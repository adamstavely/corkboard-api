import * as Y from 'yjs';
import { agendaOf, castVote, setAgenda, setAgendaStep, setTimer, setVoting, timerOf, voteCounts, votingOf } from './facilitation-doc';

describe('dot voting', () => {
  it('gives each person their votes, lets them take one back, and starts each round empty', () => {
    const doc = new Y.Doc();
    expect(castVote(doc, 'ada', 'n1', true)).toBe('Voting is closed');

    setVoting(doc, true, 2);
    expect(votingOf(doc)).toEqual({ open: true, votesEach: 2, round: 1 });
    expect(castVote(doc, 'ada', 'n1', true)).toBeNull();
    expect(castVote(doc, 'ada', 'n1', true)).toBeNull();
    expect(castVote(doc, 'ada', 'n2', true)).toBe("You've used all 2 of your votes");
    expect(castVote(doc, 'grace', 'n1', true)).toBeNull();
    expect(castVote(doc, 'ada', 'n2', false)).toBe("You haven't voted for that note");
    expect(castVote(doc, 'ada', 'n1', false)).toBeNull();
    expect(voteCounts(doc)).toEqual(new Map([['n1', 2]]));

    setVoting(doc, false, 2);
    expect(voteCounts(doc).get('n1')).toBe(2);
    expect(castVote(doc, 'ada', 'n1', true)).toBe('Voting is closed');

    setVoting(doc, true, 5);
    expect(votingOf(doc).round).toBe(2);
    expect(voteCounts(doc).size).toBe(0);
  });
});

describe('the shared timer', () => {
  it('runs until a time, and stops', () => {
    const doc = new Y.Doc();
    setTimer(doc, 300, 'Add notes', 'Ada', 1000);
    expect(timerOf(doc)).toEqual({ endsAt: 301_000, seconds: 300, label: 'Add notes', by: 'Ada' });
    setTimer(doc, null, '', 'Ada', 2000);
    expect(timerOf(doc).endsAt).toBeNull();
  });
});

describe('the agenda', () => {
  const step = (id: string, title: string) => ({ id, title, seconds: 300, frameId: null });

  it('keeps its place by step when edited while it runs, and forgets a place that is gone', () => {
    const doc = new Y.Doc();
    expect(agendaOf(doc)).toEqual({ steps: [], current: null });
    setAgenda(doc, [step('a', 'Ideas'), step('b', 'Vote')]);
    setAgendaStep(doc, 1);
    setAgenda(doc, [step('c', 'Check in'), step('a', 'Ideas'), step('b', 'Vote')]);
    expect(agendaOf(doc).current).toBe(2);
    setAgenda(doc, [step('a', 'Ideas')]);
    expect(agendaOf(doc).current).toBeNull();
  });
});
