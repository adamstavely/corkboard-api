import * as Y from 'yjs';
import { placesIn } from './node-schema';

/** What one change did to the board's things, by their ids: added, changed (anything in them) or removed. */
export interface Touched {
  added: Set<string>;
  changed: Set<string>;
  removed: Set<string>;
}

export const touched = (): Touched => ({ added: new Set(), changed: new Set(), removed: new Set() });

/**
 * Which things on the board an update (already applied to `doc`) added, changed or removed, for the history: so it can
 * say "Ada changed 3 things" of edits made straight in the board, which no endpoint records.
 */
export function touchedBy(doc: Y.Doc, update: Uint8Array, into: Touched = touched()): Touched {
  const { structs, ds } = Y.decodeUpdate(update);
  const { placeOf, isNode, find } = placesIn(doc, structs);
  const nodeOf = (item: Y.Item): string | null => {
    let at = item;
    for (let depth = 0; depth < 1000; depth++) {
      if (isNode(at)) return placeOf(at).key;
      const { parent } = placeOf(at);
      if (!(parent instanceof Y.Item)) return null;
      at = parent;
    }
    return null;
  };

  for (const s of structs) {
    if (!(s instanceof Y.Item) || s.content instanceof Y.ContentDeleted) continue;
    const id = nodeOf(s);
    if (!id) continue;
    if (isNode(s)) into.added.add(id);
    else into.changed.add(id);
  }
  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      for (let at = clock; at < clock + len; ) {
        const item = find({ client, clock: at });
        if (!(item instanceof Y.Item)) {
          at = item ? item.id.clock + item.length : at + 1;
          continue;
        }
        const id = nodeOf(item);
        if (id) {
          // A node replaced or taken away; or a field set again, which is a change.
          if (isNode(item) && !doc.getMap('nodes').has(id)) into.removed.add(id);
          else into.changed.add(id);
        }
        at = item.id.clock + item.length;
      }
    }
  }
  return into;
}

/** "2 added, 5 changed, 1 removed", or null when nothing was touched. */
export function describe(t: Touched): string | null {
  const added = [...t.added].filter((id) => !t.removed.has(id));
  const changed = [...t.changed].filter((id) => !t.added.has(id) && !t.removed.has(id));
  const removed = [...t.removed].filter((id) => !t.added.has(id));
  const parts = [added.length ? `${added.length} added` : '', changed.length ? `${changed.length} changed` : '', removed.length ? `${removed.length} removed` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
