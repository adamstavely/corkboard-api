import * as Y from 'yjs';

/** The decks to estimate with: story points on a Fibonacci scale, or T-shirt sizes. "?" is "I can't say yet". */
export const DECKS = {
  fibonacci: ['0', '1', '2', '3', '5', '8', '13', '21', '?'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL', '?'],
} as const;
export type Deck = keyof typeof DECKS;

/**
 * A planning poker round, as everyone on the board sees it: what's being estimated, with which deck, and whether the
 * estimates are shown yet. Until they are, the estimates themselves stay on the server (poker_estimates); the board
 * keeps only who has estimated, under `pokerEstimates` with an empty value, and on reveal gets the values.
 */
export interface Poker {
  round: string;
  deck: Deck;
  /** What's being estimated: a task, a note, or just a title. */
  taskId: string | null;
  noteId: string | null;
  title: string;
  revealed: boolean;
  startedBy: string;
}

const pokerMap = (doc: Y.Doc) => doc.getMap<unknown>('poker');
/** Each person's estimate once revealed; before that, an empty string for "has estimated". */
export const pokerEstimatesMap = (doc: Y.Doc) => doc.getMap<string>('pokerEstimates');

export function pokerOf(doc: Y.Doc): Poker | null {
  const m = pokerMap(doc);
  const round = m.get('round');
  if (typeof round !== 'string') return null;
  const str = (k: string) => (typeof m.get(k) === 'string' ? (m.get(k) as string) : null);
  return {
    round,
    deck: m.get('deck') === 'tshirt' ? 'tshirt' : 'fibonacci',
    taskId: str('taskId'),
    noteId: str('noteId'),
    title: str('title') ?? '',
    revealed: m.get('revealed') === true,
    startedBy: str('startedBy') ?? '',
  };
}

/** Starts a round, clearing the last one's estimates. */
export function startPoker(doc: Y.Doc, poker: Omit<Poker, 'revealed'>): void {
  const m = pokerMap(doc);
  doc.transact(() => {
    pokerEstimatesMap(doc).clear();
    for (const [k, v] of Object.entries({ ...poker, revealed: false })) m.set(k, v);
  });
}

/** Marks that someone has estimated in this round, without saying what. */
export function markEstimated(doc: Y.Doc, round: string, userId: string): string | null {
  const poker = pokerOf(doc);
  if (!poker || poker.round !== round) return 'That round of planning poker has ended';
  if (poker.revealed) return 'The estimates have been revealed';
  pokerEstimatesMap(doc).set(userId, '');
  return null;
}

/** Shows everyone's estimates. Anyone marked with no estimate kept (it came in as the round was revealed) is dropped. */
export function revealPoker(doc: Y.Doc, estimates: ReadonlyMap<string, string>): void {
  const map = pokerEstimatesMap(doc);
  doc.transact(() => {
    pokerMap(doc).set('revealed', true);
    for (const userId of [...map.keys()]) if (!estimates.has(userId)) map.delete(userId);
    for (const [userId, value] of estimates) map.set(userId, value);
  });
}

export function clearPoker(doc: Y.Doc): void {
  const m = pokerMap(doc);
  doc.transact(() => {
    pokerEstimatesMap(doc).clear();
    for (const k of [...m.keys()]) m.delete(k);
  });
}
