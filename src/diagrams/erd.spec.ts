import * as Y from 'yjs';
import { applyLayout, layoutProblem } from '../boards/layout';
import { erdChecks, erdMermaid, erdsOn, isErdSource, layoutErd, parseErd, readErd, readErdSource, rewriteErd, type ErData } from './erd';

const SHOP = `erDiagram
  customer {
    uuid id PK
    text email UK
  }
  order {
    uuid id PK
    uuid customer_id FK
  }
  customer ||..o{ order : "places"
`;
const data = (text = SHOP): ErData => {
  const parsed = parseErd(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.data;
};

describe('editable ER diagrams (API)', () => {
  it('places tables and relationships, and reads the same Mermaid back', () => {
    expect(isErdSource(SHOP)).toBe(true);
    const layout = layoutErd(data());
    expect(layoutProblem(layout)).toBeNull();
    const doc = new Y.Doc();
    const id = applyLayout(doc, layout, { x: 0, y: 0 }, 'assistant').get('diagram')!;
    expect(erdsOn(doc)).toEqual([id]);
    const nodes = [...doc.getMap<Y.Map<unknown>>('nodes').values()];
    const order = nodes.find((n) => n.get('kind') === 'entity' && n.get('name') === 'order')!;
    expect(order.get('columns')).toEqual([{ name: 'id', type: 'uuid', pk: true }, { name: 'customer_id', type: 'uuid', fk: true }]);
    const back = readErd(doc, id)!;
    expect(back.relationships).toEqual([{ from: 'order', to: 'customer', fromEnd: 'zeroOrMany', toEnd: 'one', identifying: false, label: 'places', columns: ['customer_id'] }]);
    expect(erdMermaid(doc, id)).toMatch(/customer \|\|\.\.o\{ order : "places"/);
    // Rewritten with a new column: the same table.
    const before = [...doc.getMap<Y.Map<unknown>>('nodes').entries()].find(([, n]) => n.get('name') === 'order')![0];
    rewriteErd(doc, id, data(SHOP.replace('    uuid customer_id FK\n', '    uuid customer_id FK\n    timestamptz placed_at\n')));
    const after = doc.getMap<Y.Map<unknown>>('nodes').get(before)!;
    expect((after.get('columns') as unknown[]).length).toBe(3);
  });

  it('finds what the skill would warn about', () => {
    expect(erdChecks(data())).toEqual([]);
    const checks = readErdSource(`erDiagram
  person {
    text name
    text name
    uuid team_id FK
    uuid manager_id FK
  }
  person ||..o{ person : "manages"
`).checks.join('\n');
    expect(checks).toMatch(/has the column "name" twice/);
    expect(checks).toMatch(/has no primary key/);
    expect(checks).toMatch(/team_id" is marked FK but no relationship uses it/);
  });
});
