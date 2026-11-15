import * as Y from 'yjs';
import { canChangeLocked, lockProblem } from './locks';

/** A client's change to a copy of the board, as the update it would send. */
function clientChange(board: Y.Doc, change: (nodes: Y.Map<Y.Map<unknown>>) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(board));
  const before = Y.encodeStateVector(client);
  client.transact(() => change(client.getMap('nodes')));
  return Y.encodeStateAsUpdate(client, before);
}

describe('locked things', () => {
  const board = new Y.Doc();
  const nodes = board.getMap<Y.Map<unknown>>('nodes');
  const frame = new Y.Map<unknown>();
  nodes.set('f1', frame);
  frame.set('kind', 'frame');
  frame.set('title', 'Ideas');
  frame.set('x', 0);
  frame.set('locked', true);
  const note = new Y.Map<unknown>();
  nodes.set('n1', note);
  note.set('kind', 'note');
  note.set('x', 10);
  const text = new Y.XmlFragment();
  note.set('text', text);
  text.insert(0, [new Y.XmlText('Hello')]);
  const lockedNote = new Y.Map<unknown>();
  nodes.set('n2', lockedNote);
  lockedNote.set('kind', 'note');
  lockedNote.set('locked', true);
  const lockedText = new Y.XmlFragment();
  lockedNote.set('text', lockedText);
  lockedText.insert(0, [new Y.XmlText('Fixed')]);

  it('lets anyone add notes and change what is not locked', () => {
    expect(lockProblem(board, clientChange(board, (n) => n.get('n1')!.set('x', 50)))).toBeNull();
    expect(lockProblem(board, clientChange(board, (n) => (n.get('n1')!.get('text') as Y.XmlFragment).insert(1, [new Y.XmlText('!')])))).toBeNull();
    expect(
      lockProblem(
        board,
        clientChange(board, (n) => {
          const added = new Y.Map<unknown>();
          n.set('n3', added);
          added.set('kind', 'note');
          added.set('x', 5);
        }),
      ),
    ).toBeNull();
    expect(lockProblem(board, clientChange(board, (n) => n.delete('n1')))).toBeNull();
  });

  it('refuses moving, editing, retitling or deleting what is locked', () => {
    expect(lockProblem(board, clientChange(board, (n) => n.get('f1')!.set('x', 99)))).toMatch(/f1: it is locked/);
    expect(lockProblem(board, clientChange(board, (n) => n.get('f1')!.set('title', 'Mine')))).toMatch(/locked/);
    expect(lockProblem(board, clientChange(board, (n) => n.get('f1')!.delete('title')))).toMatch(/locked/);
    expect(lockProblem(board, clientChange(board, (n) => n.delete('f1')))).toMatch(/f1: it is locked/);
    expect(lockProblem(board, clientChange(board, (n) => (n.get('n2')!.get('text') as Y.XmlFragment).insert(1, [new Y.XmlText('!')])))).toMatch(/n2: it is locked/);
    // Replacing it outright, under the same id.
    expect(lockProblem(board, clientChange(board, (n) => n.set('f1', new Y.Map())))).toMatch(/locked/);
  });

  it('refuses locking or unlocking', () => {
    expect(lockProblem(board, clientChange(board, (n) => n.get('n1')!.set('locked', true)))).toMatch(/n1: locking or unlocking/);
    expect(lockProblem(board, clientChange(board, (n) => n.get('f1')!.delete('locked')))).toMatch(/f1: locking or unlocking/);
    expect(
      lockProblem(
        board,
        clientChange(board, (n) => {
          const added = new Y.Map<unknown>();
          n.set('n4', added);
          added.set('locked', true);
        }),
      ),
    ).toMatch(/locking/);
  });

  it('leaves locks to owners and the facilitator', () => {
    const doc = new Y.Doc();
    expect(canChangeLocked(doc, 'owner', 'ada')).toBe(true);
    expect(canChangeLocked(doc, 'updater', 'grace')).toBe(false);
    doc.getMap('facilitator').set('userId', 'grace');
    expect(canChangeLocked(doc, 'updater', 'grace')).toBe(true);
    expect(canChangeLocked(doc, 'updater', 'linus')).toBe(false);
  });

  it("takes a browser's whole saved copy of a board with locked things in it, unchanged", () => {
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(board));
    copy.getMap<Y.Map<unknown>>('nodes').get('n1')!.set('x', 77);
    expect(lockProblem(board, Y.encodeStateAsUpdate(copy))).toBeNull();
    copy.getMap<Y.Map<unknown>>('nodes').get('f1')!.set('x', 77);
    expect(lockProblem(board, Y.encodeStateAsUpdate(copy))).toMatch(/f1: it is locked/);
  });
});
