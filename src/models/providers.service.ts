import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { modelProviders, type ModelProvider, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { ModelError, type ChatModel } from './adapters/types';
import { allowedBaseUrl, CHAT_MODELS, type ChatModelFactory } from './chat-models';
import type { CreateProviderDto, ProviderDto, ProviderTestDto, UpdateProviderDto } from './providers.dto';
import { SecretBox } from './secret-box';

const toDto = (p: ModelProvider): ProviderDto => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  model: p.model,
  baseUrl: p.baseUrl,
  hasKey: !!p.apiKeyEncrypted,
  createdAt: p.createdAt,
});

/**
 * The models a workspace can use. Admins add, change, test and remove them; everyone in the workspace can see them (but
 * not their keys) and use them on the workspace's boards.
 */
@Injectable()
export class ProvidersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly secrets: SecretBox,
    @Inject(CHAT_MODELS) private readonly models: ChatModelFactory,
  ) {}

  async list(user: User, orgId: string): Promise<ProviderDto[]> {
    await this.orgs.roleIn(user.id, orgId);
    const rows = await this.db.select().from(modelProviders).where(eq(modelProviders.orgId, orgId)).orderBy(asc(modelProviders.createdAt));
    return rows.map(toDto);
  }

  async create(user: User, orgId: string, body: CreateProviderDto): Promise<ProviderDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const baseUrl = this.#baseUrl(body.baseUrl);
    const [row] = await this.db
      .insert(modelProviders)
      .values({
        orgId,
        label: body.label.trim(),
        kind: body.kind,
        model: body.model.trim(),
        baseUrl,
        apiKeyEncrypted: this.#seal(body.apiKey),
        createdBy: user.id,
      })
      .returning();
    return toDto(row);
  }

  async update(user: User, orgId: string, id: string, body: UpdateProviderDto): Promise<ProviderDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    await this.#find(orgId, id);
    const [row] = await this.db
      .update(modelProviders)
      .set({
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.model !== undefined ? { model: body.model.trim() } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: this.#baseUrl(body.baseUrl) } : {}),
        ...(body.apiKey !== undefined ? { apiKeyEncrypted: this.#seal(body.apiKey) } : {}),
      })
      .where(eq(modelProviders.id, id))
      .returning();
    return toDto(row);
  }

  async remove(user: User, orgId: string, id: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    await this.#find(orgId, id);
    await this.db.delete(modelProviders).where(eq(modelProviders.id, id));
  }

  /** Asks the model for a one-word reply, so an admin knows the connection works before anyone relies on it. */
  async test(user: User, orgId: string, id: string): Promise<ProviderTestDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const model = await this.modelFor(orgId, id);
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
  async modelFor(orgId: string, id: string): Promise<ChatModel & { label: string }> {
    const provider = await this.#find(orgId, id);
    let apiKey: string | null = null;
    if (provider.apiKeyEncrypted) {
      try {
        apiKey = this.secrets.open(provider.apiKeyEncrypted);
      } catch {
        throw new ServiceUnavailableException(`${provider.label}'s key can't be read. An admin needs to enter it again.`);
      }
    }
    return Object.assign(this.models(provider, apiKey), { label: provider.label });
  }

  async #find(orgId: string, id: string): Promise<ModelProvider> {
    const [row] = await this.db
      .select()
      .from(modelProviders)
      .where(and(eq(modelProviders.id, id), eq(modelProviders.orgId, orgId)));
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
