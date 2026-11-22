import * as Y from 'yjs';
import { notesOf } from '../assist/board-edit';
import { agendaOf, pollCounts, pollOf, stepsRun, voteCounts, votingOf } from '../facilitation/facilitation-doc';
import { DECKS, pokerEstimatesMap, pokerOf } from '../facilitation/poker-doc';
import type { RecapResultDto } from './recap.dto';

/** The most notes a vote's result lists: the ones that came out on top. */
const MAX_VOTED = 10;

const label = (text: string, max = 80) => {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || 'A note with no text';
};

/**
 * What the session's activities came to, read straight from the board, so the recap's numbers are exact rather than a
 * model's retelling: the vote's tally, the poll's answers, the planning poker estimates once revealed, and the agenda
 * steps run. Only counts: never who voted, answered or estimated what, whatever mode the session ran in. Hidden
 * writing isn't here at all: its notes stay on the server until revealed onto the board, and once revealed they're
 * notes like any other.
 */
export function sessionResults(doc: Y.Doc): RecapResultDto[] {
  const results: RecapResultDto[] = [];
  const agenda = agendaOf(doc);
  const ran = stepsRun(doc);
  const run = ran.map((id) => agenda.steps.find((s) => s.id === id)).filter((s) => !!s);

  if (run.length) results.push({ kind: 'agenda', title: 'Steps run', items: run.map((s) => ({ label: s.title })) });

  const voting = votingOf(doc);
  const votes = voteCounts(doc);
  if (voting.round > 0 && votes.size) {
    const notes = new Map(notesOf(doc).map((n) => [n.id, n.text]));
    // Named for the agenda step that ran it, when one did.
    const step = [...run].reverse().find((s) => s.activity?.kind === 'vote');
    results.push({
      kind: 'vote',
      title: step?.title || 'Dot vote',
      ...(voting.open ? { open: true } : {}),
      items: [...votes]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_VOTED)
        .map(([id, count]) => ({ label: label(notes.get(id) ?? ''), count })),
    });
  }

  const poll = pollOf(doc);
  const answers = pollCounts(doc);
  if (poll && answers.size) {
    const choices = poll.kind === 'fist' ? [5, 4, 3, 2, 1, 0] : poll.options.map((_, i) => i);
    results.push({
      kind: 'poll',
      title: poll.question || 'Poll',
      ...(poll.open ? { open: true } : {}),
      items: choices
        .map((a) => ({ label: poll.kind === 'fist' ? `${a} finger${a === 1 ? '' : 's'}` : poll.options[a], count: answers.get(a) ?? 0 }))
        .filter((item) => poll.kind !== 'fist' || item.count > 0),
    });
  }

  // Estimates are on the board only once revealed; before that the server keeps them, and only who has estimated shows.
  const poker = pokerOf(doc);
  if (poker?.revealed) {
    const tally = new Map<string, number>();
    pokerEstimatesMap(doc).forEach((value) => value && tally.set(value, (tally.get(value) ?? 0) + 1));
    if (tally.size) {
      const order: readonly string[] = DECKS[poker.deck];
      results.push({
        kind: 'estimate',
        title: poker.title || 'Planning poker',
        items: [...tally].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([value, count]) => ({ label: value, count })),
      });
    }
  }
  return results;
}

/** One line for each result, as the chat and the prompt show it: "Vote: Which theme first? — Onboarding 7, Billing 4". */
export function resultLine(r: RecapResultDto): string {
  const kind = { agenda: 'Agenda', vote: 'Vote', poll: 'Poll', estimate: 'Estimate' }[r.kind];
  const items = r.items.map((i) => (i.count === undefined ? i.label : `${i.label} ${i.count}`)).join(', ');
  return `${kind}: ${r.title}${r.open ? ' (still open)' : ''} — ${items}`;
}
