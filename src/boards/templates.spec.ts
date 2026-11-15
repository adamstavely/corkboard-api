import * as Y from 'yjs';
import { framesOf, notesOf } from '../assist/board-edit';
import { nodeProblem } from '../collab/node-schema';
import { applyLayout, layoutProblem, type Layout } from './layout';
import { TEMPLATES, applyTemplate, previewOf } from './templates';

describe('board templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s lays out cleanly', (_, template) => {
    expect(layoutProblem(template.layout)).toBeNull();
    // What it writes is what a client would be allowed to write.
    const doc = new Y.Doc();
    const before = Y.encodeStateVector(doc);
    applyTemplate(doc, template);
    expect(nodeProblem(new Y.Doc(), Y.encodeStateAsUpdate(doc, before))).toBeNull();
    // Frames don't overlap one another unless one sits wholly inside the other.
    const frames = framesOf(doc);
    for (const a of frames)
      for (const b of frames) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const inside = (p: typeof a, q: typeof a) => p.x >= q.x && p.y >= q.y && p.x + p.w <= q.x + q.w && p.y + p.h <= q.y + q.h;
        if (overlap) expect(inside(a, b) || inside(b, a)).toBe(true);
      }
    expect(previewOf(template).length).toBe(frames.length);
  });

  it('keeps the old column templates: a frame per column with its hint inside', () => {
    const doc = new Y.Doc();
    applyTemplate(doc, TEMPLATES.find((t) => t.id === 'retro')!);
    expect(framesOf(doc).map((f) => f.title)).toEqual(['What went well', 'What could be better', 'Action items']);
    expect(notesOf(doc).map((n) => n.frame)).toEqual(['What went well', 'What could be better', 'Action items']);
  });

  it('places every kind of thing, with arrows between keys, at an origin', () => {
    const layout: Layout = {
      frames: [{ key: 'f', title: 'Goal', x: 0, y: 0, w: 400, h: 300, fill: 'blue', border: 'dashed' }],
      notes: [{ key: 'n', text: '**Why:** because', color: 'green', x: 32, y: 48 }],
      texts: [{ key: 't', text: 'Heading', size: 'xl', x: 500, y: 0 }],
      shapes: [{ key: 's', shape: 'diamond', label: 'Decide', x: 500, y: 100, w: 200, h: 160 }],
      tables: [{ x: 0, y: 400, cells: [['Task', 'R', 'A'], ['Ship', 'Ada']] }],
      views: [{ view: 'matrix', x: 800, y: 0 }],
      arrows: [{ from: 'n', to: 's', route: 'elbow' }],
    };
    expect(layoutProblem(layout)).toBeNull();
    const doc = new Y.Doc();
    const ids = applyLayout(doc, layout, { x: 1000, y: 2000 });
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const frame = nodes.get(ids.get('f')!)!;
    expect([frame.get('x'), frame.get('y'), frame.get('fill'), frame.get('border')]).toEqual([1000, 2000, 'blue', 'dashed']);
    expect(nodes.get(ids.get('t')!)!.get('size')).toBe('xl');
    const table = [...nodes.values()].find((n) => n.get('kind') === 'table')!;
    expect([table.get('rows'), table.get('cols'), (table.get('cells') as Y.Map<string>).get('1:1')]).toEqual([2, 3, 'Ada']);
    const arrow = [...nodes.values()].find((n) => n.get('kind') === 'connector')!;
    expect([arrow.get('from'), arrow.get('to'), arrow.get('route')]).toEqual([ids.get('n'), ids.get('s'), 'elbow']);
    // Frames go under everything else.
    const zs = [...nodes.values()].filter((n) => n.get('kind') !== 'connector').map((n) => [n.get('kind'), n.get('z') as number] as const);
    expect(Math.min(...zs.filter(([k]) => k !== 'frame').map(([, z]) => z))).toBeGreaterThan(frame.get('z') as number);
  });

  it('refuses layouts the board cannot show', () => {
    expect(layoutProblem({})).toMatch(/empty/);
    expect(layoutProblem({ notes: [{ text: 'x', color: 'teal' as never, x: 0, y: 0 }] })).toMatch(/colour/);
    expect(layoutProblem({ notes: [{ text: 'x', x: -5, y: 0 }] })).toMatch(/position/);
    expect(layoutProblem({ notes: [{ key: 'a', text: 'x', x: 0, y: 0 }], arrows: [{ from: 'a', to: 'b' }] })).toMatch(/arrow/);
    expect(layoutProblem({ notes: [{ key: 'a', text: 'x', x: 0, y: 0 }, { key: 'a', text: 'y', x: 0, y: 0 }] })).toMatch(/twice/);
    expect(layoutProblem({ notes: Array.from({ length: 201 }, () => ({ text: 'x', x: 0, y: 0 })) })).toMatch(/more than/);
  });
});
