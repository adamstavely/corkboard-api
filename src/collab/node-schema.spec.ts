import * as Y from 'yjs';
import { nodeProblem } from './node-schema';

/** A client's change to a copy of the board, as the update it would send. */
function clientChange(board: Y.Doc, change: (nodes: Y.Map<unknown>, doc: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(board));
  const before = Y.encodeStateVector(client);
  client.transact(() => change(client.getMap('nodes'), client));
  return Y.encodeStateAsUpdate(client, before);
}

/** A node as the board writes it. */
function node(fields: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
}

describe('what a board node may hold', () => {
  const board = new Y.Doc();
  const existingNote = new Y.Map<unknown>();
  board.getMap('nodes').set('n1', existingNote);
  existingNote.set('kind', 'note');
  existingNote.set('x', 10);
  existingNote.set('text', new Y.XmlFragment());

  it('accepts what the board writes: notes, frames, shapes, text, drawings, tables, links, files and arrows', () => {
    expect(
      nodeProblem(
        board,
        clientChange(board, (nodes) => {
          const n = node({ kind: 'note', x: 100, y: -40, w: 200, h: 160, z: 3, color: 'pink', tags: ['risk'], locked: true });
          nodes.set('note', n);
          n.set('text', new Y.XmlFragment());
          nodes.set('frame', node({ kind: 'frame', title: 'Week 1', x: 0, y: 0, w: 800, h: 600, z: 1, order: 2 }));
          nodes.set('shape', node({ kind: 'shape', shape: 'diamond', color: 'blue', label: 'Go?', x: 1, y: 2, w: 200, h: 160, z: 4 }));
          nodes.set('text', node({ kind: 'text', text: 'Heading', size: 'lg', x: 1, y: 2, w: 240, h: 40, z: 5 }));
          nodes.set('drawing', node({ kind: 'drawing', points: [0, 0, 10, 12.5], vw: 14, vh: 16, color: 'ink', width: 3, x: 1, y: 2, w: 14, h: 16, z: 6 }));
          const t = node({ kind: 'table', rows: 3, cols: 3, x: 1, y: 2, w: 420, h: 120, z: 7 });
          nodes.set('table', t);
          t.set('cells', new Y.Map());
          nodes.set('link', node({ kind: 'link', url: 'https://example.com', title: 'Example', x: 1, y: 2, w: 320, h: 120, z: 8 }));
          nodes.set('file', node({ kind: 'file', fileId: 'f', name: 'a.pdf', mime: 'application/pdf', size: 12345, x: 1, y: 2, w: 240, h: 80, z: 9 }));
          nodes.set('arrow', node({ kind: 'connector', from: 'note', to: 'frame' }));
          // Moving and editing an existing note.
          const n1 = nodes.get('n1') as Y.Map<unknown>;
          n1.set('x', 50);
          (n1.get('text') as Y.XmlFragment).insert(0, [new Y.XmlText('Hi')]);
          nodes.delete('n1');
        }),
      ),
    ).toBeNull();
  });

  it('refuses a node that is not a map', () => {
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('malformed', 42)))).toBe('node malformed is not a node');
  });

  it('refuses positions, sizes and tables the board could not show', () => {
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('a', node({ kind: 'note', x: Number.NaN }))))).toMatch(/^a\.x: /);
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('b', node({ kind: 'frame', w: -5 }))))).toMatch(/^b\.w: /);
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('c', node({ kind: 'table', rows: 1e9 }))))).toMatch(/^c\.rows: /);
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('d', node({ kind: 'text', text: 'x'.repeat(30_000) }))))).toMatch(/^d\.text: /);
    expect(nodeProblem(board, clientChange(board, (nodes) => nodes.set('e', node({ kind: 'note', text: 7 }))))).toMatch(/^e\.text: /);
  });

  it('refuses a bad value set again on an existing node, which arrives without its key', () => {
    expect(nodeProblem(board, clientChange(board, (nodes) => (nodes.get('n1') as Y.Map<unknown>).set('x', Number.POSITIVE_INFINITY)))).toMatch(/^n1\.x: /);
  });
});
