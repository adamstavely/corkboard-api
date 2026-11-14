import * as Y from 'yjs';

/**
 * The parts of a board's document only the API writes, through its own direct connections: chat, votes, the timer,
 * reactions, the summary, hidden writing rounds and the model's change history. People's clients read them but may not change them, so who
 * wrote a message or cast a vote is whatever the API checked, not what a client claims.
 */
export const SERVER_OWNED: ReadonlySet<string> = new Set(['chat', 'ledger', 'reactions', 'summary', 'timer', 'votes', 'voting', 'writing']);

type ID = { client: number; clock: number };

/** The item with this id in the document, if it has it. */
function existing(doc: Y.Doc, id: ID): Y.Item | undefined {
  const structs = doc.store.clients.get(id.client);
  const last = structs?.at(-1);
  if (!last || last.id.clock + last.length <= id.clock) return undefined;
  const struct = Y.getItem(doc.store, id);
  return struct instanceof Y.Item ? struct : undefined;
}

/** The name of the top-level type a (possibly nested) type is in. */
function topLevel(type: Y.AbstractType<unknown>): string | null {
  let t = type;
  for (let depth = 0; t._item && depth < 1000; depth++) {
    const parent = t._item.parent as unknown;
    if (!(parent instanceof Y.AbstractType)) return null;
    t = parent;
  }
  try {
    return Y.findRootTypeKey(t);
  } catch {
    return null;
  }
}

/**
 * The first server-owned part of the document an update would change (add to, or delete from), or null if it only
 * touches what clients may edit. Each item is followed up to its top-level type, through the document's items and the
 * update's own.
 */
export function serverOwnedIn(doc: Y.Doc, update: Uint8Array): string | null {
  const { structs, ds } = Y.decodeUpdate(update);
  const items = structs.filter((s): s is Y.Item => s instanceof Y.Item);
  const roots = new Map<Y.Item, string | null>();

  // An id can point into the middle of an item (a run of text, or several array entries).
  const within = (id: ID) => items.find((i) => i.id.client === id.client && i.id.clock <= id.clock && id.clock < i.id.clock + i.length);
  const find = (id: ID): Y.Item | undefined => existing(doc, id) ?? within(id);
  const rootOf = (item: Y.Item, depth = 0): string | null => {
    if (depth > 1000) return null;
    const known = roots.get(item);
    if (known !== undefined) return known;
    let root: string | null = null;
    const parent = item.parent as unknown;
    if (parent instanceof Y.AbstractType) root = topLevel(parent);
    else if (typeof parent === 'string') root = parent;
    else {
      // Its parent is another item (a nested map or array), or it's placed next to one: follow that.
      const next = parent ? find(parent as ID) : item.origin ? find(item.origin) : item.rightOrigin ? find(item.rightOrigin) : undefined;
      if (next) root = rootOf(next, depth + 1);
    }
    roots.set(item, root);
    return root;
  };

  for (const s of items) {
    const root = rootOf(s);
    if (root && SERVER_OWNED.has(root)) return root;
  }
  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      for (let at = clock; at < clock + len; ) {
        const item = find({ client, clock: at });
        if (!item) break;
        const root = rootOf(item);
        if (root && SERVER_OWNED.has(root)) return root;
        at = item.id.clock + item.length;
      }
    }
  }
  return null;
}
