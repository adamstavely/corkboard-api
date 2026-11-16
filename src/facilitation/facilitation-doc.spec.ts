import * as Y from 'yjs';
import { agendaOf, answerPoll, endPoll, pollCounts, pollOf, startPoll, castVote, setAgenda, setAgendaStep, setTimer, setVoting, timerOf, voteCounts, votingOf } from './facilitation-doc';

/** A board with these notes on it. */
function withNotes(...ids: string[]): Y.Doc {
  const doc = new Y.Doc();
  for (const id of ids) {
    const note = new Y.Map<unknown>();
    doc.getMap('nodes').set(id, note);
    note.set('kind', 'note');
  }
  return doc;
}

describe('dot voting', () => {
  it('gives back votes on a note that was deleted, and leaves them out of the count', () => {
    const doc = withNotes('n1', 'n2');
    setVoting(doc, true, 2);
    castVote(doc, 'ada', 'n1', true);
    castVote(doc, 'ada', 'n1', true);
    doc.getMap('nodes').delete('n1');
    expect(voteCounts(doc).size).toBe(0);
    expect(castVote(doc, 'ada', 'n2', true)).toBeNull();
    expect(castVote(doc, 'ada', 'n2', true)).toBeNull();
    expect(voteCounts(doc)).toEqual(new Map([['n2', 2]]));
  });

  it('gives each person their votes, lets them take one back, and starts each round empty', () => {
    const doc = withNotes('n1', 'n2');
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

describe('polls', () => {
  it('takes one answer each, in range, while open; keeps the result when closed; clears away', () => {
    const doc = new Y.Doc();
    expect(pollOf(doc)).toBeNull();
    expect(answerPoll(doc, 'ada', 0)).toBe('No poll is open');
    startPoll(doc, 'Lunch?', 'choice', ['Pizza', 'Salad']);
    expect(answerPoll(doc, 'ada', 0)).toBeNull();
    expect(answerPoll(doc, 'ada', 1)).toBeNull();
    expect(answerPoll(doc, 'bob', 1)).toBeNull();
    expect(answerPoll(doc, 'cy', 2)).toBe('That is not one of the answers');
    expect([...pollCounts(doc)]).toEqual([[1, 2]]);
    endPoll(doc, false);
    expect(pollOf(doc)).toMatchObject({ open: false, question: 'Lunch?', round: 1 });
    expect(pollCounts(doc).get(1)).toBe(2);

    startPoll(doc, 'Ready to ship?', 'fist', ['ignored']);
    expect(pollOf(doc)).toMatchObject({ open: true, kind: 'fist', options: [], round: 2 });
    expect(pollCounts(doc).size).toBe(0);
    expect(answerPoll(doc, 'ada', 5)).toBeNull();
    expect(answerPoll(doc, 'ada', 6)).toBe('That is not one of the answers');
    endPoll(doc, true);
    expect(pollOf(doc)).toBeNull();
    expect(pollCounts(doc).size).toBe(0);
  });
});
