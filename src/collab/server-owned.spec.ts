import * as Y from 'yjs';
import { serverOwnedIn, UNRESOLVED } from './server-owned';

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

  it("refuses an update built on the API's next item before it exists, which Yjs would otherwise apply later unchecked", () => {
    const board = new Y.Doc();
    board.getArray('chat').push(['m1']);
    // What the API will write next, from its own client: the attacker predicts it.
    const predicted = new Y.Doc();
    Y.applyUpdate(predicted, Y.encodeStateAsUpdate(board));
    predicted.clientID = board.clientID;
    predicted.getArray('chat').push(['m2']);
    expect(predicted.getArray('chat').length).toBe(2);
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, Y.encodeStateAsUpdate(predicted));
    const before = Y.encodeStateVector(attacker);
    attacker.getArray('chat').push(['forged']);
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(attacker, before))).toBe(UNRESOLVED);
  });

  it('refuses updates after a gap in a client\'s changes, and deletes of things not here', () => {
    const board = new Y.Doc();
    board.getMap('nodes').set('a', 1);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(board));
    client.getMap('nodes').set('b', 2);
    const afterB = Y.encodeStateVector(client);
    client.getMap('nodes').set('c', 3);
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(client, afterB))).toBe(UNRESOLVED);

    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(board));
    other.getMap('nodes').set('d', 4);
    const afterD = Y.encodeStateVector(other);
    other.getMap('nodes').delete('d');
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(other, afterD))).toBe(UNRESOLVED);
  });

  it('still lets someone type in a note another person has just deleted', () => {
    const board = new Y.Doc();
    const note = new Y.Map<unknown>();
    board.getMap('nodes').set('n', note);
    const text = new Y.XmlText();
    note.set('text', text);
    text.insert(0, 'Hello');
    const typist = new Y.Doc();
    Y.applyUpdate(typist, Y.encodeStateAsUpdate(board));
    // Deleted on the server (its insides collected) while the typist, who hasn't heard yet, types.
    board.getMap('nodes').delete('n');
    const before = Y.encodeStateVector(typist);
    ((typist.getMap('nodes').get('n') as Y.Map<unknown>).get('text') as Y.XmlText).insert(5, ' there');
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(typist, before))).toBeNull();
  });

  it("takes a browser's whole saved copy, with the server's own replaced values and deletes, and still refuses forgeries in it", () => {
    const board = new Y.Doc();
    board.getMap('timer').set('endsAt', 1);
    board.getMap('timer').set('endsAt', 2);
    board.getMap('votes').set('ada', ['n1']);
    board.getMap('votes').delete('ada');
    // The browser's copy, everything the server wrote included, plus a note of its own.
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(board));
    browser.getMap('nodes').set('mine', new Y.Map());
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(browser))).toBeNull();
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(board)))).toBeNull();

    // Riding along with all that, a new value or a delete of the server's is still refused.
    const forger = new Y.Doc();
    Y.applyUpdate(forger, Y.encodeStateAsUpdate(board));
    forger.getMap('timer').set('endsAt', 99);
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(forger))).toBe('timer');
    const deleter = new Y.Doc();
    Y.applyUpdate(deleter, Y.encodeStateAsUpdate(board));
    deleter.getMap('timer').delete('endsAt');
    expect(serverOwnedIn(board, Y.encodeStateAsUpdate(deleter))).toBe('timer');
  });
});
