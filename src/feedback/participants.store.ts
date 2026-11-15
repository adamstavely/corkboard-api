import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boardFeedbackLinks, boardParticipants, users } from '../db/schema';
import type { Participant, Visibility } from '../collab/projection';

export type LinkRow = typeof boardFeedbackLinks.$inferSelect;
export type ParticipantRow = typeof boardParticipants.$inferSelect;

/**
 * Who has joined a board through its feedback link, and what they may see: read by the collaboration server (which
 * builds participants' projections) and by FeedbackService (which manages them), so neither needs the other.
 */
@Injectable()
export class ParticipantsStore {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The board's live feedback link, if any. */
  async liveLink(boardId: string): Promise<LinkRow | null> {
    const [link] = await this.db
      .select()
      .from(boardFeedbackLinks)
      .where(and(eq(boardFeedbackLinks.boardId, boardId), isNull(boardFeedbackLinks.revokedAt)));
    return link ?? null;
  }

  async row(boardId: string, userId: string): Promise<ParticipantRow | null> {
    const [row] = await this.db
      .select()
      .from(boardParticipants)
      .where(and(eq(boardParticipants.boardId, boardId), eq(boardParticipants.userId, userId)));
    return row ?? null;
  }

  /** Everyone who joined, first first, with their names. */
  async all(boardId: string): Promise<(ParticipantRow & { name: string })[]> {
    const rows = await this.db
      .select({ p: boardParticipants, name: users.name })
      .from(boardParticipants)
      .innerJoin(users, eq(users.id, boardParticipants.userId))
      .where(eq(boardParticipants.boardId, boardId))
      .orderBy(asc(boardParticipants.pseudonym));
    return rows.map(({ p, name }) => ({ ...p, name }));
  }

  /** A participant who may be on the board now (joined, not blocked, while it's open for feedback), with what they see. */
  async active(boardId: string, userId: string): Promise<{ row: ParticipantRow; visibility: Visibility } | null> {
    const [row, link] = await Promise.all([this.row(boardId, userId), this.liveLink(boardId)]);
    return row && !row.blockedAt && link ? { row, visibility: link.visibility } : null;
  }

  /** What projections of the board need: what participants see of each other, and who they all are. */
  async forProjection(boardId: string): Promise<{ visibility: Visibility | null; participants: Map<string, Participant & { blocked: boolean }> }> {
    const [link, all] = await Promise.all([this.liveLink(boardId), this.all(boardId)]);
    return {
      visibility: link?.visibility ?? null,
      participants: new Map(all.map((p) => [p.userId, { pseudonym: p.pseudonym, name: p.name, blocked: !!p.blockedAt }])),
    };
  }
}
