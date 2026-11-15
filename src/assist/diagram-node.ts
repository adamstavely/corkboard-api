import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { besideBoard } from '../apps/app-node';
import { topZ } from './board-edit';

/** How big a new diagram is on the board; it draws fitted to its box. */
export const DIAGRAM_SIZE = { w: 560, h: 420 } as const;
/** The longest a diagram's text may be. */
export const MAX_DIAGRAM_CHARS = 8000;

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');

/** Says what's wrong with a diagram's text, or null: Corkboard draws Mermaid flowcharts and sequence diagrams. */
export function diagramProblem(source: unknown): string | null {
  if (typeof source !== 'string' || !source.trim()) return 'A diagram needs its Mermaid text.';
  if (source.length > MAX_DIAGRAM_CHARS) return `A diagram's text can be at most ${MAX_DIAGRAM_CHARS} characters.`;
  if (!/^\s*(flowchart|graph|sequenceDiagram)\b/.test(source)) return 'Start the text with "flowchart TD" (or LR) for a flowchart, or "sequenceDiagram" for a sequence diagram.';
  return null;
}

/** The diagrams on the board, with their text. */
export function diagramsOn(doc: Y.Doc): { id: string; source: string }[] {
  const found: { id: string; source: string }[] = [];
  nodesOf(doc).forEach((node, id) => {
    const source = node instanceof Y.Map ? node.get('source') : undefined;
    if (node instanceof Y.Map && node.get('kind') === 'diagram') found.push({ id, source: typeof source === 'string' ? source : '' });
  });
  return found;
}

/** Puts a diagram beside everything on the board and returns its id. */
export function placeDiagram(doc: Y.Doc, source: string, author = 'assistant'): string {
  const id = randomUUID();
  const at = besideBoard(doc);
  const z = topZ(doc) + 1;
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    nodesOf(doc).set(id, node);
    node.set('kind', 'diagram');
    node.set('x', at.x);
    node.set('y', at.y);
    node.set('w', DIAGRAM_SIZE.w);
    node.set('h', DIAGRAM_SIZE.h);
    node.set('z', z);
    node.set('source', source.trim());
    node.set('author', author);
  });
  return id;
}

/** A diagram's new text; false if there's no diagram with that id. */
export function setDiagramSource(doc: Y.Doc, id: string, source: string): boolean {
  const node = nodesOf(doc).get(id);
  if (!(node instanceof Y.Map) || node.get('kind') !== 'diagram') return false;
  node.set('source', source.trim());
  return true;
}
