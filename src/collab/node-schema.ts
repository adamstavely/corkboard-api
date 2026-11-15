import * as Y from 'yjs';
import { existing, type ID } from './server-owned';

/** Limits on a node's fields, matching what the board shows (corkboard-ui's board-doc.ts). */
export const MAX_COORD = 1_000_000;
export const MAX_SIZE = 100_000;
export const MAX_TABLE = 100;
const MAX_TEXT = 20_000;
const MAX_POINTS = 40_000;
const MAX_VALUE_JSON = 20_000;

/** What's wrong with a field's value, or null if it's fine. Unknown fields need only be small, plain values. */
function fieldProblem(key: string, content: Y.Item['content']): string | null {
  const isType = content instanceof Y.ContentType;
  const [value] = isType ? [] : (content.getContent() as unknown[]);
  const finite = typeof value === 'number' && Number.isFinite(value);
  switch (key) {
    case 'x':
    case 'y':
      return finite && Math.abs(value) <= MAX_COORD ? null : 'a position off the board';
    case 'z':
      return finite ? null : 'a layer that is not a number';
    case 'w':
    case 'h':
    case 'vw':
    case 'vh':
      return finite && value > 0 && value <= MAX_SIZE ? null : 'a size out of range';
    case 'rows':
    case 'cols':
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TABLE ? null : 'a table size out of range';
    case 'text':
      if (isType) return content.type instanceof Y.XmlFragment || content.type instanceof Y.XmlText ? null : 'text of the wrong kind';
      return typeof value === 'string' && value.length <= MAX_TEXT ? null : 'text that is too long or not text';
    case 'cells':
      return isType && content.type instanceof Y.Map ? null : 'table cells that are not a map';
    case 'points':
      return Array.isArray(value) && value.length <= MAX_POINTS && value.every((p) => typeof p === 'number' && Number.isFinite(p)) ? null : 'a drawing that is not points';
  }
  if (isType) return null;
  try {
    return JSON.stringify(value ?? null).length <= MAX_VALUE_JSON ? null : 'a value that is too large';
  } catch {
    return 'a value that is not plain data';
  }
}

/** Where an update's items sit: their parent (the nodes map, or the item of the type they're in) and their key. */
export interface Places {
  placeOf: (item: Y.Item) => Place;
  /** Whether an item is a node itself: an entry of the nodes map. */
  isNode: (item: Y.Item) => boolean;
  /** An item by id, in the document or in the update. */
  find: (id: ID) => Y.Item | Y.GC | undefined;
}
export type Place = { parent: 'nodes' | Y.Item | null; key: string | null };

/** Works out where an update's items sit, through the document's items and the update's own. */
export function placesIn(doc: Y.Doc, structs: (Y.Item | Y.GC | Y.Skip)[]): Places {
  const known = structs.filter((s): s is Y.Item | Y.GC => s instanceof Y.Item || s instanceof Y.GC);
  const within = (id: ID) => known.find((i) => i.id.client === id.client && i.id.clock <= id.clock && id.clock < i.id.clock + i.length);
  const find = (id: ID) => existing(doc, id) ?? within(id);
  const nodes = doc.getMap('nodes');

  const places = new Map<Y.Item, Place>();
  /** Where an item sits: its parent (the nodes map, or the item of the type it's in) and its key. A map entry set again
   * names neither; they're its left neighbour's. */
  const placeOf = (item: Y.Item, depth = 0): Place => {
    const seen = places.get(item);
    if (seen) return seen;
    let place: Place = { parent: null, key: null };
    const parent = item.parent as unknown;
    if (parent === 'nodes' || parent === nodes) place = { parent: 'nodes', key: item.parentSub };
    else if (parent instanceof Y.AbstractType) place = { parent: parent._item ?? null, key: item.parentSub };
    else if (parent && typeof parent === 'object') {
      const p = find(parent as ID);
      place = { parent: p instanceof Y.Item ? p : null, key: item.parentSub };
    } else if (typeof parent !== 'string' && depth < 1000) {
      const left = item.origin ? find(item.origin) : item.rightOrigin ? find(item.rightOrigin) : undefined;
      if (left instanceof Y.Item) place = placeOf(left, depth + 1);
    }
    places.set(item, place);
    return place;
  };
  const isNode = (item: Y.Item) => {
    const { parent, key } = placeOf(item);
    return parent === 'nodes' && key !== null;
  };
  return { placeOf, isNode, find };
}

/**
 * Why an update would put something malformed under `nodes` (anything but a map as a node, or a field the board can't
 * show: a NaN position, a negative or vast size, a million-row table…), or null if it wouldn't. The guard runs before
 * the update is applied, so a bad node is never saved or sent on to anyone.
 */
export function nodeProblem(doc: Y.Doc, update: Uint8Array): string | null {
  const { structs } = Y.decodeUpdate(update);
  const { placeOf, isNode } = placesIn(doc, structs);

  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue;
    // A value set and then set again in the same change arrives already deleted, with nothing in it: there's
    // nothing to check, and the value that replaced it is checked on its own.
    if (s.content instanceof Y.ContentDeleted) continue;
    const { parent, key } = placeOf(s);
    if (parent === 'nodes' && key !== null) {
      if (!(s.content instanceof Y.ContentType && s.content.type instanceof Y.Map)) return `node ${key} is not a node`;
    } else if (parent instanceof Y.Item && key !== null && isNode(parent)) {
      const problem = fieldProblem(key, s.content);
      if (problem) return `${placeOf(parent).key}.${key}: ${problem}`;
    }
  }
  return null;
}
