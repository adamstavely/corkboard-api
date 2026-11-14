import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest());
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** User present and verified; and, when making a passkey, attested credential data follows. */
const FLAGS = { up: 0x01, uv: 0x04, at: 0x40 };

interface Options {
  challenge: string;
  rp?: { id?: string };
  rpId?: string;
  user?: { id: string };
}

/**
 * A passkey authenticator in software, for tests: makes P-256 passkeys and signs sign-ins with them, the way a browser
 * and a phone or laptop would, answering the options the API hands out.
 */
export class SoftAuthenticator {
  readonly #keys = new Map<string, { key: KeyObject; userHandle: string; counter: number }>();

  constructor(private readonly origin = 'http://localhost:4300') {}

  /** Answers sign-up (or add-a-passkey) options with a new passkey. */
  create(options: Options): Record<string, unknown> {
    const rpId = options.rp?.id ?? 'localhost';
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(16);
    const cose = isoCBOR.encode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]) as never,
    );
    const authData = concat(sha256(rpId), new Uint8Array([FLAGS.up | FLAGS.uv | FLAGS.at]), u32(0), new Uint8Array(16), new Uint8Array([0, id.length]), id, cose);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never,
    );
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    this.#keys.set(b64(id), { key: privateKey, userHandle: options.user?.id ?? '', counter: 0 });
    return {
      id: b64(id),
      rawId: b64(id),
      type: 'public-key',
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
    };
  }

  /** Answers sign-in options with one of its passkeys (the first, unless one is named). */
  get(options: Options, credentialId = [...this.#keys.keys()][0]): Record<string, unknown> {
    const held = this.#keys.get(credentialId);
    if (!held) throw new Error('No such passkey here');
    held.counter += 1;
    const authenticatorData = concat(sha256(options.rpId ?? 'localhost'), new Uint8Array([FLAGS.up | FLAGS.uv]), u32(held.counter));
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const signature = sign('sha256', concat(authenticatorData, sha256(clientDataJSON)), held.key);
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature), userHandle: held.userHandle },
      clientExtensionResults: {},
    };
  }
}
