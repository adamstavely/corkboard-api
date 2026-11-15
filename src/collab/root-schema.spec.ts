import * as Y from 'yjs';
import { rootProblem, taskProblem } from './root-schema';

/** A client's change to a copy of the board, as the update it would send. */
function clientChange(board: Y.Doc, change: (doc: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(board));
  const before = Y.encodeStateVector(client);
  client.transact(() => change(client));
  return Y.encodeStateAsUpdate(client, before);
}

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, key: 'T-1', title: 'Ship it', status: 'todo', priority: 0, labels: [], created: '2026-11-15T12:00:00.000Z', ...extra });

describe("a board's tasks and other parts", () => {
  const board = new Y.Doc();
  board.getMap('tasks').set('t1', task('t1'));
  board.getMap('meta').set('taskSeq', 1);

  it('takes well-formed tasks and counters, new or changed', () => {
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', task('t2', { key: 'T-2', due: '2026-12-01', estimate: 'M', assignee: 'ada', noteId: 'n1' }))))).toBeNull();
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t1', task('t1', { status: 'done' }))))).toBeNull();
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('meta').set('taskSeq', 2)))).toBeNull();
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').delete('t1')))).toBeNull();
  });

  it('refuses a task that is empty, missing fields or out of range', () => {
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('bad', {})))).toMatch(/^tasks\.bad: /);
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', task('t2', { created: 5 }))))).toContain('creation time');
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', task('t2', { status: 'later' }))))).toContain('status');
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', task('other')))) ).toContain('id');
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', 'Ship it')))).toContain('not a task');
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t2', new Y.Map())))).toContain('not a plain value');
    // Changing an existing task into a broken one is refused too.
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('tasks').set('t1', { ...task('t1'), labels: 'x' })))).toContain('labels');
  });

  it('refuses a counter that is not a count', () => {
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('meta').set('taskSeq', -1)))).toContain('counter');
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('meta').set('taskSeq', 'many')))).toContain('counter');
  });

  it('refuses parts of the document no board has, and tasks kept as a list', () => {
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('junk').set('a', 1)))).toBe('junk: not part of a board');
    expect(rootProblem(new Y.Doc(), clientChange(new Y.Doc(), (d) => d.getArray('tasks').insert(0, [task('t1')])))).toBe('tasks: not a map');
  });

  it('leaves nodes to their own guard and takes a browser sending back what the server has', () => {
    expect(rootProblem(board, clientChange(board, (d) => d.getMap('nodes').set('n1', new Y.Map())))).toBeNull();
    expect(rootProblem(board, Y.encodeStateAsUpdate(board))).toBeNull();
  });

  it('checks every field a task may have', () => {
    expect(taskProblem('t', task('t', { external: { kind: 'jira', key: 'P-1', url: 'https://x' } }))).toBeNull();
    expect(taskProblem('t', task('t', { external: { kind: 'jira' } }))).toContain('issue link');
    expect(taskProblem('t', task('t', { due: 'tomorrow' }))).toContain('due');
    expect(taskProblem('t', task('t', { priority: 9 }))).toContain('priority');
    expect(taskProblem('t', task('t', { key: 'NW-301' }))).toBeNull();
    expect(taskProblem('t', task('t', { key: '' }))).toContain('key');
    expect(taskProblem('t', task('t', { key: 7 }))).toContain('key');
  });
});
