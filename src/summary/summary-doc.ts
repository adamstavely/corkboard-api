import * as Y from 'yjs';

/** A board's shared summary, as the API keeps it in the board's document. */
export interface BoardSummary {
  tldr: string;
  summary: string;
  /** Key points, decisions and action items, each citing the notes it rests on. */
  points: { id: string; text: string; sources: string[] }[];
  /** Questions the team might ask next. */
  questions: string[];
  length: 'short' | 'detailed';
  /** The model's name, and who asked. */
  model: string;
  by: string;
  /** Epoch ms. */
  at: number;
  /** The notes it was made from, sorted: the board has moved on when they differ. */
  basis: string[];
  /** Every note's content as it was made (see `contentFingerprint`): the board has moved on when it differs. */
  fingerprint?: string;
}

/**
 * A short hash of every note's id and text, so editing a note's words shows a summary is out of date. The UI computes
 * the same thing from its copy of the board; keep the two in step.
 */
export function contentFingerprint(doc: Y.Doc): string {
  const notes: string[] = [];
  doc.getMap<unknown>('nodes').forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'note') return;
    const text: unknown = node.get('text');
    notes.push(`${id}\u0001${text instanceof Y.XmlFragment ? text.toJSON() : ''}`);
  });
  // FNV-1a, 32 bits, over UTF-16 code units.
  let hash = 0x811c9dc5;
  const all = notes.sort().join('\u0002');
  for (let i = 0; i < all.length; i++) {
    hash ^= all.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const summaryMap = (doc: Y.Doc) => doc.getMap<unknown>('summary');

export function setSummary(doc: Y.Doc, summary: BoardSummary): void {
  const map = summaryMap(doc);
  doc.transact(() => {
    for (const [key, value] of Object.entries(summary)) map.set(key, value);
  });
}
