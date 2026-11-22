import { randomUUID } from 'node:crypto';
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
  /** The model's name (or, from an agent, its access token's name: "Cursor"), and who asked. */
  model: string;
  /** Proposed by an agent through one of `forId`'s access tokens, not by the assistant. */
  agent?: boolean;
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

const FUTURE: Record<string, string> = { made: 'make', moved: 'move', added: 'add', changed: 'change', drew: 'draw' };

/** "Made 3 frames and moved 9 notes into them" as a proposal: "Would make 3 frames and move 9 notes into them." */
export function wouldDo(done: string): string {
  const line = done.replace(/\b(made|moved|added|changed|drew)\b/gi, (verb) => FUTURE[verb.toLowerCase()]);
  return `Would ${line[0].toLowerCase()}${line.slice(1)}.`;
}

/** The most suggestions a board keeps waiting; the oldest go first. */
export const MAX_SUGGESTIONS = 20;

export const suggestionsOf = (doc: Y.Doc) => doc.getMap<Suggestion>('suggestions');

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

/** What a draft changed, as a suggestion to put on the board. `done` says it in words: "Added 3 notes". */
export function suggestionFrom(
  draft: Draft,
  who: { id?: string; model: string; forId: string; forName: string; asked: string; agent?: boolean },
  done: string,
  now = Date.now(),
): Suggestion {
  const changes = draft.tracker.changes();
  return {
    id: who.id ?? randomUUID(),
    at: now,
    model: who.model,
    ...(who.agent ? { agent: true } : {}),
    forId: who.forId,
    forName: who.forName,
    asked: who.asked.trim().slice(0, 300),
    action: wouldDo(done),
    done,
    added: changes.createdNodes.map(({ id, attrs, text }) => ({ id, attrs, ...(text !== undefined ? { text } : {}) })),
    changed: changes.changed,
    removed: changes.removed.map((r) => r.id),
    update: Buffer.from(draft.update()).toString('base64'),
  };
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
