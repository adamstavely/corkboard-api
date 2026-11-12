import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../src/app.module';
import { KEY_SOURCE } from '../../src/auth/token-verifier';
import { CHAT_MODELS, type ChatModelFactory } from '../../src/models/chat-models';

export const ISSUER = 'https://idp.corkboard.test/realms/corkboard';
export const AUDIENCE = 'corkboard-ui';

export interface TestApp {
  app: INestApplication;
  /** The collaboration socket, e.g. ws://127.0.0.1:1234/collab. */
  collabUrl: string;
  /** A signed access token for a person; `claims` overrides the defaults (issuer, audience, expiry, name). */
  token(subject: string, claims?: Record<string, unknown>): Promise<string>;
  /** Signed with a key the API doesn't trust. */
  foreignToken(subject: string): Promise<string>;
}

/**
 * The app as main.ts builds it, trusting a key pair made here instead of a real identity provider. `models` replaces the
 * real model adapters, so tests never call a model API.
 */
export async function createTestApp(options: { models?: ChatModelFactory } = {}): Promise<TestApp> {
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  process.env.MODEL_KEY_SECRET = randomBytes(32).toString('base64');

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const kid = randomUUID();
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256' }] });

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KEY_SOURCE)
    .useValue(() => Promise.resolve(jwks));
  if (options.models) builder = builder.overrideProvider(CHAT_MODELS).useValue(options.models);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  // Listening for real, so tests can open the collaboration socket.
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;

  const sign = (key: KeyLike, subject: string, claims: Record<string, unknown> = {}) =>
    new SignJWT({ name: `Person ${subject}`, email: `${subject}@corkboard.test`, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(subject)
      .setIssuer((claims.iss as string) ?? ISSUER)
      .setAudience((claims.aud as string) ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime((claims.exp as number) ?? '5m')
      .sign(key);

  return {
    app,
    collabUrl: `ws://127.0.0.1:${port}/collab`,
    token: (subject, claims) => sign(privateKey, subject, claims),
    foreignToken: (subject) => sign(foreign.privateKey, subject),
  };
}
