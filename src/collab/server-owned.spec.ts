import * as Y from 'yjs';
import { serverOwnedIn } from './server-owned';

/** A client's change to a copy of the server's document, as the update it would send. */
function clientChange(server: Y.Doc, change: (doc: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const before = Y.encodeStateVector(client);
  change(client);
  return Y.encodeStateAsUpdate(client, before);
}

describe('server-owned parts of a board', () => {
  const server = new Y.Doc();
  const note = new Y.Map<unknown>();
  server.getMap('nodes').set('n1', note);
  note.set('x', 0);
  const text = new Y.XmlFragment();
  note.set('text', text);
  text.insert(0, [new Y.XmlText('Hello')]);
  server.getArray('chat').push([{ id: 'm1', authorId: 'ada', text: 'Hi' }]);
  server.getMap('votes').set('ada', ['n1']);
  const timer = new Y.Map<unknown>();
  server.getMap('timer').set('state', timer);
  timer.set('ends', 1);

  it('lets clients edit notes, their text and tasks', () => {
    expect(serverOwnedIn(server, clientChange(server, (d) => (d.getMap('nodes').get('n1') as Y.Map<unknown>).set('x', 5)))).toBeNull();
    expect(serverOwnedIn(server, clientChange(server, (d) => ((d.getMap('nodes').get('n1') as Y.Map<unknown>).get('text') as Y.XmlFragment).insert(1, [new Y.XmlText('!')])))).toBeNull();
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getMap('tasks').set('t', { title: 'T' })))).toBeNull();
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getMap('nodes').delete('n1')))).toBeNull();
  });

  it('refuses votes, chat and timer changes, added or deleted, nested or not', () => {
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getMap('votes').set('grace', ['n1', 'n1'])))).toBe('votes');
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getArray('chat').push([{ authorId: 'ada', text: 'Forged' }])))).toBe('chat');
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getArray('chat').delete(0, 1)))).toBe('chat');
    expect(serverOwnedIn(server, clientChange(server, (d) => (d.getMap('timer').get('state') as Y.Map<unknown>).set('ends', 99)))).toBe('timer');
    expect(serverOwnedIn(server, clientChange(server, (d) => d.getMap('ledger').set('x', 1)))).toBe('ledger');
  });
});
