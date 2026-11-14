import * as Y from 'yjs';

/** A board's next title: its last number up by one ("Sprint 12 retro" → "Sprint 13 retro"), else a 2 on the end. */
export function nextTitle(title: string): string {
  const t = title.trim() || 'Untitled board';
  const last = /(\d+)(?!.*\d)/.exec(t);
  if (!last) return `${t} 2`;
  return `${t.slice(0, last.index)}${Number(last[1]) + 1}${t.slice(last.index + last[1].length)}`;
}

interface StoredTask {
  id: string;
  key: string;
  status: string;
  created: string;
  noteId?: string;
  labels?: string[];
  [k: string]: unknown;
}

const ACTION_FRAME = /action items?/i;

const centreIn = (n: Y.Map<unknown>, f: Y.Map<unknown>) => {
  const num = (m: Y.Map<unknown>, k: string, d = 0) => (typeof m.get(k) === 'number' ? (m.get(k) as number) : d);
  const cx = num(n, 'x') + num(n, 'w', 200) / 2;
  const cy = num(n, 'y') + num(n, 'h', 160) / 2;
  return cx >= num(f, 'x') && cx <= num(f, 'x') + num(f, 'w') && cy >= num(f, 'y') && cy <= num(f, 'y') + num(f, 'h');
};

/**
 * Starts the next session's board from the last one: the same frames (columns, timelines) in the same places, empty
 * but for what's still open. That's the tasks not done, renumbered from T-1, and the notes they came from, plus any
 * notes left in "Action items" frames whose task isn't done. Returns what it carried.
 */
export function carryOver(from: Y.Doc, to: Y.Doc): { frames: number; notes: number; tasks: number } {
  const source = from.getMap<Y.Map<unknown>>('nodes');
  const tasks = [...from.getMap<StoredTask>('tasks').values()];
  const done = new Set(tasks.filter((t) => t.status === 'done' && t.noteId).map((t) => t.noteId!));
  const open = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));

  const frames = [...source.entries()].filter(([, n]) => n instanceof Y.Map && n.get('kind') === 'frame');
  const titleOf = (f: Y.Map<unknown>) => {
    const title: unknown = f.get('title');
    return typeof title === 'string' ? title : '';
  };
  const actionFrames = frames.filter(([, f]) => ACTION_FRAME.test(titleOf(f))).map(([, f]) => f);
  const keep = new Set<string>(open.flatMap((t) => (t.noteId ? [t.noteId] : [])));
  source.forEach((n, id) => {
    if (n instanceof Y.Map && n.get('kind') === 'note' && !done.has(id) && actionFrames.some((f) => centreIn(n, f))) keep.add(id);
  });
  const notes = [...keep].filter((id) => source.get(id) instanceof Y.Map && source.get(id)!.get('kind') === 'note');

  const target = to.getMap<Y.Map<unknown>>('nodes');
  to.transact(() => {
    for (const [id, f] of frames) target.set(id, f.clone());
    for (const id of notes) target.set(id, source.get(id)!.clone());
    const carried = to.getMap<StoredTask>('tasks');
    open.forEach((t, i) => {
      const labels = [...new Set([...(t.labels ?? []), 'carried over'])];
      const { noteId, ...rest } = t;
      carried.set(t.id, { ...rest, key: `T-${i + 1}`, labels, ...(noteId && notes.includes(noteId) ? { noteId } : {}) });
    });
    to.getMap<unknown>('meta').set('taskSeq', open.length);
  });
  return { frames: frames.length, notes: notes.length, tasks: open.length };
}
