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
}

/** The app as main.ts builds it. `models` replaces the real model adapters, so tests never call a model API. */
export async function createTestApp(options: { models?: ChatModelFactory; providers?: [unknown, unknown][] } = {}): Promise<TestApp> {
  process.env.MODEL_KEY_SECRET = randomBytes(32).toString('base64');

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.models) builder = builder.overrideProvider(CHAT_MODELS).useValue(options.models);
  for (const [token, value] of options.providers ?? []) builder = builder.overrideProvider(token).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  // Listening for real, so tests can open the collaboration socket.
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;

  const tokens = new Map<string, Promise<string>>();
  const token = (subject: string, as: { name?: string; email?: string } = {}) => {
    if (!tokens.has(subject)) {
      const body = { name: as.name ?? `Person ${subject}`, email: as.email ?? `${subject}@corkboard.test` };
      tokens.set(subject, request(app.getHttpServer()).post('/people').send(body).expect(201).then((res) => res.body.id as string));
    }
    return tokens.get(subject)!;
  };

  return { app, collabUrl: `ws://127.0.0.1:${port}/collab`, token };
}
