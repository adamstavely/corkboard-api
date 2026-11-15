import * as Y from 'yjs';
import { type NoteColor } from '../assist/board-edit';
import { setAgenda, type StepActivity } from '../facilitation/facilitation-doc';
import { randomUUID } from 'node:crypto';
import { applyLayout, layoutSize, type Layout } from './layout';
import { area, columns, grid, headed, merge, shift, type Box } from './template-kit';
import { LIBRARY_TEMPLATES } from './templates-library';

export { columns };

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
  /** How a session on it runs, a step at a time; `frame` is a frame's key in the layout. */
  agenda?: { title: string; minutes: number; frame?: string; activity?: StepActivity }[];
}

/**
 * The canvas both the Lean and Business Model canvases use: five columns, the second and fourth split in two, over two
 * wide boxes. Titles and hints in reading order: the five tall boxes and split halves left to right, top to bottom, then
 * the two along the bottom.
 */
function businessCanvas(boxes: { title: string; hint: string; color?: NoteColor }[]): Layout {
  const col = 360;
  const gap = 32;
  const tall = 720;
  const half = (tall - gap) / 2;
  const x = (i: number) => i * (col + gap);
  const spots: Box[] = [
    { x: x(0), y: 0, w: col, h: tall },
    { x: x(1), y: 0, w: col, h: half },
    { x: x(1), y: half + gap, w: col, h: half },
    { x: x(2), y: 0, w: col, h: tall },
    { x: x(3), y: 0, w: col, h: half },
    { x: x(3), y: half + gap, w: col, h: half },
    { x: x(4), y: 0, w: col, h: tall },
    { x: 0, y: tall + gap, w: (5 * col + 4 * gap - gap) / 2, h: 360 },
    { x: (5 * col + 4 * gap + gap) / 2, y: tall + gap, w: (5 * col + 4 * gap - gap) / 2, h: 360 },
  ];
  return merge(...boxes.map((b, i) => area(`c${i}`, b.title, spots[i], b.hint, b.color)));
}

export const TEMPLATES: BoardTemplate[] = [
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'What went well, what could be better, and what to do about it.',
    category: 'retro',
    agenda: [
      { title: 'Check in', minutes: 3 },
      { title: 'What went well', minutes: 5, frame: 'col0', activity: { kind: 'writing', anonymous: true } },
      { title: 'What could be better', minutes: 5, frame: 'col1', activity: { kind: 'writing', anonymous: true } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'col2' },
    ],
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
  {
    id: 'mad-sad-glad',
    name: 'Mad, sad, glad',
    description: 'How the last stretch felt: what frustrated, disappointed and pleased people.',
    category: 'retro',
    layout: columns([
      { title: 'Mad', hint: 'What frustrated you?', color: 'pink' },
      { title: 'Sad', hint: 'What disappointed you?', color: 'blue' },
      { title: 'Glad', hint: 'What made you happy?', color: 'green' },
    ]),
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'What pushes the team on, what holds it back, what lies ahead and where it is heading.',
    category: 'retro',
    layout: headed(
      'Sailboat retro',
      merge(
        area('wind', 'Wind: what pushes us on', { x: 0, y: 0, w: 560, h: 440 }, 'What helped us move forward?', 'green', { fill: 'blue' }),
        area('island', 'Island: where we are heading', { x: 1000, y: 0, w: 560, h: 440 }, 'What is our goal?', 'yellow', { fill: 'green' }),
        area('anchors', 'Anchors: what holds us back', { x: 0, y: 504, w: 560, h: 440 }, 'What slowed us down?', 'pink', { fill: 'gray' }),
        area('rocks', 'Rocks: risks ahead', { x: 1000, y: 504, w: 560, h: 440 }, 'What could sink us?', 'purple', { fill: 'pink' }),
        {
          shapes: [{ key: 'boat', shape: 'triangle', color: 'yellow', label: 'Us', x: 660, y: 320, w: 240, h: 240 }],
          arrows: [
            { from: 'wind', to: 'boat', route: 'curve', dash: 'dashed' },
            { from: 'boat', to: 'island', route: 'curve' },
          ],
        },
      ),
    ),
  },
  {
    id: 'crazy-8s',
    name: 'Crazy 8s',
    description: 'Eight ideas in eight minutes: one sketch or note per frame, then vote on the best.',
    category: 'ideate',
    agenda: [
      { title: 'Sketch eight ideas', minutes: 8 },
      { title: 'Share', minutes: 10 },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
    ],
    layout: merge(
      { texts: [{ text: 'Crazy 8s: one idea a minute. Set an 8-minute timer, then vote.', size: 'lg', x: 0, y: 0, w: 1200 }] },
      ...Array.from({ length: 8 }, (_, i) => ({ frames: [{ title: String(i + 1), x: (i % 4) * 344, y: 96 + Math.floor(i / 4) * 344, w: 320, h: 320 }] })),
    ),
  },
  {
    id: 'how-might-we',
    name: 'How might we…',
    description: 'Turn a problem into questions that invite ideas, then answer them.',
    category: 'ideate',
    layout: columns([
      { title: 'The problem', hint: 'What is getting in the way, and for whom?', color: 'pink' },
      { title: 'How might we…', hint: 'How might we …?', color: 'blue' },
      { title: 'Ideas', hint: 'One idea per note, for any question.', color: 'yellow' },
    ]),
  },
  {
    id: 'brainstorm-decide',
    name: 'Brainstorm, then decide',
    description: 'Ideas, grouped into themes, scored for value and effort, and turned into actions.',
    category: 'ideate',
    agenda: [
      { title: 'Ideas', minutes: 8, frame: 'ideas', activity: { kind: 'writing', anonymous: true } },
      { title: 'Group into themes', minutes: 5, frame: 'themes' },
      { title: 'Vote', minutes: 3, frame: 'themes', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Value and effort', minutes: 8 },
      { title: 'Actions', minutes: 8, frame: 'actions' },
    ],
    layout: merge(
      area('ideas', 'Ideas', { x: 0, y: 0, w: 920, h: 640 }, '**1. Ideas:** write on your own, one per note. Try hidden writing.'),
      area('themes', 'Themes', { x: 984, y: 0, w: 920, h: 640 }, '**2. Themes:** ask the assistant to group the ideas, then dot vote.', 'purple'),
      { views: [{ view: 'matrix', x: 0, y: 704 }] },
      area('actions', 'Action items', { x: 824, y: 704, w: 1080, h: 620 }, '**4. Actions:** ask the assistant to draft action items with owners.', 'green'),
      { texts: [{ text: '3. Drag the top ideas onto value and effort', size: 'sm', x: 0, y: 1340, w: 760 }] },
    ),
  },
  {
    id: 'lean-canvas',
    name: 'Lean canvas',
    description: 'A one-page business plan for a new product: problem, solution, customers and money.',
    category: 'plan',
    layout: businessCanvas([
      { title: 'Problem', hint: 'Top three problems, and how people solve them today.', color: 'pink' },
      { title: 'Solution', hint: 'Top three features.', color: 'green' },
      { title: 'Key metrics', hint: 'What will we count?', color: 'blue' },
      { title: 'Unique value proposition', hint: 'One clear message: why us?', color: 'yellow' },
      { title: 'Unfair advantage', hint: "What can't be copied or bought?", color: 'purple' },
      { title: 'Channels', hint: 'How we reach customers.', color: 'blue' },
      { title: 'Customer segments', hint: 'Who, and who will use it first?', color: 'green' },
      { title: 'Cost structure', hint: 'What it costs to run.', color: 'gray' },
      { title: 'Revenue streams', hint: 'How it makes money.', color: 'gray' },
    ]),
  },
  {
    id: 'business-model-canvas',
    name: 'Business model canvas',
    description: 'How an organisation creates, delivers and captures value, on one page.',
    category: 'plan',
    layout: businessCanvas([
      { title: 'Key partners', hint: 'Who helps us?', color: 'blue' },
      { title: 'Key activities', hint: 'What we do.', color: 'green' },
      { title: 'Key resources', hint: 'What we need.', color: 'green' },
      { title: 'Value propositions', hint: 'What we offer, and why it matters.', color: 'yellow' },
      { title: 'Customer relationships', hint: 'How we keep customers.', color: 'pink' },
      { title: 'Channels', hint: 'How we reach them.', color: 'pink' },
      { title: 'Customer segments', hint: 'Who we serve.', color: 'purple' },
      { title: 'Cost structure', hint: 'What it costs.', color: 'gray' },
      { title: 'Revenue streams', hint: 'How money comes in.', color: 'gray' },
    ]),
  },
  {
    id: 'okr-tree',
    name: 'OKR tree',
    description: 'An objective, the key results that show it is met, and the work that moves each one.',
    category: 'plan',
    layout: merge(
      area('objective', 'Objective', { x: 608, y: 0, w: 560, h: 320 }, 'What do we want to achieve? Make it inspiring.', 'yellow', { fill: 'yellow' }),
      ...[0, 1, 2].map((i) =>
        area(`kr${i}`, `Key result ${i + 1}`, { x: i * 592, y: 448, w: 528, h: 560 }, '**Measure:** from … to … by …\nThen a note per initiative.', 'blue'),
      ),
      { arrows: [0, 1, 2].map((i) => ({ from: 'objective', to: `kr${i}`, route: 'elbow' as const })) },
    ),
  },
  {
    id: 'now-next-later',
    name: 'Now, next, later',
    description: 'A roadmap without dates: what we are doing, what comes next and what can wait.',
    category: 'plan',
    layout: columns([
      { title: 'Now', hint: 'In progress this cycle.', color: 'green' },
      { title: 'Next', hint: 'Up next, once now is done.', color: 'blue' },
      { title: 'Later', hint: 'Worth doing, not yet.', color: 'gray' },
    ]),
  },
  {
    id: 'empathy-map',
    name: 'Empathy map',
    description: 'What a person says, thinks, does and feels, and what they want and fear.',
    category: 'discover',
    layout: merge(
      grid(2, { w: 560, h: 400 }, [
        { title: 'Says', hint: 'What do they say out loud?', color: 'blue' },
        { title: 'Thinks', hint: "What's on their mind?", color: 'purple' },
        { title: 'Does', hint: 'What do they do?', color: 'green' },
        { title: 'Feels', hint: 'What worries or excites them?', color: 'pink' },
      ]),
      { shapes: [{ shape: 'ellipse', color: 'yellow', label: 'Who are they?', x: 452, y: 332, w: 280, h: 200 }] },
      shift(
        grid(2, { w: 560, h: 320 }, [
          { title: 'Pains', hint: 'Fears, frustrations, obstacles.', color: 'pink', fill: 'pink' },
          { title: 'Gains', hint: 'Wants, needs, hopes.', color: 'green', fill: 'green' },
        ], 'pg'),
        0,
        928,
      ),
    ),
  },
  {
    id: 'journey-map',
    name: 'User journey map',
    description: 'A person’s steps from first hearing of you to coming back, and how each one goes.',
    category: 'discover',
    layout: headed('Persona: who is on this journey?', {
      tables: [
        {
          x: 0,
          y: 0,
          colWidth: 200,
          cells: [
            ['', 'Discover', 'Sign up', 'First use', 'Get value', 'Come back'],
            ['Doing'],
            ['Thinking'],
            ['Feeling'],
            ['Pain points'],
            ['Opportunities'],
          ],
        },
      ],
      notes: [{ text: 'Write in the cells, or add notes below each stage.', color: 'blue', x: 0, y: 296 }],
    }),
  },
  {
    id: 'swot',
    name: 'SWOT',
    description: 'Strengths and weaknesses inside, opportunities and threats outside.',
    category: 'analyse',
    layout: grid(2, { w: 560, h: 440 }, [
      { title: 'Strengths', hint: 'What do we do well?', color: 'green' },
      { title: 'Weaknesses', hint: 'Where do we fall short?', color: 'pink' },
      { title: 'Opportunities', hint: 'What could we take advantage of?', color: 'blue' },
      { title: 'Threats', hint: 'What could hurt us?', color: 'purple' },
    ]),
  },
  {
    id: 'pre-mortem',
    name: 'Pre-mortem',
    description: 'Imagine the project failed, then work out why, and what to do about it now.',
    category: 'analyse',
    agenda: [
      { title: 'Why it failed', minutes: 7, frame: 'col0', activity: { kind: 'writing', anonymous: true } },
      { title: 'Warning signs', minutes: 5, frame: 'col1' },
      { title: 'Vote on the biggest risks', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'What we do now', minutes: 10, frame: 'col2' },
    ],
    layout: headed(
      "It's six months from now and the project failed. What happened?",
      columns([
        { title: 'Why it failed', hint: 'One reason per note. Be specific.', color: 'pink' },
        { title: 'Warning signs', hint: 'What would we see first?', color: 'yellow' },
        { title: 'What we do now', hint: 'Vote on the biggest risks, then plan against them.', color: 'green' },
      ]),
    ),
  },
  {
    id: 'risk-register',
    name: 'Risk register',
    description: 'Each risk with how likely and bad it is, who owns it and what we are doing about it.',
    category: 'analyse',
    layout: headed('Risk register', {
      tables: [
        {
          x: 0,
          y: 0,
          colWidth: 200,
          cells: [['Risk', 'Likelihood (1–5)', 'Impact (1–5)', 'Owner', 'Mitigation'], [], [], [], [], [], []],
        },
      ],
    }),
  },
  {
    id: 'five-whys',
    name: '5 whys',
    description: 'Ask why five times to get from a problem to its root cause.',
    category: 'analyse',
    layout: merge(
      { frames: [{ title: '5 whys', x: 0, y: 0, w: 7 * 264 - 64 + 64, h: 288 }] },
      {
        notes: [
          { key: 'w0', text: '**Problem:** what happened?', color: 'pink', x: 32, y: 80 },
          ...[1, 2, 3, 4, 5].map((i) => ({ key: `w${i}`, text: `**Why?**\nBecause …`, color: 'yellow' as const, x: 32 + i * 264, y: 80 })),
          { key: 'w6', text: '**Root cause:** what to fix.', color: 'green', x: 32 + 6 * 264, y: 80 },
        ],
        arrows: [0, 1, 2, 3, 4, 5].map((i) => ({ from: `w${i}`, to: `w${i + 1}` })),
      },
    ),
  },
  {
    id: 'fishbone',
    name: 'Fishbone',
    description: 'Causes of a problem by category, all pointing at the problem.',
    category: 'analyse',
    layout: merge(
      ...['People', 'Process', 'Tools'].map((title, i) => area(`top${i}`, title, { x: i * 424, y: 0, w: 360, h: 320 }, `Causes from ${title.toLowerCase()}.`, 'yellow')),
      ...['Materials', 'Environment', 'Measurement'].map((title, i) => area(`bottom${i}`, title, { x: i * 424, y: 560, w: 360, h: 320 }, `Causes from ${title.toLowerCase()}.`, 'yellow')),
      {
        texts: [{ key: 'tail', text: 'Causes', size: 'md', x: 0, y: 420, w: 120 }],
        shapes: [{ key: 'head', shape: 'rect', color: 'pink', label: 'The problem', x: 1336, y: 380, w: 280, h: 120 }],
        // The spine; the categories above and below are its bones.
        arrows: [{ from: 'tail', to: 'head', weight: 6 }],
      },
    ),
  },
  {
    id: 'icebreaker',
    name: 'Icebreaker',
    description: 'A quick round to start a session: everyone adds a note to each question.',
    category: 'team',
    layout: columns([
      { title: 'How are you, in one word?', hint: 'One word, one note.', color: 'yellow' },
      { title: 'Something you learned this week', hint: 'Big or small.', color: 'blue' },
      { title: "Something you're looking forward to", hint: 'At work or not.', color: 'green' },
    ]),
  },
  {
    id: 'team-charter',
    name: 'Team charter',
    description: 'Why the team exists, what it values and how it works together.',
    category: 'team',
    layout: grid(3, { w: 520, h: 400 }, [
      { title: 'Purpose', hint: 'Why does this team exist?', color: 'yellow' },
      { title: 'Values', hint: 'What do we care about?', color: 'green' },
      { title: 'How we work', hint: 'Rituals, hours, tools.', color: 'blue' },
      { title: 'How we decide', hint: 'Who decides what, and how?', color: 'purple' },
      { title: 'Roles', hint: 'Who does what?', color: 'pink' },
      { title: 'How we talk', hint: 'Channels, response times, feedback.', color: 'gray' },
    ]),
  },
  {
    id: 'raci',
    name: 'RACI',
    description: 'Who is responsible, accountable, consulted and informed for each task or decision.',
    category: 'team',
    layout: headed('RACI: R does it, A owns it, C is asked, I is told', {
      tables: [{ x: 0, y: 0, colWidth: 200, cells: [['Task or decision', 'Responsible', 'Accountable', 'Consulted', 'Informed'], [], [], [], [], [], []] }],
    }),
  },
  {
    id: 'meeting',
    name: 'Meeting',
    description: 'An agenda, notes, decisions and actions, ready for the recap.',
    category: 'team',
    agenda: [
      { title: 'Agenda', minutes: 2, frame: 'col0' },
      { title: 'Discussion', minutes: 20, frame: 'col1' },
      { title: 'Decisions', minutes: 5, frame: 'col2' },
      { title: 'Actions', minutes: 5, frame: 'col3' },
    ],
    layout: columns([
      { title: 'Agenda', hint: '**Agenda**\n1. \n2. \n3. ', color: 'blue' },
      { title: 'Notes', hint: 'Anyone can add notes as we go.', color: 'yellow' },
      { title: 'Decisions', hint: '**Decision**\nWe decided: \nBecause: \nDecided by: ', color: 'green' },
      { title: 'Action items', hint: 'One action per note, with an owner.', color: 'pink' },
    ]),
  },
  // The wider library: more retros, workshops, canvases and team rituals.
  ...LIBRARY_TEMPLATES,
];

/** Lays a template out on a new board, from its top-left corner. */
export function applyTemplate(doc: Y.Doc, template: BoardTemplate): void {
  const ids = applyLayout(doc, template.layout, { x: 0, y: 0 });
  if (template.agenda)
    setAgenda(doc, template.agenda.map((s) => ({ id: randomUUID(), title: s.title, seconds: s.minutes * 60, frameId: (s.frame && ids.get(s.frame)) || null, activity: s.activity ?? null })));
}

/** The frames' outlines, scaled into a 100-wide box, to draw a template's preview. */
export function previewOf(template: BoardTemplate): { x: number; y: number; w: number; h: number }[] {
  const { w, h } = layoutSize(template.layout);
  const scale = 100 / Math.max(w, h, 1);
  return (template.layout.frames ?? []).map((f) => ({ x: Math.round(f.x * scale), y: Math.round(f.y * scale), w: Math.max(1, Math.round(f.w * scale)), h: Math.max(1, Math.round(f.h * scale)) }));
}
