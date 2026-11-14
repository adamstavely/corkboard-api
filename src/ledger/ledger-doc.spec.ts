import * as Y from 'yjs';
import { addNotes, frameGroups, framesOf, notesOf, setColors } from '../assist/board-edit';
import { ChangeTracker, ledgerEntries, record, redo, undo, type LedgerEntry } from './ledger-doc';

const entry = (id: string, tracker: ChangeTracker): LedgerEntry => ({ id, at: 1, model: 'Claude', forName: 'Ada', action: 'Changed', ...tracker.changes(), undone: false });

describe('the change ledger', () => {
  it("records what the model changed and takes exactly that back", () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: 'A', color: 'yellow' }, { text: 'B', color: 'yellow' }], []);
    frameGroups(doc, [{ title: 'Old', noteIds: [a, b] }]);
    const tracker = new ChangeTracker();

    // The model regroups (removing "Old"), recolours a note and writes one.
    tracker.track(doc, (d) => frameGroups(d, [{ title: 'New', noteIds: [a, b] }]));
    tracker.track(doc, (d) => setColors(d, [a], 'pink'));
    const [added] = tracker.track(doc, (d) => addNotes(d, [{ text: 'C', color: 'blue' }]));
    const changes = tracker.changes();
    expect(changes.created).toContain(added);
    expect(changes.removed.map((r) => r.attrs['title'])).toEqual(['Old']);
    expect(changes.changed.find((c) => c.id === a)?.before).toMatchObject({ color: 'yellow' });

    record(doc, entry('e1', tracker));
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

  it("leaves out what people did while the model worked, and undo leaves their later edits alone", () => {
    const doc = new Y.Doc();
    const [a] = addNotes(doc, [{ text: 'A', color: 'yellow' }], []);
    const tracker = new ChangeTracker();
    const [mine, edited] = tracker.track(doc, (d) => addNotes(d, [{ text: 'Model', color: 'blue' }, { text: 'Model 2', color: 'blue' }]));
    // Between the model's tool calls, a person writes a note and recolours one.
    const [human] = addNotes(doc, [{ text: 'Human', color: 'yellow' }]);
    setColors(doc, [a], 'green');
    tracker.track(doc, (d) => setColors(d, [mine], 'pink'));

    const changes = tracker.changes();
    expect(changes.created.sort()).toEqual([mine, edited].sort());
    expect(changes.changed).toEqual([]);
    record(doc, entry('e1', tracker));

    // Someone recolours one of the model's notes, then undoes the model's change.
    setColors(doc, [edited], 'green');
    expect(undo(doc, 'e1')).toBeNull();
    expect(notesOf(doc).map((n) => n.text).sort()).toEqual(['A', 'Human', 'Model 2']);
    expect(notesOf(doc).find((n) => n.id === a)?.color).toBe('green');
    expect(notesOf(doc).some((n) => n.id === human)).toBe(true);
  });

  it("only puts a property back while it's still the model's value", () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: 'A', color: 'yellow' }, { text: 'B', color: 'yellow' }], []);
    const tracker = new ChangeTracker();
    tracker.track(doc, (d) => setColors(d, [a, b], 'pink'));
    record(doc, entry('e1', tracker));
    setColors(doc, [b], 'blue');
    expect(undo(doc, 'e1')).toBeNull();
    expect(notesOf(doc).map((n) => n.color)).toEqual(['yellow', 'blue']);
  });
});
