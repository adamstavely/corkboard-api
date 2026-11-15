import * as Y from 'yjs';
import { atLeast, type Role } from '../access/roles';
import { placesIn } from './node-schema';
import { alreadyHas, existing } from './server-owned';

/**
 * Who may lock, unlock and change locked things: the board's owners, and whoever holds the facilitator's seat. Everyone
 * else can still add notes and move their own around a locked layout; that's what locking it is for.
 */
export function canChangeLocked(doc: Y.Doc, role: Role, userId: string): boolean {
  return atLeast(role, 'owner') || doc.getMap('facilitator').get('userId') === userId;
}

/**
 * Why an update would change something locked (its fields, its text, or delete it) or lock or unlock anything, or null
 * if it wouldn't. Checked only for people who may not (see canChangeLocked).
 */
export function lockProblem(doc: Y.Doc, update: Uint8Array): string | null {
  const { structs, ds } = Y.decodeUpdate(update);
  const { placeOf, isNode, find } = placesIn(doc, structs);
  const lockedNode = (node: Y.Item) => node.content instanceof Y.ContentType && node.content.type instanceof Y.Map && node.content.type.get('locked') === true;

  /** The node an item is in (or is), and the field of the node it's under, if any. */
  const nodeOf = (item: Y.Item): { node: Y.Item; field: string | null } | null => {
    let at = item;
    let field: string | null = null;
    for (let depth = 0; depth < 1000; depth++) {
      if (isNode(at)) return { node: at, field };
      const { parent, key } = placeOf(at);
      if (!(parent instanceof Y.Item)) return null;
      field = key;
      at = parent;
    }
    return null;
  };

  const check = (item: Y.Item): string | null => {
    const inNode = nodeOf(item);
    if (!inNode) return null;
    const id = placeOf(inNode.node).key;
    // Locking and unlocking are for the owners and the facilitator. A field set directly on a node is the node's own.
    if (inNode.field === 'locked' && placeOf(item).parent === inNode.node) return `${id}: locking or unlocking`;
    if (lockedNode(inNode.node)) return `${id}: it is locked`;
    return null;
  };

  for (const s of structs) {
    // What the server already has changes nothing (a browser's saved copy sends it all again).
    if (!(s instanceof Y.Item) || s.content instanceof Y.ContentDeleted || alreadyHas(doc, s)) continue;
    // A node set again under its id replaces the node there: that's changing it, if that one's locked.
    if (isNode(s)) {
      const key = placeOf(s).key!;
      const there = doc.getMap('nodes').get(key);
      if (there instanceof Y.Map && there.get('locked') === true) return `${key}: it is locked`;
    }
    const problem = check(s);
    if (problem) return problem;
  }
  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      for (let at = clock; at < clock + len; ) {
        const item = find({ client, clock: at });
        // serverOwnedIn refuses deletes of what isn't here; nothing to check in what's already gone.
        // Nothing to check in what's already gone, or already deleted here.
        if (!(item instanceof Y.Item) || (item.deleted && existing(doc, item.id) === item)) {
          at = item ? item.id.clock + item.length : at + 1;
          continue;
        }
        const problem = check(item);
        if (problem) return problem;
        at = item.id.clock + item.length;
      }
    }
  }
  return null;
}
