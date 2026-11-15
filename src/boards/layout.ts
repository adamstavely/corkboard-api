import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { NOTE_COLORS, NOTE_SIZE, newFrame, newNote, topZ, type NoteColor } from '../assist/board-edit';

/** The UI's choices for frames, shapes, text, arrows and views (corkboard-ui's board-doc.ts); a layout uses only these. */
export const FRAME_FILLS = ['clear', 'solid', ...NOTE_COLORS] as const;
export const FRAME_BORDERS = ['solid', 'dashed', 'none'] as const;
export const SHAPES = ['rect', 'ellipse', 'diamond', 'triangle'] as const;
export const TEXT_SIZES = { sm: 14, md: 20, lg: 32, xl: 48 } as const;
export const ARROW_ROUTES = ['straight', 'elbow', 'curve'] as const;
export const ARROW_DASHES = ['solid', 'dashed', 'dotted'] as const;
export const ARROW_WEIGHTS = [1, 2, 4, 6] as const;
export const BOARD_VIEWS = ['matrix', 'kanban', 'timeline'] as const;
export const VIEW_SIZE = { matrix: { w: 760, h: 620 }, kanban: { w: 1040, h: 620 }, timeline: { w: 1040, h: 520 } } as const;

export type FrameFill = (typeof FRAME_FILLS)[number];
export type FrameBorder = (typeof FRAME_BORDERS)[number];
export type ShapeKind = (typeof SHAPES)[number];
export type TextSize = keyof typeof TEXT_SIZES;
export type ArrowRoute = (typeof ARROW_ROUTES)[number];
export type ArrowDash = (typeof ARROW_DASHES)[number];
export type BoardView = (typeof BOARD_VIEWS)[number];

/**
 * A board's worth of things to lay out, in board pixels from the layout's top-left corner. Anything with a `key` can be
 * an arrow's end. Frames go under everything else, in the order given; the rest goes on top in the order of the lists.
 */
export interface Layout {
  frames?: { key?: string; title: string; x: number; y: number; w: number; h: number; fill?: FrameFill; border?: FrameBorder }[];
  /** Notes are a fixed size; a line of text a paragraph, and `**Bold:**` at a line's start is bold. */
  notes?: { key?: string; text: string; color?: NoteColor; x: number; y: number }[];
  texts?: { key?: string; text: string; size?: TextSize; x: number; y: number; w?: number }[];
  shapes?: { key?: string; shape: ShapeKind; color?: NoteColor; label?: string; x: number; y: number; w: number; h: number }[];
  /** `cells[row][col]`; a table's rows and columns are as many as its cells say, or `rows`/`cols` if more. */
  tables?: { key?: string; x: number; y: number; rows?: number; cols?: number; cells: string[][]; colWidth?: number }[];
  views?: { key?: string; view: BoardView; x: number; y: number }[];
  arrows?: { from: string; to: string; route?: ArrowRoute; dash?: ArrowDash; weight?: number }[];
}

const ROW_HEIGHT = 40;
const COL_WIDTH = 140;
const LIMITS = { things: 200, coord: 20_000, size: 10_000, text: 2_000, cells: 50 };

/** How big the layout is, from its top-left corner. */
export function layoutSize(layout: Layout): { w: number; h: number } {
  const boxes = boxesOf(layout).map(([, b]) => b);
  return { w: Math.max(0, ...boxes.map((b) => b.x + b.w)), h: Math.max(0, ...boxes.map((b) => b.y + b.h)) };
}

function tableSize(t: NonNullable<Layout['tables']>[number]): { rows: number; cols: number } {
  return { rows: Math.max(t.rows ?? 1, t.cells.length, 1), cols: Math.max(t.cols ?? 1, ...t.cells.map((r) => r.length), 1) };
}

/** Each thing's key (or none) and box. */
function boxesOf(layout: Layout): [string | undefined, { x: number; y: number; w: number; h: number }][] {
  return [
    ...(layout.frames ?? []).map((f) => [f.key, f] as const),
    ...(layout.notes ?? []).map((n) => [n.key, { x: n.x, y: n.y, ...NOTE_SIZE }] as const),
    ...(layout.texts ?? []).map((t) => [t.key, { x: t.x, y: t.y, w: t.w ?? 240, h: TEXT_SIZES[t.size ?? 'md'] * 1.6 }] as const),
    ...(layout.shapes ?? []).map((s) => [s.key, s] as const),
    ...(layout.tables ?? []).map((t) => {
      const { rows, cols } = tableSize(t);
      return [t.key, { x: t.x, y: t.y, w: cols * (t.colWidth ?? COL_WIDTH), h: rows * ROW_HEIGHT }] as const;
    }),
    ...(layout.views ?? []).map((v) => [v.key, { x: v.x, y: v.y, ...VIEW_SIZE[v.view] }] as const),
  ].map(([key, b]) => [key, { x: b.x, y: b.y, w: b.w, h: b.h }]);
}

/**
 * What's wrong with a layout (from a template, or from the model), or null if it can be placed: choices the board doesn't
 * have, sizes and positions out of range, text too long, an arrow to a key that isn't there, too many things.
 */
export function layoutProblem(layout: Layout): string | null {
  const boxes = boxesOf(layout);
  const things = boxes.length + (layout.arrows?.length ?? 0);
  if (things === 0) return 'the layout is empty';
  if (things > LIMITS.things) return `the layout has more than ${LIMITS.things} things`;
  for (const [, b] of boxes) {
    if (![b.x, b.y].every((v) => Number.isFinite(v) && v >= 0 && v <= LIMITS.coord)) return 'a position is off the layout';
    if (![b.w, b.h].every((v) => Number.isFinite(v) && v > 0 && v <= LIMITS.size)) return 'a size is out of range';
  }
  const keys = new Set<string>();
  for (const [key] of boxes) {
    if (key === undefined) continue;
    if (keys.has(key)) return `the key "${key}" is used twice`;
    keys.add(key);
  }
  const texts = [
    ...(layout.frames ?? []).map((f) => f.title),
    ...(layout.notes ?? []).map((n) => n.text),
    ...(layout.texts ?? []).map((t) => t.text),
    ...(layout.shapes ?? []).map((s) => s.label ?? ''),
    ...(layout.tables ?? []).flatMap((t) => t.cells.flat()),
  ];
  if (texts.some((t) => typeof t !== 'string' || t.length > LIMITS.text)) return 'some text is too long';
  const one = <T>(list: readonly T[], value: T | undefined) => value === undefined || list.includes(value);
  if (!(layout.frames ?? []).every((f) => one(FRAME_FILLS, f.fill) && one(FRAME_BORDERS, f.border))) return 'a frame style the board does not have';
  if (![...(layout.notes ?? []), ...(layout.shapes ?? [])].every((n) => one(NOTE_COLORS, n.color))) return 'a colour the board does not have';
  if (!(layout.texts ?? []).every((t) => one(Object.keys(TEXT_SIZES), t.size))) return 'a text size the board does not have';
  if (!(layout.shapes ?? []).every((s) => SHAPES.includes(s.shape))) return 'a shape the board does not have';
  if (!(layout.views ?? []).every((v) => BOARD_VIEWS.includes(v.view))) return 'a view the board does not have';
  for (const t of layout.tables ?? []) {
    const { rows, cols } = tableSize(t);
    if (rows > LIMITS.cells || cols > 20) return 'a table is too big';
  }
  for (const a of layout.arrows ?? []) {
    if (!keys.has(a.from) || !keys.has(a.to) || a.from === a.to) return 'an arrow joins things that are not in the layout';
    if (!one(ARROW_ROUTES, a.route) || !one(ARROW_DASHES, a.dash) || !one(ARROW_WEIGHTS, a.weight)) return 'an arrow style the board does not have';
  }
  return null;
}

function newItem(doc: Y.Doc, kind: string, box: { x: number; y: number; w: number; h: number }, z: number, author: string, set: (n: Y.Map<unknown>) => void): string {
  const id = randomUUID();
  const node = new Y.Map<unknown>();
  node.set('kind', kind);
  node.set('x', Math.round(box.x));
  node.set('y', Math.round(box.y));
  node.set('w', Math.round(box.w));
  node.set('h', Math.round(box.h));
  node.set('z', z);
  node.set('author', author);
  doc.getMap<Y.Map<unknown>>('nodes').set(id, node);
  set(node);
  return id;
}

/**
 * Places a layout (checked with layoutProblem first) with its top-left corner at `at`, above everything on the board, in
 * one change. Returns the new things' ids by key.
 */
export function applyLayout(doc: Y.Doc, layout: Layout, at: { x: number; y: number }, author = 'template'): Map<string, string> {
  const ids = new Map<string, string>();
  const keep = (key: string | undefined, id: string) => key !== undefined && ids.set(key, id);
  const pos = (p: { x: number; y: number }) => ({ x: Math.round(at.x + p.x), y: Math.round(at.y + p.y) });
  doc.transact(() => {
    let z = topZ(doc);
    for (const f of layout.frames ?? []) {
      const id = newFrame(doc, f.title, { ...pos(f), w: f.w, h: f.h }, ++z, author);
      const node = doc.getMap<Y.Map<unknown>>('nodes').get(id)!;
      if (f.fill) node.set('fill', f.fill);
      if (f.border) node.set('border', f.border);
      keep(f.key, id);
    }
    for (const n of layout.notes ?? []) keep(n.key, newNote(doc, { text: n.text, color: n.color ?? 'yellow' }, pos(n), ++z, author));
    for (const t of layout.texts ?? []) {
      const size = t.size ?? 'md';
      keep(t.key, newItem(doc, 'text', { ...pos(t), w: t.w ?? 240, h: TEXT_SIZES[size] * 1.6 }, ++z, author, (n) => {
        n.set('text', t.text);
        n.set('size', size);
      }));
    }
    for (const s of layout.shapes ?? []) {
      keep(s.key, newItem(doc, 'shape', { ...pos(s), w: s.w, h: s.h }, ++z, author, (n) => {
        n.set('shape', s.shape);
        n.set('color', s.color ?? 'blue');
        n.set('label', s.label ?? '');
      }));
    }
    for (const t of layout.tables ?? []) {
      const { rows, cols } = tableSize(t);
      keep(t.key, newItem(doc, 'table', { ...pos(t), w: cols * (t.colWidth ?? COL_WIDTH), h: rows * ROW_HEIGHT }, ++z, author, (n) => {
        n.set('rows', rows);
        n.set('cols', cols);
        const cells = new Y.Map<string>();
        n.set('cells', cells);
        t.cells.forEach((row, r) => row.forEach((text, c) => text && cells.set(`${r}:${c}`, text)));
      }));
    }
    for (const v of layout.views ?? []) keep(v.key, newItem(doc, 'view', { ...pos(v), ...VIEW_SIZE[v.view] }, ++z, author, (n) => n.set('view', v.view)));
    for (const a of layout.arrows ?? []) {
      const node = new Y.Map<unknown>();
      node.set('kind', 'connector');
      node.set('from', ids.get(a.from)!);
      node.set('to', ids.get(a.to)!);
      node.set('route', a.route ?? 'straight');
      node.set('dash', a.dash ?? 'solid');
      node.set('weight', a.weight ?? 2);
      doc.getMap<Y.Map<unknown>>('nodes').set(randomUUID(), node);
    }
  });
  return ids;
}

/**
 * Places a layout to the right of everything on the board (or at the top left of an empty one), so it covers nothing.
 * Returns the new things' ids by key, and how many frames and notes it made.
 */
export function placeBeside(doc: Y.Doc, layout: Layout, author = 'assistant'): { ids: Map<string, string>; frames: number; notes: number } {
  let right = -Infinity;
  let top = Infinity;
  doc.getMap<Y.Map<unknown>>('nodes').forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') === 'connector') return;
    const x = Number(node.get('x') ?? 0);
    const y = Number(node.get('y') ?? 0);
    const w = Number(node.get('w') ?? 0);
    if (Number.isFinite(x + w)) right = Math.max(right, x + w);
    if (Number.isFinite(y)) top = Math.min(top, y);
  });
  const at = Number.isFinite(right) ? { x: right + 160, y: Number.isFinite(top) ? top : 0 } : { x: 0, y: 0 };
  const ids = applyLayout(doc, layout, at, author);
  return { ids, frames: layout.frames?.length ?? 0, notes: layout.notes?.length ?? 0 };
}
