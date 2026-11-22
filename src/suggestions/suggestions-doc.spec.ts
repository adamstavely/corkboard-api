import * as Y from 'yjs';
import { addNotes, notesOf, setColors } from '../assist/board-edit';
import { ChangeTracker } from '../ledger/ledger-doc';
import { applySuggestion, Draft, MAX_SUGGESTIONS, propose, suggestionsIn, take, wouldDo, type Suggestion } from './suggestions-doc';

const suggestion = (id: string, update: Uint8Array, at = Date.now()): Suggestion => ({
  id,
  at,
  model: 'Claude',
  forId: 'u1',
  forName: 'Ada',
  asked: 'Add ideas',
  action: 'Would add 1 note.',
  done: 'Added 1 note',
  added: [],
  changed: [],
  removed: [],
  update: Buffer.from(update).toString('base64'),
});

describe('suggestions', () => {
  it('lets the model change a private copy, leaving the board alone until the change is applied', () => {
    const board = new Y.Doc();
    const [kept] = addNotes(board, [{ text: 'Keep', color: 'yellow' }]);
    const draft = new Draft(board);
    expect(draft.empty).toBe(true);
    const [added] = draft.edit((d) => addNotes(d, [{ text: 'New idea', color: 'blue' }]));
    draft.edit((d) => setColors(d, [kept], 'pink'));
    expect(draft.empty).toBe(false);
    expect(notesOf(board).map((n) => n.text)).toEqual(['Keep']);
    expect(draft.tracker.changes().created).toEqual([added]);

    // People keep working meanwhile; the suggestion still applies on top.
    const [theirs] = addNotes(board, [{ text: 'Meanwhile', color: 'green' }]);
    const tracker = new ChangeTracker();
    board.transact(() => applySuggestion(board, suggestion('s1', draft.update()), tracker));
    expect(notesOf(board).map((n) => [n.text, n.color])).toEqual(
      expect.arrayContaining([
        ['Keep', 'pink'],
        ['New idea', 'blue'],
        ['Meanwhile', 'green'],
      ]),
    );
    expect(tracker.changes().created).toEqual([added]);
    expect(tracker.changes().changed.map((c) => c.id)).toEqual([kept]);
    expect(notesOf(board).some((n) => n.id === theirs)).toBe(true);
  });

  it('keeps the newest suggestions, and takes each off once', () => {
    const board = new Y.Doc();
    for (let i = 0; i < MAX_SUGGESTIONS + 2; i++) propose(board, suggestion(`s${i}`, new Uint8Array(), i));
    const ids = suggestionsIn(board).map((s) => s.id);
    expect(ids).toHaveLength(MAX_SUGGESTIONS);
    expect(ids[0]).toBe('s2');
    expect(take(board, 's2')?.id).toBe('s2');
    expect(take(board, 's2')).toBeUndefined();
  });

  it('words a change as a proposal', () => {
    expect(wouldDo('Made 3 frames, moved 9 notes into them and added 2 notes')).toBe('Would make 3 frames, move 9 notes into them and add 2 notes.');
    expect(wouldDo('Changed the board')).toBe('Would change the board.');
    expect(wouldDo('Added 1 task and drew 1 diagram')).toBe('Would add 1 task and draw 1 diagram.');
  });
});
