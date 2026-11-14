import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { comments, commentThreads, users, type User } from '../db/schema';
import type { CommentThreadDto } from './comments.dto';
import { ActivityService } from '../activity/activity.service';
import { mentioned, NotificationsService } from '../activity/notifications';

/** What the board's open connections are told when its comments change, so they fetch them again. */
export const COMMENTS_CHANGED = JSON.stringify({ type: 'comments' });

/**
 * Comments on a board's notes and frames: one thread per note or frame. Anyone who can open the board reads them;
 * commenters and up write and resolve them; people delete their own, and board owners anyone's.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: User, boardId: string): Promise<CommentThreadDto[]> {
    await this.boards.get(user, boardId);
    return this.#threads(boardId);
  }

  /** Adds a comment to the note or frame's thread, starting it if need be, and reopening it if it was resolved. */
  async add(user: User, boardId: string, nodeId: string, body: string): Promise<CommentThreadDto> {
    const board = await this.boards.get(user, boardId, 'commenter');
    const threadId = await this.db.transaction(async (tx) => {
      const [thread] = await tx
        .insert(commentThreads)
        .values({ boardId, nodeId })
        .onConflictDoUpdate({ target: [commentThreads.boardId, commentThreads.nodeId], set: { resolvedAt: null, resolvedBy: null } })
        .returning({ id: commentThreads.id });
      await tx.insert(comments).values({ threadId: thread.id, authorId: user.id, body: body.trim() });
      return thread.id;
    });
    this.#changed(boardId);
    const thread = (await this.#threads(boardId, threadId))[0];
    await this.activity.record(boardId, user, 'commented', undefined, body.trim());
    // Others in the thread hear of the reply; anyone named with an @ hears they were mentioned.
    const people = (await this.boards.members(user, boardId)).filter((m) => m.role).map((m) => ({ id: m.userId, name: m.name }));
    const named = new Set(mentioned(body, people).filter((id) => id !== user.id));
    // Only people who can still open the board: someone who's since lost access hears nothing new.
    const current = new Set(people.map((p) => p.id));
    const others = new Set(thread.comments.map((c) => c.author?.id).filter((id): id is string => !!id && id !== user.id && !named.has(id) && current.has(id)));
    const link = `/boards/${boardId}`;
    await this.notifications.notify(named, { kind: 'mention', actor: user.name, title: 'mentioned you in a comment', body, context: board.title, link, boardId });
    await this.notifications.notify(others, { kind: 'reply', actor: user.name, title: 'replied in a thread you’re in', body, context: board.title, link, boardId });
    return thread;
  }

  async resolve(user: User, boardId: string, threadId: string, resolved: boolean): Promise<CommentThreadDto> {
    await this.boards.get(user, boardId, 'commenter');
    const updated = await this.db
      .update(commentThreads)
      .set(resolved ? { resolvedAt: new Date(), resolvedBy: user.id } : { resolvedAt: null, resolvedBy: null })
      .where(and(eq(commentThreads.id, threadId), eq(commentThreads.boardId, boardId)))
      .returning({ id: commentThreads.id });
    if (updated.length === 0) throw new NotFoundException('Thread not found');
    this.#changed(boardId);
    await this.activity.record(boardId, user, resolved ? 'resolved a thread' : 'reopened a thread');
    return (await this.#threads(boardId, threadId))[0];
  }

  /** Deletes a comment: its author can, and so can the board's owners. A thread left empty goes too. */
  async remove(user: User, boardId: string, commentId: string): Promise<void> {
    const board = await this.boards.get(user, boardId);
    const [row] = await this.db
      .select({ id: comments.id, authorId: comments.authorId, threadId: comments.threadId })
      .from(comments)
      .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
      .where(and(eq(comments.id, commentId), eq(commentThreads.boardId, boardId)));
    if (!row) throw new NotFoundException('Comment not found');
    if (row.authorId !== user.id && board.role !== 'owner') throw new ForbiddenException('Only its author or a board owner can delete a comment.');
    await this.db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, commentId));
      const left = await tx.select({ id: comments.id }).from(comments).where(eq(comments.threadId, row.threadId)).limit(1);
      if (left.length === 0) await tx.delete(commentThreads).where(eq(commentThreads.id, row.threadId));
    });
    this.#changed(boardId);
  }

  #changed(boardId: string): void {
    this.collab.hocuspocus.documents.get(boardId)?.broadcastStateless(COMMENTS_CHANGED);
  }

  /** A board's threads (or just one), oldest first, each with its comments oldest first. */
  async #threads(boardId: string, only?: string): Promise<CommentThreadDto[]> {
    const threads = await this.db
      .select()
      .from(commentThreads)
      .where(only ? and(eq(commentThreads.boardId, boardId), eq(commentThreads.id, only)) : eq(commentThreads.boardId, boardId))
      .orderBy(asc(commentThreads.createdAt));
    if (threads.length === 0) return [];
    const rows = await this.db
      .select({ id: comments.id, threadId: comments.threadId, body: comments.body, createdAt: comments.createdAt, authorId: comments.authorId, name: users.name })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(inArray(comments.threadId, threads.map((t) => t.id)))
      .orderBy(asc(comments.createdAt));
    return threads.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      resolvedAt: t.resolvedAt,
      comments: rows
        .filter((c) => c.threadId === t.id)
        .map((c) => ({ id: c.id, author: { id: c.authorId, name: c.name ?? 'Someone who left' }, body: c.body, createdAt: c.createdAt })),
    }));
  }
}
