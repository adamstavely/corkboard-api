import * as Y from 'yjs';

/**
 * Replay: close-together states of a board while people edit it, so anyone on it can step through how it grew.
 *
 * Versions save the board every 15 minutes while people edit, too far apart to watch a session take shape. So, while a
 * board is being edited, a snapshot is kept at most every 30 seconds. Most hold only what changed since the one before
 * (a Yjs update: a few hundred bytes for a few notes), and every 20th holds the whole board, so reading any one of them
 * never goes more than 20 back. Each board keeps at most 600 (five hours of solid editing): past that, the oldest whole
 * state and what builds on it go. The workspace's retention policy prunes them like versions.
 */
export const SNAPSHOT_MS = 30_000;
/** A whole state every this many snapshots. */
export const KEYFRAME_EVERY = 20;
/** Snapshots a board keeps at most. */
export const SNAPSHOT_CAP = 600;

/** The latest snapshot, as far as the next one needs it. */
export interface LatestSnapshot {
  vector: Buffer;
  depth: number;
}

/** What to store for the board's state now: the whole state, or only what changed since `latest`. */
export function nextSnapshot(state: Buffer, latest: LatestSnapshot | undefined): { state: Buffer; vector: Buffer; depth: number } {
  const update = new Uint8Array(state);
  const vector = Buffer.from(Y.encodeStateVectorFromUpdate(update));
  if (!latest || latest.depth + 1 >= KEYFRAME_EVERY) return { state, vector, depth: 0 };
  return { state: Buffer.from(Y.diffUpdate(update, new Uint8Array(latest.vector))), vector, depth: latest.depth + 1 };
}

/** A stored snapshot, oldest first in a chain. */
export interface ChainRow {
  id: string;
  state: Buffer;
  depth: number;
}

/** The whole state at each snapshot in `rows` (oldest first); none for rows before the first whole state. */
export function materialize(rows: readonly ChainRow[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let current: Uint8Array | undefined;
  for (const row of rows) {
    const update = new Uint8Array(row.state);
    if (row.depth === 0) current = update;
    else if (current) current = Y.mergeUpdates([current, update]);
    if (current) out.set(row.id, current);
  }
  return out;
}

/** Whole states in order, sent as the first in full and each after it as only what changed since the one before. */
export function asSteps(states: readonly Uint8Array[]): Uint8Array[] {
  return states.map((state, i) => (i === 0 ? state : Y.diffUpdate(state, Y.encodeStateVectorFromUpdate(states[i - 1]))));
}

/** A pause longer than this ends a stretch of editing. */
export const SESSION_GAP_MS = 20 * 60_000;

/**
 * When "this session" started: the last stretch of editing without a long pause, or, when an agenda ran into that
 * stretch, when that agenda started if it's earlier. `at` is ascending; `events` are oldest first.
 */
export function sessionStart(at: readonly number[], events: readonly { at: number; action: string }[]): number | null {
  if (!at.length) return null;
  let i = at.length - 1;
  while (i > 0 && at[i] - at[i - 1] <= SESSION_GAP_MS) i--;
  const stretch = at[i];
  // The agenda's last run: from the first step taken after it last ended, to when it ended again (or now).
  let runStart: number | null = null;
  let runEnd: number | null = null;
  for (const e of events) {
    if (e.action === 'moved the agenda on') {
      if (runStart === null || runEnd !== null) [runStart, runEnd] = [e.at, null];
    } else if (e.action === 'ended the agenda' && runStart !== null && runEnd === null) runEnd = e.at;
  }
  if (runStart === null) return stretch;
  return (runEnd ?? Infinity) >= stretch - SESSION_GAP_MS ? Math.min(runStart, stretch) : stretch;
}
