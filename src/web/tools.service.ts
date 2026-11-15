import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { workspaceTools, type User } from '../db/schema';
import { SecretBox } from '../models/secret-box';
import { OrgsService } from '../orgs/orgs.service';
import type { UpdateWorkspaceToolsDto, WorkspaceToolsDto } from './tools.dto';
import type { SearchProvider } from './web';

/**
 * What each workspace's assistant may use beyond the board. Owners switch web search on and give the search service's
 * key; everyone in the workspace can see what's on, never the key.
 */
@Injectable()
export class ToolsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly secrets: SecretBox,
  ) {}

  async get(user: User, orgId: string): Promise<WorkspaceToolsDto> {
    await this.orgs.roleIn(user.id, orgId);
    return this.#dto(await this.#row(orgId));
  }

  async update(user: User, orgId: string, body: UpdateWorkspaceToolsDto): Promise<WorkspaceToolsDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const was = await this.#row(orgId);
    const next = {
      webSearch: body.webSearch ?? was?.webSearch ?? false,
      searchProvider: body.searchProvider !== undefined ? body.searchProvider : (was?.searchProvider ?? null),
      searchKeyEncrypted: body.searchKey !== undefined ? this.#seal(body.searchKey) : (was?.searchKeyEncrypted ?? null),
    };
    if (next.webSearch && (!next.searchProvider || !next.searchKeyEncrypted)) {
      throw new BadRequestException('Pick a search service and give its key before turning web search on.');
    }
    const [row] = await this.db
      .insert(workspaceTools)
      .values({ orgId, ...next, updatedBy: user.id })
      .onConflictDoUpdate({ target: workspaceTools.orgId, set: { ...next, updatedBy: user.id, updatedAt: new Date() } })
      .returning();
    return this.#dto(row);
  }

  /** The workspace's web search, if it's on: for the assistant, with the key opened. */
  async webSearchFor(orgId: string): Promise<{ provider: SearchProvider; key: string } | null> {
    const row = await this.#row(orgId);
    if (!row?.webSearch || !row.searchProvider || !row.searchKeyEncrypted || !this.secrets.ready) return null;
    return { provider: row.searchProvider, key: this.secrets.open(row.searchKeyEncrypted) };
  }

  async #row(orgId: string) {
    const [row] = await this.db.select().from(workspaceTools).where(eq(workspaceTools.orgId, orgId));
    return row;
  }

  #dto(row: typeof workspaceTools.$inferSelect | undefined): WorkspaceToolsDto {
    return { webSearch: row?.webSearch ?? false, searchProvider: row?.searchProvider ?? null, hasSearchKey: !!row?.searchKeyEncrypted };
  }

  #seal(key: string): string | null {
    const value = key.trim();
    if (!value) return null;
    if (!this.secrets.ready) throw new ServiceUnavailableException('This server can’t store API keys yet (MODEL_KEY_SECRET is not set).');
    return this.secrets.seal(value);
  }
}
