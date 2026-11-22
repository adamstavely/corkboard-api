import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boards, boardShareLinks, workspacePolicies, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import type { BoardWithRole } from '../boards/boards.service';
import type { AllowedDto, BoardPolicyDto, PoliciesDto } from './policies.dto';
import { covers, DEFAULT_POLICIES, policyRefusal, refusalText, type OnBoard, type Policies, type WhoPolicy } from './rules';

/** What saving a workspace's policies changed for links already out there. */
export interface PolicyChange {
  policies: PoliciesDto;
  /** Links whose guests must reconnect (now password-less where a password is needed, or editable where editing is off). */
  letGo: string[];
  /** Links cut short to the new longest expiry, with their new expiry (epoch ms). */
  shortened: { id: string; expiresAt: number }[];
}

/**
 * Workspace policies: what a workspace's owners allow on its boards (sharing, links, exports, feedback, how long
 * history is kept). The services that do those things ask here first, so a refusal holds whatever the client shows.
 */
@Injectable()
export class PoliciesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
  ) {}

  /** A workspace's policies; the defaults when none are set. */
  async of(orgId: string): Promise<Policies> {
    const [row] = await this.db.select().from(workspacePolicies).where(eq(workspacePolicies.orgId, orgId));
    if (!row) return { ...DEFAULT_POLICIES };
    return {
      shareWithPeople: row.shareWithPeople,
      shareLinks: row.shareLinks,
      editableLinks: row.editableLinks,
      linkPassword: row.linkPassword,
      linkMaxDays: row.linkMaxDays,
      exports: row.exports,
      feedback: row.feedback,
      retentionDays: row.retentionDays,
    };
  }

  /** Anyone in the workspace: its policies, so the app can explain what's turned off. */
  async get(user: User, orgId: string): Promise<PoliciesDto> {
    await this.orgs.roleIn(user.id, orgId);
    return this.of(orgId);
  }

  /** Workspace owners: set every policy at once. Links already out there are brought into line (see PolicyChange). */
  async set(user: User, orgId: string, next: PoliciesDto): Promise<PolicyChange> {
    await this.orgs.require(user.id, orgId, 'owner');
    const values = { ...next, updatedBy: user.id, updatedAt: new Date() };
    await this.db.insert(workspacePolicies).values({ orgId, ...values }).onConflictDoUpdate({ target: workspacePolicies.orgId, set: values });

    const live = and(inArray(boardShareLinks.boardId, this.db.select({ id: boards.id }).from(boards).where(eq(boards.orgId, orgId))), isNull(boardShareLinks.revokedAt));
    let shortened: PolicyChange['shortened'] = [];
    if (next.linkMaxDays !== null) {
      // A link lives at most linkMaxDays from when it was made: later expiries (and none) are cut back to that.
      const limit = sql`${boardShareLinks.createdAt} + make_interval(days => ${next.linkMaxDays})`;
      const rows = await this.db
        .update(boardShareLinks)
        .set({ expiresAt: limit })
        .where(and(live, or(isNull(boardShareLinks.expiresAt), gt(boardShareLinks.expiresAt, limit))))
        .returning({ id: boardShareLinks.id, expiresAt: boardShareLinks.expiresAt });
      shortened = rows.map((r) => ({ id: r.id, expiresAt: r.expiresAt!.getTime() }));
    }
    const letGo = [];
    if (next.linkPassword) letGo.push(...(await this.db.select({ id: boardShareLinks.id }).from(boardShareLinks).where(and(live, isNull(boardShareLinks.passwordHash)))));
    if (!next.editableLinks) letGo.push(...(await this.db.select({ id: boardShareLinks.id }).from(boardShareLinks).where(and(live, eq(boardShareLinks.canEdit, true)))));
    return { policies: await this.of(orgId), letGo: [...new Set(letGo.map((l) => l.id))], shortened };
  }

  /** Why this person can't do what `policy` covers on the board; null when they can. */
  async refusal(user: User, board: BoardWithRole, policy: WhoPolicy, policies?: Policies, facilitator?: () => Promise<boolean>): Promise<string | null> {
    const set = policies ?? (await this.of(board.orgId));
    const who = set[policy];
    const on: OnBoard = { orgRole: board.role === 'owner' && who === 'workspace_owners' ? await this.orgs.roleIn(user.id, board.orgId) : 'reader', boardRole: board.role };
    if (covers(who, on, policy)) return null;
    if (policy === 'feedback' && who === 'board_owners' && facilitator && covers(who, { ...on, facilitator: await facilitator() }, policy)) return null;
    return refusalText(policy, who);
  }

  /** Throws a 403 naming the policy unless this person may do what it covers on the board. Returns the policies. */
  async check(user: User, board: BoardWithRole, policy: WhoPolicy, facilitator?: () => Promise<boolean>): Promise<Policies> {
    const policies = await this.of(board.orgId);
    const why = await this.refusal(user, board, policy, policies, facilitator);
    if (why) throw policyRefusal(policy, why);
    return policies;
  }

  /** What the person asking may do on a board under its workspace's policies. */
  async onBoard(user: User, board: BoardWithRole, facilitator: () => Promise<boolean>): Promise<BoardPolicyDto> {
    const policies = await this.of(board.orgId);
    const allowed = (reason: string | null): AllowedDto => ({ allowed: !reason, reason });
    const [shareWithPeople, shareLinks, exports, feedback] = await Promise.all(
      (['shareWithPeople', 'shareLinks', 'exports', 'feedback'] as const).map((p) => this.refusal(user, board, p, policies, facilitator)),
    );
    return {
      shareWithPeople: allowed(shareWithPeople),
      shareLinks: allowed(shareLinks),
      editableLinks: allowed(shareLinks ?? (policies.editableLinks ? null : EDITABLE_OFF)),
      exports: allowed(exports),
      feedback: allowed(feedback),
      linkPassword: policies.linkPassword,
      linkMaxDays: policies.linkMaxDays,
    };
  }
}

export const EDITABLE_OFF = "This workspace's policy doesn't allow share links that let guests edit.";
export const PASSWORD_NEEDED = "This workspace's policy needs a password on every share link.";
export const tooLong = (days: number) => `This workspace's policy needs share links to expire within ${days} day${days === 1 ? '' : 's'}.`;
