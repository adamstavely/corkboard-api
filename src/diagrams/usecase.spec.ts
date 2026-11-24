import * as Y from 'yjs';
import { applyLayout, layoutProblem } from '../boards/layout';
import { isUsecaseSource, layoutUsecase, parseUsecase, readUsecase, readUsecaseSource, rewriteUsecase, usecaseChecks, usecaseMermaid, usecasesOn, type UcData } from './usecase';

const SHOP = `---
title: Online shop
---
%% @type usecase
%% @colorKey 1 Ordering
%% @colorKey 2 Payments
flowchart LR
  customer["Customer"]
  member["Registered customer"]
  psp["Payment gateway"]:::system
  subgraph shop["Storefront"]
    browse(["FR-1: Browse catalogue"]):::c1
    checkout(["FR-4: Check out"]):::c1
    voucher(["FR-6: Apply voucher"]):::c1
    pay(["FR-7: Take payment"]):::c2
  end
  class pay subfunction
  member -->|is a| customer
  customer --- browse
  member --- checkout
  checkout -.->|«include»| pay
  voucher -.->|"«extend» (Payment): customer has a code"| checkout
  pay --- psp
  n1>"Guest checkout allowed up to 200 EUR (BR-3)"] -.- checkout
  %% @points checkout Payment
`;

const data = (text = SHOP): UcData => {
  const parsed = parseUsecase(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.data;
};

describe('editable use case diagrams (API)', () => {
  it('places one as tagged board things and reads it back as the same Mermaid', () => {
    expect(isUsecaseSource(SHOP)).toBe(true);
    expect(isUsecaseSource('flowchart\n a --> b')).toBe(false);
    const layout = layoutUsecase(data());
    expect(layoutProblem(layout)).toBeNull();
    const doc = new Y.Doc();
    const id = applyLayout(doc, layout, { x: 0, y: 0 }, 'assistant').get('diagram')!;
    expect(usecasesOn(doc)).toEqual([id]);
    const read = readUsecase(doc, id)!;
    expect(read.colorKey).toEqual({ '1': 'Ordering', '2': 'Payments' });
    expect(read.actors.find((a) => a.id === 'psp')).toMatchObject({ kind: 'system', name: 'Payment gateway' });
    expect(read.links.find((l) => l.type === 'extend')).toMatchObject({ condition: 'customer has a code', extensionPoint: 'Payment' });
    const text = usecaseMermaid(doc, id)!;
    expect(text).toContain('voucher -.->|"«extend» (Payment): customer has a code"| checkout');
    expect(data(text).useCases.map((u) => u.id).sort()).toEqual(['browse', 'checkout', 'pay', 'voucher']);
  });

  it('rewrites in place, keeping the things whose ids stay', () => {
    const doc = new Y.Doc();
    const id = applyLayout(doc, layoutUsecase(data()), { x: 0, y: 0 }, 'assistant').get('diagram')!;
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const idOf = (key: string) => [...nodes.entries()].find(([, n]) => (n.get('part') as { key?: string } | undefined)?.key === key)?.[0];
    const browse = idOf('browse');
    rewriteUsecase(doc, id, data(SHOP.replace('FR-1: Browse catalogue', 'FR-1: Search catalogue')));
    expect(idOf('browse')).toBe(browse);
    expect(nodes.get(browse!)?.get('label')).toBe('FR-1: Search catalogue');
  });

  it('finds what the skill would warn about', () => {
    expect(usecaseChecks(data())).toEqual([]);
    const messy = readUsecaseSource(`%% @type usecase
flowchart LR
  boss["The Head Of The Whole Department"]
  clerk["Clerk"]
  subgraph s["System"]
    create(["Create Order"])
    view(["View Order"])
    edit(["Edit Order"])
    lonely(["Do Something With All Of The Things Today"]):::c3
    a(["Alpha"])
    b(["Beta"])
  end
  clerk --- create
  clerk --- view
  clerk --- edit
  clerk --- a
  a -.->|«include»| b
  b -.->|«include»| a
  boss --- clerk
`).checks.join('\n');
    expect(messy).toMatch(/joins two actors/);
    expect(messy).toMatch(/has 6 words \(at most 3\)/);
    expect(messy).toMatch(/isn't reached by any actor/);
    expect(messy).toMatch(/has 8 words \(at most 5\)/);
    expect(messy).toMatch(/colour key doesn't name/);
    expect(messy).toMatch(/Manage order/);
    expect(messy).toMatch(/runs in a circle/);
  });
});
