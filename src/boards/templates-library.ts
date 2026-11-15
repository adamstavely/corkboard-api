import { type NoteColor } from '../assist/board-edit';
import type { FrameFill, FrameLook, Layout } from './layout';
import { area, columns, grid, headed, merge, shift } from './template-kit';
import type { BoardTemplate } from './templates';

type Hinted = { title: string; hint: string; color?: NoteColor; fill?: FrameFill; look?: FrameLook };

/**
 * Four frames in a two-by-two, with what each axis means along the top and down the left. Boxes in reading order: top
 * left, top right, bottom left, bottom right; their keys are `q0` to `q3`.
 */
function quadrants(axes: { across: [string, string]; down: [string, string] }, boxes: Hinted[]): Layout {
  const size = { w: 560, h: 440 };
  return merge(
    {
      texts: [
        { text: axes.across[0], size: 'sm', x: 240, y: 0, w: size.w },
        { text: axes.across[1], size: 'sm', x: 240 + size.w + 64, y: 0, w: size.w },
        { text: axes.down[0], size: 'sm', x: 0, y: 64 + size.h / 2, w: 200 },
        { text: axes.down[1], size: 'sm', x: 0, y: 64 + size.h + 64 + size.h / 2, w: 200 },
      ],
    },
    shift(grid(2, size, boxes, 'q'), 240, 64),
  );
}

/** Arrows from each key to the next. */
const chain = (keys: string[]): NonNullable<Layout['arrows']> => keys.slice(1).map((to, i) => ({ from: keys[i], to }));

const RETRO: BoardTemplate[] = [
  {
    id: 'starfish',
    name: 'Starfish',
    description: 'A finer-grained retro in five arms: start, more of, keep, less of and stop.',
    category: 'retro',
    agenda: [
      { title: 'Check in', minutes: 3 },
      { title: 'Write', minutes: 8, activity: { kind: 'writing', anonymous: true } },
      { title: 'Read and group', minutes: 7 },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'actions' },
    ],
    layout: merge(
      area('start', 'Start doing', { x: 0, y: 0, w: 520, h: 400 }, 'What should we try that we have not done before?', 'green'),
      area('more', 'More of', { x: 1080, y: 0, w: 520, h: 400 }, 'What works, and deserves more time or people?', 'blue'),
      area('keep', 'Keep doing', { x: 0, y: 464, w: 520, h: 400 }, 'What works well just as it is?', 'yellow'),
      area('less', 'Less of', { x: 1080, y: 464, w: 520, h: 400 }, 'What still has some value, but we overdo?', 'purple'),
      area('stop', 'Stop doing', { x: 540, y: 928, w: 520, h: 400 }, 'What costs us more than it gives back?', 'pink'),
      area('actions', 'Action items', { x: 1664, y: 0, w: 496, h: 1328 }, 'Vote, then turn the top notes into action items, each with an owner.', 'gray', { look: 'band' }),
      { shapes: [{ shape: 'star', color: 'yellow', label: 'Us', x: 620, y: 340, w: 360, h: 360 }] },
    ),
  },
  {
    id: 'hot-air-balloon',
    name: 'Hot air balloon',
    description: 'What lifts the team, what weighs it down, and the sunshine and storms around it.',
    category: 'retro',
    agenda: [
      { title: 'Sunshine', minutes: 4, frame: 'sun', activity: { kind: 'writing', anonymous: true } },
      { title: 'Hot air', minutes: 4, frame: 'air', activity: { kind: 'writing', anonymous: true } },
      { title: 'Sandbags', minutes: 4, frame: 'sandbags', activity: { kind: 'writing', anonymous: true } },
      { title: 'Storm clouds', minutes: 4, frame: 'storms', activity: { kind: 'writing', anonymous: true } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'actions' },
    ],
    layout: headed(
      'Hot air balloon retro',
      merge(
        area('sun', "Sunshine: what's going well around us", { x: 0, y: 0, w: 1600, h: 320 }, 'Good things outside the team: support, timing, luck.', 'yellow', { fill: 'yellow' }),
        area('air', 'Hot air: what lifts us', { x: 0, y: 384, w: 560, h: 480 }, 'What helped us rise? Habits, tools, people.', 'green', { fill: 'pink' }),
        area('sandbags', 'Sandbags: what weighs us down', { x: 1040, y: 384, w: 560, h: 480 }, 'What should we drop to rise faster?', 'pink', { fill: 'gray' }),
        area('storms', 'Storm clouds: risks ahead', { x: 0, y: 928, w: 1600, h: 320 }, 'What could blow us off course next?', 'purple', { fill: 'blue' }),
        area('actions', 'Action items', { x: 1664, y: 0, w: 496, h: 1248 }, 'One action per note, with an owner: more hot air, fewer sandbags.', 'blue', { look: 'band' }),
        {
          shapes: [
            { key: 'balloon', shape: 'ellipse', color: 'yellow', label: 'Us', x: 640, y: 400, w: 320, h: 360 },
            { shape: 'rect', color: 'gray', x: 740, y: 780, w: 120, h: 100 },
          ],
          arrows: [{ from: 'air', to: 'balloon', route: 'curve', dash: 'dashed' }],
        },
      ),
    ),
  },
  {
    id: 'kalm',
    name: 'Keep, add, less, more',
    description: 'KALM: which practices to keep, add, do less of and do more of.',
    category: 'retro',
    agenda: [
      { title: 'Write', minutes: 8, activity: { kind: 'writing', anonymous: true } },
      { title: 'Read each column', minutes: 10 },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'actions' },
    ],
    layout: headed(
      'Keep, add, less, more',
      merge(
        grid(4, { w: 440, h: 640 }, [
          { title: 'Keep', hint: 'What works and should carry on unchanged?', color: 'green', look: 'band' },
          { title: 'Add', hint: 'What new practice, tool or habit should we bring in?', color: 'blue', look: 'band' },
          { title: 'Less', hint: 'What should we cut back on, without stopping it?', color: 'pink', look: 'band' },
          { title: 'More', hint: 'What should we do more often or more of?', color: 'purple', look: 'band' },
        ]),
        area('actions', 'Action items', { x: 0, y: 704, w: 1952, h: 360 }, 'Vote, then one action per note for the top items, with an owner.', 'yellow'),
      ),
    ),
  },
  {
    id: 'timeline-retro',
    name: 'Timeline retro',
    description: 'Lay out the highs and lows of a stretch in order, then look for patterns.',
    category: 'retro',
    agenda: [
      { title: 'Highs', minutes: 7, frame: 'highs', activity: { kind: 'writing', anonymous: false } },
      { title: 'Lows', minutes: 7, frame: 'lows', activity: { kind: 'writing', anonymous: false } },
      { title: 'Patterns', minutes: 8, frame: 'patterns' },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 8, frame: 'actions' },
    ],
    layout: headed(
      'Timeline retro: what happened, when, and how it felt',
      merge(
        area('highs', 'Highs', { x: 0, y: 0, w: 2400, h: 440 }, 'Something that went well. Put it under the week it happened.', 'green', { fill: 'green', look: 'lane' }),
        { texts: Array.from({ length: 6 }, (_, i) => ({ text: `Week ${i + 1}`, size: 'md' as const, x: i * 400 + 32, y: 464, w: 200 })) },
        area('lows', 'Lows', { x: 0, y: 528, w: 2400, h: 440 }, 'Something that was hard. Put it under the week it happened.', 'pink', { fill: 'pink', look: 'lane' }),
        area('patterns', 'Patterns', { x: 0, y: 1032, w: 1168, h: 440 }, 'What repeats? What led to the highs, and what to the lows?', 'purple'),
        area('actions', 'Action items', { x: 1232, y: 1032, w: 1168, h: 440 }, 'One action per note, with an owner.', 'blue'),
      ),
    ),
  },
  {
    id: 'speedboat',
    name: 'Speedboat',
    description: 'The engines that drive the team towards its goal and the anchors that slow it down.',
    category: 'retro',
    agenda: [
      { title: 'Finish line', minutes: 3, frame: 'finish' },
      { title: 'Engines', minutes: 5, frame: 'engines', activity: { kind: 'writing', anonymous: true } },
      { title: 'Anchors', minutes: 5, frame: 'anchors', activity: { kind: 'writing', anonymous: true } },
      { title: 'Vote on the heaviest anchors', minutes: 3, frame: 'anchors', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Lift the anchors', minutes: 10, frame: 'anchors' },
    ],
    layout: headed(
      'Speedboat retro',
      merge(
        area('engines', 'Engines: what drives us forward', { x: 0, y: 0, w: 640, h: 480 }, 'What gave us speed? Tools, habits, people.', 'green', { fill: 'blue' }),
        area('finish', 'Finish line: our goal', { x: 1280, y: 0, w: 560, h: 480 }, 'Where are we trying to get to, and by when?', 'yellow', { fill: 'green', look: 'card' }),
        area('anchors', 'Anchors: what slows us down', { x: 0, y: 544, w: 1840, h: 400 }, 'What held us back? Name the thing, not the person.', 'pink', { fill: 'gray' }),
        {
          shapes: [{ key: 'boat', shape: 'arrow', color: 'yellow', label: 'Us', x: 720, y: 160, w: 480, h: 160 }],
          arrows: [
            { from: 'engines', to: 'boat', dash: 'dashed' },
            { from: 'boat', to: 'finish' },
          ],
        },
      ),
    ),
  },
  {
    id: 'three-little-pigs',
    name: 'Three little pigs',
    description: 'What is built of straw, of sticks and of bricks: how sturdy our work and ways of working are.',
    category: 'retro',
    agenda: [
      { title: 'Write', minutes: 8, activity: { kind: 'writing', anonymous: true } },
      { title: 'Read each house', minutes: 10 },
      { title: 'Vote on what to shore up', minutes: 3, frame: 'house0', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'house0' },
    ],
    layout: headed(
      'Three little pigs',
      merge(
        ...[
          { title: 'House of straw', hint: 'What could fall over at the first puff? Fragile, risky, held together by luck.', color: 'pink' as const, roof: 'Straw' },
          { title: 'House of sticks', hint: 'What stands up, but needs work before it will last?', color: 'yellow' as const, roof: 'Sticks' },
          { title: 'House of bricks', hint: 'What is solid, and we can build on?', color: 'green' as const, roof: 'Bricks' },
        ].map((h, i) =>
          merge(
            { shapes: [{ shape: 'triangle', color: h.color, label: h.roof, x: i * 584 + 60, y: 0, w: 400, h: 160 }] },
            area(`house${i}`, h.title, { x: i * 584, y: 176, w: 520, h: 560 }, h.hint, h.color, { look: 'card' }),
          ),
        ),
      ),
    ),
  },
  {
    id: 'daki',
    name: 'Drop, add, keep, improve',
    description: 'DAKI: what to drop, what to add, what to keep and what to improve.',
    category: 'retro',
    agenda: [
      { title: 'Write', minutes: 8, activity: { kind: 'writing', anonymous: true } },
      { title: 'Read and group', minutes: 8 },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Actions', minutes: 10, frame: 'actions' },
    ],
    layout: merge(
      grid(2, { w: 560, h: 440 }, [
        { title: 'Drop', hint: 'What adds no value and should go?', color: 'pink', look: 'tab' },
        { title: 'Add', hint: 'What new practice or tool should we bring in?', color: 'blue', look: 'tab' },
        { title: 'Keep', hint: 'What works well and must stay?', color: 'green', look: 'tab' },
        { title: 'Improve', hint: 'What works, but could work better? Say how.', color: 'purple', look: 'tab' },
      ]),
      area('actions', 'Action items', { x: 1248, y: 0, w: 496, h: 944 }, 'One action per note, with an owner.', 'yellow'),
    ),
  },
  {
    id: 'rose-thorn-bud',
    name: 'Rose, thorn, bud',
    description: 'A highlight, a challenge and an opportunity from each person.',
    category: 'retro',
    agenda: [
      { title: 'Roses', minutes: 4, frame: 'g0', activity: { kind: 'writing', anonymous: false } },
      { title: 'Thorns', minutes: 4, frame: 'g1', activity: { kind: 'writing', anonymous: false } },
      { title: 'Buds', minutes: 4, frame: 'g2', activity: { kind: 'writing', anonymous: false } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'What we will do', minutes: 8, frame: 'actions' },
    ],
    layout: merge(
      grid(3, { w: 520, h: 600 }, [
        { title: 'Rose', hint: 'A highlight: something that went well or made you proud.', color: 'pink', look: 'band' },
        { title: 'Thorn', hint: 'A challenge: something that hurt or got in the way.', color: 'purple', look: 'band' },
        { title: 'Bud', hint: 'An opportunity: something just starting, or an idea that could grow.', color: 'green', look: 'band' },
      ]),
      area('actions', 'What we will do', { x: 0, y: 664, w: 1688, h: 360 }, 'Protect the roses, deal with the thorns, grow the buds. One action per note, with an owner.', 'blue'),
    ),
  },
  {
    id: 'futurespective',
    name: 'Futurespective',
    description: 'Imagine a future where things went brilliantly, then work back to the first steps.',
    category: 'retro',
    agenda: [
      { title: 'Picture success', minutes: 8, frame: 'success', activity: { kind: 'writing', anonymous: false } },
      { title: 'What got us there', minutes: 8, frame: 'helped' },
      { title: 'What we steered round', minutes: 8, frame: 'avoided' },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'First steps', minutes: 8, frame: 'first' },
    ],
    layout: headed(
      'It is a year from now and this went brilliantly.',
      merge(
        area('success', 'What success looks like', { x: 0, y: 0, w: 520, h: 560 }, 'Describe the day it went well. What can people see, do or say?', 'green', { look: 'card' }),
        area('helped', 'What got us there', { x: 648, y: 0, w: 520, h: 560 }, 'Which decisions, habits and help made the difference?', 'blue', { look: 'card' }),
        area('avoided', 'What we steered round', { x: 1296, y: 0, w: 520, h: 560 }, 'Which risks or traps did we avoid, and how?', 'purple', { look: 'card' }),
        area('first', 'First steps', { x: 1944, y: 0, w: 520, h: 560 }, 'What do we start next week to make this real? Add an owner.', 'yellow', { fill: 'yellow' }),
        { arrows: chain(['success', 'helped', 'avoided', 'first']) },
      ),
    ),
  },
];

const IDEATE: BoardTemplate[] = [
  {
    id: 'scamper',
    name: 'SCAMPER',
    description: 'Seven prompts for improving something that exists: substitute, combine, adapt, modify, put to another use, eliminate, reverse.',
    category: 'ideate',
    agenda: [
      { title: 'What we are improving', minutes: 3, frame: 'subject' },
      { title: 'Ideas', minutes: 12, activity: { kind: 'writing', anonymous: true } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Best ideas', minutes: 7, frame: 'g7' },
    ],
    layout: merge(
      area('subject', 'What we are improving', { x: 0, y: 0, w: 1872, h: 280 }, 'Name the product, process or idea, and what is wrong with it today.', 'pink', { fill: 'yellow' }),
      shift(
        grid(4, { w: 420, h: 440 }, [
          { title: 'Substitute', hint: 'What could we swap: a part, a material, a step, a person?', color: 'yellow' },
          { title: 'Combine', hint: 'What could we merge with something else?', color: 'blue' },
          { title: 'Adapt', hint: 'What else is like this, and what could we borrow from it?', color: 'green' },
          { title: 'Modify', hint: 'What could we make bigger, smaller, faster or simpler?', color: 'purple' },
          { title: 'Put to another use', hint: 'Who else could use this, or for what else?', color: 'yellow' },
          { title: 'Eliminate', hint: 'What could we take away and not miss?', color: 'pink' },
          { title: 'Reverse', hint: 'What if we did it backwards, or in another order?', color: 'blue' },
          { title: 'Best ideas', hint: 'Move the ideas with the most votes here.', color: 'green', fill: 'green' },
        ]),
        0,
        344,
      ),
    ),
  },
  {
    id: 'brain-dump',
    name: 'Brain dump',
    description: 'Get everything out of people’s heads first, then sort it into themes and next steps.',
    category: 'ideate',
    agenda: [
      { title: 'Dump', minutes: 6, frame: 'dump', activity: { kind: 'writing', anonymous: true } },
      { title: 'Group into themes', minutes: 6, frame: 'themes' },
      { title: 'Vote', minutes: 3, frame: 'themes', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Next steps', minutes: 6, frame: 'next' },
    ],
    layout: merge(
      area('dump', 'Everything on your mind', { x: 0, y: 0, w: 1280, h: 880 }, 'Write fast, one thought per note. Anything goes: tasks, worries, ideas, questions.', 'yellow', { look: 'zone' }),
      area('themes', 'Themes', { x: 1344, y: 0, w: 640, h: 880 }, 'Ask the assistant to group the notes into themes, then dot vote.', 'purple'),
      area('next', 'Next steps', { x: 2048, y: 0, w: 496, h: 880 }, 'For the top themes: the first thing to do, and who does it.', 'green'),
    ),
  },
  {
    id: 'brainwriting-635',
    name: '6-3-5 brainwriting',
    description: 'Six people write three ideas in five minutes, then pass their sheet on and build on what is there.',
    category: 'ideate',
    agenda: [
      ...Array.from({ length: 6 }, (_, i) => ({ title: `Round ${i + 1}`, minutes: 5 })),
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Talk through the top ideas', minutes: 7 },
    ],
    layout: merge(
      { texts: [{ text: '6-3-5: six people, three ideas each, five minutes a round. Then pass your sheet on.', size: 'lg', x: 0, y: 0, w: 2480 }] },
      ...Array.from({ length: 6 }, (_, i) => {
        const x = (i % 3) * 848;
        const y = 96 + Math.floor(i / 3) * 464;
        return {
          frames: [{ key: `sheet${i}`, title: `Sheet ${i + 1}`, x, y, w: 784, h: 400 }],
          tables: [{ x: x + 32, y: y + 64, colWidth: 180, cells: [['', 'Idea 1', 'Idea 2', 'Idea 3'], ...Array.from({ length: 6 }, (_, r) => [`Round ${r + 1}`])] }],
        };
      }),
    ),
  },
  {
    id: 'reverse-brainstorm',
    name: 'Reverse brainstorm',
    description: 'Ask how to make the problem worse, then flip each answer into something to try.',
    category: 'ideate',
    agenda: [
      { title: 'The problem', minutes: 3, frame: 'problem' },
      { title: 'Make it worse', minutes: 8, frame: 'worse', activity: { kind: 'writing', anonymous: true } },
      { title: 'Flip it', minutes: 10, frame: 'flip' },
      { title: 'Vote', minutes: 3, frame: 'flip', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Worth trying', minutes: 5, frame: 'try' },
    ],
    layout: headed(
      'Reverse brainstorm',
      merge(
        area('problem', 'The problem', { x: 0, y: 0, w: 496, h: 560 }, 'What are we trying to solve, and for whom?', 'pink', { look: 'card' }),
        area('worse', 'How could we make it worse?', { x: 624, y: 0, w: 560, h: 560 }, 'Every way to cause the problem or make it worse. The sillier the better.', 'purple'),
        area('flip', 'Flip it', { x: 1312, y: 0, w: 560, h: 560 }, 'Turn each bad idea round into something we could do.', 'blue'),
        area('try', 'Worth trying', { x: 2000, y: 0, w: 496, h: 560 }, 'The flipped ideas with the most votes.', 'green', { fill: 'green' }),
        { arrows: chain(['problem', 'worse', 'flip', 'try']) },
      ),
    ),
  },
  {
    id: 'lotus-blossom',
    name: 'Lotus blossom',
    description: 'A core idea in the middle, eight themes around it, and ideas growing from each theme.',
    category: 'ideate',
    agenda: [
      { title: 'Core idea', minutes: 3, frame: 'p4' },
      { title: 'Eight themes', minutes: 7, frame: 'p4' },
      { title: 'Ideas from each theme', minutes: 15, activity: { kind: 'writing', anonymous: false } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
    ],
    layout: headed(
      'Lotus blossom',
      grid(
        3,
        { w: 440, h: 440 },
        Array.from({ length: 9 }, (_, i) =>
          i === 4
            ? { title: 'Core idea', hint: 'The core idea first, then eight themes from it, one per note. Copy each theme to a square around this one.', color: 'yellow' as const, fill: 'yellow' as const }
            : { title: `Theme ${i < 4 ? i + 1 : i}`, hint: 'Name the theme in the title, then up to eight ideas that grow from it.', color: 'blue' as const },
        ),
        'p',
      ),
    ),
  },
  {
    id: 'worst-possible-idea',
    name: 'Worst possible idea',
    description: 'Come up with terrible ideas on purpose, then turn them round into good ones.',
    category: 'ideate',
    agenda: [
      { title: 'Worst ideas', minutes: 6, frame: 'col0', activity: { kind: 'writing', anonymous: true } },
      { title: 'Why they are so bad', minutes: 6, frame: 'col1' },
      { title: 'Turn them round', minutes: 8, frame: 'col2' },
      { title: 'Vote', minutes: 3, frame: 'col2', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Ideas to keep', minutes: 5, frame: 'col3' },
    ],
    layout: columns([
      { title: 'Worst ideas', hint: 'The worst idea you can think of. Bad on purpose takes the pressure off.', color: 'pink' },
      { title: 'Why it is so bad', hint: 'What exactly makes each one terrible?', color: 'purple' },
      { title: 'Turn it round', hint: 'What is the opposite of what makes it bad? Is there a good idea hiding there?', color: 'blue' },
      { title: 'Ideas to keep', hint: 'The turned-round ideas worth taking further.', color: 'green' },
    ]),
  },
  {
    id: 'affinity-map',
    name: 'Affinity map',
    description: 'Sort a pile of notes into themes by what they have in common, then say what each theme means.',
    category: 'ideate',
    agenda: [
      { title: 'Add notes', minutes: 8, frame: 'raw', activity: { kind: 'writing', anonymous: false } },
      { title: 'Sort in silence', minutes: 10 },
      { title: 'Name the themes', minutes: 5 },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Insights', minutes: 8, frame: 'insights' },
    ],
    layout: merge(
      area('raw', 'Raw notes', { x: 0, y: 0, w: 1200, h: 1024 }, "One observation, quote or fact per note. Don't group yet.", 'yellow', { look: 'zone' }),
      shift(
        grid(
          3,
          { w: 400, h: 480 },
          Array.from({ length: 6 }, (_, i) => ({ title: `Theme ${i + 1}`, hint: 'Drag in notes that belong together, then rename this frame for what they share.', color: 'gray' as const, look: 'drop' as const })),
          'group',
        ),
        1264,
        0,
      ),
      area('insights', 'Insights', { x: 0, y: 1088, w: 2592, h: 400 }, 'For each theme: what does it tell us, and what should we do about it?', 'green'),
    ),
  },
  {
    id: 'impact-effort',
    name: 'Impact and effort',
    description: 'Place each idea by how much difference it makes and how much work it takes.',
    category: 'ideate',
    agenda: [
      { title: 'Ideas', minutes: 6, frame: 'ideas', activity: { kind: 'writing', anonymous: true } },
      { title: 'Place them', minutes: 10 },
      { title: 'Agree what goes first', minutes: 5, frame: 'q0' },
    ],
    layout: merge(
      area('ideas', 'Ideas to place', { x: 0, y: 64, w: 496, h: 944 }, 'One idea per note. Then drag each into the square that fits.', 'yellow', { look: 'lane' }),
      shift(
        quadrants({ across: ['Less effort', 'More effort'], down: ['More impact', 'Less impact'] }, [
          { title: 'Quick wins', hint: 'More impact for less effort: do these first.', color: 'green', fill: 'green' },
          { title: 'Big bets', hint: 'More impact, more effort: plan these properly.', color: 'blue' },
          { title: 'Fill-ins', hint: 'Less impact, less effort: do them when there is slack.', color: 'gray' },
          { title: 'Money pits', hint: 'Less impact, more effort: drop these.', color: 'pink' },
        ]),
        560,
        0,
      ),
    ),
  },
  {
    id: 'round-robin',
    name: 'Round robin',
    description: 'Each idea is passed on twice: once to find its weakness and once to fix it.',
    category: 'ideate',
    agenda: [
      { title: 'Write an idea', minutes: 5, frame: 'idea', activity: { kind: 'writing', anonymous: false } },
      { title: 'Why it might fail', minutes: 5, frame: 'flaw' },
      { title: 'How to fix it', minutes: 5, frame: 'fix' },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Ideas to take forward', minutes: 7, frame: 'keep' },
    ],
    layout: headed(
      'Round robin: pass each idea on twice',
      merge(
        area('idea', '1. The idea', { x: 0, y: 0, w: 520, h: 640 }, 'One idea per note, with your name. Then pass it to the person on your right.', 'yellow', { look: 'card' }),
        area('flaw', '2. Why it might fail', { x: 648, y: 0, w: 520, h: 640 }, 'For the idea you were passed: its biggest weakness.', 'pink', { look: 'card' }),
        area('fix', '3. How to fix it', { x: 1296, y: 0, w: 520, h: 640 }, 'Pass it on again: how could we get round that weakness?', 'green', { look: 'card' }),
        area('keep', 'Ideas to take forward', { x: 1944, y: 0, w: 520, h: 640 }, 'The ideas that held up best, with their fixes.', 'blue', { fill: 'blue' }),
        { arrows: chain(['idea', 'flaw', 'fix', 'keep']) },
      ),
    ),
  },
];

const PLAN: BoardTemplate[] = [
  {
    id: 'sprint-planning',
    name: 'Sprint planning',
    description: 'A sprint goal, the team’s capacity, and the work that fits, with its risks.',
    category: 'plan',
    agenda: [
      { title: 'Sprint goal', minutes: 5, frame: 'goal' },
      { title: 'Capacity', minutes: 5, frame: 'capacity' },
      { title: 'Pick the work', minutes: 20, frame: 'sprint' },
      { title: 'Risks and dependencies', minutes: 5, frame: 'risks' },
      { title: 'Confidence', minutes: 2, frame: 'goal', activity: { kind: 'poll', question: 'How confident are you that we can meet the sprint goal?', pollKind: 'fist', options: [] } },
    ],
    layout: merge(
      area('goal', 'Sprint goal', { x: 0, y: 0, w: 1240, h: 360 }, 'One sentence: what will be true at the end of the sprint that is not true now?', 'yellow', { fill: 'yellow' }),
      {
        frames: [{ key: 'capacity', title: 'Capacity', x: 1304, y: 0, w: 696, h: 360 }],
        tables: [{ x: 1336, y: 64, colWidth: 210, cells: [['Person', 'Days available', 'Notes'], [], [], [], [], []] }],
      },
      area('candidates', 'Candidates', { x: 0, y: 424, w: 640, h: 720 }, 'Backlog items ready to pull in, highest priority first, each with an estimate.', 'blue', { look: 'lane' }),
      area('sprint', 'Sprint backlog', { x: 704, y: 424, w: 640, h: 720 }, 'What we commit to. Stop when the estimates fill our capacity.', 'green', { look: 'lane' }),
      area('risks', 'Risks and dependencies', { x: 1408, y: 424, w: 592, h: 720 }, 'What could stop us, and who outside the team do we need?', 'pink'),
    ),
  },
  {
    id: 'pi-planning',
    name: 'PI planning board',
    description: 'Each team’s features by iteration, with milestones, dependencies and risks sorted by ROAM.',
    category: 'plan',
    agenda: [
      { title: 'Vision and context', minutes: 20, frame: 'milestones' },
      { title: 'Team breakouts', minutes: 60, frame: 'lane0' },
      { title: 'Draft plan review', minutes: 30 },
      { title: 'Risks', minutes: 20, frame: 'roam0' },
      { title: 'Confidence vote', minutes: 5, activity: { kind: 'poll', question: 'How confident are you that we can meet these objectives?', pollKind: 'fist', options: [] } },
    ],
    layout: merge(
      { texts: ['Iteration 1', 'Iteration 2', 'Iteration 3', 'Iteration 4', 'Innovation and planning'].map((text, i) => ({ text, size: 'md' as const, x: i * 493 + 32, y: 0, w: 420 })) },
      area('milestones', 'Milestones and events', { x: 0, y: 64, w: 2464, h: 280 }, 'Releases, demos and dates that matter, under the iteration they fall in.', 'yellow', { fill: 'yellow', look: 'lane' }),
      ...['Team A', 'Team B', 'Team C'].map((team, i) =>
        area(`lane${i}`, team, { x: 0, y: 64 + (i + 1) * 312, w: 2464, h: 280 }, `One note per feature ${team} will deliver, under its iteration. Draw an arrow to anything it depends on.`, 'blue', { look: 'lane' }),
      ),
      shift(
        grid(
          4,
          { w: 568, h: 400 },
          [
            { title: 'Resolved', hint: 'No longer a risk: solved, or not real after all.', color: 'green' },
            { title: 'Owned', hint: 'Someone has taken it on and will report back.', color: 'blue' },
            { title: 'Accepted', hint: 'Nothing more we can do; we go ahead knowing.', color: 'gray' },
            { title: 'Mitigated', hint: 'We have a plan that makes it less likely or less bad.', color: 'purple' },
          ],
          'roam',
        ),
        0,
        1376,
      ),
    ),
  },
  {
    id: 'quarterly-roadmap',
    name: 'Quarterly roadmap',
    description: 'A year by quarter: firm near the front, looser further out, with the outcomes it aims for.',
    category: 'plan',
    layout: headed(
      'Vision: where is the product going this year?',
      merge(
        grid(4, { w: 496, h: 880 }, [
          { title: 'Q1', hint: 'Committed work and the outcome it is for.', color: 'green', look: 'band' },
          { title: 'Q2', hint: 'Likely work. Write the outcome, not just the feature.', color: 'blue', look: 'band' },
          { title: 'Q3', hint: 'Bets we expect to make. Less detail is fine.', color: 'purple', look: 'band' },
          { title: 'Q4', hint: 'Themes and big questions, not features.', color: 'gray', look: 'band' },
        ], 'q'),
        area('outcomes', 'Outcomes we are aiming for', { x: 0, y: 944, w: 2176, h: 320 }, 'How will we know the roadmap worked? One measurable outcome per note.', 'yellow', { fill: 'yellow' }),
      ),
    ),
  },
  {
    id: 'release-plan',
    name: 'Release plan',
    description: 'What goes in each release, what must be true before it ships, and what could make it slip.',
    category: 'plan',
    layout: merge(
      area('r1', 'Release 1: first usable version', { x: 0, y: 0, w: 560, h: 640 }, '**Date:** \nOne note per feature it must include.', 'green', { look: 'card' }),
      area('r2', 'Release 2', { x: 688, y: 0, w: 560, h: 640 }, '**Date:** \nWhat comes next, once people are using release 1.', 'blue', { look: 'card' }),
      area('r3', 'Release 3', { x: 1376, y: 0, w: 560, h: 640 }, '**Date:** \nLater features, still open to change.', 'purple', { look: 'card' }),
      area('out', 'Not planned', { x: 2064, y: 0, w: 496, h: 640 }, 'Asked for but not in any release yet, and why.', 'gray', { border: 'dashed' }),
      area('criteria', 'Ready to release when', { x: 0, y: 704, w: 1248, h: 360 }, 'What must be true before each release goes out: tests, docs, sign-off, support.', 'yellow'),
      area('risks', 'Risks to the dates', { x: 1312, y: 704, w: 1248, h: 360 }, 'What could make a release slip, and what we will do about it.', 'pink'),
      { arrows: chain(['r1', 'r2', 'r3']) },
    ),
  },
  {
    id: 'moscow',
    name: 'MoSCoW',
    description: 'Sort requirements into must have, should have, could have and won’t have this time.',
    category: 'plan',
    agenda: [
      { title: 'List requirements', minutes: 5, frame: 'sort', activity: { kind: 'writing', anonymous: false } },
      { title: 'Sort them', minutes: 15 },
      { title: 'Check the musts', minutes: 5, frame: 'm0', activity: { kind: 'poll', question: 'Is the must-have list small enough to deliver?', pollKind: 'choice', options: ['Yes', 'Nearly', 'No'] } },
    ],
    layout: merge(
      area('sort', 'To sort', { x: 0, y: 0, w: 496, h: 800 }, 'One requirement per note. Then drag each to where it belongs.', 'yellow', { look: 'lane' }),
      shift(
        grid(
          4,
          { w: 440, h: 800 },
          [
            { title: 'Must have', hint: 'Without these the release fails. Keep this list short.', color: 'pink', look: 'band' },
            { title: 'Should have', hint: 'Important, but we could ship without them for a while.', color: 'purple', look: 'band' },
            { title: 'Could have', hint: 'Nice to have, if there is time.', color: 'blue', look: 'band' },
            { title: "Won't have this time", hint: 'Agreed out of scope for now. Saying so stops scope creep.', color: 'gray', look: 'band' },
          ],
          'm',
        ),
        560,
        0,
      ),
    ),
  },
  {
    id: 'story-map',
    name: 'Story map',
    description: 'What a person does, step by step, left to right, with the detail sliced into releases.',
    category: 'plan',
    agenda: [
      { title: 'Activities', minutes: 10, frame: 'activities' },
      { title: 'Steps', minutes: 15, frame: 'steps' },
      { title: 'Details', minutes: 20, frame: 'r1' },
      { title: 'Slice into releases', minutes: 15, frame: 'r1' },
    ],
    layout: headed(
      'Persona: who is this map for?',
      merge(
        area('activities', 'Activities', { x: 0, y: 0, w: 2400, h: 256 }, 'The big things the person does, left to right in order. One note each.', 'blue', { fill: 'blue', look: 'lane' }),
        area('steps', 'Steps', { x: 0, y: 288, w: 2400, h: 256 }, 'Under each activity, the steps it takes.', 'green', { look: 'lane' }),
        area('r1', 'Release 1', { x: 0, y: 608, w: 2400, h: 400 }, 'Details under each step. Keep the smallest set that works end to end here.', 'yellow', { fill: 'green', look: 'lane' }),
        area('r2', 'Release 2', { x: 0, y: 1040, w: 2400, h: 400 }, 'What makes it better next.', 'yellow', { look: 'lane' }),
        area('later', 'Later', { x: 0, y: 1472, w: 2400, h: 400 }, 'Everything else. Move notes up as plans firm up.', 'gray', { fill: 'gray', look: 'lane' }),
      ),
    ),
  },
  {
    id: 'project-kickoff',
    name: 'Project kick-off',
    description: 'Why the project exists, what success looks like, its scope, team, dates and risks.',
    category: 'plan',
    agenda: [
      { title: 'Why', minutes: 5, frame: 'k0' },
      { title: 'Success', minutes: 10, frame: 'k1' },
      { title: 'Scope', minutes: 10, frame: 'k2' },
      { title: 'Team and roles', minutes: 5, frame: 'k4' },
      { title: 'Milestones', minutes: 10, frame: 'k5' },
      { title: 'Risks', minutes: 10, frame: 'k6', activity: { kind: 'writing', anonymous: true } },
      { title: 'How clear are we?', minutes: 2, activity: { kind: 'poll', question: 'How clear are you on what we are doing and why?', pollKind: 'fist', options: [] } },
    ],
    layout: headed(
      'Project kick-off',
      grid(
        4,
        { w: 440, h: 480 },
        [
          { title: 'Why', hint: 'Why are we doing this, and why now?', color: 'yellow', look: 'card' },
          { title: 'Success', hint: 'How will we know it worked? Measures and dates.', color: 'green', look: 'card' },
          { title: 'In scope', hint: 'What we will deliver.', color: 'blue', look: 'card' },
          { title: 'Out of scope', hint: 'What we will not do, said out loud.', color: 'gray', look: 'card' },
          { title: 'Team and roles', hint: 'Who is involved, and who decides what?', color: 'purple', look: 'card' },
          { title: 'Milestones', hint: 'The key dates, from now to done.', color: 'blue', look: 'card' },
          { title: 'Risks', hint: 'What worries us most at the start?', color: 'pink', look: 'card' },
          { title: 'Ways of working', hint: 'Meetings, channels, tools and how we share progress.', color: 'yellow', look: 'card' },
        ],
        'k',
      ),
    ),
  },
  {
    id: 'project-timeline',
    name: 'Project timeline',
    description: 'Tasks week by week in a timeline frame, shown as a Gantt chart once it has dates.',
    category: 'plan',
    layout: merge(
      { frames: [{ key: 'timeline', title: 'Project timeline', x: 0, y: 0, w: 2400, h: 720 }] },
      ...Array.from({ length: 8 }, (_, i) => ({ frames: [{ key: `week${i}`, title: `Week ${i + 1}`, x: 32 + i * 296, y: 48, w: 264, h: 640 }] })),
      { notes: [{ text: 'One note per task, in the week it starts. Put who owns it on the first line.', color: 'blue', x: 64, y: 96 }] },
      { views: [{ view: 'timeline', x: 0, y: 784 }] },
      { texts: [{ text: "Set the timeline frame's start date and how long each column lasts, and the timeline shows it as a Gantt chart.", size: 'sm', x: 0, y: 1320, w: 1040 }] },
      area('milestones', 'Milestones', { x: 1104, y: 784, w: 1296, h: 520 }, 'Key dates, and what must be done by each.', 'yellow', { fill: 'yellow' }),
    ),
  },
  {
    id: 'quarterly-goals',
    name: 'Quarterly goals',
    description: 'Three goals for the quarter, why they matter and how we will measure them, checked monthly.',
    category: 'plan',
    agenda: [
      { title: 'Propose goals', minutes: 10, activity: { kind: 'writing', anonymous: false } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Write the top three', minutes: 20, frame: 'goal0' },
      { title: 'What we will not do', minutes: 5, frame: 'not' },
      { title: 'Confidence', minutes: 2, activity: { kind: 'poll', question: 'How confident are you that we can meet these goals?', pollKind: 'fist', options: [] } },
    ],
    layout: headed(
      'Goals for the quarter',
      merge(
        ...[0, 1, 2].map((i) =>
          area(`goal${i}`, `Goal ${i + 1}`, { x: i * 624, y: 0, w: 560, h: 560 }, '**Goal:** \n**Why it matters:** \n**Measure:** \n**Owner:** ', 'yellow', { look: 'card' }),
        ),
        area('not', 'Not this quarter', { x: 1872, y: 0, w: 496, h: 560 }, 'Good ideas we are choosing not to do yet.', 'gray', { border: 'dashed' }),
        {
          texts: [{ text: 'Monthly check-in: on track, at risk or off track', size: 'md', x: 0, y: 624, w: 1200 }],
          tables: [{ x: 0, y: 680, colWidth: 300, cells: [['', 'Month 1', 'Month 2', 'Month 3'], ['Goal 1'], ['Goal 2'], ['Goal 3']] }],
        },
      ),
    ),
  },
  {
    id: 'eisenhower',
    name: 'Eisenhower matrix',
    description: 'Sort tasks by urgent and important: do, schedule, delegate or drop.',
    category: 'plan',
    layout: merge(
      area('tasks', 'Tasks to sort', { x: 0, y: 64, w: 496, h: 944 }, 'One task per note. Then drag each into the square that fits.', 'yellow', { look: 'lane' }),
      shift(
        quadrants({ across: ['Urgent', 'Not urgent'], down: ['Important', 'Not important'] }, [
          { title: 'Do first', hint: 'Important and urgent: do it today.', color: 'pink', fill: 'pink' },
          { title: 'Schedule', hint: 'Important, not urgent: put a date on it.', color: 'blue' },
          { title: 'Delegate', hint: 'Urgent, not important: who else can do it?', color: 'yellow' },
          { title: 'Drop', hint: 'Neither: stop doing it.', color: 'gray' },
        ]),
        560,
        0,
      ),
    ),
  },
];

const DISCOVER: BoardTemplate[] = [
  {
    id: 'persona',
    name: 'User persona',
    description: 'A portrait of a typical user: who they are, what they want, what gets in their way and what they need.',
    category: 'discover',
    layout: merge(
      area('who', 'Who they are', { x: 0, y: 0, w: 560, h: 880 }, 'Name, role, where they work, and one line that sums them up.', 'blue', { look: 'card' }),
      { shapes: [{ shape: 'ellipse', color: 'gray', label: 'Photo or sketch', x: 180, y: 280, w: 200, h: 200 }] },
      area('quote', 'In their words', { x: 0, y: 944, w: 560, h: 320 }, 'A real quote from research that captures them.', 'purple', { look: 'card' }),
      shift(
        grid(2, { w: 560, h: 600 }, [
          { title: 'Goals', hint: 'What are they trying to get done?', color: 'green' },
          { title: 'Frustrations', hint: 'What gets in their way today?', color: 'pink' },
          { title: 'Behaviours', hint: 'What do they do now: tools, habits, workarounds?', color: 'blue' },
          { title: 'Needs from us', hint: 'What would make their life easier?', color: 'yellow' },
        ]),
        624,
        0,
      ),
    ),
  },
  {
    id: 'interview-notes',
    name: 'User interview notes',
    description: 'Notes from one interview, sorted as you go: background, quotes, pains, goals, surprises and follow-ups.',
    category: 'discover',
    layout: headed(
      'Interview: who, when, and who asked',
      grid(
        3,
        { w: 560, h: 480 },
        [
          { title: 'Background', hint: 'Their role, their context and how they do this today.', color: 'blue', look: 'tab' },
          { title: 'Quotes', hint: 'Their exact words, in quotation marks.', color: 'purple', look: 'tab' },
          { title: 'Pains', hint: 'What frustrates them, and how much?', color: 'pink', look: 'tab' },
          { title: 'Goals', hint: 'What are they trying to achieve?', color: 'green', look: 'tab' },
          { title: 'Surprises', hint: 'What did we not expect to hear?', color: 'yellow', look: 'tab' },
          { title: 'Follow-ups', hint: 'Questions for next time, and people to talk to.', color: 'gray', look: 'tab' },
        ],
        'i',
      ),
    ),
  },
  {
    id: 'assumption-map',
    name: 'Assumption map',
    description: 'Place each assumption by how important it is and how much evidence there is, then test the riskiest.',
    category: 'discover',
    agenda: [
      { title: 'Write assumptions', minutes: 8, frame: 'list', activity: { kind: 'writing', anonymous: false } },
      { title: 'Place them', minutes: 10 },
      { title: 'Vote on the riskiest', minutes: 3, frame: 'q0', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Plan experiments', minutes: 10, frame: 'q0' },
    ],
    layout: merge(
      area('list', 'Assumptions', { x: 0, y: 64, w: 496, h: 944 }, 'One per note, starting "We believe that…". Cover the customer, the problem, the solution and the business.', 'yellow', { look: 'lane' }),
      shift(
        quadrants({ across: ['Little evidence', 'Strong evidence'], down: ['Important', 'Less important'] }, [
          { title: 'Test first', hint: 'Important, with little evidence: run an experiment on these next.', color: 'pink', fill: 'pink' },
          { title: 'Build on', hint: 'Important and well supported: go ahead.', color: 'green' },
          { title: 'Keep an eye on', hint: 'Less important, little evidence: revisit later.', color: 'purple' },
          { title: 'Park', hint: 'Less important and well known: no action needed.', color: 'gray' },
        ]),
        560,
        0,
      ),
    ),
  },
  {
    id: 'problem-statement',
    name: 'Problem statement',
    description: 'Who has the problem, what it is, when it happens and why it matters, written up as one sentence.',
    category: 'discover',
    agenda: [
      { title: 'Fill in each card', minutes: 15, activity: { kind: 'writing', anonymous: false } },
      { title: 'Draft the statement', minutes: 10, frame: 'statement' },
      { title: 'Agree', minutes: 2, frame: 'statement', activity: { kind: 'poll', question: 'Does this statement describe the problem we should solve?', pollKind: 'fist', options: [] } },
    ],
    layout: merge(
      grid(
        5,
        { w: 400, h: 440 },
        [
          { title: 'Who', hint: 'Who has the problem? Be specific.', color: 'blue', look: 'card' },
          { title: 'What', hint: 'What is the problem, in their words?', color: 'pink', look: 'card' },
          { title: 'When and where', hint: 'When does it happen, and how often?', color: 'purple', look: 'card' },
          { title: 'Why it matters', hint: 'What does it cost them, or us?', color: 'yellow', look: 'card' },
          { title: 'How we will know', hint: 'What would change if it were solved?', color: 'green', look: 'card' },
        ],
        'p',
      ),
      area('statement', 'Problem statement', { x: 0, y: 568, w: 2256, h: 360 }, '**Who:** needs a way to …\n**Because:** …\n**Solved when:** …', 'yellow', { fill: 'yellow' }),
      { arrows: [0, 1, 2, 3, 4].map((i) => ({ from: `p${i}`, to: 'statement', route: 'elbow' as const })) },
    ),
  },
  {
    id: 'jobs-to-be-done',
    name: 'Jobs to be done',
    description: 'The job someone hires a product to do: the situation, the motivation and the outcome they want.',
    category: 'discover',
    layout: merge(
      area('job', 'Job statement', { x: 0, y: 0, w: 1808, h: 280 }, '**When** I … (the situation)\n**I want to** … (the motivation)\n**So I can** … (the outcome)', 'yellow', { fill: 'yellow' }),
      shift(
        grid(3, { w: 560, h: 440 }, [
          { title: 'Functional', hint: 'The practical task they need done.', color: 'blue' },
          { title: 'Emotional', hint: 'How they want to feel, or not feel.', color: 'pink' },
          { title: 'Social', hint: 'How they want others to see them.', color: 'purple' },
        ], 'j'),
        0,
        344,
      ),
      shift(
        grid(2, { w: 872, h: 400 }, [
          { title: 'Hired today', hint: 'What they use now to get the job done, workarounds included.', color: 'gray' },
          { title: 'Why they would switch', hint: 'What pushes them away from that, and what pulls them to something new?', color: 'green' },
        ], 's'),
        0,
        848,
      ),
    ),
  },
  {
    id: 'emotion-journey',
    name: 'Customer journey with emotions',
    description: 'Each stage of a customer’s journey, with a line through how they feel at every step.',
    category: 'discover',
    agenda: [
      { title: 'Stages', minutes: 10, activity: { kind: 'writing', anonymous: false } },
      { title: 'How it feels', minutes: 10, frame: 'feel' },
      { title: 'Vote on the moments that matter', minutes: 3, frame: 'feel', activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Ideas', minutes: 10, frame: 'ideas' },
    ],
    layout: merge(
      grid(
        5,
        { w: 400, h: 520 },
        [
          { title: 'Aware', hint: 'How do they first hear of us? What are they doing at the time?', color: 'blue', look: 'band' },
          { title: 'Considering', hint: 'What do they compare, and who do they ask?', color: 'blue', look: 'band' },
          { title: 'Signing up', hint: 'Every step from deciding to being set up.', color: 'blue', look: 'band' },
          { title: 'Using', hint: 'What do they do day to day?', color: 'blue', look: 'band' },
          { title: 'Staying or leaving', hint: 'What makes them stay, recommend us or leave?', color: 'blue', look: 'band' },
        ],
        's',
      ),
      area('feel', 'How it feels', { x: 0, y: 584, w: 2256, h: 560 }, 'A note per stage: high for a good moment, low for a bad one. Then join them with arrows.', 'pink', { look: 'lane' }),
      {
        texts: [
          { text: 'Delighted', size: 'sm', x: 2288, y: 640, w: 160 },
          { text: 'Frustrated', size: 'sm', x: 2288, y: 1080, w: 160 },
        ],
      },
      area('moments', 'Moments that matter', { x: 0, y: 1208, w: 1096, h: 400 }, 'The highs to protect and the lows to fix first.', 'green'),
      area('ideas', 'Ideas', { x: 1160, y: 1208, w: 1096, h: 400 }, 'How might we fix each low point?', 'yellow'),
    ),
  },
  {
    id: 'service-blueprint',
    name: 'Service blueprint',
    description: 'What the customer does and sees, and everything behind the scenes that makes each step work.',
    category: 'discover',
    layout: headed(
      'Service: what is it, and where does it start and end?',
      merge(
        area('evidence', 'Evidence', { x: 0, y: 0, w: 2400, h: 280 }, 'What the customer sees at each step: emails, screens, receipts, signs.', 'gray', { look: 'lane' }),
        area('customer', 'Customer actions', { x: 0, y: 344, w: 2400, h: 280 }, 'Each step the customer takes, left to right.', 'yellow', { fill: 'yellow', look: 'lane' }),
        area('front', 'Frontstage', { x: 0, y: 688, w: 2400, h: 280 }, 'What staff or the product do that the customer sees.', 'blue', { look: 'lane' }),
        area('back', 'Backstage', { x: 0, y: 1032, w: 2400, h: 280 }, 'What staff do that the customer does not see.', 'purple', { look: 'lane', border: 'dashed' }),
        area('support', 'Support processes', { x: 0, y: 1376, w: 2400, h: 280 }, 'Systems, suppliers and teams that make it all work. Mark failure points with pink notes.', 'green', { look: 'lane', border: 'dashed' }),
        {
          texts: [
            { text: 'Line of interaction', size: 'sm', x: 0, y: 644, w: 600 },
            { text: 'Line of visibility', size: 'sm', x: 0, y: 988, w: 600 },
            { text: 'Line of internal interaction', size: 'sm', x: 0, y: 1332, w: 600 },
          ],
        },
      ),
    ),
  },
  {
    id: 'competitor-analysis',
    name: 'Competitor analysis',
    description: 'Us against the competition, side by side, and where we win and lose.',
    category: 'discover',
    layout: headed(
      'Competitor analysis',
      merge(
        {
          tables: [
            {
              x: 0,
              y: 0,
              colWidth: 240,
              cells: [
                ['', 'Us', 'Competitor A', 'Competitor B', 'Competitor C'],
                ['Who they serve'],
                ['Main offer'],
                ['Price'],
                ['Strengths'],
                ['Weaknesses'],
                ['How they win customers'],
              ],
            },
          ],
        },
        area('win', 'Where we win', { x: 0, y: 344, w: 560, h: 440 }, 'Where we beat every competitor, and why it will last.', 'green'),
        area('lose', 'Where we lose', { x: 624, y: 344, w: 560, h: 440 }, 'Where they are ahead, and whether our customers care.', 'pink'),
        area('next', 'What we do next', { x: 1248, y: 344, w: 560, h: 440 }, 'What to copy, what to ignore, and where to go further.', 'blue'),
      ),
    ),
  },
  {
    id: 'value-proposition-canvas',
    name: 'Value proposition canvas',
    description: 'What the customer needs set against what we offer, to check the two fit.',
    category: 'discover',
    layout: merge(
      {
        frames: [
          { title: 'Value map', x: 0, y: 0, w: 1040, h: 960, look: 'card' },
          { title: 'Customer profile', x: 1200, y: 0, w: 1040, h: 960, look: 'zone' },
        ],
      },
      area('products', 'Products and services', { x: 32, y: 64, w: 480, h: 864 }, 'What we offer: products, services, features.', 'blue'),
      area('creators', 'Gain creators', { x: 544, y: 64, w: 464, h: 416 }, 'How we create the gains the customer wants.', 'green'),
      area('relievers', 'Pain relievers', { x: 544, y: 512, w: 464, h: 416 }, "How we ease the customer's pains.", 'pink'),
      area('gains', 'Gains', { x: 1232, y: 64, w: 464, h: 416 }, 'The outcomes and benefits they want.', 'green'),
      area('pains', 'Pains', { x: 1232, y: 512, w: 464, h: 416 }, 'What annoys them, or stops them getting the job done.', 'pink'),
      area('jobs', 'Customer jobs', { x: 1728, y: 64, w: 480, h: 864 }, 'What they are trying to get done: tasks, problems, needs.', 'yellow'),
      {
        arrows: [
          { from: 'creators', to: 'gains', dash: 'dashed' },
          { from: 'relievers', to: 'pains', dash: 'dashed' },
        ],
      },
    ),
  },
  {
    id: 'opportunity-solution-tree',
    name: 'Opportunity solution tree',
    description: 'From an outcome to the customer opportunities behind it, the solutions for each, and how to test them.',
    category: 'discover',
    layout: merge(
      area('outcome', 'Outcome', { x: 656, y: 0, w: 560, h: 280 }, 'The one measurable outcome we are working towards.', 'yellow', { fill: 'yellow' }),
      ...[0, 1, 2].map((i) =>
        merge(
          area(`opp${i}`, `Opportunity ${i + 1}`, { x: i * 656, y: 408, w: 560, h: 360 }, 'A customer need, pain or wish we heard in research.', 'pink', { look: 'card' }),
          area(`sol${i}`, 'Solutions', { x: i * 656, y: 896, w: 560, h: 360 }, 'Ways we could meet this opportunity. Aim for several.', 'blue'),
          area(`exp${i}`, 'Experiments', { x: i * 656, y: 1384, w: 560, h: 360 }, 'The quickest test of each solution’s riskiest assumption.', 'green', { border: 'dashed' }),
          { arrows: [{ from: 'outcome', to: `opp${i}`, route: 'elbow' as const }, ...chain([`opp${i}`, `sol${i}`, `exp${i}`])] },
        ),
      ),
    ),
  },
];

const ANALYSE: BoardTemplate[] = [
  {
    id: 'pestle',
    name: 'PESTLE',
    description: 'The political, economic, social, technological, legal and environmental forces around us.',
    category: 'analyse',
    layout: merge(
      grid(3, { w: 560, h: 440 }, [
        { title: 'Political', hint: 'Government policy, elections, regulation on the way, trade.', color: 'blue' },
        { title: 'Economic', hint: 'Growth, inflation, interest rates, budgets, exchange rates.', color: 'green' },
        { title: 'Social', hint: 'Demographics, attitudes, and how people live and work.', color: 'yellow' },
        { title: 'Technological', hint: 'New technology, automation, what competitors can now do.', color: 'purple' },
        { title: 'Legal', hint: 'Laws and standards that apply: data, employment, safety, accessibility.', color: 'gray' },
        { title: 'Environmental', hint: 'Climate, sustainability targets, supply chains, weather.', color: 'green' },
      ]),
      area('sowhat', 'So what for us', { x: 0, y: 1008, w: 1808, h: 320 }, 'The few factors that matter most, and what we will do about each.', 'pink', { fill: 'green' }),
    ),
  },
  {
    id: 'five-forces',
    name: 'Porter’s five forces',
    description: 'How hard competition is in a market, from rivals, new entrants, substitutes, suppliers and buyers.',
    category: 'analyse',
    layout: merge(
      area('entrants', 'Threat of new entrants', { x: 600, y: 0, w: 520, h: 400 }, 'How easily could someone new start competing? What keeps them out?', 'blue'),
      area('suppliers', 'Power of suppliers', { x: 0, y: 464, w: 520, h: 400 }, 'How much can suppliers raise prices or set terms? How many are there?', 'purple'),
      area('rivalry', 'Competitive rivalry', { x: 600, y: 464, w: 520, h: 400 }, 'How many competitors, how alike are they, and how hard do they fight?', 'pink', { fill: 'pink' }),
      area('buyers', 'Power of buyers', { x: 1200, y: 464, w: 520, h: 400 }, 'How easily can customers push prices down or switch?', 'green'),
      area('substitutes', 'Threat of substitutes', { x: 600, y: 928, w: 520, h: 400 }, 'What else could customers use to solve the same problem?', 'yellow'),
      { arrows: ['entrants', 'suppliers', 'buyers', 'substitutes'].map((from) => ({ from, to: 'rivalry' })) },
    ),
  },
  {
    id: 'decision-matrix',
    name: 'Decision matrix',
    description: 'Score each option against weighted criteria, then decide.',
    category: 'analyse',
    agenda: [
      { title: 'Options', minutes: 5, frame: 'options', activity: { kind: 'writing', anonymous: false } },
      { title: 'Criteria and weights', minutes: 8, frame: 'criteria' },
      { title: 'Score', minutes: 15 },
      { title: 'Decide', minutes: 5, frame: 'decision' },
      { title: 'Check', minutes: 2, frame: 'decision', activity: { kind: 'poll', question: 'How comfortable are you with this decision?', pollKind: 'fist', options: [] } },
    ],
    layout: headed(
      'Decision: what are we choosing between?',
      merge(
        area('options', 'Options', { x: 0, y: 0, w: 560, h: 440 }, 'One note per option. Include doing nothing.', 'blue'),
        area('criteria', 'Criteria', { x: 624, y: 0, w: 560, h: 440 }, 'What matters in this decision? Give each a weight from 1 to 5.', 'purple'),
        area('decision', 'Decision', { x: 1248, y: 0, w: 560, h: 440 }, '**We chose:** \n**Because:** \n**Decided by:** ', 'green', { fill: 'green' }),
        {
          texts: [{ text: 'Score each option from 1 to 5 against each criterion, multiply by the weight, and add up the row.', size: 'sm', x: 0, y: 504, w: 1440 }],
          tables: [
            {
              x: 0,
              y: 560,
              colWidth: 240,
              cells: [
                ['Option', 'Criterion 1 (weight)', 'Criterion 2 (weight)', 'Criterion 3 (weight)', 'Criterion 4 (weight)', 'Weighted total'],
                ['Option A'],
                ['Option B'],
                ['Option C'],
                ['Option D'],
              ],
            },
          ],
        },
      ),
    ),
  },
  {
    id: 'pros-and-cons',
    name: 'Pros and cons',
    description: 'The case for and against a decision, what we don’t know yet, and the verdict.',
    category: 'analyse',
    layout: headed(
      'What are we deciding?',
      merge(
        area('pros', 'Pros', { x: 0, y: 0, w: 640, h: 600 }, 'Every reason in favour, one per note. Add 1 to 3 for how much it matters.', 'green', { fill: 'green' }),
        area('cons', 'Cons', { x: 704, y: 0, w: 640, h: 600 }, 'Every reason against, one per note. Add 1 to 3 for how much it matters.', 'pink', { fill: 'pink' }),
        area('unknowns', 'What we don’t know', { x: 1408, y: 0, w: 496, h: 600 }, 'Questions that could change the answer.', 'purple'),
        area('verdict', 'Verdict', { x: 0, y: 664, w: 1904, h: 320 }, '**Decision:** \n**Because:** \n**Unless:** ', 'yellow', { look: 'card' }),
      ),
    ),
  },
  {
    id: 'force-field',
    name: 'Force field analysis',
    description: 'The forces pushing for a change and those pushing against it, weighed up.',
    category: 'analyse',
    layout: headed(
      'Force field analysis',
      merge(
        area('driving', 'Driving forces', { x: 0, y: 0, w: 640, h: 880 }, 'What pushes towards the change? Score each from 1 (weak) to 5 (strong).', 'green', { fill: 'green' }),
        area('restraining', 'Restraining forces', { x: 1216, y: 0, w: 640, h: 880 }, 'What pushes against it? Score each from 1 (weak) to 5 (strong).', 'pink', { fill: 'pink' }),
        area('plan', 'What we will do', { x: 0, y: 944, w: 1856, h: 360 }, 'How we strengthen the strongest drivers and weaken the strongest restraints.', 'blue'),
        {
          shapes: [{ key: 'change', shape: 'rect', color: 'yellow', label: 'The change we want', x: 768, y: 280, w: 320, h: 320 }],
          arrows: [
            { from: 'driving', to: 'change', weight: 4 },
            { from: 'restraining', to: 'change', weight: 4 },
          ],
        },
      ),
    ),
  },
  {
    id: 'stakeholder-map',
    name: 'Stakeholder map',
    description: 'Everyone with a stake, placed by their power and interest, so you know how to work with each.',
    category: 'analyse',
    layout: merge(
      area('people', 'Stakeholders', { x: 0, y: 64, w: 496, h: 944 }, 'One person or group per note. Then place each by how much power and interest they have.', 'yellow', { look: 'lane' }),
      shift(
        quadrants({ across: ['Less interest', 'More interest'], down: ['More power', 'Less power'] }, [
          { title: 'Keep satisfied', hint: "More power, less interest: meet their needs without overloading them.", color: 'purple' },
          { title: 'Manage closely', hint: 'More power and interest: involve them in decisions and talk often.', color: 'pink', fill: 'pink' },
          { title: 'Monitor', hint: 'Less power and interest: check in now and then.', color: 'gray' },
          { title: 'Keep informed', hint: 'Less power, more interest: keep them up to date. They often spot problems first.', color: 'blue' },
        ]),
        560,
        0,
      ),
    ),
  },
  {
    id: 'cost-benefit',
    name: 'Cost-benefit analysis',
    description: 'What something costs against what it gives back, year by year, with a recommendation.',
    category: 'analyse',
    layout: headed(
      'Cost-benefit: what are we weighing up?',
      merge(
        area('costs', 'Costs', { x: 0, y: 0, w: 640, h: 560 }, 'Everything it costs: money, time, people, risk. Put a number on it where you can.', 'pink'),
        area('benefits', 'Benefits', { x: 704, y: 0, w: 640, h: 560 }, 'Everything it gives back: savings, revenue, time, risk reduced.', 'green'),
        area('intangibles', 'Hard to count', { x: 1408, y: 0, w: 496, h: 560 }, 'Costs and benefits without a number: morale, reputation, learning.', 'purple'),
        { tables: [{ x: 0, y: 624, colWidth: 240, cells: [['', 'Year 1', 'Year 2', 'Year 3', 'Total'], ['Costs'], ['Benefits'], ['Net benefit']] }] },
        area('call', 'Recommendation', { x: 1264, y: 624, w: 640, h: 360 }, 'Go or no-go, and how long until it pays for itself.', 'yellow', { fill: 'yellow' }),
      ),
    ),
  },
  {
    id: 'cause-tree',
    name: 'Cause tree',
    description: 'A problem broken down into its causes and their causes, to find the roots worth fixing.',
    category: 'analyse',
    layout: merge(
      { frames: [{ title: 'Cause tree', x: 0, y: 0, w: 1584, h: 784 }] },
      {
        notes: [
          { key: 'problem', text: '**Problem:** what went wrong?', color: 'pink', x: 692, y: 80 },
          ...[0, 1, 2].map((i) => ({ key: `cause${i}`, text: '**Cause:** why did it happen?', color: 'yellow' as const, x: 164 + i * 528, y: 336 })),
          ...[0, 1, 2, 3, 4, 5].map((j) => ({ key: `sub${j}`, text: '**Because:** …', color: 'yellow' as const, x: 32 + j * 264, y: 592 })),
        ],
        arrows: [
          ...[0, 1, 2].map((i) => ({ from: 'problem', to: `cause${i}`, route: 'elbow' as const })),
          ...[0, 1, 2, 3, 4, 5].map((j) => ({ from: `cause${Math.floor(j / 2)}`, to: `sub${j}`, route: 'elbow' as const })),
        ],
      },
      area('roots', 'Root causes to fix', { x: 1648, y: 0, w: 496, h: 784 }, 'The causes at the ends of the branches that we can act on. Vote, then add an owner.', 'green'),
    ),
  },
  {
    id: 'soar',
    name: 'SOAR',
    description: 'Strengths, opportunities, aspirations and results: a strategy look that builds on what works.',
    category: 'analyse',
    agenda: [
      { title: 'Strengths', minutes: 5, frame: 'g0', activity: { kind: 'writing', anonymous: false } },
      { title: 'Opportunities', minutes: 5, frame: 'g1', activity: { kind: 'writing', anonymous: false } },
      { title: 'Aspirations', minutes: 5, frame: 'g2', activity: { kind: 'writing', anonymous: false } },
      { title: 'Results', minutes: 5, frame: 'g3', activity: { kind: 'writing', anonymous: false } },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
    ],
    layout: headed(
      'SOAR: build on what works',
      grid(2, { w: 560, h: 440 }, [
        { title: 'Strengths', hint: 'What are we best at? What are we proud of?', color: 'green', look: 'card' },
        { title: 'Opportunities', hint: 'What could we do next that people want?', color: 'blue', look: 'card' },
        { title: 'Aspirations', hint: 'What do we want to be known for?', color: 'purple', look: 'card' },
        { title: 'Results', hint: 'How will we know we got there? Measures and targets.', color: 'yellow', look: 'card' },
      ]),
    ),
  },
];

const TEAM: BoardTemplate[] = [
  {
    id: 'lean-coffee',
    name: 'Lean coffee',
    description: 'A meeting with no set agenda: people bring topics, vote, and talk through them in order.',
    category: 'team',
    agenda: [
      { title: 'Propose topics', minutes: 5, frame: 'topics', activity: { kind: 'writing', anonymous: false } },
      { title: 'Vote', minutes: 3, frame: 'topics', activity: { kind: 'vote', votesEach: 2 } },
      { title: 'First topic', minutes: 8, frame: 'now' },
      { title: 'Keep going?', minutes: 1, frame: 'now', activity: { kind: 'poll', question: 'Keep going on this topic, or move on?', pollKind: 'choice', options: ['Keep going', 'Move on'] } },
      { title: 'Next topic', minutes: 8, frame: 'now' },
      { title: 'Keep going?', minutes: 1, frame: 'now', activity: { kind: 'poll', question: 'Keep going on this topic, or move on?', pollKind: 'choice', options: ['Keep going', 'Move on'] } },
      { title: 'Wrap up', minutes: 3, frame: 'actions' },
    ],
    layout: headed(
      'Lean coffee: the group sets the agenda',
      merge(
        area('topics', 'To discuss', { x: 0, y: 0, w: 560, h: 960 }, 'One topic per note. Vote with dots; the most dots go first.', 'yellow', { look: 'lane' }),
        area('now', 'Discussing', { x: 624, y: 0, w: 560, h: 960 }, 'One topic at a time. When the timer ends, vote to keep going or move on.', 'blue', { look: 'lane' }),
        area('done', 'Discussed', { x: 1248, y: 0, w: 560, h: 960 }, 'Finished topics. Add a note with any takeaway.', 'green', { look: 'lane' }),
        area('actions', 'Action items', { x: 1872, y: 0, w: 496, h: 960 }, 'Anything we agreed to do, with an owner.', 'pink'),
      ),
    ),
  },
  {
    id: 'working-agreements',
    name: 'Working agreements',
    description: 'Propose how the team works together, then keep the agreements everyone can live with.',
    category: 'team',
    agenda: [
      { title: 'Proposals', minutes: 8, frame: 'proposals', activity: { kind: 'writing', anonymous: true } },
      { title: 'Discuss', minutes: 15, frame: 'proposals' },
      { title: 'Vote', minutes: 3, frame: 'proposals', activity: { kind: 'vote', votesEach: 5 } },
      { title: 'Agree', minutes: 10, frame: 'agreed' },
      { title: 'Check', minutes: 2, frame: 'agreed', activity: { kind: 'poll', question: 'Can you live with these agreements?', pollKind: 'fist', options: [] } },
    ],
    layout: headed(
      'Working agreements',
      merge(
        area('proposals', 'Proposals', { x: 0, y: 0, w: 1040, h: 800 }, 'One per note, starting "We…". Think of meetings, messages, focus time, feedback, and what we do when things go wrong.', 'yellow', { look: 'zone' }),
        area('agreed', 'We agree', { x: 1104, y: 0, w: 640, h: 800 }, 'The proposals everyone can live with. Look at them again each quarter.', 'green', { fill: 'green', look: 'card' }),
        area('later', 'Revisit later', { x: 1808, y: 0, w: 496, h: 800 }, 'Not agreed yet: what would we need to decide?', 'gray', { border: 'dashed' }),
      ),
    ),
  },
  {
    id: 'skills-matrix',
    name: 'Skills matrix',
    description: 'Who knows what on the team, where the gaps are, and who could learn from whom.',
    category: 'team',
    layout: merge(
      {
        texts: [
          { text: 'Skills matrix', size: 'lg', x: 0, y: 0, w: 960 },
          { text: 'Score each skill: 0 none, 1 learning, 2 can do it, 3 can teach it.', size: 'sm', x: 0, y: 64, w: 1440 },
        ],
      },
      shift(
        merge(
          { tables: [{ x: 0, y: 0, colWidth: 180, cells: [['Person', 'Skill 1', 'Skill 2', 'Skill 3', 'Skill 4', 'Skill 5', 'Skill 6', 'Wants to learn'], [], [], [], [], [], [], [], []] }] },
          area('gaps', 'Gaps', { x: 0, y: 424, w: 688, h: 400 }, 'Skills where nobody scores 2 or more, or only one person does.', 'pink'),
          area('pairs', 'Who learns from whom', { x: 752, y: 424, w: 688, h: 400 }, 'Pair someone who scores 3 with someone who wants to learn. One pairing per note.', 'green'),
        ),
        0,
        128,
      ),
    ),
  },
  {
    id: 'one-to-one',
    name: 'One-to-one',
    description: 'A regular one-to-one: their topics first, then yours, feedback, growth and actions.',
    category: 'team',
    agenda: [
      { title: 'How are you?', minutes: 3 },
      { title: 'Their topics', minutes: 15, frame: 'o0' },
      { title: 'My topics', minutes: 10, frame: 'o1' },
      { title: 'Feedback', minutes: 5, frame: 'o2' },
      { title: 'Growth', minutes: 5, frame: 'o3' },
      { title: 'Actions', minutes: 2, frame: 'o5' },
    ],
    layout: grid(
      3,
      { w: 520, h: 480 },
      [
        { title: 'Their topics', hint: 'What do they want to talk about? They go first.', color: 'blue', look: 'tab' },
        { title: 'My topics', hint: 'What do I want to raise?', color: 'purple', look: 'tab' },
        { title: 'Feedback', hint: 'Both ways: one thing going well, one thing to change.', color: 'yellow', look: 'tab' },
        { title: 'Growth', hint: 'What are they learning, and what do they want to do next?', color: 'green', look: 'tab' },
        { title: 'Blockers', hint: 'What is in their way that I can help with?', color: 'pink', look: 'tab' },
        { title: 'Actions', hint: 'One per note: who does what, by when.', color: 'gray', look: 'tab' },
      ],
      'o',
    ),
  },
  {
    id: 'onboarding-plan',
    name: 'Onboarding plan',
    description: 'A new starter’s first ninety days, the people to meet and where to find things.',
    category: 'team',
    layout: headed(
      'Welcome: onboarding plan for …',
      merge(
        area('o0', 'Before day one', { x: 0, y: 0, w: 496, h: 560 }, 'Laptop, accounts, a buddy and a first-week calendar, ready before they arrive.', 'gray', { look: 'card' }),
        area('o1', 'First week', { x: 592, y: 0, w: 496, h: 560 }, 'Meet the team, get set up, and ship one small change.', 'blue', { look: 'card' }),
        area('o2', 'First 30 days', { x: 1184, y: 0, w: 496, h: 560 }, 'Learn the product and how we work. Pick up real work with the buddy.', 'green', { look: 'card' }),
        area('o3', 'Days 31–90', { x: 1776, y: 0, w: 496, h: 560 }, 'Own something end to end. Agree goals for the next quarter.', 'purple', { look: 'card' }),
        { arrows: chain(['o0', 'o1', 'o2', 'o3']) },
        {
          texts: [{ text: 'People to meet', size: 'md', x: 0, y: 624, w: 960 }],
          tables: [{ x: 0, y: 672, colWidth: 240, cells: [['Name', 'Role', 'Why meet them', 'Done'], [], [], [], [], []] }],
        },
        area('links', 'Where things are', { x: 1024, y: 624, w: 1248, h: 400 }, 'Handbook, code, dashboards, and who to ask about what.', 'yellow'),
      ),
    ),
  },
  {
    id: 'kudos-wall',
    name: 'Kudos wall',
    description: 'Thank people for specific things they did, and celebrate the team’s wins.',
    category: 'team',
    agenda: [
      { title: 'Write kudos', minutes: 5, frame: 'kudos', activity: { kind: 'writing', anonymous: false } },
      { title: 'Read them out', minutes: 10, frame: 'kudos' },
      { title: 'Team wins', minutes: 5, frame: 'wins' },
    ],
    layout: merge(
      {
        shapes: [
          { shape: 'star', color: 'yellow', x: 0, y: 0, w: 112, h: 112 },
          { shape: 'star', color: 'yellow', x: 1888, y: 0, w: 112, h: 112 },
        ],
        texts: [{ text: 'Kudos wall', size: 'xl', x: 144, y: 24, w: 600 }],
      },
      area('kudos', 'Thank you for…', { x: 0, y: 160, w: 1400, h: 880 }, 'Start with their name, then what they did and the difference it made.', 'yellow', { fill: 'yellow', look: 'zone' }),
      area('wins', 'Team wins', { x: 1464, y: 160, w: 536, h: 880 }, 'Things we did together that are worth celebrating.', 'green', { look: 'card' }),
    ),
  },
  {
    id: 'team-health-check',
    name: 'Team health check',
    description: 'A quick poll on six areas of team health, then a plan for the weakest.',
    category: 'team',
    agenda: [
      ...['Delivering value', 'Speed', 'Easy to release', 'Learning', 'Fun', 'Support'].map((topic, i) => ({
        title: topic,
        minutes: 2,
        frame: `h${i}`,
        activity: { kind: 'poll' as const, question: `${topic}: how are we doing?`, pollKind: 'choice' as const, options: ['Great', 'Some problems', 'Bad'] },
      })),
      { title: 'Talk about the lowest', minutes: 10 },
      { title: 'What we will improve', minutes: 8, frame: 'actions' },
    ],
    layout: merge(
      grid(
        3,
        { w: 560, h: 400 },
        [
          { title: 'Delivering value', hint: '**Great:** we ship things people want.\n**Bad:** we ship things nobody uses.', color: 'green' },
          { title: 'Speed', hint: '**Great:** we get things done quickly.\n**Bad:** we are always waiting or stuck.', color: 'blue' },
          { title: 'Easy to release', hint: '**Great:** releasing is simple and safe.\n**Bad:** it is painful and risky.', color: 'purple' },
          { title: 'Learning', hint: '**Great:** we learn something every week.\n**Bad:** there is never time to learn.', color: 'yellow' },
          { title: 'Fun', hint: '**Great:** we enjoy working together.\n**Bad:** it is a slog.', color: 'pink' },
          { title: 'Support', hint: '**Great:** we get help when we ask.\n**Bad:** we are on our own.', color: 'gray' },
        ],
        'h',
      ),
      area('actions', 'What we will improve', { x: 0, y: 928, w: 1808, h: 360 }, 'Pick the one or two lowest areas. What would make each one step better?', 'green', { fill: 'green' }),
    ),
  },
  {
    id: 'decision-log',
    name: 'Decision log',
    description: 'A running record of decisions: what, why, who decided and when to look again.',
    category: 'team',
    layout: headed(
      'Decision log',
      merge(
        { tables: [{ x: 0, y: 0, colWidth: 220, cells: [['Date', 'Decision', 'Why', 'Options considered', 'Decided by', 'Revisit by'], [], [], [], [], [], [], [], []] }] },
        area('pending', 'Waiting for a decision', { x: 1384, y: 0, w: 496, h: 600 }, 'One question per note, with who decides and by when.', 'purple'),
      ),
    ),
  },
  {
    id: 'weekly-check-in',
    name: 'Weekly check-in',
    description: 'A short weekly team meeting: how people are, last week’s wins, this week’s priorities and blockers.',
    category: 'team',
    agenda: [
      { title: 'How is everyone?', minutes: 2, activity: { kind: 'poll', question: 'How are you feeling about this week?', pollKind: 'fist', options: [] } },
      { title: 'Wins', minutes: 5, frame: 'w0', activity: { kind: 'writing', anonymous: false } },
      { title: 'This week', minutes: 5, frame: 'w1' },
      { title: 'Blockers', minutes: 8, frame: 'w2' },
      { title: 'Shout-outs', minutes: 3, frame: 'w3' },
    ],
    layout: headed(
      'Weekly check-in',
      grid(
        4,
        { w: 440, h: 600 },
        [
          { title: 'Wins', hint: 'Something that went well last week, big or small.', color: 'green', look: 'band' },
          { title: 'This week', hint: 'Your top one to three priorities.', color: 'blue', look: 'band' },
          { title: 'Blockers', hint: 'Anything in your way? Say who could help.', color: 'pink', look: 'band' },
          { title: 'Shout-outs', hint: 'Thank someone for their help.', color: 'yellow', look: 'band' },
        ],
        'w',
      ),
    ),
  },
  {
    id: 'post-mortem',
    name: 'Project post-mortem',
    description: 'A blameless look back at a finished project or incident: what happened, why, and what changes.',
    category: 'team',
    agenda: [
      { title: 'Timeline', minutes: 10, frame: 'timeline', activity: { kind: 'writing', anonymous: false } },
      { title: 'What went well', minutes: 5, frame: 'g0', activity: { kind: 'writing', anonymous: true } },
      { title: 'What went wrong', minutes: 8, frame: 'g1', activity: { kind: 'writing', anonymous: true } },
      { title: 'Where we got lucky', minutes: 5, frame: 'g2' },
      { title: 'Vote', minutes: 3, activity: { kind: 'vote', votesEach: 3 } },
      { title: 'Root causes', minutes: 15, frame: 'causes' },
      { title: 'Actions', minutes: 10, frame: 'actions' },
    ],
    layout: headed(
      'Post-mortem: what happened, and what we change. No blame.',
      merge(
        area('timeline', 'Timeline', { x: 0, y: 0, w: 2384, h: 400 }, 'What happened, in order, with dates. Facts only.', 'blue', { look: 'lane' }),
        shift(
          grid(3, { w: 752, h: 440 }, [
            { title: 'What went well', hint: 'What should we do again next time?', color: 'green' },
            { title: 'What went wrong', hint: 'What hurt? Describe what happened, not who.', color: 'pink' },
            { title: 'Where we got lucky', hint: 'What could have gone worse, and why didn’t it?', color: 'yellow' },
          ]),
          0,
          464,
        ),
        area('causes', 'Root causes', { x: 0, y: 968, w: 1160, h: 400 }, 'Why did the things that went wrong happen? Ask why until you reach something we can change.', 'purple'),
        {
          frames: [{ key: 'actions', title: 'Action items', x: 1224, y: 968, w: 1160, h: 400 }],
          tables: [{ x: 1256, y: 1032, colWidth: 270, cells: [['Action', 'Owner', 'Due'], [], [], [], []] }],
        },
      ),
    ),
  },
];

/** The wider library, after the first templates in templates.ts. */
export const LIBRARY_TEMPLATES: BoardTemplate[] = [...RETRO, ...IDEATE, ...PLAN, ...DISCOVER, ...ANALYSE, ...TEAM];
