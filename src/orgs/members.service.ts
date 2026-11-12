import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgInvites, orgMembers, orgs, users, type OrgRole, type User } from '../db/schema';
import type { OrgDto } from './orgs.dto';
import { OrgsService } from './orgs.service';
import type { InviteDto, MembersDto, MyInviteDto } from './members.dto';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Who belongs to a workspace and at what role, and invites by email. Admins invite, change roles and remove people;
 * anyone may leave; a workspace always keeps at least one admin.
 */
@Injectable()
export class MembersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
  ) {}

  async list(user: User, orgId: string): Promise<MembersDto> {
    await this.orgs.roleIn(user.id, orgId);
    const members = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, orgId))
      .orderBy(asc(orgMembers.createdAt));
    const invites = await this.#invites(orgId);
    return { members, invites };
  }

  /** Invites an email, or changes the role of its open invite. Someone already in the workspace can't be invited. */
  async invite(user: User, orgId: string, rawEmail: string, role: OrgRole): Promise<InviteDto> {
    await this.orgs.requireAdmin(user.id, orgId);
    const email = normalise(rawEmail);
    const [member] = await this.db
      .select({ id: users.id })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email)));
    if (member) throw new ConflictException(`${email} is already in this workspace`);

    const [invite] = await this.db
      .insert(orgInvites)
      .values({ orgId, email, role, invitedBy: user.id })
      .onConflictDoUpdate({ target: [orgInvites.orgId, orgInvites.email], set: { role } })
      .returning();
    return (await this.#invites(orgId)).find((i) => i.id === invite.id)!;
  }

  async changeInvite(user: User, orgId: string, inviteId: string, role: OrgRole): Promise<InviteDto> {
    await this.orgs.requireAdmin(user.id, orgId);
    const [invite] = await this.db
      .update(orgInvites)
      .set({ role })
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
      .returning();
    if (!invite) throw new NotFoundException('Invite not found');
    return (await this.#invites(orgId)).find((i) => i.id === invite.id)!;
  }

  async revokeInvite(user: User, orgId: string, inviteId: string): Promise<void> {
    await this.orgs.requireAdmin(user.id, orgId);
    const deleted = await this.db
      .delete(orgInvites)
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
      .returning({ id: orgInvites.id });
    if (deleted.length === 0) throw new NotFoundException('Invite not found');
  }

  async changeRole(user: User, orgId: string, memberId: string, role: OrgRole): Promise<void> {
    await this.orgs.requireAdmin(user.id, orgId);
    await this.db.transaction(async (tx) => {
      await this.#lockMembers(tx, orgId);
      const current = await this.#roleOf(tx, orgId, memberId);
      if (current === 'admin' && role !== 'admin') await this.#keepAnAdmin(tx, orgId, memberId);
      await tx
        .update(orgMembers)
        .set({ role })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)));
    });
  }

  /** Removes someone: an admin removing anyone, or anyone leaving. */
  async remove(user: User, orgId: string, memberId: string): Promise<void> {
    if (memberId === user.id) await this.orgs.roleIn(user.id, orgId);
    else await this.orgs.requireAdmin(user.id, orgId);
    await this.db.transaction(async (tx) => {
      await this.#lockMembers(tx, orgId);
      if ((await this.#roleOf(tx, orgId, memberId)) === 'admin') await this.#keepAnAdmin(tx, orgId, memberId);
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)));
    });
  }

  /** Invites waiting for the signed-in person, matched on their verified email. */
  async mine(user: User): Promise<MyInviteDto[]> {
    if (!user.email || !user.emailVerified) return [];
    return this.db
      .select({
        id: orgInvites.id,
        orgId: orgInvites.orgId,
        orgName: orgs.name,
        role: orgInvites.role,
        invitedByName: users.name,
      })
      .from(orgInvites)
      .innerJoin(orgs, eq(orgs.id, orgInvites.orgId))
      .leftJoin(users, eq(users.id, orgInvites.invitedBy))
      .where(eq(orgInvites.email, normalise(user.email)))
      .orderBy(asc(orgInvites.createdAt));
  }

  /** Joins the workspace an invite is for, at its role. */
  async accept(user: User, inviteId: string): Promise<OrgDto> {
    const invite = await this.#myInvite(user, inviteId);
    await this.db.transaction(async (tx) => {
      await tx.insert(orgMembers).values({ orgId: invite.orgId, userId: user.id, role: invite.role }).onConflictDoNothing();
      await tx.delete(orgInvites).where(eq(orgInvites.id, invite.id));
    });
    const org = (await this.orgs.forUser(user.id)).find((o) => o.id === invite.orgId);
    return org!;
  }

  async decline(user: User, inviteId: string): Promise<void> {
    const invite = await this.#myInvite(user, inviteId);
    await this.db.delete(orgInvites).where(eq(orgInvites.id, invite.id));
  }

  async #myInvite(user: User, inviteId: string): Promise<MyInviteDto> {
    const invite = (await this.mine(user)).find((i) => i.id === inviteId);
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  async #invites(orgId: string): Promise<InviteDto[]> {
    return this.db
      .select({
        id: orgInvites.id,
        email: orgInvites.email,
        role: orgInvites.role,
        invitedByName: users.name,
        createdAt: orgInvites.createdAt,
      })
      .from(orgInvites)
      .leftJoin(users, eq(users.id, orgInvites.invitedBy))
      .where(eq(orgInvites.orgId, orgId))
      .orderBy(asc(orgInvites.createdAt));
  }

  /** Serialises membership changes per workspace, so two admins can't each demote the other. */
  async #lockMembers(tx: Tx, orgId: string): Promise<void> {
    await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for('update');
  }

  async #roleOf(tx: Tx, orgId: string, userId: string): Promise<OrgRole> {
    const [row] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    if (!row) throw new NotFoundException('Member not found');
    return row.role;
  }

  async #keepAnAdmin(tx: Tx, orgId: string, leaving: string): Promise<void> {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'admin'), ne(orgMembers.userId, leaving)));
    if (n === 0) throw new ConflictException('A workspace needs at least one admin. Make someone else an admin first.');
  }
}
