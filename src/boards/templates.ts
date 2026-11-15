import * as Y from 'yjs';
import { FRAME_PADDING, FRAME_TITLE, NOTE_SIZE, type NoteColor } from '../assist/board-edit';
import { applyLayout, layoutSize, type Layout } from './layout';

/** Where a template sits in the picker. */
export const TEMPLATE_CATEGORIES = ['retro', 'ideate', 'plan', 'discover', 'analyse', 'team'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** A board to start from: frames, notes, text, shapes, tables, views and arrows, laid out (see layout.ts). */
export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  layout: Layout;
}

const COLUMN = { w: 2 * NOTE_SIZE.w + 3 * FRAME_PADDING, h: 640 };
const GAP = 64;

/** Columns side by side, each a frame with a note at the top saying what goes in it. */
export function columns(list: { title: string; hint: string; color?: NoteColor }[]): Layout {
  return {
    frames: list.map((c, i) => ({ title: c.title, x: i * (COLUMN.w + GAP), y: 0, ...COLUMN })),
    notes: list.map((c, i) => ({ text: c.hint, color: c.color ?? 'yellow', x: i * (COLUMN.w + GAP) + FRAME_PADDING, y: FRAME_TITLE })),
  };
}

export const TEMPLATES: BoardTemplate[] = [
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'What went well, what could be better, and what to do about it.',
    category: 'retro',
    layout: columns([
      { title: 'What went well', hint: 'One thing per note: what went well?', color: 'green' },
      { title: 'What could be better', hint: 'One thing per note: what got in the way?', color: 'pink' },
      { title: 'Action items', hint: 'Vote, then ask the assistant to draft action items with owners.', color: 'blue' },
    ]),
  },
  {
    id: 'start-stop-continue',
    name: 'Start, stop, continue',
    description: 'What the team should start doing, stop doing and keep doing.',
    category: 'retro',
    layout: columns([
      { title: 'Start', hint: 'What should we start doing?', color: 'green' },
      { title: 'Stop', hint: 'What should we stop doing?', color: 'pink' },
      { title: 'Continue', hint: 'What should we keep doing?', color: 'blue' },
    ]),
  },
  {
    id: 'four-ls',
    name: '4 Ls',
    description: 'Liked, learned, lacked and longed for: a retro that looks forward too.',
    category: 'retro',
    layout: columns([
      { title: 'Liked', hint: 'What did you like?', color: 'green' },
      { title: 'Learned', hint: 'What did you learn?', color: 'blue' },
      { title: 'Lacked', hint: 'What was missing?', color: 'pink' },
      { title: 'Longed for', hint: 'What do you wish we had?', color: 'purple' },
    ]),
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'A goal, the steps to it, and what could go wrong; ready to turn into a timeline.',
    category: 'plan',
    layout: columns([
      { title: 'Goal', hint: 'What are we trying to achieve, and by when?', color: 'yellow' },
      { title: 'Steps', hint: 'A note per step. Then ask the assistant to turn this plan into a timeline.', color: 'blue' },
      { title: 'Risks', hint: 'What could get in the way?', color: 'pink' },
      { title: 'Open questions', hint: 'What do we still need to find out?', color: 'purple' },
    ]),
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Ideas first, judging later, with a parking lot for the rest.',
    category: 'ideate',
    layout: columns([
      { title: 'Ideas', hint: 'Every idea gets a note. No judging yet.', color: 'yellow' },
      { title: 'Parking lot', hint: 'Good, but not for now.', color: 'gray' },
    ]),
  },
];

/** Lays a template out on a new board, from its top-left corner. */
export function applyTemplate(doc: Y.Doc, template: BoardTemplate): void {
  applyLayout(doc, template.layout, { x: 0, y: 0 });
}

/** The frames' outlines, scaled into a 100-wide box, to draw a template's preview. */
export function previewOf(template: BoardTemplate): { x: number; y: number; w: number; h: number }[] {
  const { w, h } = layoutSize(template.layout);
  const scale = 100 / Math.max(w, h, 1);
  return (template.layout.frames ?? []).map((f) => ({ x: Math.round(f.x * scale), y: Math.round(f.y * scale), w: Math.max(1, Math.round(f.w * scale)), h: Math.max(1, Math.round(f.h * scale)) }));
}
