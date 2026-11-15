import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { topZ } from '../assist/board-edit';

/** How big a new mini-app is on the board. */
export const APP_SIZE = { w: 560, h: 420 } as const;
/** The most code one version may have. */
export const MAX_APP_HTML = 200_000;

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');

/** Where something new goes so it covers nothing: right of everything on the board, level with its top (or the origin). */
export function besideBoard(doc: Y.Doc, gap = 160): { x: number; y: number } {
  let right = -Infinity;
  let top = Infinity;
  nodesOf(doc).forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') === 'connector') return;
    const x = Number(node.get('x') ?? 0);
    const y = Number(node.get('y') ?? 0);
    const w = Number(node.get('w') ?? 0);
    if (Number.isFinite(x + w)) right = Math.max(right, x + w);
    if (Number.isFinite(y)) top = Math.min(top, y);
  });
  return Number.isFinite(right) ? { x: right + gap, y: Number.isFinite(top) ? top : 0 } : { x: 0, y: 0 };
}

/**
 * Puts a mini-app on the board beside everything else: an `app` item naming the app, the version shown and the notes
 * it reads (none: the whole board's). Returns the item's id.
 */
export function placeApp(doc: Y.Doc, app: { appId: string; title: string; version: number; sources: string[] }, author = 'assistant'): string {
  const id = randomUUID();
  const at = besideBoard(doc);
  const z = topZ(doc) + 1;
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    nodesOf(doc).set(id, node);
    node.set('kind', 'app');
    node.set('x', at.x);
    node.set('y', at.y);
    node.set('w', APP_SIZE.w);
    node.set('h', APP_SIZE.h);
    node.set('z', z);
    node.set('appId', app.appId);
    node.set('title', app.title);
    node.set('version', app.version);
    node.set('sources', app.sources);
    node.set('author', author);
  });
  return id;
}

/** Shows a version of an app wherever it is on the board (and renames it, if given). Returns how many items changed. */
export function showAppVersion(doc: Y.Doc, appId: string, version: number, title?: string): number {
  let changed = 0;
  doc.transact(() => {
    nodesOf(doc).forEach((node) => {
      if (!(node instanceof Y.Map) || node.get('kind') !== 'app' || node.get('appId') !== appId) return;
      node.set('version', version);
      if (title) node.set('title', title);
      changed++;
    });
  });
  return changed;
}

/** The apps on the board: one entry per app (the first item showing it), for the model to know what's there. */
export function appsOn(doc: Y.Doc): { appId: string; title: string; version: number }[] {
  const seen = new Map<string, { appId: string; title: string; version: number }>();
  nodesOf(doc).forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'app') return;
    const appId = node.get('appId');
    if (typeof appId !== 'string' || seen.has(appId)) return;
    const title = node.get('title');
    seen.set(appId, { appId, title: typeof title === 'string' ? title : '', version: Number(node.get('version') ?? 1) });
  });
  return [...seen.values()];
}
