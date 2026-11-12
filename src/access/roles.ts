import type { BoardAccess, OrgRole } from '../db/schema';

/** The four roles, least first. Each can do everything the ones before it can. */
export const ROLES = ['reader', 'commenter', 'updater', 'owner'] as const satisfies readonly OrgRole[];
export type Role = (typeof ROLES)[number];

/** What each role is for, in the words the API's errors use. */
const DOING: Record<Role, string> = {
  reader: 'see this',
  commenter: 'comment here',
  updater: 'change this',
  owner: 'manage this',
};

export const atLeast = (role: Role, min: Role) => ROLES.indexOf(role) >= ROLES.indexOf(min);

/** What someone needs to be to do something, for a 403's message. */
export const needs = (min: Role) => `You need to be ${min === 'owner' ? 'an owner' : `a${min === 'updater' ? 'n' : ''} ${min}`} to ${DOING[min]}.`;

/**
 * Someone's role on a board: workspace owners own every board; otherwise a role set on the board replaces their
 * workspace role, up or down; `none` keeps them out (undefined).
 */
export function boardRole(orgRole: OrgRole, onBoard: BoardAccess | null | undefined): Role | undefined {
  if (orgRole === 'owner') return 'owner';
  if (onBoard === 'none') return undefined;
  return onBoard ?? orgRole;
}
