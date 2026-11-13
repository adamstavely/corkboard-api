import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fragmentText } from '../boards/board-text';
import { voteCounts } from '../facilitation/facilitation-doc';

/** The UI's note colours and size (corkboard-ui's board-doc.ts); notes made here must look like notes made there. */
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const NOTE_SIZE = { w: 200, h: 160 } as const;
const GAP = 24;
const COLUMNS = 4;

/** Space inside a frame: around its notes, and the band at the top for its title (corkboard-ui's canvas). */
export const FRAME_PADDING = 32;
export const FRAME_TITLE = 48;
const FRAME_GAP = 64;
const FRAME_COLUMNS = 3;
const FRAMES_PER_ROW = 4;

/** A note as the model sees it, with the title of the frame it sits in, if any. */
export interface NoteView {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  frame?: string;
  /** Dot votes it has, when any. */
  votes?: number;
}

/** A frame: a titled area that holds the notes whose centres are inside it. */
export interface FrameView {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');

const rectOf = (node: Y.Map<unknown>): Rect => ({
  x: Number(node.get('x') ?? 0),
  y: Number(node.get('y') ?? 0),
  w: Number(node.get('w') ?? NOTE_SIZE.w),
  h: Number(node.get('h') ?? NOTE_SIZE.h),
});

/** Whether a note belongs to a frame: its centre is inside. The UI decides the same way. */
export const inFrame = (note: Rect, frame: Rect) =>
  note.x + note.w / 2 >= frame.x && note.x + note.w / 2 <= frame.x + frame.w && note.y + note.h / 2 >= frame.y && note.y + note.h / 2 <= frame.y + frame.h;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function framesOf(doc: Y.Doc): FrameView[] {
  const frames: FrameView[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'frame') return;
    const title = node.get('title');
    frames.push({ id, title: typeof title === 'string' ? title : '', ...rectOf(node) });
  });
  return frames;
}

export function notesOf(doc: Y.Doc): NoteView[] {
  const frames = framesOf(doc);
  const votes = voteCounts(doc);
  const notes: NoteView[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'note') return;
    const fragment = node.get('text');
    const color = node.get('color');
    const rect = rectOf(node);
    // The smallest frame it's in, should frames overlap.
    const frame = frames.filter((f) => inFrame(rect, f)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    notes.push({
      id,
      text: fragment instanceof Y.XmlFragment ? fragmentText(fragment) : '',
      color: typeof color === 'string' ? color : 'yellow',
      x: rect.x,
      y: rect.y,
      ...(frame ? { frame: frame.title } : {}),
      ...(votes.get(id) ? { votes: votes.get(id) } : {}),
    });
  });
  return notes;
}

const topZ = (doc: Y.Doc) => {
  let z = 0;
  nodesOf(doc).forEach((node) => (z = Math.max(z, Number(node.get('z') ?? 0))));
  return z;
};

/** A paragraph for each line; `**Name:**` at the start of a line becomes bold, as Tiptap would store it. */
function paragraphs(text: string): Y.XmlElement[] {
  return text.split(/\r?\n/).map((line) => {
    const p = new Y.XmlElement('paragraph');
    if (!line) return p;
    const run = new Y.XmlText();
    const bold = /^\*\*(.+?)\*\*(.*)$/.exec(line);
    if (bold) {
      run.insert(0, bold[1], { bold: {} });
      if (bold[2]) run.insert(bold[1].length, bold[2]);
    } else run.insert(0, line);
    p.insert(0, [run]);
    return p;
  });
}

/** Frames that would be left empty once these notes move out: the arrangement being replaced. */
function emptiedBy(doc: Y.Doc, taken: Set<string>): Set<string> {
  const notes: (Rect & { id: string })[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (node instanceof Y.Map && node.get('kind') === 'note') notes.push({ id, ...rectOf(node) });
  });
  return new Set(
    framesOf(doc)
      .filter((f) => {
        const inside = notes.filter((n) => inFrame(n, f));
        return inside.length > 0 && inside.every((n) => taken.has(n.id));
      })
      .map((f) => f.id),
  );
}

/**
 * Where something `size` big goes: where the notes it takes (and the frames they leave) were, unless that would cover
 * anything staying put; then to the right of it all. With nothing taken, to the right of the board.
 */
function originFor(doc: Y.Doc, taken: Set<string>, emptied: Set<string>, size: { w: number; h: number }) {
  const nodes = nodesOf(doc);
  const others: Rect[] = [];
  nodes.forEach((node, id) => {
    if (node instanceof Y.Map && !taken.has(id) && !emptied.has(id)) others.push(rectOf(node));
  });
  const moving = [...[...taken].map((id) => rectOf(nodes.get(id)!)), ...framesOf(doc).filter((f) => emptied.has(f.id))];
  const right = () => Math.max(0, ...others.map((r) => r.x + r.w + FRAME_GAP), ...moving.map((r) => r.x + r.w + FRAME_GAP));
  if (moving.length === 0) return { x: others.length ? right() : 0, y: others.length ? Math.min(...others.map((r) => r.y)) : 0 };
  const origin = { x: Math.min(...moving.map((r) => r.x)), y: Math.min(...moving.map((r) => r.y)) };
  return others.some((r) => overlaps(r, { ...origin, ...size })) ? { x: right(), y: origin.y } : origin;
}

function newFrame(doc: Y.Doc, title: string, rect: Rect, z: number): string {
  const id = randomUUID();
  const frame = new Y.Map<unknown>();
  frame.set('kind', 'frame');
  frame.set('title', title);
  frame.set('x', rect.x);
  frame.set('y', rect.y);
  frame.set('w', rect.w);
  frame.set('h', rect.h);
  frame.set('z', z);
  frame.set('author', 'assistant');
  nodesOf(doc).set(id, frame);
  return id;
}

/**
 * Lays out groups of notes, each in a new titled frame, and moves the notes into them. Frames go where the notes they
 * hold were (the notes are leaving), unless that would cover something else on the board; then to the right of it all.
 * A frame all of whose notes move is the grouping being replaced, so it goes. Returns the new frames' ids, how many
 * notes moved and how many old frames were removed. A note named in two groups goes in the first.
 */
export function frameGroups(
  doc: Y.Doc,
  groups: { title: string; noteIds: string[] }[],
): { frameIds: string[]; moved: number; replaced: number } {
  const nodes = nodesOf(doc);
  const taken = new Set<string>();
  const kept = groups
    .map((g) => ({
      title: g.title,
      ids: g.noteIds.filter((id) => {
        const node = nodes.get(id);
        if (taken.has(id) || !(node instanceof Y.Map) || node.get('kind') !== 'note') return false;
        taken.add(id);
        return true;
      }),
    }))
    .filter((g) => g.ids.length);
  if (kept.length === 0) return { frameIds: [], moved: 0, replaced: 0 };

  // Each frame's size, then a layout of rows starting at (0, 0).
  const sized = kept.map((g) => {
    const columns = Math.min(FRAME_COLUMNS, g.ids.length);
    const rows = Math.ceil(g.ids.length / columns);
    return {
      ...g,
      columns,
      w: FRAME_PADDING * 2 + columns * NOTE_SIZE.w + (columns - 1) * GAP,
      h: FRAME_TITLE + FRAME_PADDING + rows * NOTE_SIZE.h + (rows - 1) * GAP,
    };
  });
  const layout: (Rect & (typeof sized)[number])[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  sized.forEach((g, i) => {
    if (i > 0 && i % FRAMES_PER_ROW === 0) {
      x = 0;
      y += rowHeight + FRAME_GAP;
      rowHeight = 0;
    }
    layout.push({ ...g, x, y });
    x += g.w + FRAME_GAP;
    rowHeight = Math.max(rowHeight, g.h);
  });
  const emptied = emptiedBy(doc, taken);
  const origin = originFor(doc, taken, emptied, {
    w: Math.max(...layout.map((f) => f.x + f.w)),
    h: Math.max(...layout.map((f) => f.y + f.h)),
  });

  const frameIds: string[] = [];
  doc.transact(() => {
    for (const id of emptied) nodes.delete(id);
    // Frames sit under notes whatever their z, so theirs only orders them among themselves.
    let z = topZ(doc);
    for (const f of layout) {
      const fx = Math.round(origin.x + f.x);
      const fy = Math.round(origin.y + f.y);
      frameIds.push(newFrame(doc, f.title, { x: fx, y: fy, w: f.w, h: f.h }, ++z));
      f.ids.forEach((noteId, i) => {
        const note = nodes.get(noteId)!;
        note.set('x', fx + FRAME_PADDING + (i % f.columns) * (NOTE_SIZE.w + GAP));
        note.set('y', fy + FRAME_TITLE + Math.floor(i / f.columns) * (NOTE_SIZE.h + GAP));
        note.set('z', ++z);
      });
    }
  });
  return { frameIds, moved: taken.size, replaced: emptied.size };
}

/**
 * Adds notes in a grid beside `near` (or beside everything on the board), above all else, and returns their ids. Where
 * notes go is decided here, not by the model, so its additions always land tidily.
 */
export function addNotes(doc: Y.Doc, notes: { text: string; color: NoteColor }[], near: NoteView[] = notesOf(doc)): string[] {
  const right = near.length ? Math.max(...near.map((n) => n.x)) + NOTE_SIZE.w + GAP * 3 : 0;
  const top = near.length ? Math.min(...near.map((n) => n.y)) : 0;
  let z = topZ(doc);
  const ids: string[] = [];
  doc.transact(() => {
    notes.forEach((note, i) => {
      ids.push(
        newNote(doc, note, { x: Math.round(right + (i % COLUMNS) * (NOTE_SIZE.w + GAP)), y: Math.round(top + Math.floor(i / COLUMNS) * (NOTE_SIZE.h + GAP)) }, ++z),
      );
    });
  });
  return ids;
}

function newNote(doc: Y.Doc, note: { text: string; color: NoteColor }, at: { x: number; y: number }, z: number): string {
  const id = randomUUID();
  const node = new Y.Map<unknown>();
  node.set('kind', 'note');
  node.set('x', at.x);
  node.set('y', at.y);
  node.set('w', NOTE_SIZE.w);
  node.set('h', NOTE_SIZE.h);
  node.set('z', z);
  node.set('color', note.color);
  node.set('author', 'assistant');
  const fragment = new Y.XmlFragment();
  node.set('text', fragment);
  nodesOf(doc).set(id, node);
  fragment.insert(0, paragraphs(note.text));
  return id;
}

/** One step on a timeline: an existing note to move there, or a new note to write. */
export type TimelineItem = { noteId: string } | { text: string; color: NoteColor };

/**
 * Lays a plan out as a timeline: a frame titled `title` holding one column per period, left to right, each a frame
 * titled with the period's label and holding its items top to bottom. Existing notes move into place (a note named
 * twice goes in the first place); new ones are written there. Placed like frameGroups. Returns the timeline frame's
 * id and what it did.
 */
export function makeTimeline(
  doc: Y.Doc,
  title: string,
  periods: { label: string; items: TimelineItem[] }[],
): { frameId: string; frames: number; moved: number; added: number; replaced: number } {
  const nodes = nodesOf(doc);
  const taken = new Set<string>();
  const columns = periods.map((p) => ({
    label: p.label,
    items: p.items.filter((item) => {
      if (!('noteId' in item)) return true;
      const node = nodes.get(item.noteId);
      if (taken.has(item.noteId) || !(node instanceof Y.Map) || node.get('kind') !== 'note') return false;
      taken.add(item.noteId);
      return true;
    }),
  }));

  const columnW = NOTE_SIZE.w + FRAME_PADDING * 2;
  const tallest = Math.max(1, ...columns.map((c) => c.items.length));
  const columnH = FRAME_TITLE + FRAME_PADDING + tallest * NOTE_SIZE.h + (tallest - 1) * GAP;
  const size = {
    w: FRAME_PADDING * 2 + columns.length * columnW + (columns.length - 1) * GAP,
    h: FRAME_TITLE + columnH + FRAME_PADDING,
  };
  const emptied = emptiedBy(doc, taken);
  const origin = originFor(doc, taken, emptied, size);

  let frameId = '';
  let added = 0;
  doc.transact(() => {
    for (const id of emptied) nodes.delete(id);
    let z = topZ(doc);
    const x0 = Math.round(origin.x);
    const y0 = Math.round(origin.y);
    frameId = newFrame(doc, title, { x: x0, y: y0, ...size }, ++z);
    columns.forEach((column, c) => {
      const cx = x0 + FRAME_PADDING + c * (columnW + GAP);
      const cy = y0 + FRAME_TITLE;
      newFrame(doc, column.label, { x: cx, y: cy, w: columnW, h: columnH }, ++z);
      column.items.forEach((item, i) => {
        const at = { x: cx + FRAME_PADDING, y: cy + FRAME_TITLE + i * (NOTE_SIZE.h + GAP) };
        if ('noteId' in item) {
          const note = nodes.get(item.noteId)!;
          note.set('x', at.x);
          note.set('y', at.y);
          note.set('z', ++z);
        } else {
          newNote(doc, item, at, ++z);
          added++;
        }
      });
    });
  });
  return { frameId, frames: columns.length + 1, moved: taken.size, added, replaced: emptied.size };
}

/** Recolours notes that exist; returns how many it found. */
export function setColors(doc: Y.Doc, ids: string[], color: NoteColor): number {
  const nodes = nodesOf(doc);
  let found = 0;
  doc.transact(() => {
    for (const id of ids) {
      const node = nodes.get(id);
      if (node instanceof Y.Map && node.get('kind') === 'note') {
        node.set('color', color);
        found++;
      }
    }
  });
  return found;
}
