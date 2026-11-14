import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { InjectDb, type Db } from '../db/db.module';
import { authChallenges, passkeys, users, type Passkey, type User } from '../db/schema';
import { UsersService } from './users.service';

/** How long someone has to answer their browser's passkey prompt. */
const CHALLENGE_MS = 5 * 60_000;

type Purpose = (typeof authChallenges.$inferSelect)['purpose'];

/** A passkey as its owner sees it in their account. */
export interface PasskeyView {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * Signing up and in with passkeys (WebAuthn). Each ceremony is two calls: options (a challenge the browser has the
 * passkey sign, kept server-side for a few minutes and used once), then verify, which checks the signature and starts a
 * session.
 */
@Injectable()
export class PasskeysService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  get #rp() {
    return this.config.getOrThrow<{ rpId: string; rpName: string; origins: string[] }>('webauthn');
  }

  /** Step one of signing up: a new person, named and with an email, makes their first passkey. */
  async registerOptions(name: string, rawEmail: string, label: string): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const email = rawEmail.trim().toLowerCase();
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    let userId: string = randomUUID();
    if (existing) {
      const [hasKey] = await this.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, existing.id)).limit(1);
      // Someone added with the development picker can claim their account; anyone with a passkey signs in instead.
      if (hasKey || !this.users.pickerOn) throw new ConflictException('There is already an account with that email. Sign in instead.');
      userId = existing.id;
    }
    const options = await generateRegistrationOptions({
      rpName: this.#rp.rpName,
      rpID: this.#rp.rpId,
      userName: email,
      userDisplayName: name.trim(),
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challengeId = await this.#challenge('register', options.challenge, userId, name.trim(), email, label);
    return { challengeId, options };
  }

  /** Step two of signing up: checks the new passkey, makes the account (if it's new) and signs them in. */
  async registerVerify(challengeId: string, response: RegistrationResponseJSON): Promise<{ token: string; user: User }> {
    const pending = await this.#take(challengeId, 'register');
    const credential = await this.#checkNew(pending.challenge, response);
    const user =
      (await this.db.query.users.findFirst({ where: eq(users.id, pending.userId) })) ??
      (await this.users.create(pending.name ?? 'Someone', pending.email ?? '', pending.userId));
    await this.#save(user.id, credential, pending.labelOrDefault);
    return { token: await this.users.startSession(user.id), user };
  }

  /** Step one of signing in: any passkey made here will do; the browser offers the ones it has. */
  async loginOptions(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const options = await generateAuthenticationOptions({ rpID: this.#rp.rpId, userVerification: 'preferred' });
    const challengeId = await this.#challenge('login', options.challenge, randomUUID());
    return { challengeId, options };
  }

  /** Step two of signing in: checks the passkey's signature and starts a session for its owner. */
  async loginVerify(challengeId: string, response: AuthenticationResponseJSON): Promise<{ token: string; user: User }> {
    const pending = await this.#take(challengeId, 'login');
    const [row] = await this.db
      .select({ key: passkeys, user: users })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(eq(passkeys.credentialId, response.id));
    if (!row) throw new UnauthorizedException("That passkey isn't for this site, or it was removed.");
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.#rp.origins,
        expectedRPID: this.#rp.rpId,
        credential: { id: row.key.credentialId, publicKey: new Uint8Array(row.key.publicKey), counter: row.key.counter, transports: row.key.transports },
      });
    } catch (err) {
      throw new UnauthorizedException(`That sign-in didn't check out: ${(err as Error).message}`);
    }
    if (!verified.verified) throw new UnauthorizedException("That sign-in didn't check out.");
    await this.db
      .update(passkeys)
      .set({ counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.id, row.key.id));
    return { token: await this.users.startSession(row.user.id), user: row.user };
  }

  /** Adding another passkey (another device) to your account: step one. */
  async addOptions(user: User, label: string): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const mine = await this.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: this.#rp.rpName,
      rpID: this.#rp.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: mine.map((k) => ({ id: k.credentialId, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challengeId = await this.#challenge('add', options.challenge, user.id, undefined, undefined, label);
    return { challengeId, options };
  }

  /** Adding another passkey: step two. */
  async addVerify(user: User, challengeId: string, response: RegistrationResponseJSON): Promise<PasskeyView> {
    const pending = await this.#take(challengeId, 'add');
    if (pending.userId !== user.id) throw new BadRequestException('That passkey prompt was for someone else.');
    const credential = await this.#checkNew(pending.challenge, response);
    return view(await this.#save(user.id, credential, pending.labelOrDefault));
  }

  async list(user: User): Promise<PasskeyView[]> {
    return (await this.db.select().from(passkeys).where(eq(passkeys.userId, user.id)).orderBy(asc(passkeys.createdAt))).map(view);
  }

  /** Removes one of your passkeys; not your last, or you couldn't sign in again. */
  async remove(user: User, id: string): Promise<void> {
    const mine = await this.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, user.id));
    if (!mine.some((k) => k.id === id)) throw new NotFoundException('Passkey not found');
    if (mine.length === 1) throw new ConflictException("That's your only passkey. Add another before removing it.");
    await this.db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)));
  }

  async #challenge(purpose: Purpose, challenge: string, userId: string, name?: string, email?: string, label?: string): Promise<string> {
    // Clear out old ones as new ones arrive.
    await this.db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date()));
    const [row] = await this.db
      .insert(authChallenges)
      .values({ challenge, purpose, userId, name: name ?? null, email: email ?? null, label: label ?? null, expiresAt: new Date(Date.now() + CHALLENGE_MS) })
      .returning({ id: authChallenges.id });
    return row.id;
  }

  /** Uses up a pending challenge: it must exist, be for this, and not have expired. */
  async #take(id: string, purpose: Purpose) {
    const [row] = await this.db
      .delete(authChallenges)
      .where(and(eq(authChallenges.id, id), eq(authChallenges.purpose, purpose), gt(authChallenges.expiresAt, new Date())))
      .returning();
    if (!row) throw new BadRequestException('That passkey prompt has expired. Try again.');
    return { ...row, labelOrDefault: row.label?.trim() || 'Passkey' };
  }

  async #checkNew(challenge: string, response: RegistrationResponseJSON) {
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.#rp.origins,
        expectedRPID: this.#rp.rpId,
      });
    } catch (err) {
      throw new BadRequestException(`That passkey couldn't be checked: ${(err as Error).message}`);
    }
    if (!verified.verified) throw new BadRequestException("That passkey couldn't be checked.");
    return verified.registrationInfo.credential;
  }

  async #save(userId: string, credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] }, label: string): Promise<Passkey> {
    const [key] = await this.db
      .insert(passkeys)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        label: label.slice(0, 100),
      })
      .onConflictDoNothing({ target: passkeys.credentialId })
      .returning();
    if (!key) throw new ConflictException('That passkey is already in use.');
    return key;
  }
}

const view = (k: Passkey): PasskeyView => ({ id: k.id, label: k.label, createdAt: k.createdAt.getTime(), lastUsedAt: k.lastUsedAt?.getTime() ?? null });
