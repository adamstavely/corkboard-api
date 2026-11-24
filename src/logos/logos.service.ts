import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { SiteAdmins } from '../site/site-admins';
import { InjectDb, type Db } from '../db/db.module';
import { logoPacks, type LogoPack, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import type { AddedLogosDto, AddLogosDto, LogoPackDto } from './logos.dto';
import { cleanLogo, LOGO_NAME, PACK_NAME, type Logo } from './svg-logo';

const packDto = (r: LogoPack): LogoPackDto => ({ name: r.name, licence: r.licence, logos: r.logos, site: r.orgId === null, updatedAt: r.updatedAt });

/** How much a workspace (or the site's library) may keep. */
export const LOGO_LIMITS = { packs: 20, logos: 3000 };
/** The cloud vendors' packs: only the site's library has them, kept up to date by its site admins for everyone. */
export const SITE_PACKS = ['aws', 'azure', 'google-cloud', 'oracle-cloud', 'ibm-cloud', 'kubernetes'] as const;

/**
 * Logo packs for diagrams: the site's library (the cloud vendors' icons, from their own downloads), which its site admins
 * keep up to date and every workspace uses, and a workspace's own packs (its company's logos), which its owners keep.
 * Every logo is checked (svg-logo.ts) before it's kept.
 */
@Injectable()
export class LogosService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly siteAdmins: SiteAdmins,
  ) {}

  /** The packs a workspace's boards use: the site's library, then the workspace's own (a site pack's name wins). */
  async list(user: User, orgId: string): Promise<LogoPackDto[]> {
    await this.orgs.roleIn(user.id, orgId);
    const site = await this.#site();
    const own = await this.db.select().from(logoPacks).where(eq(logoPacks.orgId, orgId)).orderBy(logoPacks.name);
    const taken = new Set(site.map((r) => r.name));
    return [...site, ...own.filter((r) => !taken.has(r.name))].map(packDto);
  }

  /** Site admins: the library. */
  async siteList(user: User): Promise<LogoPackDto[]> {
    this.siteAdmins.require(user);
    return (await this.#site()).map(packDto);
  }

  /**
   * Site admins: add logos to a library pack (made if it's new). With `replace`, the pack starts afresh from this batch,
   * for a vendor's new download: send its first batch with replace, the rest without.
   */
  async siteAdd(user: User, name: string, body: AddLogosDto): Promise<AddedLogosDto> {
    this.siteAdmins.require(user);
    if (!PACK_NAME.test(name)) throw new BadRequestException('A pack is named in lower case letters, numbers and hyphens, as aws or google-cloud.');
    if (name === 'devicon') throw new BadRequestException('devicon is the bundled tech logo pack: name yours something else.');
    return this.#add(null, user, name, body);
  }

  async siteRemove(user: User, name: string): Promise<void> {
    this.siteAdmins.require(user);
    const gone = await this.db
      .delete(logoPacks)
      .where(and(isNull(logoPacks.orgId), eq(logoPacks.name, name)))
      .returning({ id: logoPacks.id });
    if (!gone.length) throw new NotFoundException('There is no logo pack by that name.');
  }

  async #site() {
    return this.db.select().from(logoPacks).where(isNull(logoPacks.orgId)).orderBy(logoPacks.name);
  }

  /** Adds logos to a pack, making it if it's new; logos that aren't plain drawings are refused, by name, with why. */
  async add(user: User, orgId: string, name: string, body: AddLogosDto): Promise<AddedLogosDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    if (!PACK_NAME.test(name)) throw new BadRequestException('A pack is named in lower case letters, numbers and hyphens, as aws or google-cloud.');
    if (name === 'devicon') throw new BadRequestException('devicon is the bundled tech logo pack: name yours something else.');
    if ((SITE_PACKS as readonly string[]).includes(name) || (await this.#site()).some((r) => r.name === name))
      throw new BadRequestException(`${name} comes from Corkboard's icon library, kept up to date by its site admins: there's no need to add it.`);
    return this.#add(orgId, user, name, body);
  }

  /** Adds logos to a pack of a workspace's own (orgId) or of the site's library (null), making it if it's new. */
  async #add(orgId: string | null, user: User, name: string, body: AddLogosDto): Promise<AddedLogosDto> {
    const owner = orgId === null ? isNull(logoPacks.orgId) : eq(logoPacks.orgId, orgId);
    const [existing] = await this.db
      .select()
      .from(logoPacks)
      .where(and(owner, eq(logoPacks.name, name)));
    if (!existing) {
      const packs = await this.db.select({ id: logoPacks.id }).from(logoPacks).where(owner);
      if (packs.length >= LOGO_LIMITS.packs) throw new BadRequestException(`A workspace keeps at most ${LOGO_LIMITS.packs} logo packs.`);
    }
    const logos: Record<string, Logo> = body.replace ? {} : { ...(existing?.logos ?? {}) };
    const refused: { name: string; reason: string }[] = [];
    let added = 0;
    for (const [logo, raw] of Object.entries(body.logos ?? {})) {
      if (!LOGO_NAME.test(logo)) {
        refused.push({ name: logo, reason: 'its name is not lower case letters, numbers, dots and hyphens' });
        continue;
      }
      const clean = cleanLogo(raw ?? {});
      if ('error' in clean) {
        refused.push({ name: logo, reason: clean.error });
        continue;
      }
      if (!(logo in logos) && Object.keys(logos).length >= LOGO_LIMITS.logos) {
        refused.push({ name: logo, reason: `the pack already has ${LOGO_LIMITS.logos} logos` });
        continue;
      }
      logos[logo] = clean;
      added++;
    }
    const values = { logos, updatedAt: new Date(), ...(body.licence !== undefined ? { licence: body.licence } : {}) };
    if (existing) await this.db.update(logoPacks).set(values).where(eq(logoPacks.id, existing.id));
    else await this.db.insert(logoPacks).values({ orgId, name, createdBy: user.id, ...values });
    return { name, added, total: Object.keys(logos).length, refused };
  }

  async remove(user: User, orgId: string, name: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    const gone = await this.db
      .delete(logoPacks)
      .where(and(eq(logoPacks.orgId, orgId), eq(logoPacks.name, name)))
      .returning({ id: logoPacks.id });
    if (!gone.length) throw new NotFoundException('There is no logo pack by that name.');
  }
}
