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
}

export const summaryMap = (doc: Y.Doc) => doc.getMap<unknown>('summary');

export function setSummary(doc: Y.Doc, summary: BoardSummary): void {
  const map = summaryMap(doc);
  doc.transact(() => {
    for (const [key, value] of Object.entries(summary)) map.set(key, value);
  });
}
