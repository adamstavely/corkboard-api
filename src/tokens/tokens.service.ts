import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/users.service';
import { InjectDb, type Db } from '../db/db.module';
import { accessTokens, users, type AccessToken, type User } from '../db/schema';
import { TOKEN_PREFIX, type Scope } from './scopes';
import type { AccessTokenDto, CreatedAccessTokenDto } from './tokens.dto';

/** Last-used times are only written this often, not on every call. */
const TOUCH_MS = 60_000;
/** How many live tokens one person may have. */
const MAX_TOKENS = 50;
/** How much of a token the list shows: the prefix and eight more characters. */
const SHOWN = TOKEN_PREFIX.length + 8;

/** An access token at work: who it acts for, and what it may do. */
export interface Agent {
  tokenId: string;
  /** The token's name, which is how boards name the agent: "Cursor". */
  name: string;
  scopes: Scope[];
}

/** Whether a token still works. */
export const isLive = (t: Pick<AccessToken, 'revokedAt' | 'expiresAt'>, now = Date.now()) => !t.revokedAt && (!t.expiresAt || t.expiresAt.getTime() > now);

const toDto = (t: AccessToken): AccessTokenDto => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes as Scope[],
  createdAt: t.createdAt.getTime(),
  expiresAt: t.expiresAt?.getTime() ?? null,
  lastUsedAt: t.lastUsedAt?.getTime() ?? null,
});

/** Personal access tokens: people make and revoke their own; agents sign in with them (see AuthGuard). */
@Injectable()
export class TokensService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Your tokens that haven't been revoked, newest first; expired ones too, so you can see why one stopped. */
  async list(user: User): Promise<AccessTokenDto[]> {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(and(eq(accessTokens.userId, user.id), isNull(accessTokens.revokedAt)))
      .orderBy(desc(accessTokens.createdAt));
    return rows.map(toDto);
  }

  /** A new token: returned once, with only its hash kept. */
  async create(user: User, name: string, scopes: Scope[], expiresInDays?: number): Promise<CreatedAccessTokenDto> {
    const [{ live }] = await this.db
      .select({ live: count() })
      .from(accessTokens)
      .where(and(eq(accessTokens.userId, user.id), isNull(accessTokens.revokedAt)));
    if (live >= MAX_TOKENS) throw new ConflictException(`You have ${MAX_TOKENS} access tokens already; revoke one you no longer use first`);
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const [row] = await this.db
      .insert(accessTokens)
      .values({
        userId: user.id,
        name: name.trim(),
        prefix: token.slice(0, SHOWN),
        tokenHash: hashToken(token),
        scopes: [...new Set(scopes)],
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      })
      .returning();
    return { ...toDto(row), token };
  }

  /** It stops working at once. */
  async revoke(user: User, id: string): Promise<void> {
    const [row] = await this.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, user.id), isNull(accessTokens.revokedAt)))
      .returning({ id: accessTokens.id });
    if (!row) throw new NotFoundException('That token is not yours, or is already revoked');
  }

  /** Who a token acts for and what it may do; throws if it's unknown, revoked or expired. */
  async signin(token: string): Promise<{ user: User; agent: Agent }> {
    const [row] = await this.db
      .select({ user: users, token: accessTokens })
      .from(accessTokens)
      .innerJoin(users, eq(users.id, accessTokens.userId))
      .where(eq(accessTokens.tokenHash, hashToken(token)));
    if (!row || !isLive(row.token)) throw new Error('No such token');
    if (!row.token.lastUsedAt || Date.now() - row.token.lastUsedAt.getTime() > TOUCH_MS) {
      await this.db.update(accessTokens).set({ lastUsedAt: new Date() }).where(eq(accessTokens.id, row.token.id));
    }
    return { user: row.user, agent: { tokenId: row.token.id, name: row.token.name, scopes: row.token.scopes as Scope[] } };
  }
}
