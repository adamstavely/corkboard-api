import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgMembers, orgs, users, type User } from '../db/schema';
import type { Identity } from './token-verifier';

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The user behind a verified token, created on their first request. A new user gets an org of their own, which they
   * administer, so they can make boards straight away.
   */
  async signIn(identity: Identity): Promise<User> {
    const existing = await this.db.query.users.findFirst({ where: eq(users.oidcSubject, identity.subject) });
    if (existing) {
      if (
        existing.name === identity.name &&
        existing.email === (identity.email ?? null) &&
        existing.emailVerified === identity.emailVerified
      ) {
        return existing;
      }
      const [updated] = await this.db
        .update(users)
        .set({ name: identity.name, email: identity.email ?? null, emailVerified: identity.emailVerified })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    return this.db.transaction(async (tx) => {
      // Two first requests can race; the loser reads the winner's row.
      const [created] = await tx
        .insert(users)
        .values({
          oidcSubject: identity.subject,
          name: identity.name,
          email: identity.email ?? null,
          emailVerified: identity.emailVerified,
        })
        .onConflictDoNothing({ target: users.oidcSubject })
        .returning();
      if (!created) return (await tx.query.users.findFirst({ where: eq(users.oidcSubject, identity.subject) }))!;

      const [org] = await tx
        .insert(orgs)
        .values({ name: `${identity.name}'s workspace` })
        .returning();
      await tx.insert(orgMembers).values({ orgId: org.id, userId: created.id, role: 'admin' });
      return created;
    });
  }
}
