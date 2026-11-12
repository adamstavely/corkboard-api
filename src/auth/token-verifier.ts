import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { OidcConfig } from '../config/configuration';

/** Who a verified access token says the caller is. */
export interface Identity {
  subject: string;
  email: string | undefined;
  name: string;
}

/** Signing keys for an issuer, found through its discovery document. Tests swap in a local key set. */
export type KeySource = (issuer: string) => Promise<JWTVerifyGetKey>;

export const KEY_SOURCE = Symbol('KEY_SOURCE');

export const discoveredKeys: KeySource = async (issuer) => {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${res.status}`);
  const { jwks_uri } = (await res.json()) as { jwks_uri?: string };
  if (!jwks_uri) throw new Error(`OIDC discovery for ${issuer} has no jwks_uri`);
  return createRemoteJWKSet(new URL(jwks_uri));
};

/** Verifies the identity provider's access tokens: signature, issuer, expiry and (when configured) audience. */
@Injectable()
export class TokenVerifier {
  readonly #oidc: OidcConfig;
  #keys: Promise<JWTVerifyGetKey> | undefined;

  constructor(
    config: ConfigService,
    @Inject(KEY_SOURCE) private readonly keySource: KeySource,
  ) {
    this.#oidc = config.getOrThrow<OidcConfig>('oidc');
  }

  async verify(token: string): Promise<Identity> {
    // Discovery is fetched once; a failure is retried on the next request rather than cached.
    this.#keys ??= this.keySource(this.#oidc.issuer).catch((err: unknown) => {
      this.#keys = undefined;
      throw err;
    });
    const { payload } = await jwtVerify(token, await this.#keys, {
      issuer: this.#oidc.issuer,
      audience: this.#oidc.audience,
    });
    return identityOf(payload);
  }
}

function identityOf(payload: JWTPayload): Identity {
  if (!payload.sub) throw new Error('Token has no subject');
  const claim = (key: string) => {
    const value = payload[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const email = claim('email');
  return { subject: payload.sub, email, name: claim('name') ?? claim('preferred_username') ?? email ?? payload.sub };
}
