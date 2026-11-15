import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';

/** A task as the board keeps it (corkboard-ui's tasks.ts): the kanban's cards. */
export interface StoredTask {
  id: string;
  key: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  /** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
  priority: 0 | 1 | 2 | 3 | 4;
  /** A person's user id. */
  assignee?: string;
  labels: string[];
  /** "YYYY-MM-DD". */
  due?: string;
  noteId?: string;
  created: string;
}

/** Adds tasks to the board's kanban, numbered T-1, T-2… after the ones there, and returns them. */
export function addTasks(doc: Y.Doc, tasks: Omit<StoredTask, 'id' | 'key' | 'created'>[], now = Date.now()): StoredTask[] {
  const map = doc.getMap<StoredTask>('tasks');
  const meta = doc.getMap<unknown>('meta');
  const added: StoredTask[] = [];
  doc.transact(() => {
    let seq = Number(meta.get('taskSeq') ?? 0);
    for (const t of tasks) {
      const task: StoredTask = { ...t, id: randomUUID(), key: `T-${++seq}`, created: new Date(now).toISOString() };
      map.set(task.id, task);
      added.push(task);
    }
    meta.set('taskSeq', seq);
  });
  return added;
}

/** The tasks already on the board, for the model to avoid writing the same one twice. */
export function tasksOf(doc: Y.Doc): StoredTask[] {
  return [...doc.getMap<StoredTask>('tasks').values()];
}
