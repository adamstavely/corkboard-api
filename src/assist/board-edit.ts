import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fragmentText } from '../boards/board-text';

/** The UI's note colours and size (corkboard-ui's board-doc.ts); notes made here must look like notes made there. */
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_SIZE = { w: 200, h: 160 } as const;
const GAP = 24;
const COLUMNS = 4;

/** A note as the model sees it. */
export interface NoteView {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');

export function notesOf(doc: Y.Doc): NoteView[] {
  const notes: NoteView[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'note') return;
    const fragment = node.get('text');
    const color = node.get('color');
    notes.push({
      id,
      text: fragment instanceof Y.XmlFragment ? fragmentText(fragment) : '',
      color: typeof color === 'string' ? color : 'yellow',
      x: Number(node.get('x') ?? 0),
      y: Number(node.get('y') ?? 0),
    });
  });
  return notes;
}

/**
 * Adds notes in a grid beside `near` (or beside everything on the board), above all else, and returns their ids. Where
 * notes go is decided here, not by the model, so its additions always land tidily.
 */
export function addNotes(doc: Y.Doc, notes: { text: string; color: NoteColor }[], near: NoteView[] = notesOf(doc)): string[] {
  const nodes = nodesOf(doc);
  const right = near.length ? Math.max(...near.map((n) => n.x)) + NOTE_SIZE.w + GAP * 3 : 0;
  const top = near.length ? Math.min(...near.map((n) => n.y)) : 0;
  let z = 0;
  nodes.forEach((node) => (z = Math.max(z, Number(node.get('z') ?? 0))));

  const ids: string[] = [];
  doc.transact(() => {
    notes.forEach((note, i) => {
      const id = randomUUID();
      const node = new Y.Map<unknown>();
      node.set('kind', 'note');
      node.set('x', Math.round(right + (i % COLUMNS) * (NOTE_SIZE.w + GAP)));
      node.set('y', Math.round(top + Math.floor(i / COLUMNS) * (NOTE_SIZE.h + GAP)));
      node.set('w', NOTE_SIZE.w);
      node.set('h', NOTE_SIZE.h);
      node.set('z', ++z);
      node.set('color', note.color);
      node.set('author', 'assistant');
      const fragment = new Y.XmlFragment();
      node.set('text', fragment);
      nodes.set(id, node);
      // One Tiptap paragraph per line.
      fragment.insert(
        0,
        note.text.split(/\r?\n/).map((line) => {
          const p = new Y.XmlElement('paragraph');
          if (line) p.insert(0, [new Y.XmlText(line)]);
          return p;
        }),
      );
      ids.push(id);
    });
  });
  return ids;
}

/** Recolours notes that exist; returns how many it found. */
export function setColors(doc: Y.Doc, ids: string[], color: NoteColor): number {
  const nodes = nodesOf(doc);
  let found = 0;
  doc.transact(() => {
    for (const id of ids) {
      const node = nodes.get(id);
      if (node instanceof Y.Map && node.get('kind') === 'note') {
        node.set('color', color);
        found++;
      }
    }
  });
  return found;
}
