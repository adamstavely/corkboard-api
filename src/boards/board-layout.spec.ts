import * as Y from 'yjs';
import { setAgenda } from '../facilitation/facilitation-doc';
import { layoutFromBoard } from './board-layout';
import { applyLayout, layoutProblem, type Layout } from './layout';
import { richOf } from './rich-text';

describe('a board as a template', () => {
  const layout: Layout = {
    frames: [
      { key: 'a', title: 'Went well', x: 0, y: 0, w: 400, h: 300, fill: 'green', look: 'card' },
      { key: 'b', title: 'To improve', x: 480, y: 0, w: 400, h: 300 },
    ],
    notes: [{ key: 'n', text: 'One thing per note', color: 'blue', x: 20, y: 60 }],
    texts: [{ text: 'Retro', size: 'lg', x: 0, y: 340 }],
    shapes: [
      { key: 's', shape: 'star', color: 'yellow', label: 'Goal', x: 960, y: 0, w: 160, h: 160 },
      { key: 'v', shape: 'ellipse', color: 'blue', fill: 'tint', label: '', x: 1200, y: 0, w: 300, h: 300 },
    ],
    tables: [{ x: 0, y: 420, cells: [['Owner', 'Due'], ['Ada', 'Friday']] }],
    arrows: [{ from: 'a', to: 's', route: 'curve', start: 'one', end: 'zeroMany', label: 'holds' }],
  };

  it('keeps its structure and notes, moved to the origin, with its agenda naming frames by key', () => {
    const doc = new Y.Doc();
    const ids = applyLayout(doc, layout, { x: 500, y: 700 });
    setAgenda(doc, [{ id: 'x', title: 'Write', seconds: 300, frameId: ids.get('a')!, activity: { kind: 'writing', anonymous: true } }]);
    const { layout: saved, agenda, things } = layoutFromBoard(doc, true);
    expect(layoutProblem(saved)).toBeNull();
    expect(things).toBe(8);
    expect(saved.frames?.map((f) => [f.title, f.x, f.y, f.fill ?? null, f.look ?? null]).sort()).toEqual([
      ['To improve', 480, 0, null, null],
      ['Went well', 0, 0, 'green', 'card'],
    ].sort());
    expect(saved.notes?.[0]).toMatchObject({ text: 'One thing per note', color: 'blue' });
    expect(saved.shapes?.find((x) => x.shape === 'star')).toMatchObject({ label: 'Goal', x: 960, y: 0 });
    expect(saved.shapes?.find((x) => x.shape === 'ellipse')).toMatchObject({ fill: 'tint', x: 1200 });
    expect(saved.shapes?.find((x) => x.shape === 'star')?.fill).toBeUndefined();
    expect(saved.tables?.[0].cells).toEqual([['Owner', 'Due'], ['Ada', 'Friday']]);
    expect(saved.arrows).toEqual([expect.objectContaining({ route: 'curve', start: 'one', end: 'zeroMany', label: 'holds' })]);
    const went = saved.frames!.find((f) => f.title === 'Went well')!;
    expect(agenda).toEqual([{ title: 'Write', minutes: 5, frame: went.key, activity: { kind: 'writing', anonymous: true } }]);
  });

  it('keeps a note as written (lists, code, maths, bold) and its size, and agenda times to the second', () => {
    const doc = new Y.Doc();
    const ids = applyLayout(doc, { notes: [{ key: 'n', text: 'x', x: 0, y: 0 }] }, { x: 0, y: 0 });
    const node = doc.getMap<Y.Map<unknown>>('nodes').get(ids.get('n')!)!;
    node.set('w', 320);
    node.set('h', 240);
    const fragment = node.get('text') as Y.XmlFragment;
    fragment.delete(0, fragment.length);
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    const p = new Y.XmlElement('paragraph');
    const run = new Y.XmlText();
    run.insert(0, 'Ship', { bold: {} });
    p.insert(0, [run]);
    item.insert(0, [p]);
    list.insert(0, [item]);
    const math = new Y.XmlElement('mathBlock');
    math.setAttribute('latex', 'E=mc^2');
    const code = new Y.XmlElement('codeBlock');
    const src = new Y.XmlText();
    src.insert(0, 'npm test');
    code.insert(0, [src]);
    fragment.insert(0, [list, math, code]);
    setAgenda(doc, [{ id: 'x', title: 'Check in', seconds: 20, frameId: null, activity: null }]);

    const { layout: saved, agenda } = layoutFromBoard(doc, true);
    expect(layoutProblem(saved)).toBeNull();
    expect(agenda[0].minutes * 60).toBeCloseTo(20);
    const copy = new Y.Doc();
    const again = applyLayout(copy, saved, { x: 0, y: 0 });
    const made = copy.getMap<Y.Map<unknown>>('nodes').get([...again.values()][0])!;
    expect([made.get('w'), made.get('h')]).toEqual([320, 240]);
    expect(richOf(made.get('text') as Y.XmlFragment)).toEqual(richOf(fragment));
  });

  it('refuses rich text the board has no use for', () => {
    expect(layoutProblem({ notes: [{ text: '', rich: [{ n: 'script', c: [] }], x: 0, y: 0 }] })).toMatch(/rich text/);
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
