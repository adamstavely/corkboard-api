import * as Y from 'yjs';
import { boardText } from '../boards/board-text';
import { cleanSequence, isSequenceSource, placeSequence, readSequenceSource, rewriteSequence, sequenceChecks, sequenceMermaid, sequenceOf, sequencesOn, sequenceSize } from './sequence';

const CHECKOUT = `---
title: Checkout
---
sequenceDiagram
  actor customer as Customer
  participant shop as Shop
  participant pay as Payment
  customer->>shop: Place order
  shop->>pay: Charge card
  alt card approved
    pay-->>shop: Approved
    shop-->>customer: Order confirmed
  else card declined
    pay-->>shop: Declined
    shop-->>customer: Order failed
  end
`;

describe('editable sequence diagrams (API)', () => {
  it('reads Mermaid into the model the board keeps, with nothing to fix', () => {
    expect(isSequenceSource(CHECKOUT)).toBe(true);
    expect(isSequenceSource('flowchart LR\n a-->b')).toBe(false);
    const { model, checks } = readSequenceSource(CHECKOUT);
    expect(checks).toEqual([]);
    expect(model.title).toBe('Checkout');
    expect(model.participants.map((p) => p.id)).toEqual(['customer', 'shop', 'pay']);
    expect(model.messages).toHaveLength(6);
    expect(model.fragments).toEqual([{ id: 'f1', kind: 'alt', label: 'card approved', from: 'm3', to: 'm6', branches: [{ at: 'm5', label: 'card declined' }] }]);
  });

  it('refuses a diagram with no participants or no messages', () => {
    expect(() => readSequenceSource('sequenceDiagram\n')).toThrow(/no participants/);
    expect(() => readSequenceSource('sequenceDiagram\n  participant a as A\n')).toThrow(/no messages/);
  });

  it('places it beside the board sized by the engine, rewrites it in place, and lists it as Mermaid', () => {
    const doc = new Y.Doc();
    const { model } = readSequenceSource(CHECKOUT);
    const id = placeSequence(doc, model);
    expect(sequencesOn(doc)).toEqual([id]);
    const node = doc.getMap<Y.Map<unknown>>('nodes').get(id)!;
    expect(node.get('kind')).toBe('sequence');
    expect({ w: node.get('w'), h: node.get('h') }).toEqual(sequenceSize(model));
    expect(sequenceOf(doc, id)).toEqual(model);
    // Read back as the same diagram.
    expect(readSequenceSource(sequenceMermaid(doc, id)!).model).toEqual(model);
    const x = node.get('x');
    const bigger = readSequenceSource(
      CHECKOUT.replace('  participant pay as Payment', '  participant pay as Payment\n  participant bank as Bank').replace(
        '  shop->>pay: Charge card',
        '  shop->>pay: Charge card\n  pay->>bank: Authorise\n  bank-->>pay: Authorised',
      ),
    ).model;
    expect(rewriteSequence(doc, id, bigger)).toBe(true);
    expect(sequenceOf(doc, id)!.participants).toHaveLength(4);
    expect(node.get('w')).toBeGreaterThan(sequenceSize(model).w);
    expect(node.get('x')).toBe(x);
    expect(rewriteSequence(doc, 'nope', bigger)).toBe(false);
    // Search finds its words.
    expect(boardText(doc).find((t) => t.id === id)?.text).toContain('Payment → Bank: Authorise');
  });

  it('checks the size budget, nesting, loose participants and empty labels', () => {
    const many = cleanSequence({
      participants: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      messages: Array.from({ length: 18 }, (_, i) => ({ id: `m${i}`, from: 'p0', to: `p${(i % 6) + 1}`, label: i === 3 ? '' : `Step ${i}` })),
      fragments: [
        { id: 'f1', kind: 'loop', label: 'a', from: 'm0', to: 'm10' },
        { id: 'f2', kind: 'opt', label: 'b', from: 'm1', to: 'm9' },
        { id: 'f3', kind: 'alt', label: 'c', from: 'm2', to: 'm8' },
        { id: 'f4', kind: 'break', label: 'd', from: 'm3', to: 'm7' },
      ],
    });
    const checks = sequenceChecks(many);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('8 participants'),
        expect.stringContaining('18 messages'),
        expect.stringContaining('"P7" sends and receives nothing'),
        expect.stringContaining('has no label'),
        expect.stringContaining('Frames nest 4 deep'),
      ]),
    );
  });
});
