import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { logoPacks, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import type { AddedLogosDto, AddLogosDto, LogoPackDto } from './logos.dto';
import { cleanLogo, LOGO_NAME, PACK_NAME, type Logo } from './svg-logo';

/** How much a workspace may keep. */
export const LOGO_LIMITS = { packs: 20, logos: 3000 };

/**
 * A workspace's own logo packs for diagrams: everyone in the workspace sees them; its owners add and remove them.
 * Every logo is checked (svg-logo.ts) before it's kept.
 */
@Injectable()
export class LogosService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
  ) {}

  async list(user: User, orgId: string): Promise<LogoPackDto[]> {
    await this.orgs.roleIn(user.id, orgId);
    const rows = await this.db.select().from(logoPacks).where(eq(logoPacks.orgId, orgId)).orderBy(logoPacks.name);
    return rows.map((r) => ({ name: r.name, licence: r.licence, logos: r.logos }));
  }

  /** Adds logos to a pack, making it if it's new; logos that aren't plain drawings are refused, by name, with why. */
  async add(user: User, orgId: string, name: string, body: AddLogosDto): Promise<AddedLogosDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    if (!PACK_NAME.test(name)) throw new BadRequestException('A pack is named in lower case letters, numbers and hyphens, as aws or google-cloud.');
    if (name === 'devicon') throw new BadRequestException('devicon is the bundled tech logo pack: name yours something else.');
    const [existing] = await this.db.select().from(logoPacks).where(and(eq(logoPacks.orgId, orgId), eq(logoPacks.name, name)));
    if (!existing) {
      const packs = await this.db.select({ id: logoPacks.id }).from(logoPacks).where(eq(logoPacks.orgId, orgId));
      if (packs.length >= LOGO_LIMITS.packs) throw new BadRequestException(`A workspace keeps at most ${LOGO_LIMITS.packs} logo packs.`);
    }
    const logos: Record<string, Logo> = { ...(existing?.logos ?? {}) };
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
    const gone = await this.db.delete(logoPacks).where(and(eq(logoPacks.orgId, orgId), eq(logoPacks.name, name))).returning({ id: logoPacks.id });
    if (!gone.length) throw new NotFoundException('There is no logo pack by that name.');
  }
}
