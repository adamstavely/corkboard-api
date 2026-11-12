import * as Y from 'yjs';
import { addNotes, FRAME_PADDING, FRAME_TITLE, frameGroups, framesOf, inFrame, NOTE_SIZE, notesOf, setColors } from './board-edit';
import { fragmentText } from '../boards/board-text';

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

  it('sorts notes into titled frames where they were, each note once, and says which frame a note is in', () => {
    const doc = new Y.Doc();
    const [a, b, c, d] = addNotes(doc, ['Slow deploys', 'Flaky tests', 'Great pairing', 'Loud office'].map((text) => ({ text, color: 'yellow' as const })), []);
    const { frameIds, moved } = frameGroups(doc, [
      { title: 'Delivery', noteIds: [a, b, 'missing'] },
      { title: 'Team', noteIds: [c, a, d] },
      { title: 'Empty', noteIds: ['missing'] },
    ]);
    expect(frameIds).toHaveLength(2);
    expect(moved).toBe(4);

    const frames = framesOf(doc);
    const delivery = frames.find((f) => f.title === 'Delivery')!;
    const team = frames.find((f) => f.title === 'Team')!;
    // Placed where the notes were (the board's top-left), side by side, sized to hold their notes.
    expect(delivery).toMatchObject({ x: 0, y: 0, h: FRAME_TITLE + FRAME_PADDING + NOTE_SIZE.h });
    expect(team.x).toBeGreaterThan(delivery.x + delivery.w);

    const notes = notesOf(doc);
    expect(notes.find((n) => n.id === a)).toMatchObject({ frame: 'Delivery', x: FRAME_PADDING, y: FRAME_TITLE });
    expect(notes.find((n) => n.id === b)!.frame).toBe('Delivery');
    expect(notes.find((n) => n.id === c)!.frame).toBe('Team');
    expect(notes.find((n) => n.id === d)!.frame).toBe('Team');
    for (const n of notes.filter((n) => n.frame)) expect(inFrame({ ...n, ...NOTE_SIZE }, n.frame === 'Team' ? team : delivery)).toBe(true);
  });

  it('puts frames to the right of everything when where the notes were would cover something else', () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: 'a', color: 'yellow' }, { text: 'b', color: 'yellow' }], []);
    frameGroups(doc, [{ title: 'Just a', noteIds: [a] }]);
    const [frame] = framesOf(doc);
    const other = notesOf(doc).find((n) => n.id === b)!;
    expect(frame.x).toBeGreaterThan(other.x + NOTE_SIZE.w);
  });

  it('writes a leading **name** in bold, as the editor stores it', () => {
    const doc = new Y.Doc();
    const [id] = addNotes(doc, [{ text: '**Ada**\nCache the build', color: 'green' }], []);
    const fragment = doc.getMap<Y.Map<unknown>>('nodes').get(id)!.get('text') as Y.XmlFragment;
    expect(fragmentText(fragment)).toBe('Ada\nCache the build');
    const first = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    expect(first.toDelta()).toEqual([{ insert: 'Ada', attributes: { bold: {} } }]);
  });
});
