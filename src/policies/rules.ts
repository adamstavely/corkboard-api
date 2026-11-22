import { ForbiddenException } from '@nestjs/common';
import { atLeast, type Role } from '../access/roles';
import type { OrgRole } from '../db/schema';

/** Who a policy lets do something on a board, fewest first. */
export const WHO = ['workspace_owners', 'board_owners', 'editors', 'everyone'] as const;
export type PolicyWho = (typeof WHO)[number];
/** The choices for policies that never reach everyone who can open a board. */
export const WHO_MANAGING = ['workspace_owners', 'board_owners', 'editors'] as const;

/** The policies that say who may do something on a board. */
export type WhoPolicy = 'shareWithPeople' | 'shareLinks' | 'exports' | 'feedback';

/** A workspace's policies, as stored. */
export interface Policies {
  shareWithPeople: PolicyWho;
  shareLinks: PolicyWho;
  editableLinks: boolean;
  linkPassword: boolean;
  linkMaxDays: number | null;
  exports: PolicyWho;
  feedback: PolicyWho;
  retentionDays: number | null;
}

/** A workspace without policies set: how Corkboard behaved before there were any. */
export const DEFAULT_POLICIES: Policies = {
  shareWithPeople: 'board_owners',
  shareLinks: 'board_owners',
  editableLinks: true,
  linkPassword: false,
  linkMaxDays: null,
  exports: 'everyone',
  feedback: 'board_owners',
  retentionDays: null,
};

/** What each policy is about, in the words its refusals use. */
const DOING: Record<WhoPolicy, string> = {
  shareWithPeople: 'share boards with people',
  shareLinks: 'make and manage share links',
  exports: 'export boards',
  feedback: 'open boards for outside feedback',
};

const WHO_WORDS: Record<PolicyWho, string> = {
  workspace_owners: 'workspace owners',
  board_owners: 'board owners',
  editors: 'people who can edit the board',
  everyone: 'anyone who can open the board',
};

/** Someone on a board, as policies see them. `facilitator`: they run the board's session (counts as an owner for feedback). */
export interface OnBoard {
  orgRole: OrgRole;
  boardRole: Role;
  facilitator?: boolean;
}

/** Whether `who` covers this person. */
export function covers(who: PolicyWho, on: OnBoard, policy?: WhoPolicy): boolean {
  switch (who) {
    case 'workspace_owners':
      return on.orgRole === 'owner';
    case 'board_owners':
      return on.boardRole === 'owner' || (policy === 'feedback' && !!on.facilitator && atLeast(on.boardRole, 'updater'));
    case 'editors':
      return atLeast(on.boardRole, 'updater');
    case 'everyone':
      return true;
  }
}

/** Why a policy keeps someone from doing something, in a sentence. */
export function refusalText(policy: WhoPolicy, who: PolicyWho): string {
  const whom = policy === 'feedback' && who === 'board_owners' ? 'board owners and the facilitator' : WHO_WORDS[who];
  return `This workspace's policy lets only ${whom} ${DOING[policy]}.`;
}

/** Which policy said no, so a caller can show it beside the control it turns off. */
export type PolicyName = WhoPolicy | 'editableLinks' | 'linkPassword' | 'linkMaxDays';

/** A 403 that names the policy behind it. */
export const policyRefusal = (policy: PolicyName, message: string) => new ForbiddenException({ statusCode: 403, error: 'Forbidden', message, policy });

/** The latest a new share link may expire under `maxDays`, epoch ms; null with no limit. */
export const latestExpiry = (maxDays: number | null, from = Date.now()) => (maxDays === null ? null : from + maxDays * 86_400_000);
