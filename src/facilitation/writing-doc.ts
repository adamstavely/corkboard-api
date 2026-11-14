import * as Y from 'yjs';

/** A hidden writing round, as everyone on the board sees it: whether it's on, and how many have written, never what. */
export interface Writing {
  open: boolean;
  /** Revealed notes carry no author. */
  anonymous: boolean;
  round: string | null;
  /** Where the notes go when revealed. */
  frameId: string | null;
  startedBy: string;
  /** How many notes have been written, and by how many people. */
  notes: number;
  writers: number;
}

export const writingMap = (doc: Y.Doc) => doc.getMap<unknown>('writing');

export function writingOf(doc: Y.Doc): Writing {
  const m = writingMap(doc);
  const str = (k: string) => (typeof m.get(k) === 'string' ? (m.get(k) as string) : null);
  return {
    open: m.get('open') === true,
    anonymous: m.get('anonymous') === true,
    round: str('round'),
    frameId: str('frameId'),
    startedBy: str('startedBy') ?? '',
    notes: Number(m.get('notes') ?? 0),
    writers: Number(m.get('writers') ?? 0),
  };
}

export function setWriting(doc: Y.Doc, writing: Partial<Writing>): void {
  const m = writingMap(doc);
  doc.transact(() => {
    for (const [k, v] of Object.entries(writing)) m.set(k, v);
  });
}
