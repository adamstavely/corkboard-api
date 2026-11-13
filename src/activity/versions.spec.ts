import * as Y from 'yjs';
import { addNotes, frameGroups, framesOf, notesOf } from '../assist/board-edit';
import { restoreInto } from './versions';

describe('restoring a version', () => {
  it("puts the saved notes, frames and tasks back, text and all, and leaves the chat alone", () => {
    const doc = new Y.Doc();
    const [a, b] = addNotes(doc, [{ text: '**Ada**\nCache the build', color: 'green' }, { text: 'Tests are flaky', color: 'yellow' }], []);
    frameGroups(doc, [{ title: 'Delivery', noteIds: [a, b] }]);
    doc.getMap('tasks').set('t1', { title: 'Cache the build' });
    const saved = Y.encodeStateAsUpdate(doc);

    addNotes(doc, [{ text: 'Later', color: 'pink' }]);
    doc.getMap('nodes').delete(a);
    doc.getMap('tasks').clear();
    doc.getArray('chat').push([{ text: 'hello' }]);

    restoreInto(doc, saved);
    expect(notesOf(doc).map((n) => [n.text, n.frame])).toEqual([
      ['Ada\nCache the build', 'Delivery'],
      ['Tests are flaky', 'Delivery'],
    ]);
    expect(framesOf(doc).map((f) => f.title)).toEqual(['Delivery']);
    expect(doc.getMap('tasks').get('t1')).toEqual({ title: 'Cache the build' });
    expect(doc.getArray('chat').length).toBe(1);
  });
});
