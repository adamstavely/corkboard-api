import * as Y from 'yjs';
import { addNotes } from '../assist/board-edit';
import { contentFingerprint } from './summary-doc';

describe("a board's content fingerprint", () => {
  it('changes when a note is edited, added or removed, and not when one is moved', () => {
    const doc = new Y.Doc();
    const [a] = addNotes(doc, [{ text: 'Deploys are slow', color: 'yellow' }], []);
    const first = contentFingerprint(doc);
    expect(first).toMatch(/^[0-9a-f]{8}$/);

    const note = doc.getMap<Y.Map<unknown>>('nodes').get(a)!;
    note.set('x', 500);
    expect(contentFingerprint(doc)).toBe(first);

    ((note.get('text') as Y.XmlFragment).get(0) as Y.XmlElement).insert(0, [new Y.XmlText('Very ')]);
    const edited = contentFingerprint(doc);
    expect(edited).not.toBe(first);

    const [b] = addNotes(doc, [{ text: 'More', color: 'yellow' }]);
    expect(contentFingerprint(doc)).not.toBe(edited);
    doc.getMap('nodes').delete(b);
    expect(contentFingerprint(doc)).toBe(edited);
  });
});
