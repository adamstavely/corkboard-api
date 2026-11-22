import * as Y from 'yjs';
import { addNotes } from '../assist/board-edit';
import { answerPoll, castVote, endPoll, setAgenda, setAgendaStep, setVoting, startPoll } from '../facilitation/facilitation-doc';
import { markEstimated, revealPoker, startPoker } from '../facilitation/poker-doc';
import { resultLine, sessionResults } from './recap-results';

describe("a session's results", () => {
  it('has none on a board where nothing was run', () => {
    expect(sessionResults(new Y.Doc())).toEqual([]);
  });

  it('counts the vote, the poll, revealed estimates and the steps run, never who gave which', () => {
    const doc = new Y.Doc();
    const [onboarding, billing] = addNotes(doc, [
      { text: 'Onboarding\nwith more detail', color: 'yellow' },
      { text: 'Billing', color: 'green' },
    ]);
    setAgenda(doc, [
      { id: 'a', title: 'Ideas', seconds: 0, frameId: null },
      { id: 'b', title: 'Which theme first?', seconds: 0, frameId: null, activity: { kind: 'vote', votesEach: 3 } },
      { id: 'c', title: 'Wrap up', seconds: 0, frameId: null },
    ]);
    setAgendaStep(doc, 0);
    setAgendaStep(doc, 1);
    setVoting(doc, true, 3);
    castVote(doc, 'ada', onboarding, true);
    castVote(doc, 'ada', onboarding, true);
    castVote(doc, 'bob', billing, true);
    castVote(doc, 'cy', onboarding, true);
    setVoting(doc, false, 3);
    startPoll(doc, 'Ready to ship?', 'fist', []);
    answerPoll(doc, 'ada', 5);
    answerPoll(doc, 'bob', 3);
    answerPoll(doc, 'cy', 5);
    endPoll(doc, false);
    startPoker(doc, { round: 'r1', deck: 'fibonacci', taskId: null, noteId: null, title: 'Search', startedBy: 'Ada' });
    markEstimated(doc, 'r1', 'ada');
    revealPoker(doc, new Map([['ada', '8'], ['bob', '3'], ['cy', '8']]));
    setAgendaStep(doc, null);

    const results = sessionResults(doc);
    expect(results).toEqual([
      { kind: 'agenda', title: 'Steps run', items: [{ label: 'Ideas' }, { label: 'Which theme first?' }] },
      { kind: 'vote', title: 'Which theme first?', items: [{ label: 'Onboarding', count: 3 }, { label: 'Billing', count: 1 }] },
      { kind: 'poll', title: 'Ready to ship?', items: [{ label: '5 fingers', count: 2 }, { label: '3 fingers', count: 1 }] },
      { kind: 'estimate', title: 'Search', items: [{ label: '3', count: 1 }, { label: '8', count: 2 }] },
    ]);
    expect(resultLine(results[1])).toBe('Vote: Which theme first? — Onboarding 3, Billing 1');
    expect(JSON.stringify(results)).not.toMatch(/ada|bob|cy/);
  });

  it('leaves out estimates not yet revealed, and says when a poll is still open', () => {
    const doc = new Y.Doc();
    startPoker(doc, { round: 'r1', deck: 'tshirt', taskId: null, noteId: null, title: 'Search', startedBy: 'Ada' });
    markEstimated(doc, 'r1', 'ada');
    startPoll(doc, 'Lunch?', 'choice', ['Pizza', 'Salad']);
    answerPoll(doc, 'ada', 1);
    expect(sessionResults(doc)).toEqual([{ kind: 'poll', title: 'Lunch?', open: true, items: [{ label: 'Pizza', count: 0 }, { label: 'Salad', count: 1 }] }]);
    expect(resultLine(sessionResults(doc)[0])).toBe('Poll: Lunch? (still open) — Pizza 0, Salad 1');
  });
});
