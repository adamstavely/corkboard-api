import * as Y from 'yjs';

/**
 * What a facilitator runs on a board, kept in the board's document so everyone sees it live: a round of dot voting
 * and a shared timer. Only the API writes these; people act through its endpoints, whatever their connection allows.
 */
export interface VotingState {
  open: boolean;
  /** Votes each person has in the round. */
  votesEach: number;
  /** Goes up with each new round, which starts with no votes. */
  round: number;
}

export interface TimerState {
  /** Epoch ms when time's up; null when no timer runs. */
  endsAt: number | null;
  /** How long it was set for. */
  seconds: number;
  label: string;
  by: string;
}

const votingMap = (doc: Y.Doc) => doc.getMap<unknown>('voting');
/** Each person's votes as the note ids they voted for, a note once per vote. */
const votesMap = (doc: Y.Doc) => doc.getMap<string[]>('votes');
const timerMap = (doc: Y.Doc) => doc.getMap<unknown>('timer');

export function votingOf(doc: Y.Doc): VotingState {
  const v = votingMap(doc);
  return { open: v.get('open') === true, votesEach: Number(v.get('votesEach') ?? 0), round: Number(v.get('round') ?? 0) };
}

/** Votes per note, across everyone. */
export function voteCounts(doc: Y.Doc): Map<string, number> {
  const counts = new Map<string, number>();
  votesMap(doc).forEach((ids) => ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1)));
  return counts;
}

/** Opens a new round (clearing the last one's votes), or closes the current one, keeping its votes as the result. */
export function setVoting(doc: Y.Doc, open: boolean, votesEach: number): void {
  const voting = votingMap(doc);
  doc.transact(() => {
    if (open) {
      votesMap(doc).clear();
      voting.set('round', votingOf(doc).round + 1);
      voting.set('votesEach', votesEach);
    }
    voting.set('open', open);
  });
}

/** Adds or takes back one of a person's votes on a note. Says why not when it can't. */
export function castVote(doc: Y.Doc, userId: string, noteId: string, add: boolean): string | null {
  const voting = votingOf(doc);
  if (!voting.open) return 'Voting is closed';
  const mine = votesMap(doc).get(userId) ?? [];
  if (add) {
    if (mine.length >= voting.votesEach) return `You've used all ${voting.votesEach} of your votes`;
    votesMap(doc).set(userId, [...mine, noteId]);
    return null;
  }
  const at = mine.lastIndexOf(noteId);
  if (at < 0) return "You haven't voted for that note";
  votesMap(doc).set(userId, mine.filter((_, i) => i !== at));
  return null;
}

/** Starts the shared timer for `seconds`, or stops it (null). */
export function setTimer(doc: Y.Doc, seconds: number | null, label: string, by: string, now = Date.now()): void {
  const timer = timerMap(doc);
  doc.transact(() => {
    timer.set('endsAt', seconds === null ? null : now + seconds * 1000);
    timer.set('seconds', seconds ?? 0);
    timer.set('label', label);
    timer.set('by', by);
  });
}

export function timerOf(doc: Y.Doc): TimerState {
  const t = timerMap(doc);
  const text = (key: string) => {
    const value = t.get(key);
    return typeof value === 'string' ? value : '';
  };
  const endsAt = t.get('endsAt');
  return { endsAt: typeof endsAt === 'number' ? endsAt : null, seconds: Number(t.get('seconds') ?? 0), label: text('label'), by: text('by') };
}

/** Who's facilitating, if anyone: only they move everyone's view. */
export interface FacilitatorState {
  userId: string | null;
  name: string;
}

/** The last time the facilitator brought everyone to what they were looking at. */
export interface SpotlightState {
  /** Goes up each time, so clients move once per call. */
  n: number;
  by: string;
  view: { cx: number; cy: number; zoom: number } | null;
}

const facilitatorMap = (doc: Y.Doc) => doc.getMap<unknown>('facilitator');
const spotlightMap = (doc: Y.Doc) => doc.getMap<unknown>('spotlight');

export function facilitatorOf(doc: Y.Doc): FacilitatorState {
  const m = facilitatorMap(doc);
  const id = m.get('userId');
  return { userId: typeof id === 'string' ? id : null, name: typeof m.get('name') === 'string' ? (m.get('name') as string) : '' };
}

export function setFacilitator(doc: Y.Doc, who: { id: string; name: string } | null): void {
  const m = facilitatorMap(doc);
  doc.transact(() => {
    m.set('userId', who?.id ?? null);
    m.set('name', who?.name ?? '');
  });
}

export function spotlight(doc: Y.Doc, by: string, view: { cx: number; cy: number; zoom: number }): void {
  const m = spotlightMap(doc);
  doc.transact(() => {
    m.set('n', Number(m.get('n') ?? 0) + 1);
    m.set('by', by);
    // A plain object: Yjs won't store class instances (the request's DTO).
    m.set('view', { cx: view.cx, cy: view.cy, zoom: view.zoom });
  });
}
