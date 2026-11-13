import { ConflictException, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgMembers, orgs, users, type User } from '../db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * There's no sign-in. People pick who they are from everyone here, or add themselves; the bearer token is just their id.
 * That's only fit for local or private use.
 */
@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Everyone, to pick from. */
  list(): Promise<User[]> {
    return this.db.query.users.findMany({ orderBy: [asc(users.name), asc(users.email)] });
  }

  /** Who a token names, or an error when it names nobody. */
  async byToken(token: string): Promise<User> {
    const user = UUID.test(token) ? await this.db.query.users.findFirst({ where: eq(users.id, token) }) : undefined;
    if (!user) throw new Error('No such person');
    return user;
  }

  /** Adds someone, with a workspace of their own that they own, so they can make boards straight away. */
  async create(name: string, rawEmail: string): Promise<User> {
    const email = rawEmail.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ name: name.trim(), email }).onConflictDoNothing({ target: users.email }).returning();
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
