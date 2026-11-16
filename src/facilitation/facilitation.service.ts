import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { framesOf, inFrame, NOTE_SIZE, notesOf } from '../assist/board-edit';
import { breakoutsOf, groupOf, moveTo, setBreakouts, spread } from './breakouts-doc';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { randomUUID } from 'node:crypto';
import { agendaOf, answerPoll, setPrivacy, castVote, endPoll, pollOf, startPoll, facilitatorOf, setAgenda, setAgendaStep, setFacilitator, setTimer, setVoting, spotlight, votingOf, type StepActivity } from './facilitation-doc';
import { WritingService } from './writing.service';
import { ActivityService } from '../activity/activity.service';

const DEFAULT_VOTES = 3;

/**
 * Dot voting, the shared timer and breakouts. Updaters and owners run them; commenters and up vote and join a
 * breakout group.
 */
@Injectable()
export class FacilitationService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
    private readonly writing: WritingService,
  ) {}

  /** `ifIdle`: start a vote only when none is running, rather than start a new round over the votes cast so far. */
  async setVoting(user: User, boardId: string, open: boolean, votesEach = DEFAULT_VOTES, { ifIdle = false } = {}): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      if (!open && !votingOf(doc).open) throw new ConflictException('No vote is running');
      if (open && ifIdle && votingOf(doc).open) throw new ConflictException('A vote is already running');
      setVoting(doc, open, votesEach);
    });
    await this.activity.record(boardId, user, open ? 'started a vote' : 'finished the vote', undefined, open ? `${votesEach} votes each` : undefined);
  }

  async vote(user: User, boardId: string, noteId: string, add: boolean): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    await this.#edit(user, boardId, (doc) => {
      const note = notesOf(doc).find((n) => n.id === noteId);
      if (add && !note) throw new BadRequestException('That note is not on the board');
      // In breakouts, people vote within their own group's frame.
      const group = groupOf(breakoutsOf(doc), user.id);
      const frame = group && framesOf(doc).find((f) => f.id === group.frameId);
      if (add && frame && !inFrame({ ...note!, ...NOTE_SIZE }, frame)) throw new ConflictException("In breakouts, vote on notes in your group's frame");
      const problem = castVote(doc, user.id, noteId, add);
      if (problem) throw new ConflictException(problem);
    });
  }

  async setTimer(user: User, boardId: string, seconds: number | null, label = ''): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => setTimer(doc, seconds, label.trim(), user.name));
    await this.activity.record(boardId, user, seconds === null ? 'stopped the timer' : 'started the timer', label.trim() || undefined, seconds === null ? undefined : `${Math.round(seconds / 60)} min`);
  }

  /**
   * Splits everyone with the board open across these frames, a group to each, each with its own timer when `minutes`
   * is given. Starting again reshuffles.
   */
  async startBreakouts(user: User, boardId: string, frameIds: string[], minutes?: number): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const ids = [...new Set(frameIds)];
    const people = this.collab.peopleOn(boardId);
    const endsAt = minutes ? Date.now() + minutes * 60_000 : null;
    await this.#edit(user, boardId, (doc) => {
      const frames = new Set(framesOf(doc).map((f) => f.id));
      if (ids.length < 2 || ids.some((id) => !frames.has(id))) throw new BadRequestException('Pick two or more frames on the board');
      const groups = spread(people, ids).map((members, i) => ({ frameId: ids[i], members, endsAt, seconds: (minutes ?? 0) * 60 }));
      setBreakouts(doc, { open: true, groups });
    });
    await this.activity.record(boardId, user, 'started breakouts', `${ids.length} groups`, minutes ? `${minutes} min` : undefined);
  }

  /** Moves this person into a group (someone arriving late, or swapping). */
  async joinBreakout(user: User, boardId: string, frameId: string): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    await this.#edit(user, boardId, (doc) => {
      const b = breakoutsOf(doc);
      if (!b.open) throw new ConflictException('No breakouts are running');
      if (!b.groups.some((g) => g.frameId === frameId)) throw new BadRequestException('That frame is not a breakout group');
      setBreakouts(doc, { open: true, groups: moveTo(b.groups, { id: user.id, name: user.name }, frameId) });
    });
  }

  /** One group's timer: started for `seconds` from now, or stopped (null). */
  async setBreakoutTimer(user: User, boardId: string, frameId: string, seconds: number | null): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const b = breakoutsOf(doc);
      if (!b.open || !b.groups.some((g) => g.frameId === frameId)) throw new ConflictException('That group is not running');
      const groups = b.groups.map((g) => (g.frameId === frameId ? { ...g, endsAt: seconds === null ? null : Date.now() + seconds * 1000, seconds: seconds ?? 0 } : g));
      setBreakouts(doc, { open: true, groups });
    });
  }

  /** Brings everyone back together: the groups end, and everyone's view returns to the whole board. */
  async endBreakouts(user: User, boardId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      if (!breakoutsOf(doc).open) throw new ConflictException('No breakouts are running');
      setBreakouts(doc, { open: false, groups: [] });
    });
    await this.activity.record(boardId, user, 'brought everyone back from breakouts');
  }

  /**
   * Takes the facilitator's seat: only one person holds it, so two facilitators don't pull everyone's view about. It's
   * free when nobody has it; a board owner can take it from someone else.
   */
  async claimFacilitator(user: User, boardId: string): Promise<void> {
    const board = await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const now = facilitatorOf(doc);
      if (now.userId && now.userId !== user.id && board.role !== 'owner') throw new ConflictException(`${now.name} is facilitating; they or a board owner can hand it over`);
      setFacilitator(doc, { id: user.id, name: user.name });
    });
  }

  /** Gives the seat up (the facilitator, or a board owner). */
  async releaseFacilitator(user: User, boardId: string): Promise<void> {
    const board = await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const now = facilitatorOf(doc);
      if (now.userId && now.userId !== user.id && board.role !== 'owner') throw new ConflictException(`${now.name} is facilitating`);
      setFacilitator(doc, null);
    });
  }

  /** The facilitator brings everyone's view to what they're looking at; it takes the seat first if it's free. */
  async bringEveryone(user: User, boardId: string, view: { cx: number; cy: number; zoom: number }): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const now = facilitatorOf(doc);
      if (now.userId && now.userId !== user.id) throw new ConflictException(`${now.name} is facilitating, so only they can bring everyone`);
      if (!now.userId) setFacilitator(doc, { id: user.id, name: user.name });
      spotlight(doc, user.name, view);
    });
  }

  /** Updaters and owners: the session's steps, each with its time, the frame it's about and what it runs. */
  async setAgenda(
    user: User,
    boardId: string,
    steps: { id?: string; title: string; seconds: number; frameId?: string | null; activity?: { kind: StepActivity['kind']; anonymous?: boolean; votesEach?: number; question?: string; pollKind?: 'choice' | 'fist'; options?: string[] } | null }[],
  ): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const frames = new Set(framesOf(doc).map((f) => f.id));
      if (steps.some((s) => s.frameId && !frames.has(s.frameId))) throw new BadRequestException('A step names a frame that is not on the board');
      setAgenda(doc, steps.map((s) => ({ id: s.id ?? randomUUID(), title: s.title.trim(), seconds: s.seconds, frameId: s.frameId ?? null, activity: stepActivity(s.activity) })));
    });
  }

  /**
   * Moves the session to a step (or ends it, null): its timer starts, and if it has a frame, everyone is brought to it.
   * Like bringing everyone, it's the facilitator's to do, and takes the seat if it's free.
   */
  async goToStep(user: User, boardId: string, step: number | null): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    let title = '';
    // What the step being left was running, to wrap up, and what the new one runs, to start.
    let leaving: StepActivity | null = null;
    let entering: { activity: StepActivity; frameId: string | null } | null = null;
    await this.#edit(user, boardId, (doc) => {
      const now = facilitatorOf(doc);
      if (now.userId && now.userId !== user.id) throw new ConflictException(`${now.name} is facilitating, so only they can move the agenda on`);
      const agenda = agendaOf(doc);
      if (agenda.current !== null && agenda.current !== step) leaving = agenda.steps[agenda.current].activity ?? null;
      if (step === null) {
        setAgendaStep(doc, null);
        setTimer(doc, null, '', user.name);
        return;
      }
      const s = agenda.steps[step];
      if (!s) throw new BadRequestException('There is no such step');
      title = s.title;
      if (s.activity && agenda.current !== step) entering = { activity: s.activity, frameId: s.frameId };
      if (!now.userId) setFacilitator(doc, { id: user.id, name: user.name });
      setAgendaStep(doc, step);
      setTimer(doc, s.seconds > 0 ? s.seconds : null, s.title, user.name);
      const frame = s.frameId ? framesOf(doc).find((f) => f.id === s.frameId) : undefined;
      if (frame) {
        // Room for the frame on a laptop screen, never past 100%.
        const zoom = Math.max(0.1, Math.min(1, 1100 / (frame.w + 64), 640 / (frame.h + 64)));
        spotlight(doc, user.name, { cx: frame.x + frame.w / 2, cy: frame.y + frame.h / 2, zoom });
      }
    });
    await this.activity.record(boardId, user, step === null ? 'ended the agenda' : 'moved the agenda on', title || undefined);
    if (leaving) await this.#wrapUp(user, boardId, leaving);
    const next = entering as { activity: StepActivity; frameId: string | null } | null;
    if (next) await this.#begin(user, boardId, next.activity, next.frameId);
  }

  /** Wraps up what a step ran, if it's still running: reveals its notes, finishes its vote, closes its poll. */
  async #wrapUp(user: User, boardId: string, activity: StepActivity): Promise<void> {
    await notRunning(async () => {
      if (activity.kind === 'writing') await this.writing.reveal(user, boardId);
      else if (activity.kind === 'vote') await this.setVoting(user, boardId, false);
      else await this.endPoll(user, boardId, false);
    });
  }

  /** Starts what a step runs; hidden writing is revealed into the step's frame. Something already running is left be. */
  async #begin(user: User, boardId: string, activity: StepActivity, frameId: string | null): Promise<void> {
    await notRunning(async () => {
      if (activity.kind === 'writing') await this.writing.start(user, boardId, activity.anonymous, frameId ?? undefined);
      else if (activity.kind === 'vote') await this.setVoting(user, boardId, true, activity.votesEach, { ifIdle: true });
      else await this.startPoll(user, boardId, activity.question, activity.pollKind, activity.options, { ifIdle: true });
    });
  }

  /** Updaters and owners: ask everyone a quick question, or for a fist-to-five. A new poll clears the last one's answers. */
  async startPoll(user: User, boardId: string, question: string, kind: 'choice' | 'fist', options: string[] = [], { ifIdle = false } = {}): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    // Blank options ("  ") would be answerable choices with no name.
    const choices = options.map((o) => o.trim()).filter(Boolean);
    if (kind === 'choice' && choices.length < 2) throw new BadRequestException('A poll needs at least two options');
    await this.#edit(user, boardId, (doc) => {
      if (ifIdle && pollOf(doc)?.open) throw new ConflictException('A poll is already running');
      startPoll(doc, question.trim(), kind, choices);
    });
    await this.activity.record(boardId, user, 'started a poll', question.trim());
  }

  /** Updaters and owners: close the poll to show its result, or clear it away. */
  async endPoll(user: User, boardId: string, clear: boolean): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      if (!pollOf(doc)) throw new ConflictException('There is no poll');
      endPoll(doc, clear);
    });
  }

  /** Commenters and up, while a poll is open: their answer, replacing any they gave before. */
  async answerPoll(user: User, boardId: string, answer: number): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    await this.#edit(user, boardId, (doc) => {
      const problem = answerPoll(doc, user.id, answer);
      if (problem) throw new ConflictException(problem);
    });
  }

  /** The facilitator (or an updater, when nobody is): turn private mode on or off. */
  async setPrivacy(user: User, boardId: string, on: boolean): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      const now = facilitatorOf(doc);
      if (now.userId && now.userId !== user.id) throw new ConflictException(`${now.name} is facilitating, so only they can change private mode`);
      setPrivacy(doc, on, user.name);
    });
    await this.activity.record(boardId, user, on ? 'turned private mode on' : 'turned private mode off');
  }

  async #edit(user: User, boardId: string, change: (doc: Y.Doc) => void): Promise<void> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      // A refusal thrown inside leaves the document as it was.
      let failure: Error | undefined;
      await connection.transact((doc) => {
        try {
          change(doc);
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err));
        }
      });
      if (failure) throw failure;
    } finally {
      await connection.disconnect();
    }
  }
}

/** A step's activity from the request, with only the fields its kind has; a poll needs its question, and options unless fist-to-five. */
function stepActivity(a: { kind: StepActivity['kind']; anonymous?: boolean; votesEach?: number; question?: string; pollKind?: 'choice' | 'fist'; options?: string[] } | null | undefined): StepActivity | null {
  if (!a) return null;
  if (a.kind === 'writing') return { kind: 'writing', anonymous: a.anonymous ?? true };
  if (a.kind === 'vote') return { kind: 'vote', votesEach: a.votesEach ?? DEFAULT_VOTES };
  const question = a.question?.trim() ?? '';
  const pollKind = a.pollKind ?? 'choice';
  const options = (a.options ?? []).map((o) => o.trim()).filter(Boolean);
  if (!question || (pollKind === 'choice' && options.length < 2)) throw new BadRequestException('A poll step needs a question, and two or more options unless it is fist to five');
  return { kind: 'poll', question, pollKind, options: pollKind === 'choice' ? options : [] };
}

/** Runs a step's start or wrap-up, letting it pass if there was nothing to do: no round to reveal, a round already running. */
async function notRunning(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (!(err instanceof ConflictException)) throw err;
  }
}
