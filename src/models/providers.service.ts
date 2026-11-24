import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { SiteAdmins } from '../site/site-admins';
import { InjectDb, type Db } from '../db/db.module';
import { modelProviders, modelUsage, workspaceModels, type ModelProvider, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { ModelError, type ChatModel } from './adapters/types';
import { ModelJobs } from './model-jobs';
import { allowedBaseUrl, CHAT_MODELS, type ChatModelFactory } from './chat-models';
import type { CreateProviderDto, ProviderDto, ProviderTestDto, UpdateProviderDto, WorkspaceModelDto } from './providers.dto';
import { SecretBox } from './secret-box';

const toDto = (p: ModelProvider): ProviderDto => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  model: p.model,
  baseUrl: p.baseUrl,
  hasKey: !!p.apiKeyEncrypted,
  priceInPerMillion: p.priceInPerMillion,
  priceOutPerMillion: p.priceOutPerMillion,
  createdAt: p.createdAt,
});

/**
 * The site's AI connections. Its site admins add, change, test and remove them (and only they see the whole list, never
 * anything about workspaces); a workspace's owners switch on the ones its people may use; everyone in a workspace sees
 * those (never their keys) and uses them on its boards.
 */
@Injectable()
export class ProvidersService implements OnModuleDestroy {
  readonly #log = new Logger(ProvidersService.name);
  /** The model requests running now (see ModelJobs). */
  readonly jobs = new ModelJobs();

  /**
   * First thing at shutdown, before boards are saved (CollabService) and the HTTP server waits on open requests: refuse
   * new model work, stop what's running, and wait for it to finish with what it has, so none outlives the API.
   */
  async onModuleDestroy(): Promise<void> {
    await this.jobs.drain();
  }
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly secrets: SecretBox,
    private readonly siteAdmins: SiteAdmins,
    @Inject(CHAT_MODELS) private readonly models: ChatModelFactory,
  ) {}

  /** The models a workspace's people may use: the site connections its owners switched on. */
  async list(user: User, orgId: string): Promise<ProviderDto[]> {
    await this.orgs.roleIn(user.id, orgId);
    const rows = await this.db
      .select({ p: modelProviders })
      .from(workspaceModels)
      .innerJoin(modelProviders, eq(workspaceModels.providerId, modelProviders.id))
      .where(eq(workspaceModels.orgId, orgId))
      .orderBy(asc(modelProviders.createdAt));
    return rows.map((r) => toDto(r.p));
  }

  /** Workspace owners: every site connection, and whether the workspace has it switched on. */
  async choices(user: User, orgId: string): Promise<WorkspaceModelDto[]> {
    await this.orgs.require(user.id, orgId, 'owner');
    const on = new Set((await this.db.select({ id: workspaceModels.providerId }).from(workspaceModels).where(eq(workspaceModels.orgId, orgId))).map((r) => r.id));
    const rows = await this.db.select().from(modelProviders).orderBy(asc(modelProviders.createdAt));
    return rows.map((p) => ({ ...toDto(p), enabled: on.has(p.id) }));
  }

  /** Workspace owners: switch a site connection on or off for the workspace's people. */
  async setEnabled(user: User, orgId: string, id: string, enabled: boolean): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    await this.#provider(id);
    if (enabled) await this.db.insert(workspaceModels).values({ orgId, providerId: id }).onConflictDoNothing();
    else await this.db.delete(workspaceModels).where(and(eq(workspaceModels.orgId, orgId), eq(workspaceModels.providerId, id)));
  }

  /** Site admins: every connection. */
  async siteList(user: User): Promise<ProviderDto[]> {
    this.siteAdmins.require(user);
    const rows = await this.db.select().from(modelProviders).orderBy(asc(modelProviders.createdAt));
    return rows.map(toDto);
  }

  async create(user: User, body: CreateProviderDto): Promise<ProviderDto> {
    this.siteAdmins.require(user);
    const baseUrl = this.#baseUrl(body.baseUrl);
    const [row] = await this.db
      .insert(modelProviders)
      .values({
        label: body.label.trim(),
        kind: body.kind,
        model: body.model.trim(),
        baseUrl,
        apiKeyEncrypted: this.#seal(body.apiKey),
        ...(body.priceInPerMillion !== undefined ? { priceInPerMillion: body.priceInPerMillion } : {}),
        ...(body.priceOutPerMillion !== undefined ? { priceOutPerMillion: body.priceOutPerMillion } : {}),
        createdBy: user.id,
      })
      .returning();
    return toDto(row);
  }

  async update(user: User, id: string, body: UpdateProviderDto): Promise<ProviderDto> {
    this.siteAdmins.require(user);
    await this.#provider(id);
    const [row] = await this.db
      .update(modelProviders)
      .set({
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.model !== undefined ? { model: body.model.trim() } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: this.#baseUrl(body.baseUrl) } : {}),
        ...(body.apiKey !== undefined ? { apiKeyEncrypted: this.#seal(body.apiKey) } : {}),
        ...(body.priceInPerMillion !== undefined ? { priceInPerMillion: body.priceInPerMillion } : {}),
        ...(body.priceOutPerMillion !== undefined ? { priceOutPerMillion: body.priceOutPerMillion } : {}),
      })
      .where(eq(modelProviders.id, id))
      .returning();
    return toDto(row);
  }

  /** Site admins: remove a connection; every workspace that used it loses it. */
  async remove(user: User, id: string): Promise<void> {
    this.siteAdmins.require(user);
    await this.#provider(id);
    await this.db.delete(modelProviders).where(eq(modelProviders.id, id));
  }

  /** Asks the model for a one-word reply, so an admin knows the connection works before anyone relies on it. */
  async test(user: User, id: string): Promise<ProviderTestDto> {
    this.siteAdmins.require(user);
    const model = this.#ready(await this.#provider(id), 'site');
    const started = Date.now();
    const latencyMs = () => Date.now() - started;
    try {
      const { text } = await model.chat({
        system: 'You are checking a connection.',
        prompt: 'Reply with the single word OK.',
        tools: [],
        execute: () => Promise.resolve(''),
        maxSteps: 1,
      });
      return { ok: true, status: 'healthy', message: text || '(an empty reply)', latencyMs: latencyMs() };
    } catch (err) {
      if (!(err instanceof ModelError)) return { ok: false, status: 'error', message: 'The connection test failed.', latencyMs: latencyMs() };
      const status = ({ auth: 'auth-failed', model: 'model-unavailable', unreachable: 'unreachable', other: 'error' } as const)[err.failure];
      return { ok: false, status, message: err.message, latencyMs: latencyMs() };
    }
  }

  /** A workspace's model, ready to call; the caller has checked the person may use the workspace. */
  /**
   * A workspace's model, ready to call. With `use`, every call records the tokens it used (even when it fails partway),
   * for the workspace's usage and spend.
   */
  async modelFor(orgId: string, id: string, use?: { userId: string; boardId?: string; feature: string }): Promise<ChatModel & { label: string }> {
    const provider = await this.#find(orgId, id);
    if (!use) return this.#ready(provider, orgId);
    const model = this.#client(provider);
    return {
      label: provider.label,
      chat: async (request) => {
        let input = 0;
        let output = 0;
        try {
          return await this.jobs.run(orgId, request.signal, (signal) =>
            model.chat({
              ...request,
              signal,
              onUsage: (i, o) => {
                input += i;
                output += o;
                request.onUsage?.(i, o);
              },
            }),
          );
        } finally {
          if (input || output) {
            await this.db
              .insert(modelUsage)
              .values({
                orgId,
                providerId: provider.id,
                providerLabel: provider.label,
                boardId: use.boardId ?? null,
                userId: use.userId,
                feature: use.feature,
                inputTokens: input,
                outputTokens: output,
              })
              .catch((err: unknown) => this.#log.warn(`Couldn't record model usage: ${String(err)}`));
          }
        }
      },
    };
  }

  /** A connection ready to call, its calls counted against `key`'s few at once (see ModelJobs). */
  #ready(provider: ModelProvider, key: string): ChatModel & { label: string } {
    const model = this.#client(provider);
    return { label: provider.label, chat: (request) => this.jobs.run(key, request.signal, (signal) => model.chat({ ...request, signal })) };
  }

  #client(provider: ModelProvider): ChatModel {
    let apiKey: string | null = null;
    if (provider.apiKeyEncrypted) {
      try {
        apiKey = this.secrets.open(provider.apiKeyEncrypted);
      } catch {
        throw new ServiceUnavailableException(`${provider.label}'s key can't be read. A site admin needs to enter it again.`);
      }
    }
    return this.models(provider, apiKey);
  }

  /** A connection the workspace has switched on; any other is not found, as if it weren't there. */
  async #find(orgId: string, id: string): Promise<ModelProvider> {
    const [row] = await this.db
      .select({ p: modelProviders })
      .from(workspaceModels)
      .innerJoin(modelProviders, eq(workspaceModels.providerId, modelProviders.id))
      .where(and(eq(workspaceModels.orgId, orgId), eq(modelProviders.id, id)));
    if (!row) throw new NotFoundException('Model not found');
    return row.p;
  }

  async #provider(id: string): Promise<ModelProvider> {
    const [row] = await this.db.select().from(modelProviders).where(eq(modelProviders.id, id));
    if (!row) throw new NotFoundException('Model not found');
    return row;
  }

  #baseUrl(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (!allowedBaseUrl(value)) throw new BadRequestException("That address can't be used for a model.");
    return value.replace(/\/+$/, '');
  }

  #seal(apiKey: string | undefined): string | null {
    const value = apiKey?.trim();
    if (!value) return null;
    if (!this.secrets.ready) throw new ServiceUnavailableException('This server can’t store API keys yet (MODEL_KEY_SECRET is not set).');
    return this.secrets.seal(value);
  }
}
