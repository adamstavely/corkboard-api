import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { notesOf } from '../assist/board-edit';
import { tasksOf } from '../assist/tasks-doc';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { pokerEstimates, type User } from '../db/schema';
import { clearPoker, DECKS, markEstimated, pokerOf, revealPoker, startPoker, type Deck, type Poker } from './poker-doc';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Planning poker: a facilitator (updater or owner) puts up a task, a note or just a title, and everyone estimates it
 * with the same deck. Estimates stay on the server until the facilitator reveals them all at once, so nobody anchors
 * on anyone else's; the board shows only who has estimated. Commenters estimate too, and outside feedback participants
 * through their own route (ParticipationService), each counted once under who they are.
 *
 * Starting, estimating, revealing and clearing each hold the board's poker lock (a Postgres advisory lock) while they
 * read the round and change it, so they happen one after another: an estimate is either in the reveal or refused,
 * never accepted and then left out.
 */
@Injectable()
export class PokerService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  async start(user: User, boardId: string, deck: Deck, what: { taskId?: string; noteId?: string; title?: string }): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const round = randomUUID();
    let title = what.title?.trim() ?? '';
    const change = (doc: Y.Doc) => {
      if (what.taskId) {
        const task = tasksOf(doc).find((t) => t.id === what.taskId);
        if (!task) throw new BadRequestException('That task is not on the board');
        title ||= `${task.key} ${task.title}`;
      } else if (what.noteId) {
        const note = notesOf(doc).find((n) => n.id === what.noteId);
        if (!note) throw new BadRequestException('That note is not on the board');
        title ||= note.text.split('\n')[0].slice(0, 200);
      }
      if (!title) throw new BadRequestException('Say what is being estimated: a task, a note or a title');
      startPoker(doc, { round, deck, taskId: what.taskId ?? null, noteId: what.taskId ? null : (what.noteId ?? null), title, startedBy: user.name });
    };
    await this.db.transaction(async (tx) => {
      await this.#lock(tx, boardId);
      await this.#edit(user, boardId, change);
      // Anything left from an earlier round goes.
      await tx.delete(pokerEstimates).where(and(eq(pokerEstimates.boardId, boardId), ne(pokerEstimates.round, round)));
    });
    await this.activity.record(boardId, user, 'started planning poker', title);
  }

  /** Commenters and up, while the round is open: their estimate, replacing any they gave before. */
  async estimate(user: User, boardId: string, value: string): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    await this.estimateAs(user, boardId, value);
  }

  /** An estimate from someone whose access the caller has already checked (a feedback participant). */
  async estimateAs(user: User, boardId: string, value: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Read under the lock: a reveal either already happened (refused here) or waits until this estimate is in.
      await this.#lock(tx, boardId);
      const poker = await this.#poker(user, boardId);
      if (!poker) throw new ConflictException('No planning poker round is running');
      if (poker.revealed) throw new ConflictException('The estimates have been revealed');
      if (!(DECKS[poker.deck] as readonly string[]).includes(value)) throw new BadRequestException('That is not a card in the deck');
      await tx
        .insert(pokerEstimates)
        .values({ boardId, round: poker.round, userId: user.id, value })
        .onConflictDoUpdate({ target: [pokerEstimates.boardId, pokerEstimates.round, pokerEstimates.userId], set: { value } });
      await this.#edit(user, boardId, (doc) => {
        const problem = markEstimated(doc, poker.round, user.id);
        if (problem) throw new ConflictException(problem);
      });
    });
  }

  /** Your estimate in the round that's running, if you've given one. */
  async mine(user: User, boardId: string): Promise<string | null> {
    await this.boards.get(user, boardId, 'commenter');
    return this.mineAs(user, boardId);
  }

  async mineAs(user: User, boardId: string): Promise<string | null> {
    const poker = await this.#poker(user, boardId);
    if (!poker) return null;
    const [row] = await this.db
      .select({ value: pokerEstimates.value })
      .from(pokerEstimates)
      .where(and(eq(pokerEstimates.boardId, boardId), eq(pokerEstimates.round, poker.round), eq(pokerEstimates.userId, user.id)));
    return row?.value ?? null;
  }

  /** Updaters and owners: show everyone's estimates at once. */
  async reveal(user: User, boardId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    // The round is closed to estimates (revealed) before the lock is let go, so every estimate it accepted is in it.
    const { poker, rows } = await this.db.transaction(async (tx) => {
      await this.#lock(tx, boardId);
      const poker = await this.#poker(user, boardId);
      if (!poker) throw new ConflictException('No planning poker round is running');
      if (poker.revealed) throw new ConflictException('The estimates have already been revealed');
      const rows = await tx
        .select({ userId: pokerEstimates.userId, value: pokerEstimates.value })
        .from(pokerEstimates)
        .where(and(eq(pokerEstimates.boardId, boardId), eq(pokerEstimates.round, poker.round)));
      await this.#edit(user, boardId, (doc) => {
        if (pokerOf(doc)?.round !== poker.round) throw new ConflictException('That round of planning poker has ended');
        revealPoker(doc, new Map(rows.map((r) => [r.userId, r.value])));
      });
      return { poker, rows };
    });
    await this.activity.record(boardId, user, 'revealed the estimates', poker.title, `${rows.length} estimate${rows.length === 1 ? '' : 's'}`);
  }

  /** Updaters and owners: put planning poker away. */
  async clear(user: User, boardId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.db.transaction(async (tx) => {
      await this.#lock(tx, boardId);
      await this.#edit(user, boardId, (doc) => {
        if (!pokerOf(doc)) throw new ConflictException('No planning poker round is running');
        clearPoker(doc);
      });
      await tx.delete(pokerEstimates).where(eq(pokerEstimates.boardId, boardId));
    });
  }

  /** Takes the board's poker lock until the transaction ends. */
  async #lock(tx: Tx, boardId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`poker:${boardId}`}, 0))`);
  }

  async #poker(user: User, boardId: string): Promise<Poker | null> {
    let poker: Poker | null = null;
    await this.#edit(user, boardId, (doc) => (poker = pokerOf(doc)));
    return poker;
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
