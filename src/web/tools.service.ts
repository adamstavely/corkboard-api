import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { siteSettings, workspaceTools, type User } from '../db/schema';
import { SecretBox } from '../models/secret-box';
import { OrgsService } from '../orgs/orgs.service';
import { SiteAdmins } from '../site/site-admins';
import type { SiteSearchDto, UpdateSiteSearchDto, UpdateWorkspaceToolsDto, WorkspaceToolsDto } from './tools.dto';
import type { SearchProvider } from './web';

/**
 * What each workspace's assistant may use beyond the board. The site's admins set the search service (and its key) web
 * search uses; a workspace's owners switch web search and mini-apps on or off; everyone in it sees what's on.
 */
@Injectable()
export class ToolsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly secrets: SecretBox,
    private readonly siteAdmins: SiteAdmins,
  ) {}

  async get(user: User, orgId: string): Promise<WorkspaceToolsDto> {
    await this.orgs.roleIn(user.id, orgId);
    return this.#dto(await this.#row(orgId), await this.#search());
  }

  async update(user: User, orgId: string, body: UpdateWorkspaceToolsDto): Promise<WorkspaceToolsDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const was = await this.#row(orgId);
    const search = await this.#search();
    const next = { webSearch: body.webSearch ?? was?.webSearch ?? false, miniApps: body.miniApps ?? was?.miniApps ?? true };
    if (next.webSearch && !was?.webSearch && (!search?.searchProvider || !search.searchKeyEncrypted))
      throw new BadRequestException("Web search needs the site's search service, which Corkboard's site admins haven't set up yet.");
    const [row] = await this.db
      .insert(workspaceTools)
      .values({ orgId, ...next, updatedBy: user.id })
      .onConflictDoUpdate({ target: workspaceTools.orgId, set: { ...next, updatedBy: user.id, updatedAt: new Date() } })
      .returning();
    return this.#dto(row, search);
  }

  /** Site admins: the site's search service. */
  async siteSearch(user: User): Promise<SiteSearchDto> {
    this.siteAdmins.require(user);
    const row = await this.#search();
    return { provider: row?.searchProvider ?? null, hasKey: !!row?.searchKeyEncrypted };
  }

  /** Site admins: set the search service and its key. */
  async setSiteSearch(user: User, body: UpdateSiteSearchDto): Promise<SiteSearchDto> {
    this.siteAdmins.require(user);
    const was = await this.#search();
    const next = { searchProvider: body.provider, searchKeyEncrypted: body.key !== undefined ? this.#seal(body.key) : (was?.searchKeyEncrypted ?? null), updatedAt: new Date() };
    await this.db
      .insert(siteSettings)
      .values({ id: 'site', ...next })
      .onConflictDoUpdate({ target: siteSettings.id, set: next });
    return { provider: next.searchProvider, hasKey: !!next.searchKeyEncrypted };
  }

  /** The workspace's web search, if it's on and the site has a search service: for the assistant, with the key opened. */
  async webSearchFor(orgId: string): Promise<{ provider: SearchProvider; key: string } | null> {
    const row = await this.#row(orgId);
    const search = await this.#search();
    if (!row?.webSearch || !search?.searchProvider || !search.searchKeyEncrypted || !this.secrets.ready) return null;
    return { provider: search.searchProvider, key: this.secrets.open(search.searchKeyEncrypted) };
  }

  /** Whether the workspace lets the assistant make mini-apps (it does until an owner says not). */
  async miniAppsOn(orgId: string): Promise<boolean> {
    return (await this.#row(orgId))?.miniApps ?? true;
  }

  async #row(orgId: string) {
    const [row] = await this.db.select().from(workspaceTools).where(eq(workspaceTools.orgId, orgId));
    return row;
  }

  /** The site's settings for search (a service and its key, once a site admin set them). */
  async #search() {
    const [row] = await this.db.select().from(siteSettings).where(eq(siteSettings.id, 'site'));
    return row;
  }

  #dto(row: typeof workspaceTools.$inferSelect | undefined, search: typeof siteSettings.$inferSelect | undefined): WorkspaceToolsDto {
    const available = !!search?.searchProvider && !!search.searchKeyEncrypted;
    return { webSearch: (row?.webSearch ?? false) && available, searchAvailable: available, miniApps: row?.miniApps ?? true };
  }

  #seal(key: string): string | null {
    const value = key.trim();
    if (!value) return null;
    if (!this.secrets.ready) throw new ServiceUnavailableException('This server can’t store API keys yet (MODEL_KEY_SECRET is not set).');
    return this.secrets.seal(value);
  }
}
