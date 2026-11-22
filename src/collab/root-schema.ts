import * as Y from 'yjs';
import { decoded } from './decoded';
import { alreadyHas, existing, SERVER_OWNED, type ID } from './server-owned';

/** The parts of a board clients write: its items, its tasks and the task counter. Everything else is the API's. */
export const CLIENT_ROOTS: ReadonlySet<string> = new Set(['nodes', 'tasks', 'meta']);
/** Written by the API for one reader (a feedback participant's own view), never by a client. */
const PROJECTED_ROOTS: ReadonlySet<string> = new Set(['you']);

const MAX_TASK_JSON = 10_000;
const MAX_META_JSON = 2_000;
const MAX_TASK_SEQ = 1_000_000_000;
const STATUSES = new Set(['todo', 'doing', 'done']);

const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const jsonLength = (v: unknown): number => {
  try {
    return JSON.stringify(v ?? null).length;
  } catch {
    return Infinity;
  }
};

/** What's wrong with a task as the board keeps it (corkboard-ui's tasks.ts StoredTask), or null if it's fine. */
export function taskProblem(id: string, task: unknown): string | null {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return 'not a task';
  if (jsonLength(task) > MAX_TASK_JSON) return 'too large';
  const t = task as Record<string, unknown>;
  if (t['id'] !== id) return 'an id that is not its own';
  // Keys are T-<n> once numbered, but a card just added on the task board briefly has its own: any short text will do.
  if (typeof t['key'] !== 'string' || !t['key'] || t['key'].length > 50) return 'a key that is not a short name';
  if (!isString(t['title'], 2_000)) return 'a title that is not text';
  if (typeof t['status'] !== 'string' || !STATUSES.has(t['status'])) return 'an unknown status';
  if (!Number.isInteger(t['priority']) || (t['priority'] as number) < 0 || (t['priority'] as number) > 4) return 'a priority out of range';
  if (!Array.isArray(t['labels']) || t['labels'].length > 50 || !t['labels'].every((l) => isString(l, 100))) return 'labels that are not a list of text';
  if (typeof t['created'] !== 'string' || Number.isNaN(Date.parse(t['created']))) return 'a creation time that is not a time';
  if (t['assignee'] !== undefined && !isString(t['assignee'], 200)) return 'an assignee that is not an id';
  if (t['due'] !== undefined && (typeof t['due'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t['due']))) return 'a due date that is not YYYY-MM-DD';
  if (t['noteId'] !== undefined && !isString(t['noteId'], 200)) return 'a note id that is not an id';
  if (t['estimate'] !== undefined && !isString(t['estimate'], 8)) return 'an estimate that is not a size';
  // When its title, status or assignee last changed on the board, for settling a change made in its tracker too.
  if (t['updated'] !== undefined && (typeof t['updated'] !== 'string' || Number.isNaN(Date.parse(t['updated'])))) return 'a change time that is not a time';
  const external = t['external'];
  if (external !== undefined) {
    const e = external as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || !isString(e['kind'], 50) || !isString(e['key'], 200) || !isString(e['url'], 2_000)) return 'an issue link that is not one';
    // Who the issue is assigned to in the tracker, by name, when they aren't on the board (written by the API).
    if (e['assignee'] !== undefined && !isString(e['assignee'], 200)) return 'an issue assignee that is not a name';
  }
  return null;
}

/** What's wrong with an entry of the board's `meta`, or null if it's fine. */
function metaProblem(key: string, value: unknown): string | null {
  if (key === 'taskSeq') return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TASK_SEQ ? null : 'a task counter that is not a count';
  return jsonLength(value) <= MAX_META_JSON ? null : 'a value that is too large';
}

/**
 * Why an update would write somewhere a board has no use for (a top-level type no one reads), or put a malformed task
 * or counter in `tasks` or `meta`, or null if it wouldn't. `nodes` has its own guard (nodeProblem), and the API's own
 * parts theirs (serverOwnedIn), which runs first, so everything here can be placed. Like them, it runs before the update
 * is applied: a bad task is never saved or sent on, so it can't stop a board from opening.
 */
export function rootProblem(doc: Y.Doc, update: Uint8Array): string | null {
  const { structs, within } = decoded(update);
  const find = (id: ID) => existing(doc, id) ?? within(id);
  const rootName = (type: Y.AbstractType<unknown>): string | null => {
    for (const [name, t] of doc.share) if (t === type) return name;
    return null;
  };

  /** The top-level type an entry sits directly in, and its key there; null for anything nested deeper. A map entry set
   * again names neither; they're its left neighbour's. */
  const topOf = (item: Y.Item, depth = 0): { root: string; key: string | null } | null => {
    const parent = item.parent as unknown;
    if (typeof parent === 'string') return { root: parent, key: item.parentSub };
    if (parent instanceof Y.AbstractType) {
      if (parent._item) return null;
      const root = rootName(parent);
      return root === null ? null : { root, key: item.parentSub };
    }
    if (parent || depth > 1000) return null;
    const next = item.origin ? find(item.origin) : item.rightOrigin ? find(item.rightOrigin) : undefined;
    return next instanceof Y.Item ? topOf(next, depth + 1) : null;
  };

  for (const s of structs) {
    if (!(s instanceof Y.Item) || s.content instanceof Y.ContentDeleted || alreadyHas(doc, s)) continue;
    const top = topOf(s);
    if (!top) continue;
    const { root, key } = top;
    if (!CLIENT_ROOTS.has(root)) {
      if (SERVER_OWNED.has(root) || PROJECTED_ROOTS.has(root)) continue;
      return `${root}: not part of a board`;
    }
    if (root === 'nodes') continue;
    if (key === null) return `${root}: not a map`;
    if (!(s.content instanceof Y.ContentAny) || s.content.getContent().length !== 1) return `${root}.${key}: not a plain value`;
    const [value] = s.content.getContent() as unknown[];
    const problem = root === 'tasks' ? taskProblem(key, value) : metaProblem(key, value);
    if (problem) return `${root}.${key}: ${problem}`;
  }
  return null;
}
