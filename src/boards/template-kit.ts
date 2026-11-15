import { FRAME_PADDING, FRAME_TITLE, NOTE_SIZE, type NoteColor } from '../assist/board-edit';
import type { FrameBorder, FrameFill, FrameLook, Layout } from './layout';

/** The pieces templates are built from (templates.ts and templates-library.ts). */

const COLUMN = { w: 2 * NOTE_SIZE.w + 3 * FRAME_PADDING, h: 640 };
const GAP = 64;

export type Box = { x: number; y: number; w: number; h: number };
type FrameStyle = { fill?: FrameFill; border?: FrameBorder; look?: FrameLook };

/** Columns side by side, each a frame with a note at the top saying what goes in it. */
export function columns(list: { title: string; hint: string; color?: NoteColor }[]): Layout {
  return {
    frames: list.map((c, i) => ({ key: `col${i}`, title: c.title, x: i * (COLUMN.w + GAP), y: 0, ...COLUMN })),
    notes: list.map((c, i) => ({ text: c.hint, color: c.color ?? 'yellow', x: i * (COLUMN.w + GAP) + FRAME_PADDING, y: FRAME_TITLE })),
  };
}

/** A frame with a note at its top saying what goes in it. */
export function area(key: string, title: string, box: Box, hint: string, color: NoteColor = 'yellow', style: FrameStyle = {}): Layout {
  return { frames: [{ key, title, ...box, ...style }], notes: [{ text: hint, color, x: box.x + FRAME_PADDING, y: box.y + FRAME_TITLE }] };
}

/** A layout moved right and down. */
export function shift(layout: Layout, dx: number, dy: number): Layout {
  const by = <T extends { x: number; y: number }>(list?: T[]) => list?.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  return { ...layout, frames: by(layout.frames), notes: by(layout.notes), texts: by(layout.texts), shapes: by(layout.shapes), tables: by(layout.tables), views: by(layout.views) };
}

/** Layouts put together. */
export function merge(...layouts: Layout[]): Layout {
  const all = <K extends keyof Layout>(key: K) => layouts.flatMap((l) => (l[key] ?? []) as NonNullable<Layout[K]>[number][]) as NonNullable<Layout[K]>;
  return { frames: all('frames'), notes: all('notes'), texts: all('texts'), shapes: all('shapes'), tables: all('tables'), views: all('views'), arrows: all('arrows') };
}

/** A heading above a layout. */
export const headed = (heading: string, layout: Layout): Layout => merge({ texts: [{ text: heading, size: 'lg', x: 0, y: 0, w: 960 }] }, shift(layout, 0, 96));

/** Frames in a grid, each with its hint. */
export function grid(cols: number, size: { w: number; h: number }, boxes: { title: string; hint: string; color?: NoteColor; fill?: FrameFill; look?: FrameLook }[], prefix = 'g'): Layout {
  return merge(
    ...boxes.map((b, i) =>
      area(`${prefix}${i}`, b.title, { x: (i % cols) * (size.w + GAP), y: Math.floor(i / cols) * (size.h + GAP), ...size }, b.hint, b.color, {
        ...(b.fill ? { fill: b.fill } : {}),
        ...(b.look ? { look: b.look } : {}),
      }),
    ),
  );
}
