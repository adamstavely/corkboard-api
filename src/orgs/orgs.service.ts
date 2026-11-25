import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgMembers, orgs, type OrgRole } from '../db/schema';
import { atLeast, needs, type Role } from '../access/roles';
import { OrgDto } from './orgs.dto';

/** How many workspaces one person may own: plenty for every team they lead, not a way to fill the database. */
export const MAX_OWNED = 25;

@Injectable()
export class OrgsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The orgs a user belongs to, oldest first, with their role in each. */
  async forUser(userId: string): Promise<OrgDto[]> {
    return this.db
      .select({ id: orgs.id, name: orgs.name, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId))
      .orderBy(asc(orgMembers.createdAt));
  }

  /** The user's role in an org. An org they're not in is reported as missing, so its existence doesn't leak. */
  async roleIn(userId: string, orgId: string): Promise<OrgRole> {
    const [row] = await this.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    if (!row) throw new NotFoundException('Workspace not found');
    return row.role;
  }

  /** The user's role, if it's at least `min`; otherwise 403 (or 404 outside the org). */
  async require(userId: string, orgId: string, min: Role): Promise<OrgRole> {
    const role = await this.roleIn(userId, orgId);
    if (!atLeast(role, min)) throw new ForbiddenException(needs(min));
    return role;
  }

  /** Starts a workspace, owned by the person who made it, with nobody else in it until they invite people. */
  async create(userId: string, name: string): Promise<OrgDto> {
    return this.db.transaction(async (tx) => {
      const [{ owned }] = await tx
        .select({ owned: count() })
        .from(orgMembers)
        .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, 'owner')));
      if (owned >= MAX_OWNED) throw new ConflictException(`You already own ${MAX_OWNED} workspaces; delete or hand one over first`);
      const [org] = await tx.insert(orgs).values({ name }).returning({ id: orgs.id, name: orgs.name });
      await tx.insert(orgMembers).values({ orgId: org.id, userId, role: 'owner' });
      return { ...org, role: 'owner' as const };
    });
  }

  /** Owners: renames the workspace. */
  async rename(userId: string, orgId: string, name: string): Promise<OrgDto> {
    const role = await this.require(userId, orgId, 'owner');
    const [org] = await this.db.update(orgs).set({ name }).where(eq(orgs.id, orgId)).returning({ id: orgs.id, name: orgs.name });
    return { ...org, role };
  }
}
