import * as Y from 'yjs';
import { FRAME_PADDING, FRAME_TITLE, newFrame, newNote, NOTE_SIZE, type NoteColor } from '../assist/board-edit';

/** A board to start from: columns (frames), each with a note saying what goes in it. */
export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  columns: { title: string; hint: string; color?: NoteColor }[];
}

export const TEMPLATES: BoardTemplate[] = [
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'What went well, what could be better, and what to do about it.',
    columns: [
      { title: 'What went well', hint: 'One thing per note: what went well?', color: 'green' },
      { title: 'What could be better', hint: 'One thing per note: what got in the way?', color: 'pink' },
      { title: 'Action items', hint: 'Vote, then ask the assistant to draft action items with owners.', color: 'blue' },
    ],
  },
  {
    id: 'start-stop-continue',
    name: 'Start, stop, continue',
    description: 'What the team should start doing, stop doing and keep doing.',
    columns: [
      { title: 'Start', hint: 'What should we start doing?', color: 'green' },
      { title: 'Stop', hint: 'What should we stop doing?', color: 'pink' },
      { title: 'Continue', hint: 'What should we keep doing?', color: 'blue' },
    ],
  },
  {
    id: 'four-ls',
    name: '4 Ls',
    description: 'Liked, learned, lacked and longed for: a retro that looks forward too.',
    columns: [
      { title: 'Liked', hint: 'What did you like?', color: 'green' },
      { title: 'Learned', hint: 'What did you learn?', color: 'blue' },
      { title: 'Lacked', hint: 'What was missing?', color: 'pink' },
      { title: 'Longed for', hint: 'What do you wish we had?', color: 'purple' },
    ],
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'A goal, the steps to it, and what could go wrong; ready to turn into a timeline.',
    columns: [
      { title: 'Goal', hint: 'What are we trying to achieve, and by when?', color: 'yellow' },
      { title: 'Steps', hint: 'A note per step. Then ask the assistant to turn this plan into a timeline.', color: 'blue' },
      { title: 'Risks', hint: 'What could get in the way?', color: 'pink' },
      { title: 'Open questions', hint: 'What do we still need to find out?', color: 'purple' },
    ],
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Ideas first, judging later, with a parking lot for the rest.',
    columns: [
      { title: 'Ideas', hint: 'Every idea gets a note. No judging yet.', color: 'yellow' },
      { title: 'Parking lot', hint: 'Good, but not for now.', color: 'gray' },
    ],
  },
];

const COLUMN = { w: 2 * NOTE_SIZE.w + 3 * FRAME_PADDING, h: 640 };
const GAP = 64;

/** Lays a template's columns out side by side, each a frame with its hint note at the top. */
export function applyTemplate(doc: Y.Doc, template: BoardTemplate): void {
  doc.transact(() => {
    template.columns.forEach((column, i) => {
      const x = i * (COLUMN.w + GAP);
      newFrame(doc, column.title, { x, y: 0, ...COLUMN }, i + 1, 'template');
      newNote(doc, { text: column.hint, color: column.color ?? 'yellow' }, { x: x + FRAME_PADDING, y: FRAME_TITLE }, template.columns.length + i + 1, 'template');
    });
  });
}
