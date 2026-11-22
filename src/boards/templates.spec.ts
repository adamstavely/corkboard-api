import * as Y from 'yjs';
import { framesOf, notesOf } from '../assist/board-edit';
import { agendaOf } from '../facilitation/facilitation-doc';
import { nodeProblem } from '../collab/node-schema';
import { applyLayout, layoutProblem, type Layout } from './layout';
import { TEMPLATES, TEMPLATE_CATEGORIES, applyTemplate, previewOf } from './templates';

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
    // An agenda's frames are in the layout.
    const keys = new Set((template.layout.frames ?? []).map((f) => f.key));
    for (const step of template.agenda ?? []) if (step.frame) expect(keys.has(step.frame)).toBe(true);
  });

  it('has a unique id for each template and at least ten in every category', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const category of TEMPLATE_CATEGORIES) expect(TEMPLATES.filter((t) => t.category === category).length).toBeGreaterThanOrEqual(10);
  });

  it('gives each template a name, a one-sentence description and agenda steps that run', () => {
    for (const t of TEMPLATES) {
      expect(t.name.trim()).not.toBe('');
      expect(t.description).toMatch(/^[^.]+\.$/);
      for (const step of t.agenda ?? []) {
        expect(step.minutes).toBeGreaterThan(0);
        const a = step.activity;
        if (a?.kind === 'vote') expect(a.votesEach).toBeGreaterThan(0);
        if (a?.kind === 'poll') {
          expect(a.question.trim()).not.toBe('');
          expect(a.options.length).toBe(a.pollKind === 'choice' ? Math.max(2, a.options.length) : 0);
        }
      }
    }
  });

  it('keeps the old column templates: a frame per column with its hint inside', () => {
    const doc = new Y.Doc();
    applyTemplate(doc, TEMPLATES.find((t) => t.id === 'retro')!);
    expect(framesOf(doc).map((f) => f.title)).toEqual(['What went well', 'What could be better', 'Action items']);
    expect(notesOf(doc).map((n) => n.frame)).toEqual(['What went well', 'What could be better', 'Action items']);
    // Its agenda points at its frames.
    const agenda = agendaOf(doc);
    expect(agenda.current).toBeNull();
    expect(agenda.steps.map((st) => st.title)).toEqual(['Check in', 'What went well', 'What could be better', 'Vote', 'Actions']);
    expect(agenda.steps[1].frameId).toBe(framesOf(doc)[0].id);
  });

  it('places every kind of thing, with arrows between keys, at an origin', () => {
    const layout: Layout = {
      frames: [
        { key: 'f', title: 'Goal', x: 0, y: 0, w: 400, h: 300, fill: 'blue', border: 'dashed' },
        { key: 'p', title: 'Home page', x: 0, y: 1000, w: 640, h: 300, look: 'slide' },
      ],
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
    const slide = nodes.get(ids.get('p')!)!;
    expect([frame.get('look'), slide.get('look'), slide.get('w'), slide.get('h')]).toEqual([undefined, 'slide', 640, 360]);
    expect(nodes.get(ids.get('t')!)!.get('size')).toBe('xl');
    const table = [...nodes.values()].find((n) => n.get('kind') === 'table')!;
    expect([table.get('rows'), table.get('cols'), (table.get('cells') as Y.Map<string>).get('1:1')]).toEqual([2, 3, 'Ada']);
    const arrow = [...nodes.values()].find((n) => n.get('kind') === 'connector')!;
    expect([arrow.get('from'), arrow.get('to'), arrow.get('route')]).toEqual([ids.get('n'), ids.get('s'), 'elbow']);
    // Frames go under everything else.
    const zs = [...nodes.values()].filter((n) => n.get('kind') !== 'connector').map((n) => [n.get('kind'), n.get('z') as number] as const);
    expect(Math.min(...zs.filter(([k]) => k !== 'frame').map(([, z]) => z))).toBeGreaterThan(frame.get('z') as number);
  });

  it('lays see-through shapes under the notes, and solid ones on top', () => {
    const layout: Layout = {
      notes: [{ key: 'n', text: 'In both', x: 300, y: 100 }],
      shapes: [
        { key: 'a', shape: 'ellipse', fill: 'tint', color: 'blue', x: 0, y: 0, w: 500, h: 500 },
        { key: 'b', shape: 'star', x: 600, y: 0, w: 100, h: 100 },
      ],
    };
    expect(layoutProblem(layout)).toBeNull();
    const doc = new Y.Doc();
    const ids = applyLayout(doc, layout, { x: 0, y: 0 });
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const [tint, note, solid] = ['a', 'n', 'b'].map((k) => nodes.get(ids.get(k)!)!);
    expect([tint.get('fill'), solid.get('fill')]).toEqual(['tint', undefined]);
    expect(tint.get('z') as number).toBeLessThan(note.get('z') as number);
    expect(solid.get('z') as number).toBeGreaterThan(note.get('z') as number);
    expect(layoutProblem({ shapes: [{ shape: 'ellipse', fill: 'glass' as never, x: 0, y: 0, w: 10, h: 10 }] })).toMatch(/shape/);
  });

  it('draws its Venn diagrams as overlapping see-through circles', () => {
    for (const id of ['venn-two', 'venn-three', 'desirable-feasible-viable', 'ikigai']) {
      const shapes = TEMPLATES.find((t) => t.id === id)!.layout.shapes ?? [];
      expect(shapes.length).toBeGreaterThanOrEqual(2);
      expect(shapes.every((s) => s.shape === 'ellipse' && s.fill === 'tint')).toBe(true);
      const [a, b] = shapes;
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(true);
    }
  });

  it('refuses layouts the board cannot show', () => {
    expect(layoutProblem({})).toMatch(/empty/);
    expect(layoutProblem({ notes: [{ text: 'x', color: 'teal' as never, x: 0, y: 0 }] })).toMatch(/colour/);
    expect(layoutProblem({ notes: [{ text: 'x', x: -5, y: 0 }] })).toMatch(/position/);
    expect(layoutProblem({ frames: [{ title: 'x', x: 0, y: 0, w: 400, h: 300, look: 'polaroid' as never }] })).toMatch(/frame style/);
    expect(layoutProblem({ notes: [{ key: 'a', text: 'x', x: 0, y: 0 }], arrows: [{ from: 'a', to: 'b' }] })).toMatch(/arrow/);
    expect(layoutProblem({ notes: [{ key: 'a', text: 'x', x: 0, y: 0 }, { key: 'a', text: 'y', x: 0, y: 0 }] })).toMatch(/twice/);
    expect(layoutProblem({ notes: Array.from({ length: 201 }, () => ({ text: 'x', x: 0, y: 0 })) })).toMatch(/more than/);
  });
});
