import * as Y from 'yjs';
import { applyLayout, layoutProblem } from '../boards/layout';
import { c4Checks, c4Json, c4sOn, isC4Source, layoutC4, parseC4, readC4, readC4Source, rewriteC4, type C4Data } from './c4';

const MODEL = {
  diagramType: 'c4',
  title: 'Shop landscape',
  colorKey: { '1': 'People' },
  groups: [
    { id: 'shop', name: 'Shop', kind: 'boundary' },
    { id: 'platform', name: 'Order Platform', kind: 'system', parent: 'shop', collapsed: false },
  ],
  elements: [
    { id: 'customer', kind: 'person', name: 'Customer', description: 'Buys things', color: '1' },
    { id: 'web', kind: 'container', name: 'Web App', tech: 'React', group: 'platform' },
    { id: 'db', kind: 'database', name: 'Orders', tech: 'PostgreSQL', group: 'platform' },
    { id: 'pay', kind: 'external', name: 'Payments' },
  ],
  relations: [
    { from: 'customer', to: 'web', label: 'Orders', tech: 'HTTPS' },
    { from: 'web', to: 'db', label: 'Stores orders', tech: 'SQL' },
    { from: 'web', to: 'pay', label: 'Charges cards', tech: 'REST' },
  ],
};
const data = (m: object = MODEL): C4Data => {
  const parsed = parseC4(JSON.stringify(m));
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.data;
};

describe('editable C4 diagrams (API)', () => {
  it('places a model as tagged board things and reads the same model back', () => {
    expect(isC4Source(JSON.stringify(MODEL))).toBe(true);
    expect(isC4Source('C4Context\n  Person(a, "A")')).toBe(true);
    expect(isC4Source('flowchart\n a-->b')).toBe(false);
    const layout = layoutC4(data());
    expect(layoutProblem(layout)).toBeNull();
    const doc = new Y.Doc();
    const id = applyLayout(doc, layout, { x: 0, y: 0 }, 'assistant').get('diagram')!;
    expect(c4sOn(doc)).toEqual([id]);
    const back = readC4(doc, id)!;
    expect(back.elements.find((e) => e.id === 'web')).toMatchObject({ kind: 'container', name: 'Web App', tech: 'React', group: 'platform' });
    expect(back.elements.find((e) => e.id === 'customer')).toMatchObject({ kind: 'person', description: 'Buys things', color: '1' });
    expect(back.relations).toContainEqual({ from: 'web', to: 'db', label: 'Stores orders', tech: 'SQL' });
    expect(back.groups.find((g) => g.id === 'platform')).toMatchObject({ kind: 'system', parent: 'shop', collapsed: false });
    expect(back.colorKey).toEqual({ '1': 'People' });
    expect(JSON.parse(c4Json(doc, id)!).diagramType).toBe('c4');
  });

  it('rewrites in place, keeping what keeps its id, and closes a system to one box', () => {
    const doc = new Y.Doc();
    const id = applyLayout(doc, layoutC4(data()), { x: 0, y: 0 }, 'assistant').get('diagram')!;
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const idOf = (key: string) => [...nodes.entries()].find(([, n]) => (n.get('part') as { key?: string } | undefined)?.key === key)?.[0];
    const web = idOf('web');
    const next = JSON.parse(JSON.stringify(MODEL)) as typeof MODEL;
    next.groups[1].collapsed = true;
    next.elements[1].name = 'Storefront';
    rewriteC4(doc, id, data(next));
    expect(idOf('web')).toBe(web);
    expect(nodes.get(web!)!.get('label')).toBe('Storefront\n[Container: React]');
    expect((nodes.get(web!)!.get('part') as { extra?: { hidden?: boolean } }).extra?.hidden).toBe(true);
    expect(readC4(doc, id)!.groups.find((g) => g.id === 'platform')?.collapsed).toBe(true);
  });

  it('finds what the skill would warn about', () => {
    expect(c4Checks(data())).toEqual([]);
    const checks = readC4Source(
      JSON.stringify({
        diagramType: 'c4',
        groups: [
          { id: 'a', name: 'A', kind: 'container' },
          { id: 'sys', name: 'Sys', kind: 'system' },
        ],
        elements: [
          { id: 'x', kind: 'container', name: 'X', group: 'sys' },
          { id: 'y', kind: 'container', name: 'Y', group: 'sys' },
          { id: 'z', kind: 'external', name: 'Z', group: 'sys' },
          { id: 'lonely', kind: 'system', name: 'Lonely' },
          { id: 'sys', kind: 'system', name: 'Again' },
        ],
        relations: [
          { from: 'x', to: 'y', label: 'Talks to it about many many many many things' },
          { from: 'x', to: 'a', label: 'Uses' },
          { from: 'z', to: 'x', label: '' },
        ],
      }),
    ).checks.join('\n');
    expect(checks).toMatch(/"sys" is used twice/);
    expect(checks).toMatch(/The container "a" opens to components, so it sits in a system group/);
    expect(checks).toMatch(/External "z" is inside the system "sys"/);
    expect(checks).toMatch(/"lonely" has no relation/);
    expect(checks).toMatch(/no tech/);
    expect(checks).toMatch(/over 40 characters/);
    expect(checks).toMatch(/isn't an element/);
    expect(checks).toMatch(/has no label/);
  });

  it('takes all four levels: containers opened to components, components to their code, each where it belongs', () => {
    const model = {
      diagramType: 'c4',
      groups: [
        { id: 'platform', name: 'Platform', kind: 'system', collapsed: false },
        { id: 'api', name: 'API', kind: 'container', parent: 'platform', collapsed: false },
        { id: 'ordering', name: 'Ordering', kind: 'component', parent: 'api', collapsed: false },
      ],
      elements: [
        { id: 'web', kind: 'container', name: 'Web App', tech: 'React', group: 'platform' },
        { id: 'ctl', kind: 'component', name: 'Orders Controller', tech: 'REST', group: 'api' },
        { id: 'svc', kind: 'code', name: 'OrderService', tech: 'class', description: '+place(cart): Order', group: 'ordering' },
      ],
      relations: [
        { from: 'web', to: 'ctl', label: 'Calls', tech: 'JSON/HTTPS' },
        { from: 'ctl', to: 'svc', label: 'Places orders' },
      ],
    };
    expect(readC4Source(JSON.stringify(model)).checks).toEqual([]);
    const misplaced = readC4Source(
      JSON.stringify({
        ...model,
        elements: [
          ...model.elements.slice(0, 1),
          { id: 'ctl', kind: 'component', name: 'Orders Controller', group: 'platform' },
          { id: 'svc', kind: 'code', name: 'OrderService', tech: 'thing', group: 'api' },
        ],
      }),
    ).checks.join('\n');
    expect(misplaced).toMatch(/component "ctl" belongs in a container group/);
    expect(misplaced).toMatch(/code "svc" belongs in a component group/);
    expect(misplaced).toMatch(/code "svc" says what it is/);
    // Placed on the board, every level reads back, members a line each.
    const doc = new Y.Doc();
    const layout = layoutC4(readC4Source(JSON.stringify(model)).data);
    const id = applyLayout(doc, layout, { x: 0, y: 0 }, 'assistant').get('diagram')!;
    const back = readC4(doc, id)!;
    expect(back.groups.map((g) => g.kind)).toEqual(expect.arrayContaining(['system', 'container', 'component']));
    expect(back.elements.find((e) => e.id === 'svc')).toMatchObject({ kind: 'code', tech: 'class', description: '+place(cart): Order', group: 'ordering' });
  });
});
