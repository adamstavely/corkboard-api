import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts secrets at rest (model API keys) with AES-256-GCM under MODEL_KEY_SECRET. Stored as
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64. Rotating the secret means re-entering the keys.
 */
@Injectable()
export class SecretBox {
  readonly #key: Buffer | undefined;

  constructor(config: ConfigService) {
    const secret = config.get<string>('modelKeySecret');
    if (!secret) return;
    const key = Buffer.from(secret, 'base64');
    if (key.length !== 32) throw new Error('MODEL_KEY_SECRET must be 32 bytes, base64 (openssl rand -base64 32)');
    this.#key = key;
  }

  get ready(): boolean {
    return !!this.#key;
  }

  seal(plain: string): string {
    const key = this.#require();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join('.');
  }

  open(sealed: string): string {
    const key = this.#require();
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !data) throw new Error('Unreadable secret');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  #require(): Buffer {
    if (!this.#key) throw new Error('MODEL_KEY_SECRET is not set, so model API keys can’t be stored');
    return this.#key;
  }
}
