import * as Y from 'yjs';

type Attrs = Record<string, unknown>;

/** Every note's and frame's properties (not a note's text), by id: what the board looked like at one moment. */
export type Snapshot = Map<string, Attrs>;

/**
 * One run of the model that changed the board, kept in the board's document so anyone can see what it did, and an
 * updater can take it back exactly.
 */
export interface LedgerEntry {
  id: string;
  /** Epoch ms. */
  at: number;
  /** The model's name, and whose request it was. */
  model: string;
  forName: string;
  /** What it did, in words: "Made 3 frames and moved 9 notes into them." */
  action: string;
  created: string[];
  /** Frames it removed, with their properties, to put back. */
  removed: { id: string; attrs: Attrs }[];
  /** What it changed on existing notes and frames: each property before and after. */
  changed: { id: string; before: Attrs; after: Attrs }[];
  undone: boolean;
}

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');
const ledgerOf = (doc: Y.Doc) => doc.getArray<LedgerEntry>('ledger');
/** The newest entries are kept; older ones can no longer be undone from here. */
export const MAX_LEDGER = 100;

export function snapshot(doc: Y.Doc): Snapshot {
  const snap: Snapshot = new Map();
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const attrs: Attrs = {};
    node.forEach((value, key) => {
      if (!(value instanceof Y.AbstractType)) attrs[key] = value;
    });
    snap.set(id, attrs);
  });
  return snap;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What changed between two snapshots: created, removed (frames only: a note's text can't be put back from here), changed. */
export function diff(before: Snapshot, after: Snapshot): Pick<LedgerEntry, 'created' | 'removed' | 'changed'> {
  const created = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before].filter(([id, attrs]) => !after.has(id) && attrs['kind'] === 'frame').map(([id, attrs]) => ({ id, attrs }));
  const changed: LedgerEntry['changed'] = [];
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => !same(was[k], now[k]));
    if (keys.length) changed.push({ id, before: Object.fromEntries(keys.map((k) => [k, was[k]])), after: Object.fromEntries(keys.map((k) => [k, now[k]])) });
  }
  return { created, removed, changed };
}

export function record(doc: Y.Doc, entry: LedgerEntry): void {
  const ledger = ledgerOf(doc);
  doc.transact(() => {
    ledger.push([entry]);
    if (ledger.length > MAX_LEDGER) ledger.delete(0, ledger.length - MAX_LEDGER);
  });
}

export const ledgerEntries = (doc: Y.Doc): LedgerEntry[] => ledgerOf(doc).toArray();

/** Takes an entry's changes back. Says why not when it can't. */
export function undo(doc: Y.Doc, entryId: string): string | null {
  const ledger = ledgerOf(doc);
  const at = ledger.toArray().findIndex((e) => e.id === entryId);
  if (at < 0) return 'That change is no longer in the history';
  const entry = ledger.get(at);
  if (entry.undone) return 'That change was already undone';
  const nodes = nodesOf(doc);
  doc.transact(() => {
    for (const id of entry.created) nodes.delete(id);
    for (const { id, attrs } of entry.removed) {
      if (nodes.has(id)) continue;
      const frame = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(attrs)) frame.set(k, v);
      nodes.set(id, frame);
    }
    for (const { id, before } of entry.changed) {
      const node = nodes.get(id);
      if (!(node instanceof Y.Map)) continue;
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) node.delete(k);
        else node.set(k, v);
      }
    }
    ledger.delete(at, 1);
    ledger.insert(at, [{ ...entry, undone: true }]);
  });
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Made 3 frames, moved 9 notes into them and added 2 notes." – a model run's changes in words. */
export function describe(c: { notesAdded: number; notesChanged: number; framesAdded: number; notesMoved: number }): string {
  const parts = [
    c.framesAdded ? `made ${plural(c.framesAdded, 'frame')}` : '',
    c.notesMoved ? `moved ${plural(c.notesMoved, 'note')} into ${c.framesAdded === 1 ? 'it' : 'them'}` : '',
    c.notesAdded ? `added ${plural(c.notesAdded, 'note')}` : '',
    c.notesChanged ? `changed ${plural(c.notesChanged, 'note')}` : '',
  ].filter(Boolean);
  if (!parts.length) return 'Changed the board';
  const line = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `${line[0].toUpperCase()}${line.slice(1)}`;
}
