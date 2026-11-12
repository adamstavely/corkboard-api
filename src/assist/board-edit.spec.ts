import * as Y from 'yjs';
import { addNotes, NOTE_SIZE, notesOf, setColors } from './board-edit';

describe('board edits', () => {
  it('adds notes in a grid to the right of what is in focus, one paragraph per line, on top', () => {
    const doc = new Y.Doc();
    const [first] = addNotes(doc, [{ text: 'Existing', color: 'yellow' }], []);
    const near = notesOf(doc);
    const ids = addNotes(doc, Array.from({ length: 5 }, (_, i) => ({ text: `Idea ${i}\nmore`, color: 'blue' as const })), near);

    const notes = notesOf(doc);
    const added = ids.map((id) => notes.find((n) => n.id === id)!);
    expect(added[0]).toMatchObject({ x: NOTE_SIZE.w + 72, y: 0, color: 'blue', text: 'Idea 0\nmore' });
    expect(added[4].y).toBeGreaterThan(added[0].y);
    expect(added[4].x).toBe(added[0].x);

    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    expect(nodes.get(ids[0])!.get('z')).toBeGreaterThan(nodes.get(first)!.get('z') as number);
    expect(nodes.get(ids[0])!.get('author')).toBe('assistant');
  });

  it('recolours the notes that exist and says how many', () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: 'a', color: 'yellow' }, { text: 'b', color: 'yellow' }]);
    expect(setColors(doc, [a, b, 'missing'], 'pink')).toBe(2);
    expect(notesOf(doc).map((n) => n.color)).toEqual(['pink', 'pink']);
  });
});
