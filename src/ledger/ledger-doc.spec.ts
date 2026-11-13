import * as Y from 'yjs';
import { addNotes, frameGroups, framesOf, notesOf, setColors } from '../assist/board-edit';
import { capture, diff, ledgerEntries, record, redo, snapshot, undo } from './ledger-doc';

describe('the change ledger', () => {
  it("records what the model changed and takes exactly that back", () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: 'A', color: 'yellow' }, { text: 'B', color: 'yellow' }], []);
    frameGroups(doc, [{ title: 'Old', noteIds: [a, b] }]);
    const before = snapshot(doc);

    // The model regroups (removing "Old"), recolours a note and writes one.
    frameGroups(doc, [{ title: 'New', noteIds: [a, b] }]);
    setColors(doc, [a], 'pink');
    const [added] = addNotes(doc, [{ text: 'C', color: 'blue' }]);
    const changes = diff(before, snapshot(doc));
    expect(changes.created).toContain(added);
    expect(changes.removed.map((r) => r.attrs['title'])).toEqual(['Old']);
    expect(changes.changed.find((c) => c.id === a)?.before).toMatchObject({ color: 'yellow' });

    record(doc, { id: 'e1', at: 1, model: 'Claude', forName: 'Ada', action: 'Regrouped', ...changes, createdNodes: capture(doc, changes.created), undone: false });
    expect(undo(doc, 'e1')).toBeNull();
    expect(notesOf(doc).map((n) => [n.text, n.color])).toEqual([
      ['A', 'yellow'],
      ['B', 'yellow'],
    ]);
    expect(framesOf(doc).map((f) => f.title)).toEqual(['Old']);
    expect(notesOf(doc).every((n) => n.frame === 'Old')).toBe(true);
    expect(ledgerEntries(doc)[0].undone).toBe(true);
    expect(undo(doc, 'e1')).toBe('That change was already undone');
    expect(undo(doc, 'nope')).toBe('That change is no longer in the history');

    // Redo puts it all back, the new note's text too.
    expect(redo(doc, 'e1')).toBeNull();
    expect(framesOf(doc).map((f) => f.title)).toEqual(['New']);
    expect(notesOf(doc).map((n) => [n.text, n.color, n.frame])).toEqual([
      ['A', 'pink', 'New'],
      ['B', 'yellow', 'New'],
      ['C', 'blue', undefined],
    ]);
    expect(redo(doc, 'e1')).toBe("That change wasn't undone");
  });
});
