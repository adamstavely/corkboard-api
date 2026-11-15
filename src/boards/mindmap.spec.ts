import * as Y from 'yjs';
import { NOTE_SIZE, notesOf } from '../assist/board-edit';
import { MIND_GAP, placeMindMap } from './mindmap';

describe('a mind map written by the server', () => {
  it('lays the tree out to the right of the board, each note knowing its place, joined by curved arrows', () => {
    const doc = new Y.Doc();
    const old = new Y.Map<unknown>();
    doc.getMap('nodes').set('old', old);
    old.set('kind', 'note');
    old.set('x', 0);
    old.set('y', 0);
    old.set('w', 200);
    old.set('h', 160);

    const ids = placeMindMap(doc, { text: 'Launch', children: [{ text: 'Marketing' }, { text: 'Engineering', children: [{ text: 'API' }] }] });
    expect(ids).toHaveLength(4);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const at = (text: string) => {
      const n = notesOf(doc).find((x) => x.text === text)!;
      return { ...n, mind: nodes.get(n.id)!.get('mind') as { root: string; parent: string | null; order: number } };
    };
    const [root, m, e, api] = ['Launch', 'Marketing', 'Engineering', 'API'].map(at);
    expect(root.x).toBe(360);
    expect(m.x).toBe(root.x + NOTE_SIZE.w + MIND_GAP.x);
    expect(api.x).toBe(e.x + NOTE_SIZE.w + MIND_GAP.x);
    expect(e.y - m.y).toBe(NOTE_SIZE.h + MIND_GAP.y);
    expect([root.mind.parent, m.mind.parent, e.mind.parent, api.mind.parent]).toEqual([null, root.id, root.id, e.id]);
    expect(new Set([root, m, e, api].map((n) => n.mind.root))).toEqual(new Set([root.id]));
    const arrows = [...nodes.values()].filter((n) => n.get('kind') === 'connector');
    expect(arrows.map((a) => a.get('route'))).toEqual(['curve', 'curve', 'curve']);
  });

  it('writes at most 60 notes', () => {
    const doc = new Y.Doc();
    const ids = placeMindMap(doc, { text: 'Big', children: Array.from({ length: 100 }, (_, i) => ({ text: `b${i}` })) });
    expect(ids).toHaveLength(60);
  });
});
