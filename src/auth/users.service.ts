import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { InjectDb, type Db } from '../db/db.module';
import { orgMembers, orgs, sessions, users, type User } from '../db/schema';

/** Session tokens start with this, so they're never mistaken for a picked person's id. */
const SESSION = 'cbs_';
/** How long a sign-in lasts. */
const SESSION_DAYS = 30;
/** Last-used times are only written this often, not on every request. */
const TOUCH_MS = 60 * 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who's who. People sign in with a passkey and get a session token (see PasskeysService). In development they can
 * instead pick who they are from everyone here, or add themselves (`peoplePicker`); then the bearer token is just their
 * id, which is only fit for local use.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  /** Whether people may pick who they are, with no sign-in. */
  get pickerOn(): boolean {
    return this.config.get<boolean>('peoplePicker') === true;
  }

  /** Everyone, to pick from. */
  list(): Promise<User[]> {
    return this.db.query.users.findMany({ orderBy: [asc(users.name), asc(users.email)] });
  }

  /** Who a token names: a live session's person, or (with the picker on) the person whose id it is. */
  async byToken(token: string): Promise<User> {
    if (token.startsWith(SESSION)) {
      const [row] = await this.db
        .select({ user: users, session: sessions })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
      if (!row) throw new Error('Signed out');
      if (Date.now() - row.session.lastUsedAt.getTime() > TOUCH_MS) {
        await this.db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, row.session.id));
      }
      return row.user;
    }
    const user = this.pickerOn && UUID.test(token) ? await this.db.query.users.findFirst({ where: eq(users.id, token) }) : undefined;
    if (!user) throw new Error('No such person');
    return user;
  }

  /** Signs someone in: a new session, and the token for it (shown once; only its hash is kept). */
  async startSession(userId: string): Promise<string> {
    const token = `${SESSION}${randomBytes(32).toString('base64url')}`;
    await this.db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
    return token;
  }

  /** Signs a session out. Tokens that aren't sessions (picked ids) have nothing to end. */
  async endSession(token: string): Promise<void> {
    if (token.startsWith(SESSION)) await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  /** Adds someone, with a workspace of their own that they own, so they can make boards straight away. */
  async create(name: string, rawEmail: string, id?: string): Promise<User> {
    const email = rawEmail.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ ...(id ? { id } : {}), name: name.trim(), email })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!created) throw new ConflictException(`${email} is already here; pick them instead`);
      const [org] = await tx
        .insert(orgs)
        .values({ name: `${created.name}'s workspace` })
        .returning();
      await tx.insert(orgMembers).values({ orgId: org.id, userId: created.id, role: 'owner' });
      return created;
    });
  }
}
