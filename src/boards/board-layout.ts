import * as Y from 'yjs';
import { NOTE_COLORS, NOTE_SIZE, type NoteColor } from '../assist/board-edit';
import { agendaOf, type StepActivity } from '../facilitation/facilitation-doc';
import { fragmentText } from './board-text';
import { richOf, richProblem } from './rich-text';
import {
  ARROW_DASHES,
  ARROW_ROUTES,
  ARROW_WEIGHTS,
  BOARD_VIEWS,
  FRAME_BORDERS,
  FRAME_FILLS,
  FRAME_LOOKS,
  SHAPES,
  TEXT_SIZES,
  type ArrowDash,
  type ArrowRoute,
  type BoardView,
  type FrameBorder,
  type FrameFill,
  type FrameLook,
  type Layout,
  type ShapeKind,
  type TextSize,
} from './layout';

/** The most a saved template may hold, as for any layout. */
export const MAX_TEMPLATE_THINGS = 200;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const pick = <T extends string | number>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/**
 * A board as a layout, to save as a template: its frames, notes (unless left out), text, shapes, tables, views and the
 * arrows between them, moved so the top-left one is at the origin. Images, files, drawings, diagrams, charts, links and
 * mini-apps stay behind: a template is a structure to fill in. With it, the board's agenda, its frames named by key.
 */
export function layoutFromBoard(doc: Y.Doc, keepNotes: boolean): { layout: Layout; agenda: { title: string; minutes: number; frame?: string; activity?: StepActivity }[]; things: number } {
  const layout: Required<Pick<Layout, 'frames' | 'notes' | 'texts' | 'shapes' | 'tables' | 'views' | 'arrows'>> = { frames: [], notes: [], texts: [], shapes: [], tables: [], views: [], arrows: [] };
  const keys = new Map<string, string>();
  const keyOf = (id: string) => {
    let key = keys.get(id);
    if (!key) keys.set(id, (key = `k${keys.size + 1}`));
    return key;
  };
  const connectors: Y.Map<unknown>[] = [];
  doc.getMap<Y.Map<unknown>>('nodes').forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const box = { x: num(node.get('x')), y: num(node.get('y')) };
    const size = { w: Math.max(1, num(node.get('w'))), h: Math.max(1, num(node.get('h'))) };
    switch (node.get('kind')) {
      case 'frame': {
        const fill = pick<FrameFill>(FRAME_FILLS, node.get('fill'));
        const border = pick<FrameBorder>(FRAME_BORDERS, node.get('border'));
        const look = pick<FrameLook>(FRAME_LOOKS, node.get('look'));
        layout.frames.push({ key: keyOf(id), title: str(node.get('title')).slice(0, 2000), ...box, ...size, ...(fill ? { fill } : {}), ...(border ? { border } : {}), ...(look ? { look } : {}) });
        break;
      }
      case 'note': {
        const text = node.get('text');
        if (!keepNotes || !(text instanceof Y.XmlFragment)) break;
        const color = pick<NoteColor>(NOTE_COLORS, node.get('color'));
        // The rich text as written, when it's small enough to keep; the plain text is kept either way.
        const rich = richOf(text);
        const isDefault = size.w === NOTE_SIZE.w && size.h === NOTE_SIZE.h;
        layout.notes.push({
          key: keyOf(id),
          text: fragmentText(text).slice(0, 2000),
          ...(richProblem(rich) ? {} : { rich }),
          ...(color ? { color } : {}),
          ...box,
          ...(isDefault ? {} : size),
        });
        break;
      }
      case 'text': {
        const textSize = pick<TextSize>(Object.keys(TEXT_SIZES) as TextSize[], node.get('size'));
        layout.texts.push({ key: keyOf(id), text: str(node.get('text')).slice(0, 2000), ...(textSize ? { size: textSize } : {}), ...box, w: size.w });
        break;
      }
      case 'shape': {
        const shape = pick<ShapeKind>(SHAPES, node.get('shape')) ?? 'rect';
        const color = pick<NoteColor>(NOTE_COLORS, node.get('color'));
        layout.shapes.push({ key: keyOf(id), shape, ...(color ? { color } : {}), label: str(node.get('label')).slice(0, 2000), ...box, ...size });
        break;
      }
      case 'table': {
        const rows = Math.min(50, Math.max(1, Math.floor(num(node.get('rows')))));
        const cols = Math.min(20, Math.max(1, Math.floor(num(node.get('cols')))));
        const stored = node.get('cells');
        const cell = (r: number, c: number) => (stored instanceof Y.Map ? str(stored.get(`${r}:${c}`)).slice(0, 2000) : '');
        const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (keepNotes || r === 0 ? cell(r, c) : '')));
        layout.tables.push({ key: keyOf(id), ...box, rows, cols, cells, colWidth: Math.round(size.w / cols) });
        break;
      }
      case 'view': {
        const view = pick<BoardView>(BOARD_VIEWS, node.get('view'));
        if (view) layout.views.push({ key: keyOf(id), view, ...box });
        break;
      }
      case 'connector':
        connectors.push(node);
        break;
    }
  });
  for (const c of connectors) {
    const from = keys.get(str(c.get('from')));
    const to = keys.get(str(c.get('to')));
    if (!from || !to || from === to) continue;
    const route = pick<ArrowRoute>(ARROW_ROUTES, c.get('route'));
    const dash = pick<ArrowDash>(ARROW_DASHES, c.get('dash'));
    const weight = pick<number>(ARROW_WEIGHTS, c.get('weight'));
    layout.arrows.push({ from, to, ...(route ? { route } : {}), ...(dash ? { dash } : {}), ...(weight ? { weight } : {}) });
  }

  // Everything moved so the layout starts at the origin.
  const placed = [...layout.frames, ...layout.notes, ...layout.texts, ...layout.shapes, ...layout.tables, ...layout.views];
  const minX = Math.min(...placed.map((t) => t.x));
  const minY = Math.min(...placed.map((t) => t.y));
  for (const t of placed) {
    t.x = Math.round(t.x - (Number.isFinite(minX) ? minX : 0));
    t.y = Math.round(t.y - (Number.isFinite(minY) ? minY : 0));
  }

  const frameKeys = new Map(layout.frames.map((f) => [[...keys].find(([, k]) => k === f.key)![0], f.key!]));
  const agenda = agendaOf(doc).steps.map((s) => ({
    title: s.title,
    // As set, not rounded: a 20-second check-in stays 20 seconds.
    minutes: s.seconds / 60,
    ...(s.frameId && frameKeys.has(s.frameId) ? { frame: frameKeys.get(s.frameId)! } : {}),
    ...(s.activity ? { activity: s.activity } : {}),
  }));
  const trimmed = Object.fromEntries(Object.entries(layout).filter(([, list]) => list.length)) as Layout;
  return { layout: trimmed, agenda, things: placed.length + layout.arrows.length };
}
