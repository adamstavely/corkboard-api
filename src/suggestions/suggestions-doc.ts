import * as Y from 'yjs';
import { ChangeTracker, type LedgerEntry } from '../ledger/ledger-doc';

/** What a suggestion would add to the board, for people to see before they accept it. */
export interface SuggestedNode {
  id: string;
  /** The node's properties as it would be: kind, x, y, w, h, color, title... */
  attrs: Record<string, unknown>;
  /** A note's text, a line per paragraph. */
  text?: string;
}

/**
 * Changes the model proposed instead of making, waiting for an updater to accept or reject them. Kept in the board's
 * `suggestions` map (server-owned), so everyone on the board sees them at once.
 */
export interface Suggestion {
  id: string;
  /** Epoch ms. */
  at: number;
  /** The model's name, and who asked. */
  model: string;
  forId: string;
  forName: string;
  /** What was asked, shortened. */
  asked: string;
  /** What it would do, in words: "Would make 3 frames and move 9 notes into them." */
  action: string;
  /** The same, as done, for the history once it's accepted: "Made 3 frames and moved 9 notes into them." */
  done: string;
  /** What it would add, change and remove, for the preview. */
  added: SuggestedNode[];
  changed: LedgerEntry['changed'];
  removed: string[];
  /** The change itself: a Yjs update against the board as it was, base64. */
  update: string;
}

const FUTURE: Record<string, string> = { made: 'make', moved: 'move', added: 'add', changed: 'change' };

/** "Made 3 frames and moved 9 notes into them" as a proposal: "Would make 3 frames and move 9 notes into them." */
export function wouldDo(done: string): string {
  const line = done.replace(/\b(made|moved|added|changed)\b/gi, (verb) => FUTURE[verb.toLowerCase()]);
  return `Would ${line[0].toLowerCase()}${line.slice(1)}.`;
}

/** The most suggestions a board keeps waiting; the oldest go first. */
export const MAX_SUGGESTIONS = 20;

const suggestionsOf = (doc: Y.Doc) => doc.getMap<Suggestion>('suggestions');

export const suggestionsIn = (doc: Y.Doc): Suggestion[] => [...suggestionsOf(doc).values()].sort((a, b) => a.at - b.at);

/**
 * A private copy of the board for the model to change instead of the board itself. `update()` is everything it changed
 * since, as one Yjs update; `tracker` what it changed, as the ledger counts it.
 */
export class Draft {
  readonly doc = new Y.Doc();
  readonly tracker = new ChangeTracker();
  readonly #base: Uint8Array;

  constructor(board: Y.Doc) {
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(board));
    this.#base = Y.encodeStateVector(this.doc);
  }

  edit<T>(change: (doc: Y.Doc) => T): T {
    let result!: T;
    this.doc.transact(() => (result = this.tracker.track(this.doc, change)));
    return result;
  }

  /** Whether the model changed nothing: no board items, and nothing else (tasks) either. A deletion alone adds no state, so the tracker says. */
  get empty(): boolean {
    return this.tracker.empty && Buffer.from(Y.encodeStateVector(this.doc)).equals(Buffer.from(this.#base));
  }

  update(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, this.#base);
  }
}

/** Puts a suggestion on the board, dropping the oldest past MAX_SUGGESTIONS. */
export function propose(doc: Y.Doc, suggestion: Suggestion): void {
  const map = suggestionsOf(doc);
  doc.transact(() => {
    map.set(suggestion.id, suggestion);
    const all = suggestionsIn(doc);
    for (const old of all.slice(0, Math.max(0, all.length - MAX_SUGGESTIONS))) map.delete(old.id);
  });
}

/** Takes a suggestion off the board, returning it; undefined if it isn't there (already accepted or rejected). */
export function take(doc: Y.Doc, id: string): Suggestion | undefined {
  const map = suggestionsOf(doc);
  const s = map.get(id);
  if (s) map.delete(id);
  return s;
}

/** Makes a suggestion's changes on the board, tracked as the ledger tracks the model's own changes. */
export function applySuggestion(doc: Y.Doc, s: Suggestion, tracker: ChangeTracker): void {
  tracker.track(doc, (d) => Y.applyUpdate(d, Buffer.from(s.update, 'base64')));
}
