import * as Y from 'yjs';
import { describe as say, touchedBy } from './edit-log';

/** Applies a client's change to the server's copy and says what it touched, as the server would after applying it. */
function change(server: Y.Doc, edit: (nodes: Y.Map<Y.Map<unknown>>) => void) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(client);
  client.transact(() => edit(client.getMap('nodes')));
  const update = Y.encodeStateAsUpdate(client, before);
  Y.applyUpdate(server, update);
  return touchedBy(server, update);
}

describe('what an edit touched', () => {
  it('tells added, changed (fields or text) and removed things apart', () => {
    const board = new Y.Doc();
    const added = change(board, (nodes) => {
      for (const id of ['a', 'b', 'c']) {
        const node = new Y.Map<unknown>();
        nodes.set(id, node);
        node.set('kind', 'note');
        node.set('x', 0);
        const text = new Y.XmlFragment();
        node.set('text', text);
      }
    });
    expect([...added.added].sort()).toEqual(['a', 'b', 'c']);
    expect(say(added)).toBe('3 added');

    const edited = change(board, (nodes) => {
      nodes.get('a')!.set('x', 40);
      (nodes.get('b')!.get('text') as Y.XmlFragment).insert(0, [new Y.XmlText('Hi')]);
      nodes.delete('c');
    });
    expect([...edited.changed].sort()).toEqual(['a', 'b']);
    expect([...edited.removed]).toEqual(['c']);
    expect(say(edited)).toBe('2 changed, 1 removed');
  });

  it('says nothing of changes outside the board’s things', () => {
    const board = new Y.Doc();
    const client = new Y.Doc();
    const before = Y.encodeStateVector(client);
    client.getMap('tasks').set('t1', { title: 'Ship' });
    const update = Y.encodeStateAsUpdate(client, before);
    Y.applyUpdate(board, update);
    expect(say(touchedBy(board, update))).toBeNull();
  });
});
