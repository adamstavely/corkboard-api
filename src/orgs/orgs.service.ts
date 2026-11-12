import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgMembers, orgs, type OrgRole } from '../db/schema';
import { OrgDto } from './orgs.dto';

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

  async requireAdmin(userId: string, orgId: string): Promise<void> {
    if ((await this.roleIn(userId, orgId)) !== 'admin') {
      throw new ForbiddenException('Only workspace admins can do that');
    }
  }
}
