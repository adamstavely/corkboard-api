import * as Y from 'yjs';

/**
 * The parts of a board's document only the API writes, through its own direct connections: chat, votes, the timer,
 * the agenda, reactions, the summary, hidden writing rounds and the model's change history. People's clients read them but may not change them, so who
 * wrote a message or cast a vote is whatever the API checked, not what a client claims.
 */
export const SERVER_OWNED: ReadonlySet<string> = new Set(['chat', 'ledger', 'reactions', 'summary', 'timer', 'votes', 'voting', 'writing', 'breakouts', 'facilitator', 'spotlight', 'agenda']);

export type ID = { client: number; clock: number };

/**
 * The struct with this id in the document, if it has it: an item, or a GC (what's left of something deleted inside
 * something deleted). Undefined only for what hasn't arrived.
 */
export function existing(doc: Y.Doc, id: ID): Y.Item | Y.GC | undefined {
  if (id.clock >= Y.getState(doc.store, id.client)) return undefined;
  const struct = Y.getItem(doc.store, id) as Y.Item | Y.GC | undefined;
  return struct instanceof Y.Item || struct instanceof Y.GC ? struct : undefined;
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

/** What serverOwnedIn reports for an update that depends on something the server doesn't have. */
export const UNRESOLVED = '(unresolved)';

/**
 * The first server-owned part of the document an update would change (add to, or delete from), or null if it only
 * touches what clients may edit. Each item is followed up to its top-level type, through the document's items and the
 * update's own.
 *
 * An update that depends on something the server doesn't have yet (an item after a gap in its client's clock, a
 * parent or neighbour that isn't here, a delete of an unknown item) is refused as UNRESOLVED. Yjs would hold such an
 * update back and apply it later, once something arrives that it needs, without this check seeing it again, so a
 * forged chat message could wait for the API's next real one. The server relays everything clients see, so a
 * well-behaved client only ever builds on what the server already has.
 */
export function serverOwnedIn(doc: Y.Doc, update: Uint8Array): string | null {
  const { structs, ds } = Y.decodeUpdate(update);
  const items = structs.filter((s): s is Y.Item => s instanceof Y.Item);
  const known = structs.filter((s): s is Y.Item | Y.GC => s instanceof Y.Item || s instanceof Y.GC);
  const roots = new Map<Y.Item, string | null>();

  // Nothing may start after a gap: everything before it, from that client, must be here or in this update.
  const firstClock = new Map<number, number>();
  for (const s of structs) firstClock.set(s.id.client, Math.min(firstClock.get(s.id.client) ?? Infinity, s.id.clock));
  for (const [client, clock] of firstClock) if (clock > Y.getState(doc.store, client)) return UNRESOLVED;

  // An id can point into the middle of an item (a run of text, or several array entries).
  const within = (id: ID) => known.find((i) => i.id.client === id.client && i.id.clock <= id.clock && id.clock < i.id.clock + i.length);
  const find = (id: ID): Y.Item | Y.GC | undefined => existing(doc, id) ?? within(id);
  const rootOf = (item: Y.Item, depth = 0): string | null => {
    if (depth > 1000) return UNRESOLVED;
    const known = roots.get(item);
    if (known !== undefined) return known;
    // Every item it's placed by must be known, whatever else decides its root.
    for (const ref of [item.origin, item.rightOrigin]) if (ref && !find(ref)) return remember(item, UNRESOLVED);
    let root: string | null = null;
    const parent = item.parent as unknown;
    if (parent instanceof Y.AbstractType) root = topLevel(parent);
    else if (typeof parent === 'string') root = parent;
    else {
      // Its parent is another item (a nested map or array), or it's placed next to one: follow that. Something deleted
      // inside something deleted (a GC) has no root left; anything built on it lands deleted too.
      const next = parent ? find(parent as ID) : item.origin ? find(item.origin) : item.rightOrigin ? find(item.rightOrigin) : undefined;
      root = next === undefined ? UNRESOLVED : next instanceof Y.Item ? rootOf(next, depth + 1) : null;
    }
    return remember(item, root);
  };
  const remember = (item: Y.Item, root: string | null) => {
    roots.set(item, root);
    return root;
  };

  for (const s of items) {
    const root = rootOf(s);
    if (root && (root === UNRESOLVED || SERVER_OWNED.has(root))) return root;
  }
  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      for (let at = clock; at < clock + len; ) {
        const item = find({ client, clock: at });
        // Deleting something not here would wait for it to arrive, then delete it unchecked.
        if (!item) return UNRESOLVED;
        if (item instanceof Y.GC) {
          at = item.id.clock + item.length;
          continue;
        }
        const root = rootOf(item);
        if (root && (root === UNRESOLVED || SERVER_OWNED.has(root))) return root;
        at = item.id.clock + item.length;
      }
    }
  }
  return null;
}
