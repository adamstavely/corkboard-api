import * as Y from 'yjs';

type ID = { client: number; clock: number };

/** A client's update, decoded, with its structs indexed by id. */
export interface Decoded {
  structs: (Y.Item | Y.GC | Y.Skip)[];
  ds: ReturnType<typeof Y.decodeUpdate>['ds'];
  /** The update's own struct an id falls in (an id can point into the middle of one: a run of text, several entries). */
  within: (id: ID) => Y.Item | Y.GC | undefined;
}

const cache = new WeakMap<Uint8Array, Decoded>();

/**
 * An update decoded once, however many guards read it: they run one after another on the same bytes (CollabService's
 * beforeSync), and decoding and searching a large update is most of their work. Nothing here changes the structs.
 */
export function decoded(update: Uint8Array): Decoded {
  let d = cache.get(update);
  if (!d) {
    const { structs, ds } = Y.decodeUpdate(update);
    d = { structs, ds, within: indexed(structs) };
    cache.set(update, d);
  }
  return d;
}

/** Finds an update's struct by id with a binary search through its client's structs, in clock order. */
function indexed(structs: (Y.Item | Y.GC | Y.Skip)[]): (id: ID) => Y.Item | Y.GC | undefined {
  const byClient = new Map<number, (Y.Item | Y.GC)[]>();
  for (const s of structs) {
    if (!(s instanceof Y.Item || s instanceof Y.GC)) continue;
    const list = byClient.get(s.id.client);
    if (list) list.push(s);
    else byClient.set(s.id.client, [s]);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.id.clock - b.id.clock);
  return (id) => {
    const list = byClient.get(id.client);
    if (!list) return undefined;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (id.clock < s.id.clock) hi = mid - 1;
      else if (id.clock >= s.id.clock + s.length) lo = mid + 1;
      else return s;
    }
    return undefined;
  };
}
