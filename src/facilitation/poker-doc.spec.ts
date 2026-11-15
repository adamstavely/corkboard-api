import * as Y from 'yjs';
import { clearPoker, markEstimated, pokerEstimatesMap, pokerOf, revealPoker, startPoker } from './poker-doc';

describe('planning poker on the board', () => {
  const round = { round: 'r1', deck: 'fibonacci' as const, taskId: null, noteId: null, title: 'Search', startedBy: 'Ada' };

  it('keeps who has estimated, not what, until the reveal', () => {
    const doc = new Y.Doc();
    expect(pokerOf(doc)).toBeNull();
    startPoker(doc, round);
    expect(markEstimated(doc, 'r1', 'u1')).toBeNull();
    expect(markEstimated(doc, 'r0', 'u2')).toBe('That round of planning poker has ended');
    expect(pokerEstimatesMap(doc).toJSON()).toEqual({ u1: '' });

    // Someone marked as the round was revealed, whose estimate wasn't read, is dropped rather than shown blank.
    markEstimated(doc, 'r1', 'u3');
    revealPoker(doc, new Map([['u1', '5']]));
    expect(pokerOf(doc)?.revealed).toBe(true);
    expect(pokerEstimatesMap(doc).toJSON()).toEqual({ u1: '5' });
    expect(markEstimated(doc, 'r1', 'u2')).toBe('The estimates have been revealed');
  });

  it('starts each round afresh, and clears away', () => {
    const doc = new Y.Doc();
    startPoker(doc, round);
    markEstimated(doc, 'r1', 'u1');
    startPoker(doc, { ...round, round: 'r2', deck: 'tshirt' });
    expect(pokerOf(doc)).toMatchObject({ round: 'r2', deck: 'tshirt', revealed: false });
    expect(pokerEstimatesMap(doc).size).toBe(0);
    clearPoker(doc);
    expect(pokerOf(doc)).toBeNull();
  });
});
