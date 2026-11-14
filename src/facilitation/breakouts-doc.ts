import * as Y from 'yjs';

/** One breakout group: a frame to work in, who's in it, and its own timer. */
export interface BreakoutGroup {
  frameId: string;
  members: { id: string; name: string }[];
  /** Epoch ms when the group's time is up; null when it has no timer. */
  endsAt: number | null;
  seconds: number;
}

export interface Breakouts {
  open: boolean;
  groups: BreakoutGroup[];
}

const breakoutsMap = (doc: Y.Doc) => doc.getMap<unknown>('breakouts');

export function breakoutsOf(doc: Y.Doc): Breakouts {
  const m = breakoutsMap(doc);
  const groups = m.get('groups');
  return { open: m.get('open') === true, groups: Array.isArray(groups) ? (groups as BreakoutGroup[]) : [] };
}

export function setBreakouts(doc: Y.Doc, breakouts: Breakouts): void {
  const m = breakoutsMap(doc);
  doc.transact(() => {
    m.set('open', breakouts.open);
    m.set('groups', breakouts.groups);
  });
}

/** Spreads people across the groups in turn, so groups differ in size by one at most. */
export function spread(people: readonly { id: string; name: string }[], frameIds: readonly string[]): BreakoutGroup['members'][] {
  const groups: BreakoutGroup['members'][] = frameIds.map(() => []);
  people.forEach((p, i) => groups[i % frameIds.length].push(p));
  return groups;
}

/** Moves someone into one group, out of any other. */
export function moveTo(groups: readonly BreakoutGroup[], person: { id: string; name: string }, frameId: string): BreakoutGroup[] {
  return groups.map((g) => {
    const others = g.members.filter((m) => m.id !== person.id);
    return { ...g, members: g.frameId === frameId ? [...others, person] : others };
  });
}

/** The group someone is in, if any. */
export const groupOf = (b: Breakouts, userId: string) => (b.open ? b.groups.find((g) => g.members.some((m) => m.id === userId)) : undefined);
