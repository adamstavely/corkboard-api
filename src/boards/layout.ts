import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { NOTE_COLORS, NOTE_SIZE, newFrame, newNote, topZ, type NoteColor } from '../assist/board-edit';
import { richNodes, richProblem, type RichNode } from './rich-text';

/** The UI's choices for frames, shapes, text, arrows and views (corkboard-ui's board-doc.ts); a layout uses only these. */
export const FRAME_FILLS = ['clear', 'solid', ...NOTE_COLORS] as const;
export const FRAME_BORDERS = ['solid', 'dashed', 'none'] as const;
/** A frame's shape: outlined (as frames always were), a card, a header band, a folder tab, a soft zone, a drop zone, a lane, a 16:9 slide or a browser window. */
export const FRAME_LOOKS = ['outline', 'card', 'band', 'tab', 'zone', 'drop', 'lane', 'slide', 'browser'] as const;
export const SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'hexagon', 'star', 'arrow', 'cylinder', 'cloud', 'callout', 'pill', 'parallelogram', 'document', 'delay', 'subprocess', 'actor', 'person', 'queue'] as const;
/** A shape's fill: solid (as shapes always were), or a see-through tint that lies under notes, so overlapping shapes (a Venn diagram) show where they meet. */
export const SHAPE_FILLS = ['solid', 'tint'] as const;
export const TEXT_SIZES = { sm: 14, md: 20, lg: 32, xl: 48 } as const;
export const ARROW_ROUTES = ['straight', 'elbow', 'curve'] as const;
export const ARROW_DASHES = ['solid', 'dashed', 'dotted'] as const;
export const ARROW_WEIGHTS = [1, 2, 4, 6] as const;
/** An arrow's ends: nothing, an arrowhead, an open triangle ("is a"), or crow's-foot marks for data diagrams. */
export const ARROW_HEADS = ['none', 'arrow', 'triangle', 'one', 'zeroOne', 'oneMany', 'zeroMany'] as const;
/** The longest label an arrow takes. */
export const MAX_ARROW_LABEL = 200;
export const BOARD_VIEWS = ['matrix', 'kanban', 'timeline'] as const;
export const VIEW_SIZE = { matrix: { w: 760, h: 620 }, kanban: { w: 1040, h: 620 }, timeline: { w: 1040, h: 520 } } as const;

export type FrameFill = (typeof FRAME_FILLS)[number];
export type FrameBorder = (typeof FRAME_BORDERS)[number];
export type FrameLook = (typeof FRAME_LOOKS)[number];
export type ShapeKind = (typeof SHAPES)[number];
export type ShapeFill = (typeof SHAPE_FILLS)[number];
export type TextSize = keyof typeof TEXT_SIZES;
export type ArrowRoute = (typeof ARROW_ROUTES)[number];
export type ArrowDash = (typeof ARROW_DASHES)[number];
export type ArrowHead = (typeof ARROW_HEADS)[number];
export type BoardView = (typeof BOARD_VIEWS)[number];

/** The roles a thing plays in an editable diagram (corkboard-ui's board-doc.ts Part): the diagram's own frame, a lane, a step, a remark. */
export const PART_ROLES = ['diagram', 'lane', 'group', 'step', 'note', 'legend'] as const;
export type PartRole = (typeof PART_ROLES)[number];
/**
 * A thing's place in an editable diagram: the diagram (its outer frame's id), its role, its id in the diagram's text, and
 * on the diagram its kind and direction, on a step its kind of step.
 */
export interface Part {
  of: string;
  role: PartRole;
  key: string;
  type?: string;
  dir?: 'LR' | 'TB';
  /** On the diagram: false when Auto-Tidy is off. */
  auto?: boolean;
  /** On a step: the key of its lane. */
  lane?: string;
  /** On a sub-process step: its flowchart's id. On a sub-process flowchart: the flowchart it belongs to. */
  sub?: string;
  parent?: string;
  /** What else the diagram's text says about it, by kind of diagram. */
  extra?: Record<string, string | string[] | boolean>;
}
/** A column of a database table in an ER diagram. */
export interface EntityColumn {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
  unique?: boolean;
  nullable?: boolean;
  note?: string;
}
/** A table's columns made safe to keep: at most 100, each with a name, short type and note. */
export function entityColumns(value: unknown): EntityColumn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((c) => {
    if (!c || typeof c !== 'object' || typeof (c as EntityColumn).name !== 'string') return [];
    const col = c as EntityColumn;
    return [
      {
        name: col.name.slice(0, 80),
        type: typeof col.type === 'string' ? col.type.slice(0, 60) : '',
        ...(col.pk === true ? { pk: true } : {}),
        ...(col.fk === true ? { fk: true } : {}),
        ...(col.unique === true ? { unique: true } : {}),
        ...(col.nullable === true ? { nullable: true } : {}),
        ...(typeof col.note === 'string' && col.note ? { note: col.note.slice(0, 120) } : {}),
      },
    ];
  });
}

/** A thing's part in a layout's one diagram: the frame with role 'diagram' gets the diagram's id when it's placed. */
export type LayoutPart = Omit<Part, 'of'>;

/** A part as stored, or null if it's malformed. */
export function partOf(value: unknown): Part | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p['of'] !== 'string' || !p['of'] || typeof p['key'] !== 'string' || p['key'].length > 200 || !(PART_ROLES as readonly unknown[]).includes(p['role'])) return null;
  return {
    of: p['of'],
    role: p['role'] as PartRole,
    key: p['key'],
    ...(typeof p['type'] === 'string' && p['type'].length <= 40 ? { type: p['type'] } : {}),
    ...(p['dir'] === 'LR' || p['dir'] === 'TB' ? { dir: p['dir'] } : {}),
    ...(p['auto'] === false ? { auto: false } : {}),
    ...(typeof p['lane'] === 'string' && p['lane'].length <= 200 ? { lane: p['lane'] } : {}),
    ...(typeof p['sub'] === 'string' && p['sub'].length <= 64 ? { sub: p['sub'] } : {}),
    ...(typeof p['parent'] === 'string' && p['parent'].length <= 64 ? { parent: p['parent'] } : {}),
    ...(extraOf(p['extra']) ? { extra: extraOf(p['extra'])! } : {}),
  };
}

/** A part's extra facts (a use case's requirement ids, say): a small object of strings, lists of strings and yes/no values. */
function extraOf(value: unknown): Record<string, string | string[] | boolean> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([k, v]) => k.length <= 40 && (typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200) || (Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 200))),
  );
  return entries.length && entries.length <= 20 ? (Object.fromEntries(entries) as Record<string, string | string[] | boolean>) : null;
}

/**
 * A board's worth of things to lay out, in board pixels from the layout's top-left corner. Anything with a `key` can be
 * an arrow's end. Frames go under everything else, in the order given; the rest goes on top in the order of the lists.
 */
export interface Layout {
  frames?: { key?: string; title: string; x: number; y: number; w: number; h: number; fill?: FrameFill; border?: FrameBorder; look?: FrameLook; part?: LayoutPart }[];
  /**
   * A line of text is a paragraph, and `**Bold:**` at a line's start is bold. A saved board's notes also keep their rich
   * text (lists, code, maths, marks), used instead of `text` when given, and their size, else the usual size.
   */
  notes?: { key?: string; text: string; rich?: RichNode[]; color?: NoteColor; x: number; y: number; w?: number; h?: number; part?: LayoutPart }[];
  texts?: { key?: string; text: string; size?: TextSize; x: number; y: number; w?: number; part?: LayoutPart }[];
  /** Tinted shapes go under the notes (above the frames); solid ones on top with the rest. */
  shapes?: { key?: string; shape: ShapeKind; color?: NoteColor; fill?: ShapeFill; label?: string; x: number; y: number; w: number; h: number; part?: LayoutPart }[];
  /** `cells[row][col]`; a table's rows and columns are as many as its cells say, or `rows`/`cols` if more. */
  tables?: { key?: string; x: number; y: number; rows?: number; cols?: number; cells: string[][]; colWidth?: number }[];
  views?: { key?: string; view: BoardView; x: number; y: number }[];
  /** Database tables, for ER diagrams (corkboard-ui's entity items). */
  entities?: { key?: string; name: string; columns: EntityColumn[]; color?: NoteColor; x: number; y: number; w: number; h: number; part?: LayoutPart }[];
  arrows?: { from: string; to: string; route?: ArrowRoute; dash?: ArrowDash; weight?: number; start?: ArrowHead; end?: ArrowHead; label?: string }[];
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
    ...(layout.notes ?? []).map((n) => [n.key, { x: n.x, y: n.y, w: n.w ?? NOTE_SIZE.w, h: n.h ?? NOTE_SIZE.h }] as const),
    ...(layout.texts ?? []).map((t) => [t.key, { x: t.x, y: t.y, w: t.w ?? 240, h: TEXT_SIZES[t.size ?? 'md'] * 1.6 }] as const),
    ...(layout.shapes ?? []).map((s) => [s.key, s] as const),
    ...(layout.tables ?? []).map((t) => {
      const { rows, cols } = tableSize(t);
      return [t.key, { x: t.x, y: t.y, w: cols * (t.colWidth ?? COL_WIDTH), h: rows * ROW_HEIGHT }] as const;
    }),
    ...(layout.views ?? []).map((v) => [v.key, { x: v.x, y: v.y, ...VIEW_SIZE[v.view] }] as const),
    ...(layout.entities ?? []).map((e) => [e.key, e] as const),
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
  for (const n of layout.notes ?? []) {
    const problem = n.rich === undefined ? null : richProblem(n.rich);
    if (problem) return `a note with ${problem}`;
  }
  const one = <T>(list: readonly T[], value: T | undefined) => value === undefined || list.includes(value);
  if (!(layout.frames ?? []).every((f) => one(FRAME_FILLS, f.fill) && one(FRAME_BORDERS, f.border) && one(FRAME_LOOKS, f.look))) return 'a frame style the board does not have';
  if (![...(layout.notes ?? []), ...(layout.shapes ?? [])].every((n) => one(NOTE_COLORS, n.color))) return 'a colour the board does not have';
  if (!(layout.texts ?? []).every((t) => one(Object.keys(TEXT_SIZES), t.size))) return 'a text size the board does not have';
  if (!(layout.shapes ?? []).every((s) => SHAPES.includes(s.shape) && one(SHAPE_FILLS, s.fill))) return 'a shape the board does not have';
  if (!(layout.views ?? []).every((v) => BOARD_VIEWS.includes(v.view))) return 'a view the board does not have';
  if (!(layout.entities ?? []).every((e) => typeof e.name === 'string' && Array.isArray(e.columns) && e.columns.length <= 100 && one(NOTE_COLORS, e.color))) return 'a table the board cannot show';
  for (const t of layout.tables ?? []) {
    const { rows, cols } = tableSize(t);
    if (rows > LIMITS.cells || cols > 20) return 'a table is too big';
  }
  for (const a of layout.arrows ?? []) {
    if (!keys.has(a.from) || !keys.has(a.to) || a.from === a.to) return 'an arrow joins things that are not in the layout';
    if (!one(ARROW_ROUTES, a.route) || !one(ARROW_DASHES, a.dash) || !one(ARROW_WEIGHTS, a.weight) || !one(ARROW_HEADS, a.start) || !one(ARROW_HEADS, a.end))
      return 'an arrow style the board does not have';
    if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length > MAX_ARROW_LABEL)) return 'an arrow label that is too long';
  }
  // Parts: one diagram at most, and parts only with one.
  const parts = [...(layout.frames ?? []), ...(layout.notes ?? []), ...(layout.shapes ?? []), ...(layout.texts ?? []), ...(layout.entities ?? [])].flatMap((t) => (t.part ? [t.part] : []));
  if (parts.some((p) => !partOf({ ...p, of: 'diagram' }))) return 'a diagram part the board does not have';
  const diagrams = (layout.frames ?? []).filter((f) => f.part?.role === 'diagram').length;
  if (diagrams > 1 || (parts.length && !diagrams)) return 'a layout holds at most one diagram, and its parts need it';
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
    // A diagram's parts name its frame, once everything is placed.
    const parts: { id: string; part: LayoutPart }[] = [];
    const tag = (id: string, part: LayoutPart | undefined) => part && parts.push({ id, part });
    for (const f of layout.frames ?? []) {
      // A slide is always 16:9.
      const id = newFrame(doc, f.title, { ...pos(f), w: f.w, h: f.look === 'slide' ? (f.w * 9) / 16 : f.h }, ++z, author);
      const node = doc.getMap<Y.Map<unknown>>('nodes').get(id)!;
      if (f.fill) node.set('fill', f.fill);
      if (f.border) node.set('border', f.border);
      if (f.look) node.set('look', f.look);
      keep(f.key, id);
      tag(id, f.part);
    }
    const shape = (s: NonNullable<Layout['shapes']>[number]) => {
      const id = newItem(doc, 'shape', { ...pos(s), w: s.w, h: s.h }, ++z, author, (n) => {
        n.set('shape', s.shape);
        n.set('color', s.color ?? 'blue');
        n.set('label', s.label ?? '');
        if (s.fill === 'tint') n.set('fill', 'tint');
      });
      keep(s.key, id);
      tag(id, s.part);
    };
    for (const s of layout.shapes ?? []) if (s.fill === 'tint') shape(s);
    for (const n of layout.notes ?? []) {
      const id = newNote(doc, { text: n.rich ? '' : n.text, color: n.color ?? 'yellow' }, pos(n), ++z, author);
      const node = doc.getMap<Y.Map<unknown>>('nodes').get(id)!;
      if (n.w) node.set('w', n.w);
      if (n.h) node.set('h', n.h);
      if (n.rich) {
        const fragment = node.get('text') as Y.XmlFragment;
        fragment.delete(0, fragment.length);
        fragment.insert(0, richNodes(n.rich));
      }
      keep(n.key, id);
      tag(id, n.part);
    }
    for (const t of layout.texts ?? []) {
      const size = t.size ?? 'md';
      const id = newItem(doc, 'text', { ...pos(t), w: t.w ?? 240, h: TEXT_SIZES[size] * 1.6 }, ++z, author, (n) => {
        n.set('text', t.text);
        n.set('size', size);
      });
      keep(t.key, id);
      tag(id, t.part);
    }
    for (const s of layout.shapes ?? []) if (s.fill !== 'tint') shape(s);
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
    for (const e of layout.entities ?? []) {
      const id = newItem(doc, 'entity', { ...pos(e), w: e.w, h: e.h }, ++z, author, (n) => {
        n.set('name', e.name.slice(0, 80));
        n.set('columns', entityColumns(e.columns));
        n.set('color', e.color ?? 'blue');
      });
      keep(e.key, id);
      tag(id, e.part);
    }
    for (const a of layout.arrows ?? []) {
      const node = new Y.Map<unknown>();
      node.set('kind', 'connector');
      node.set('from', ids.get(a.from)!);
      node.set('to', ids.get(a.to)!);
      node.set('route', a.route ?? 'straight');
      node.set('dash', a.dash ?? 'solid');
      node.set('weight', a.weight ?? 2);
      node.set('start', a.start ?? 'none');
      node.set('end', a.end ?? 'arrow');
      if (a.label?.trim()) node.set('label', a.label.trim());
      doc.getMap<Y.Map<unknown>>('nodes').set(randomUUID(), node);
    }
    const diagram = parts.find((p) => p.part.role === 'diagram')?.id;
    if (diagram) for (const { id, part } of parts) doc.getMap<Y.Map<unknown>>('nodes').get(id)?.set('part', { ...part, of: diagram });
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
