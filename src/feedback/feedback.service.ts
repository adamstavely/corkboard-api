import { ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, max } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardFeedbackLinks, boardParticipants, boards, users, type User } from '../db/schema';
import { facilitatorOf } from '../facilitation/facilitation-doc';
import type { FeedbackDto, FeedbackJoinDto, ParticipantDto } from './feedback.dto';

import type { Visibility } from '../collab/projection';
import { PoliciesService } from '../policies/policies.service';
import { ParticipantsStore, type LinkRow, type ParticipantRow } from './participants.store';

/** "Participant 4": what other participants call someone when names are hidden. */
export const pseudonymName = (n: number) => `Participant ${n}`;

/**
 * Feedback from outside the team. A board's owners (and its facilitator) make a feedback link; anyone signed in who has
 * it joins the board as a participant, whatever workspace they're in. Participants never get the board itself: they
 * see a projection of it (see collab/projection.ts) and act through the API, which records who they really are.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
    private readonly store: ParticipantsStore,
    private readonly policies: PoliciesService,
  ) {}

  liveLink(boardId: string): Promise<LinkRow | null> {
    return this.store.liveLink(boardId);
  }

  /** The team (anyone who can open the board): the feedback link and who has joined, with their real names. */
  async get(user: User, boardId: string): Promise<FeedbackDto> {
    await this.boards.get(user, boardId, 'reader');
    const link = await this.liveLink(boardId);
    return { link: link && { token: link.token, visibility: link.visibility, createdAt: link.createdAt.getTime() }, participants: await this.participants(boardId) };
  }

  async participants(boardId: string): Promise<ParticipantDto[]> {
    return (await this.store.all(boardId)).map((p) => ({ userId: p.userId, name: p.name, pseudonym: p.pseudonym, joinedAt: p.joinedAt.getTime(), blocked: !!p.blockedAt }));
  }

  /** Owners and the facilitator: a feedback link (replacing any live one), with what participants see of each other. */
  async open(user: User, boardId: string, visibility: Visibility): Promise<FeedbackDto> {
    await this.#manage(user, boardId, true);
    await this.db.transaction(async (tx) => {
      await tx.update(boardFeedbackLinks).set({ revokedAt: new Date() }).where(and(eq(boardFeedbackLinks.boardId, boardId), isNull(boardFeedbackLinks.revokedAt)));
      await tx.insert(boardFeedbackLinks).values({ boardId, token: randomBytes(24).toString('base64url'), visibility, createdBy: user.id });
    });
    await this.activity.record(boardId, user, 'opened the board for feedback', undefined, VISIBILITY_WORDS[visibility]);
    this.collab.refreshProjections(boardId);
    return this.get(user, boardId);
  }

  /** Owners and the facilitator: change what participants see of each other. */
  async setVisibility(user: User, boardId: string, visibility: Visibility): Promise<FeedbackDto> {
    await this.#manage(user, boardId);
    const link = await this.liveLink(boardId);
    if (!link) throw new NotFoundException('The board is not open for feedback');
    await this.db.update(boardFeedbackLinks).set({ visibility }).where(eq(boardFeedbackLinks.id, link.id));
    await this.activity.record(boardId, user, 'changed what participants see', undefined, VISIBILITY_WORDS[visibility]);
    this.collab.refreshProjections(boardId);
    return this.get(user, boardId);
  }

  /** Owners and the facilitator: turn the link off. Participants can't open the board any more. */
  async close(user: User, boardId: string): Promise<void> {
    await this.#manage(user, boardId);
    await this.db.update(boardFeedbackLinks).set({ revokedAt: new Date() }).where(and(eq(boardFeedbackLinks.boardId, boardId), isNull(boardFeedbackLinks.revokedAt)));
    await this.activity.record(boardId, user, 'closed the board to feedback');
    this.collab.closeProjections(boardId);
  }

  /** Owners and the facilitator: keep a participant out, or let them back. */
  async block(user: User, boardId: string, userId: string, blocked: boolean): Promise<void> {
    await this.#manage(user, boardId);
    const [row] = await this.db
      .update(boardParticipants)
      .set({ blockedAt: blocked ? new Date() : null })
      .where(and(eq(boardParticipants.boardId, boardId), eq(boardParticipants.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException('They have not joined this board');
    const [who] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await this.activity.record(boardId, user, blocked ? 'blocked a participant' : 'let a participant back', who?.name);
    if (blocked) this.collab.closeProjections(boardId, userId);
    this.collab.refreshProjections(boardId);
  }

  /**
   * Anyone signed in, with the link: join the board as a participant (again, harmlessly). Someone already in its
   * workspace is told so, and opens the board as themselves instead.
   */
  async join(user: User, token: string): Promise<FeedbackJoinDto> {
    const [row] = await this.db
      .select({ link: boardFeedbackLinks, title: boards.title })
      .from(boardFeedbackLinks)
      .innerJoin(boards, eq(boards.id, boardFeedbackLinks.boardId))
      .where(eq(boardFeedbackLinks.token, token));
    if (!row) throw new NotFoundException('This link does not open anything');
    if (row.link.revokedAt) throw new GoneException('This board is no longer open for feedback');
    const { link, title } = row;
    const member = await this.boards
      .access(user, link.boardId)
      .then(() => true)
      .catch(() => false);
    if (member) return { boardId: link.boardId, title, visibility: link.visibility, member: true, you: null };

    let mine = await this.store.row(link.boardId, user.id);
    if (!mine) {
      // Pseudonyms count up per board; a clash (two joining at once) retries.
      for (let attempt = 0; !mine && attempt < 5; attempt++) {
        const [{ top }] = await this.db.select({ top: max(boardParticipants.pseudonym) }).from(boardParticipants).where(eq(boardParticipants.boardId, link.boardId));
        const [added] = await this.db
          .insert(boardParticipants)
          .values({ boardId: link.boardId, userId: user.id, pseudonym: (top ?? 0) + 1, linkId: link.id })
          .onConflictDoNothing()
          .returning();
        mine = added ?? (await this.store.row(link.boardId, user.id));
      }
      if (!mine) throw new GoneException('Could not join just now; try again');
      await this.activity.record(link.boardId, user, 'joined to give feedback', undefined, pseudonymName(mine.pseudonym));
      this.collab.refreshProjections(link.boardId);
    }
    if (mine.blockedAt) throw new ForbiddenException('The team has stopped you giving feedback on this board');
    return { boardId: link.boardId, title, visibility: link.visibility, member: false, you: { pseudonym: mine.pseudonym, name: user.name } };
  }

  /** A participant who may act on the board now: joined, not blocked, while the board is open for feedback. 403 otherwise. */
  async participant(user: User, boardId: string): Promise<{ row: ParticipantRow; visibility: Visibility }> {
    const active = await this.store.active(boardId, user.id);
    if (!active) throw new ForbiddenException('You are not giving feedback on this board');
    return active;
  }

  /** Whether this person holds the board's facilitator seat. */
  async facilitates(user: User, boardId: string): Promise<boolean> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      return !!connection.document && facilitatorOf(connection.document).userId === user.id;
    } finally {
      await connection.disconnect();
    }
  }

  /**
   * Opening a board for feedback: whoever the workspace's policy allows (board owners and the facilitator by default).
   * Changing or closing it: them, and always the board's owners and facilitator.
   */
  async #manage(user: User, boardId: string, opening = false): Promise<void> {
    const board = await this.boards.get(user, boardId);
    const facilitator = () => this.facilitates(user, boardId);
    if (!opening && (board.role === 'owner' || (board.role === 'updater' && (await facilitator())))) return;
    await this.policies.check(user, board, 'feedback', facilitator);
  }
}

const VISIBILITY_WORDS: Record<Visibility, string> = {
  names: 'participants see each other, by name',
  anonymous: "participants see each other's feedback, not names",
  own: 'participants see only their own feedback',
};
