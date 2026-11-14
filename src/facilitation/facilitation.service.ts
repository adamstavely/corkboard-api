import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { framesOf, inFrame, NOTE_SIZE, notesOf } from '../assist/board-edit';
import { breakoutsOf, groupOf, moveTo, setBreakouts, spread } from './breakouts-doc';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { castVote, facilitatorOf, setFacilitator, setTimer, setVoting, spotlight, votingOf } from './facilitation-doc';
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
  ) {}

  async setVoting(user: User, boardId: string, open: boolean, votesEach = DEFAULT_VOTES): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      if (!open && !votingOf(doc).open) throw new ConflictException('No vote is running');
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
