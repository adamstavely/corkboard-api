import * as Y from 'yjs';
import { addNotes, framesOf, newFrame, notesOf, placeNotes } from '../assist/board-edit';
import { carryOver, nextTitle } from './next-session';

describe('the next session', () => {
  it('numbers the next board after the last', () => {
    expect(nextTitle('Sprint 12 retro')).toBe('Sprint 13 retro');
    expect(nextTitle('Q3 planning 2026')).toBe('Q3 planning 2027');
    expect(nextTitle('Retro')).toBe('Retro 2');
  });

  it("keeps the frames and carries over only what's still open", () => {
    const last = new Y.Doc();
    const well = newFrame(last, 'What went well', { x: 0, y: 0, w: 500, h: 400 }, 1);
    const actions = newFrame(last, 'Action items', { x: 600, y: 0, w: 500, h: 400 }, 2);
    placeNotes(last, [{ text: 'Demo went well', color: 'green', author: 'a' }], well);
    const [openNote, doneNote, loose] = placeNotes(
      last,
      [
        { text: 'Grace: second environment', color: 'yellow', author: 'a' },
        { text: 'Ada: runbook', color: 'yellow', author: 'a' },
        { text: 'Linus: nobody made a task', color: 'yellow', author: 'a' },
      ],
      actions,
    );
    const [elsewhere] = addNotes(last, [{ text: 'Open task from a stray note', color: 'blue' }]);
    const tasks = last.getMap('tasks');
    tasks.set('t1', { id: 't1', key: 'T-4', title: 'Second environment', status: 'doing', created: '2026-11-01', noteId: openNote, labels: ['action'] });
    tasks.set('t2', { id: 't2', key: 'T-5', title: 'Runbook', status: 'done', created: '2026-11-02', noteId: doneNote, labels: [] });
    tasks.set('t3', { id: 't3', key: 'T-9', title: 'Stray', status: 'todo', created: '2026-11-03', noteId: elsewhere, labels: [] });

    const next = new Y.Doc();
    expect(carryOver(last, next)).toEqual({ frames: 2, notes: 3, tasks: 2 });
    expect(framesOf(next).map((f) => f.title).sort()).toEqual(['Action items', 'What went well']);
    expect(notesOf(next).map((n) => n.text).sort()).toEqual(['Grace: second environment', 'Linus: nobody made a task', 'Open task from a stray note']);
    expect(notesOf(next).find((n) => n.id === loose)?.frame).toBe('Action items');
    const carried = [...next.getMap<{ key: string; title: string; labels: string[]; noteId?: string }>('tasks').values()];
    expect(carried.map((t) => [t.key, t.title, t.noteId])).toEqual([
      ['T-1', 'Second environment', openNote],
      ['T-2', 'Stray', elsewhere],
    ]);
    expect(carried[0].labels).toEqual(['action', 'carried over']);
    expect(next.getMap('meta').get('taskSeq')).toBe(2);
  });
});
