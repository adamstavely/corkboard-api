import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { NOTE_SIZE, newNote, topZ, type NoteColor } from '../assist/board-edit';

/** Gaps between a parent and its branches, and between branches (corkboard-ui's mindmap.ts lays out the same). */
export const MIND_GAP = { x: 96, y: 24 } as const;

/** A mind map to write: a note, and its branches under it. */
export interface MindTree {
  text: string;
  children?: MindTree[];
}

const MAX_NODES = 60;

/**
 * Writes a mind map beside everything on the board: a note per node, each knowing its place in the map (`mind`, as the
 * board reads it), joined parent to branch by curved arrows, laid out as a tree growing right. Returns its notes' ids.
 */
export function placeMindMap(doc: Y.Doc, tree: MindTree, color: NoteColor = 'yellow', author = 'assistant'): string[] {
  // How tall each subtree is, then where each node goes, from the top-left corner of the map.
  let budget = MAX_NODES;
  const trimmed = (t: MindTree): MindTree | null => {
    if (budget <= 0) return null;
    budget--;
    return { text: String(t.text ?? '').trim().slice(0, 500), children: (Array.isArray(t.children) ? t.children : []).map(trimmed).filter((c): c is MindTree => c !== null) };
  };
  const root = trimmed(tree)!;
  const height = (t: MindTree): number =>
    t.children?.length ? Math.max(NOTE_SIZE.h, t.children.reduce((s, c) => s + height(c), 0) + MIND_GAP.y * (t.children.length - 1)) : NOTE_SIZE.h;

  // Beside what's on the board.
  let right = -Infinity;
  let top = Infinity;
  doc.getMap<Y.Map<unknown>>('nodes').forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') === 'connector') return;
    right = Math.max(right, Number(node.get('x') ?? 0) + Number(node.get('w') ?? 0));
    top = Math.min(top, Number(node.get('y') ?? 0));
  });
  const origin = Number.isFinite(right) ? { x: right + 160, y: Number.isFinite(top) ? top : 0 } : { x: 0, y: 0 };

  const ids: string[] = [];
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  doc.transact(() => {
    let z = topZ(doc);
    const rootId = randomUUID();
    const write = (t: MindTree, id: string, parent: string | null, order: number, x: number, centreY: number) => {
      newNote(doc, { text: t.text, color }, { x: Math.round(x), y: Math.round(centreY - NOTE_SIZE.h / 2) }, ++z, author, id);
      nodes.get(id)!.set('mind', { root: rootId, parent, order });
      ids.push(id);
      if (parent) {
        const arrow = new Y.Map<unknown>();
        nodes.set(randomUUID(), arrow);
        arrow.set('kind', 'connector');
        arrow.set('from', parent);
        arrow.set('to', id);
        arrow.set('route', 'curve');
        arrow.set('dash', 'solid');
        arrow.set('weight', 2);
      }
      const kids = t.children ?? [];
      const total = kids.reduce((s, c) => s + height(c), 0) + MIND_GAP.y * Math.max(0, kids.length - 1);
      let y = centreY - total / 2;
      kids.forEach((c, i) => {
        const h = height(c);
        write(c, randomUUID(), id, i, x + NOTE_SIZE.w + MIND_GAP.x, y + h / 2);
        y += h + MIND_GAP.y;
      });
    };
    write(root, rootId, null, 0, origin.x, origin.y + height(root) / 2);
  });
  return ids;
}
