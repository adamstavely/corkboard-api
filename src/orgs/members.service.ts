import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boardMembers, boards, orgInvites, orgMembers, orgs, users, type OrgRole, type User } from '../db/schema';
import type { OrgDto } from './orgs.dto';
import { CollabService } from '../collab/collab.service';
import { OrgsService } from './orgs.service';
import type { CreatedInviteDto, InviteDto, MembersDto, MyInviteDto } from './members.dto';
import { hashToken } from '../auth/users.service';
import { NotificationsService } from '../activity/notifications';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const normalise = (email: string) => email.trim().toLowerCase();

/** Invite link secrets start with this. */
const INVITE = 'cbi_';

/**
 * Who belongs to a workspace and at what role, and invites. Admins invite, change roles and remove people; anyone may
 * leave; a workspace always keeps at least one owner.
 *
 * An invite is joined through its link, whose secret only the person it was sent to should have. The email on an
 * invite is who it's meant for, not proof: anyone can sign up claiming any email. Only with the development picker on,
 * where nobody is proven anyway, are invites also matched on email.
 */
@Injectable()
export class MembersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly collab: CollabService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  get #pickerOn(): boolean {
    return this.config.get<boolean>('peoplePicker') === true;
  }

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

  /**
   * Invites an email, or changes the role of its open invite, with a new link either way (an older link stops working).
   * Someone already in the workspace can't be invited.
   */
  async invite(user: User, orgId: string, rawEmail: string, role: OrgRole): Promise<CreatedInviteDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const email = normalise(rawEmail);
    const [member] = await this.db
      .select({ id: users.id })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email)));
    if (member) throw new ConflictException(`${email} is already in this workspace`);

    const token = `${INVITE}${randomBytes(24).toString('base64url')}`;
    const [invite] = await this.db
      .insert(orgInvites)
      .values({ orgId, email, role, invitedBy: user.id, tokenHash: hashToken(token) })
      .onConflictDoUpdate({ target: [orgInvites.orgId, orgInvites.email], set: { role, tokenHash: hashToken(token) } })
      .returning();
    // Only where emails are trusted (the picker): elsewhere the account with this email may not be the person meant.
    if (this.#pickerOn) {
      const [invitee] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
      const [org] = await this.db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
      if (invitee) await this.notifications.notify([invitee.id], { kind: 'invite', actor: user.name, title: `invited you to ${org?.name ?? 'a workspace'}`, context: org?.name, link: '/' });
    }
    return { ...(await this.#invites(orgId)).find((i) => i.id === invite.id)!, token };
  }

  async changeInvite(user: User, orgId: string, inviteId: string, role: OrgRole): Promise<InviteDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const [invite] = await this.db
      .update(orgInvites)
      .set({ role })
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
      .returning();
    if (!invite) throw new NotFoundException('Invite not found');
    return (await this.#invites(orgId)).find((i) => i.id === invite.id)!;
  }

  async revokeInvite(user: User, orgId: string, inviteId: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    const deleted = await this.db
      .delete(orgInvites)
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
      .returning({ id: orgInvites.id });
    if (deleted.length === 0) throw new NotFoundException('Invite not found');
  }

  async changeRole(user: User, orgId: string, memberId: string, role: OrgRole): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    await this.db.transaction(async (tx) => {
      await this.#lockMembers(tx, orgId);
      const current = await this.#roleOf(tx, orgId, memberId);
      if (current === 'owner' && role !== 'owner') await this.#keepAnOwner(tx, orgId, memberId);
      await tx
        .update(orgMembers)
        .set({ role })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)));
    });
    // Boards they have open take the new role once they reconnect.
    this.collab.disconnect(memberId);
  }

  /** Removes someone: an owner removing anyone, or anyone leaving. Their roles on the workspace's boards go too. */
  async remove(user: User, orgId: string, memberId: string): Promise<void> {
    if (memberId === user.id) await this.orgs.roleIn(user.id, orgId);
    else await this.orgs.require(user.id, orgId, 'owner');
    await this.db.transaction(async (tx) => {
      await this.#lockMembers(tx, orgId);
      if ((await this.#roleOf(tx, orgId, memberId)) === 'owner') await this.#keepAnOwner(tx, orgId, memberId);
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, memberId)));
      await tx
        .delete(boardMembers)
        .where(and(eq(boardMembers.userId, memberId), inArray(boardMembers.boardId, tx.select({ id: boards.id }).from(boards).where(eq(boards.orgId, orgId)))));
    });
    this.collab.disconnect(memberId);
  }

  /** With the development picker on, invites waiting for the signed-in person, matched on their email; else none. */
  async mine(user: User): Promise<MyInviteDto[]> {
    if (!this.#pickerOn) return [];
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

  /** What an invite link is for, to show before joining. */
  async lookup(token: string): Promise<MyInviteDto> {
    const [invite] = await this.db
      .select({ id: orgInvites.id, orgId: orgInvites.orgId, orgName: orgs.name, role: orgInvites.role, invitedByName: users.name })
      .from(orgInvites)
      .innerJoin(orgs, eq(orgs.id, orgInvites.orgId))
      .leftJoin(users, eq(users.id, orgInvites.invitedBy))
      .where(eq(orgInvites.tokenHash, hashToken(token)));
    if (!invite) throw new NotFoundException('This invite link has been used, replaced or withdrawn');
    return invite;
  }

  /** Joins the workspace an invite link is for, at its role. The link works once. */
  async acceptLink(user: User, token: string): Promise<OrgDto> {
    const orgId = await this.db.transaction(async (tx) => {
      // Taken by deleting it, so two people racing for one link can't both join.
      const [invite] = await tx.delete(orgInvites).where(eq(orgInvites.tokenHash, hashToken(token))).returning();
      if (!invite) throw new NotFoundException('This invite link has been used, replaced or withdrawn');
      await tx.insert(orgMembers).values({ orgId: invite.orgId, userId: user.id, role: invite.role }).onConflictDoNothing();
      return invite.orgId;
    });
    return (await this.orgs.forUser(user.id)).find((o) => o.id === orgId)!;
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

  /** Serialises membership changes per workspace, so two owners can't each demote the other. */
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

  async #keepAnOwner(tx: Tx, orgId: string, leaving: string): Promise<void> {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner'), ne(orgMembers.userId, leaving)));
    if (n === 0) throw new ConflictException('A workspace needs at least one owner. Make someone else an owner first.');
  }
}
