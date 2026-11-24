import * as Y from 'yjs';
import { applyLayout, layoutProblem } from '../boards/layout';
import { layoutFlow, mainFlow, partsOf, placeSubprocesses } from './flowchart';
import { readStateSource, rewriteState, stateChecks, stateMermaid, statesOn, parseState } from './state';

const ORDER = `---
title: Order
---
stateDiagram-v2
  direction LR
  [*] --> Placed
  Placed --> Paid : payment received
  Placed --> Cancelled : customer cancels
  state paid_check <<choice>>
  Paid --> paid_check
  paid_check --> Shipped : [in stock]
  paid_check --> Backordered : [out of stock]
  Backordered --> Shipped : stock arrives
  Shipped --> [*]
  Cancelled --> [*]
`;

const place = (doc: Y.Doc, text: string) => {
  const { data } = readStateSource(text);
  const layout = layoutFlow(mainFlow(data), 'state');
  expect(layoutProblem(layout)).toBeNull();
  const id = applyLayout(doc, layout, { x: 0, y: 0 }, 'assistant').get('diagram')!;
  placeSubprocesses(doc, id, data);
  return id;
};

describe('state machines (API)', () => {
  it('draws one as an editable state machine and reads it back as stateDiagram-v2', () => {
    expect(readStateSource(ORDER).checks).toEqual([]);
    const doc = new Y.Doc();
    const id = place(doc, ORDER);
    expect(statesOn(doc)).toEqual([id]);
    const shapes = new Map(partsOf(doc, id).flatMap((p) => (p.part.role === 'step' ? [[p.part.key, p.node.get('shape')]] : [])));
    expect(shapes.get('Placed')).toBe('rounded');
    expect(shapes.get('paid_check')).toBe('diamond');
    const text = stateMermaid(doc, id)!;
    expect(text).toContain('stateDiagram-v2');
    expect(text).toContain('Placed --> Paid : payment received');
    expect(text).toContain('state paid_check <<choice>>');
  });

  it('places a composite state as a sub-process, and rewrites the machine in place', () => {
    const doc = new Y.Doc();
    const text = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n  state Busy {\n    [*] --> Working\n    Working --> [*]\n  }\n  Busy --> Idle : done';
    const id = place(doc, text);
    expect(statesOn(doc)).toHaveLength(2);
    expect(statesOn(doc, true)).toEqual([id]);
    expect(stateMermaid(doc, id)).toContain('state Busy {');
    rewriteState(doc, id, readStateSource(text.replace('Busy --> Idle : done', 'Busy --> Idle : done\n  Idle --> [*] : quit')).data);
    expect(stateMermaid(doc, id)).toContain('Idle --> [*] : quit');
  });

  it('says what to fix: no start, unreachable states, dead ends, unguarded choices, lone forks', () => {
    const parsed = parseState('stateDiagram-v2\n  A --> B\n  state c <<choice>>\n  B --> c\n  c --> A\n  state f <<fork>>\n  A --> f\n  f --> B\n  Lost');
    if ('error' in parsed) throw new Error(parsed.error);
    const checks = stateChecks(parsed.data);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('has no start'),
        expect.stringContaining('"Lost" has no way out'),
        expect.stringContaining('The choice "c" has 1 way out'),
        expect.stringContaining('with its guard'),
        expect.stringContaining('The fork "f" splits into 1'),
      ]),
    );
    const unreachable = parseState('stateDiagram-v2\n  [*] --> A\n  A --> [*]\n  B --> A');
    if ('error' in unreachable) throw new Error(unreachable.error);
    expect(stateChecks(unreachable.data)).toEqual(['"B" can\'t be reached from the start: add a transition into it, or remove it.']);
  });
});
