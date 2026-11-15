import * as Y from 'yjs';
import { addNotes } from '../assist/board-edit';
import { APP_SIZE, appsOn, placeApp, showAppVersion } from './app-node';

describe('mini-apps on the board', () => {
  it('places an app beside everything, naming its app, version and notes, and shows new versions wherever it is', () => {
    const doc = new Y.Doc();
    const [note] = addNotes(doc, [{ text: 'Idea', color: 'yellow' }]);
    const n = doc.getMap<Y.Map<unknown>>('nodes').get(note)!;
    const right = Number(n.get('x')) + Number(n.get('w'));
    const id = placeApp(doc, { appId: 'a1', title: 'Vote counter', version: 1, sources: [note] });
    const node = doc.getMap<Y.Map<unknown>>('nodes').get(id)!;
    expect(node.toJSON()).toMatchObject({ kind: 'app', appId: 'a1', title: 'Vote counter', version: 1, sources: [note], w: APP_SIZE.w, h: APP_SIZE.h });
    expect(node.get('x')).toBe(right + 160);

    expect(showAppVersion(doc, 'a1', 2, 'Vote tally')).toBe(1);
    expect(showAppVersion(doc, 'missing', 2)).toBe(0);
    expect(appsOn(doc)).toEqual([{ appId: 'a1', title: 'Vote tally', version: 2 }]);
  });
});
