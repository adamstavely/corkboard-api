import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { CHAT_MODELS, type ChatModelFactory } from '../../src/models/chat-models';

export interface TestApp {
  app: INestApplication;
  /** The collaboration socket, e.g. ws://127.0.0.1:1234/collab. */
  collabUrl: string;
  /**
   * The bearer token for a person, added the first time a subject is asked for (as "Person <subject>",
   * <subject>@corkboard.test, unless `as` says otherwise).
   */
  token(subject: string, as?: { name?: string; email?: string }): Promise<string>;
  /** The bearer header of the site admin (SITE_ADMIN_EMAILS is site-admin@corkboard.test in tests). */
  siteAdmin(): Promise<{ Authorization: string }>;
  /** A site AI connection, made by the site admin and switched on for a workspace by its owner (`auth`), as the API gives it. */
  model(orgId: string, auth: Record<string, string>, body?: Record<string, unknown>): Promise<{ id: string; label: string } & Record<string, unknown>>;
}

/** Who's a site admin in tests. */
export const SITE_ADMIN = 'site-admin@corkboard.test';

/** The app as main.ts builds it. `models` replaces the real model adapters, so tests never call a model API. */
export async function createTestApp(options: { models?: ChatModelFactory; providers?: [unknown, unknown][] } = {}): Promise<TestApp> {
  process.env.MODEL_KEY_SECRET = randomBytes(32).toString('base64');
  process.env.SITE_ADMIN_EMAILS = SITE_ADMIN;

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.models) builder = builder.overrideProvider(CHAT_MODELS).useValue(options.models);
  for (const [token, value] of options.providers ?? []) builder = builder.overrideProvider(token).useValue(value);
  const moduleRef = await builder.compile();
  // The raw body, as main.ts keeps it, for checking webhooks' signatures.
  const app = moduleRef.createNestApplication({ rawBody: true });
  // Listening for real, so tests can open the collaboration socket.
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;

  const tokens = new Map<string, Promise<string>>();
  const token = (subject: string, as: { name?: string; email?: string } = {}) => {
    if (!tokens.has(subject)) {
      const body = { name: as.name ?? `Person ${subject}`, email: as.email ?? `${subject}@corkboard.test` };
      tokens.set(
        subject,
        request(app.getHttpServer())
          .post('/people')
          .send(body)
          .expect(201)
          .then((res) => res.body.id as string),
      );
    }
    return tokens.get(subject)!;
  };

  // The site admin is one person across test files, which share a database: made by the first, found by the rest.
  let admin: Promise<string> | undefined;
  const siteAdmin = async () => {
    admin ??= request(app.getHttpServer())
      .get('/people')
      .expect(200)
      .then(async (res) => {
        const found = (res.body as { id: string; email: string }[]).find((p) => p.email === SITE_ADMIN);
        if (found) return found.id;
        const made = await request(app.getHttpServer()).post('/people').send({ name: 'Site Admin', email: SITE_ADMIN }).expect(201);
        return made.body.id as string;
      });
    return { Authorization: `Bearer ${await admin}` };
  };
  const model = async (orgId: string, auth: Record<string, string>, body: Record<string, unknown> = {}) => {
    const admin = await siteAdmin();
    const server = app.getHttpServer();
    const { body: made } = await request(server)
      .post('/site/models')
      .set(admin)
      .send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k', ...body })
      .expect(201);
    // Switched on by the workspace's owner: the site admin isn't in the workspace.
    await request(server)
      .put(`/orgs/${orgId}/models/${(made as { id: string }).id}/enabled`)
      .set(auth)
      .send({ enabled: true })
      .expect(204);
    return made as { id: string; label: string } & Record<string, unknown>;
  };

  return { app, collabUrl: `ws://127.0.0.1:${port}/collab`, token, siteAdmin, model };
}
