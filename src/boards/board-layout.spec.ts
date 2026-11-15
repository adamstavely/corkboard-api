import * as Y from 'yjs';
import { setAgenda } from '../facilitation/facilitation-doc';
import { layoutFromBoard } from './board-layout';
import { applyLayout, layoutProblem, type Layout } from './layout';

describe('a board as a template', () => {
  const layout: Layout = {
    frames: [
      { key: 'a', title: 'Went well', x: 0, y: 0, w: 400, h: 300, fill: 'green', look: 'card' },
      { key: 'b', title: 'To improve', x: 480, y: 0, w: 400, h: 300 },
    ],
    notes: [{ key: 'n', text: 'One thing per note', color: 'blue', x: 20, y: 60 }],
    texts: [{ text: 'Retro', size: 'lg', x: 0, y: 340 }],
    shapes: [{ key: 's', shape: 'star', color: 'yellow', label: 'Goal', x: 960, y: 0, w: 160, h: 160 }],
    tables: [{ x: 0, y: 420, cells: [['Owner', 'Due'], ['Ada', 'Friday']] }],
    arrows: [{ from: 'a', to: 's', route: 'curve' }],
  };

  it('keeps its structure and notes, moved to the origin, with its agenda naming frames by key', () => {
    const doc = new Y.Doc();
    const ids = applyLayout(doc, layout, { x: 500, y: 700 });
    setAgenda(doc, [{ id: 'x', title: 'Write', seconds: 300, frameId: ids.get('a')!, activity: { kind: 'writing', anonymous: true } }]);
    const { layout: saved, agenda, things } = layoutFromBoard(doc, true);
    expect(layoutProblem(saved)).toBeNull();
    expect(things).toBe(7);
    expect(saved.frames?.map((f) => [f.title, f.x, f.y, f.fill ?? null, f.look ?? null]).sort()).toEqual([
      ['To improve', 480, 0, null, null],
      ['Went well', 0, 0, 'green', 'card'],
    ].sort());
    expect(saved.notes?.[0]).toMatchObject({ text: 'One thing per note', color: 'blue' });
    expect(saved.shapes?.[0]).toMatchObject({ shape: 'star', label: 'Goal', x: 960, y: 0 });
    expect(saved.tables?.[0].cells).toEqual([['Owner', 'Due'], ['Ada', 'Friday']]);
    expect(saved.arrows).toHaveLength(1);
    const went = saved.frames!.find((f) => f.title === 'Went well')!;
    expect(agenda).toEqual([{ title: 'Write', minutes: 5, frame: went.key, activity: { kind: 'writing', anonymous: true } }]);
  });

  it('leaves the notes out, and all but the header row of tables, when asked', () => {
    const doc = new Y.Doc();
    applyLayout(doc, layout, { x: 0, y: 0 });
    const { layout: saved } = layoutFromBoard(doc, false);
    expect(saved.notes).toBeUndefined();
    expect(saved.tables?.[0].cells).toEqual([['Owner', 'Due'], ['', '']]);
  });

  it('has nothing to keep on an empty board', () => {
    expect(layoutFromBoard(new Y.Doc(), true).things).toBe(0);
  });
});
