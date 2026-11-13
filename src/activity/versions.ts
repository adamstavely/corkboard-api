import * as Y from 'yjs';

/** The parts of a board's document a version brings back: its content and tasks. Chat, votes and history stay as they are. */
export const RESTORED = ['nodes', 'tasks'] as const;

/** Puts a saved state's content into a live document, replacing what's there. */
export function restoreInto(live: Y.Doc, saved: Uint8Array): void {
  const old = new Y.Doc();
  Y.applyUpdate(old, saved);
  live.transact(() => {
    for (const name of RESTORED) {
      const target = live.getMap<unknown>(name);
      const source = old.getMap<unknown>(name);
      target.clear();
      source.forEach((value, key) => target.set(key, value instanceof Y.AbstractType ? (value as Y.Map<unknown>).clone() : value));
    }
  });
}
