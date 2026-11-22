import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** A share link's password, hashed for keeping: "scrypt$<salt>$<hash>", base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64url'), want.length);
  return timingSafeEqual(got, want);
}

/** How long a guest who typed the right password can keep opening the link without typing it again. */
export const PASS_MS = 12 * 60 * 60 * 1000;

/**
 * Proof that a guest typed a link's password: "<expiry>.<mac>", the mac keyed with the stored hash, so it can't be made
 * without the database and stops working when the password changes.
 */
export function issuePass(linkId: string, stored: string, now = Date.now()): string {
  const until = now + PASS_MS;
  return `${until}.${mac(linkId, stored, until)}`;
}

export function checkPass(pass: string | undefined, linkId: string, stored: string, now = Date.now()): boolean {
  const [untilText, given] = (pass ?? '').split('.');
  const until = Number(untilText);
  if (!given || !Number.isFinite(until) || until <= now) return false;
  const want = Buffer.from(mac(linkId, stored, until));
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}

const mac = (linkId: string, stored: string, until: number) => createHmac('sha256', stored).update(`${linkId}.${until}`).digest('base64url');

/** Wrong passwords allowed per link from one address, and from everyone, in each window. */
export const ATTEMPTS = { perAddress: 5, perLink: 30, windowMs: 15 * 60 * 1000 };

/** Counts wrong passwords, in memory: after too many, a link stops taking guesses for a while. */
export class Attempts {
  readonly #misses = new Map<string, { count: number; resetAt: number }>();

  /** Minutes until guessing may resume, or 0 when it may go ahead now. */
  waitFor(linkId: string, address: string, now = Date.now()): number {
    const blocked = (key: string, max: number) => {
      const entry = this.#misses.get(key);
      return entry && entry.resetAt > now && entry.count >= max ? entry.resetAt : 0;
    };
    const until = Math.max(blocked(`${linkId}|${address}`, ATTEMPTS.perAddress), blocked(linkId, ATTEMPTS.perLink));
    return until ? Math.ceil((until - now) / 60_000) : 0;
  }

  miss(linkId: string, address: string, now = Date.now()): void {
    for (const key of [`${linkId}|${address}`, linkId]) {
      const entry = this.#misses.get(key);
      if (!entry || entry.resetAt <= now) this.#misses.set(key, { count: 1, resetAt: now + ATTEMPTS.windowMs });
      else entry.count++;
    }
    // Keep the map from growing without end: drop windows that have passed.
    if (this.#misses.size > 10_000) for (const [key, entry] of this.#misses) if (entry.resetAt <= now) this.#misses.delete(key);
  }
}
