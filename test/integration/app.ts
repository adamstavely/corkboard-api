import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { KEY_SOURCE } from '../../src/auth/token-verifier';

export const ISSUER = 'https://idp.corkboard.test/realms/corkboard';
export const AUDIENCE = 'corkboard-ui';

export interface TestApp {
  app: INestApplication;
  /** A signed access token for a person; `claims` overrides the defaults (issuer, audience, expiry, name). */
  token(subject: string, claims?: Record<string, unknown>): Promise<string>;
  /** Signed with a key the API doesn't trust. */
  foreignToken(subject: string): Promise<string>;
}

/** The app as main.ts builds it, trusting a key pair made here instead of a real identity provider. */
export async function createTestApp(): Promise<TestApp> {
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_AUDIENCE = AUDIENCE;

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const kid = randomUUID();
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256' }] });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KEY_SOURCE)
    .useValue(() => Promise.resolve(jwks))
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const sign = (key: KeyLike, subject: string, claims: Record<string, unknown> = {}) =>
    new SignJWT({ name: `Person ${subject}`, email: `${subject}@corkboard.test`, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject(subject)
      .setIssuer((claims.iss as string) ?? ISSUER)
      .setAudience((claims.aud as string) ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime((claims.exp as number) ?? '5m')
      .sign(key);

  return {
    app,
    token: (subject, claims) => sign(privateKey, subject, claims),
    foreignToken: (subject) => sign(foreign.privateKey, subject),
  };
}
