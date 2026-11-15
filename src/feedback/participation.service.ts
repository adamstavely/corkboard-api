import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { newNote, paragraphs, topZ, type NoteColor } from '../assist/board-edit';
import { CollabService } from '../collab/collab.service';
import { participantKey, type Visibility } from '../collab/projection';
import { COMMENTS_CHANGED } from '../comments/comments.service';
import { InjectDb, type Db } from '../db/db.module';
import { comments, commentThreads, type User } from '../db/schema';
import { answerPoll, castVote } from '../facilitation/facilitation-doc';
import { PokerService } from '../facilitation/poker.service';
import { react } from '../reactions/reactions';
import type { ParticipantCommentThreadDto, ParticipantNoteDto } from './participation.dto';
import { ParticipantsStore } from './participants.store';

/**
 * What a participant from outside the team does on a board: add and change their own notes, comment, react, vote and
 * answer polls. Each goes into the board itself under who they really are (the team sees it by name, and the history
 * records it); what other participants see of it is up to the board's projections.
 */
@Injectable()
export class ParticipationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly store: ParticipantsStore,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
    private readonly poker: PokerService,
  ) {}

  /** A participant who may act now, or 403. */
  async #me(user: User, boardId: string): Promise<{ visibility: Visibility; pseudonym: number }> {
    const active = await this.store.active(boardId, user.id);
    if (!active) throw new ForbiddenException('You are not giving feedback on this board');
    return { visibility: active.visibility, pseudonym: active.row.pseudonym };
  }

  /** Whether a participant can see (and so act on) something on the board: not another participant's, seeing only their own. */
  #visible(doc: Y.Doc, nodeId: string, userId: string, visibility: Visibility): boolean {
    const node = doc.getMap<Y.Map<unknown>>('nodes').get(nodeId.split('@')[0]);
    if (!(node instanceof Y.Map)) return false;
    return !(visibility === 'own' && node.get('participant') === true && node.get('author') !== userId);
  }

  async #edit<T>(boardId: string, user: User, change: (doc: Y.Doc) => T): Promise<T> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      let result: T | undefined;
      let failure: Error | undefined;
      await connection.transact((doc) => {
        try {
          result = change(doc);
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err));
        }
      });
      if (failure) throw failure;
      return result as T;
    } finally {
      await connection.disconnect();
    }
  }

  async addNote(user: User, boardId: string, note: { text: string; color: NoteColor; x: number; y: number }): Promise<ParticipantNoteDto> {
    await this.#me(user, boardId);
    const id = await this.#edit(boardId, user, (doc) => {
      const added = newNote(doc, { text: note.text, color: note.color }, { x: Math.round(note.x), y: Math.round(note.y) }, topZ(doc) + 1, user.id);
      const node = doc.getMap<Y.Map<unknown>>('nodes').get(added)!;
      node.set('participant', true);
      node.set('authorName', user.name);
      return added;
    });
    await this.activity.record(boardId, user, 'added a note', undefined, note.text.slice(0, 200));
    return { id };
  }

  /** A participant changes one of their own notes: its text, where it is, or its colour. */
  async editNote(user: User, boardId: string, noteId: string, change: { text?: string; color?: NoteColor; x?: number; y?: number }): Promise<void> {
    await this.#me(user, boardId);
    await this.#edit(boardId, user, (doc) => {
      const node = this.#ownNote(doc, noteId, user);
      if (change.x !== undefined) node.set('x', Math.round(change.x));
      if (change.y !== undefined) node.set('y', Math.round(change.y));
      if (change.color) node.set('color', change.color);
      if (change.text !== undefined) {
        const fragment = new Y.XmlFragment();
        node.set('text', fragment);
        fragment.insert(0, paragraphs(change.text));
      }
    });
    if (change.text !== undefined) await this.activity.record(boardId, user, 'changed a note', undefined, change.text.slice(0, 200));
  }

  async removeNote(user: User, boardId: string, noteId: string): Promise<void> {
    await this.#me(user, boardId);
    await this.#edit(boardId, user, (doc) => {
      this.#ownNote(doc, noteId, user);
      doc.getMap('nodes').delete(noteId);
    });
    await this.activity.record(boardId, user, 'removed a note');
  }

  #ownNote(doc: Y.Doc, noteId: string, user: User): Y.Map<unknown> {
    const node = doc.getMap<Y.Map<unknown>>('nodes').get(noteId);
    if (!(node instanceof Y.Map)) throw new NotFoundException('That note is not on the board');
    if (node.get('participant') !== true || node.get('author') !== user.id) throw new ForbiddenException('You can change only your own notes');
    return node;
  }

  async react(user: User, boardId: string, nodeId: string, emoji: string, on: boolean): Promise<void> {
    const { visibility } = await this.#me(user, boardId);
    await this.#edit(boardId, user, (doc) => {
      if (!this.#visible(doc, nodeId, user.id, visibility) || !react(doc, nodeId, emoji, user.id, on)) throw new BadRequestException('That is not on the board');
    });
  }

  async vote(user: User, boardId: string, noteId: string, add: boolean): Promise<void> {
    const { visibility } = await this.#me(user, boardId);
    await this.#edit(boardId, user, (doc) => {
      if (add && !this.#visible(doc, noteId, user.id, visibility)) throw new BadRequestException('That note is not on the board');
      const problem = castVote(doc, user.id, noteId, add);
      if (problem) throw new ConflictException(problem);
    });
  }

  async answerPoll(user: User, boardId: string, answer: number): Promise<void> {
    await this.#me(user, boardId);
    await this.#edit(boardId, user, (doc) => {
      const problem = answerPoll(doc, user.id, answer);
      if (problem) throw new ConflictException(problem);
    });
  }

  /** A planning poker estimate, kept hidden like everyone's until the facilitator reveals them. */
  async estimate(user: User, boardId: string, value: string): Promise<void> {
    await this.#me(user, boardId);
    await this.poker.estimateAs(user, boardId, value);
  }

  /** Their own estimate in the running round. */
  async myEstimate(user: User, boardId: string): Promise<string | null> {
    await this.#me(user, boardId);
    return this.poker.mineAs(user, boardId);
  }

  async comment(user: User, boardId: string, nodeId: string, body: string): Promise<ParticipantCommentThreadDto[]> {
    const { visibility } = await this.#me(user, boardId);
    if (!(await this.#edit(boardId, user, (doc) => this.#visible(doc, nodeId, user.id, visibility)))) throw new BadRequestException('That is not on the board');
    await this.db.transaction(async (tx) => {
      const [thread] = await tx
        .insert(commentThreads)
        .values({ boardId, nodeId })
        .onConflictDoUpdate({ target: [commentThreads.boardId, commentThreads.nodeId], set: { resolvedAt: null, resolvedBy: null } })
        .returning({ id: commentThreads.id });
      await tx.insert(comments).values({ threadId: thread.id, authorId: user.id, body: body.trim() });
    });
    this.collab.broadcastToBoard(boardId, COMMENTS_CHANGED);
    await this.activity.record(boardId, user, 'commented', undefined, body.trim());
    return this.comments(user, boardId);
  }

  /**
   * The board's comments as this participant may see them: the team's (as "The team"), their own (as "You"), and other
   * participants' by name or pseudonym, or not at all when they see only their own. Threads on what they can't see go.
   */
  async comments(user: User, boardId: string): Promise<ParticipantCommentThreadDto[]> {
    const { visibility } = await this.#me(user, boardId);
    const people = new Map((await this.store.all(boardId)).map((p) => [p.userId, p]));
    const threads = await this.db.select().from(commentThreads).where(eq(commentThreads.boardId, boardId)).orderBy(asc(commentThreads.createdAt));
    const visible = await this.#edit(boardId, user, (doc) => new Set(threads.filter((t) => this.#visible(doc, t.nodeId, user.id, visibility)).map((t) => t.id)));
    const shown = threads.filter((t) => visible.has(t.id));
    if (shown.length === 0) return [];
    const rows = await this.db
      .select()
      .from(comments)
      .where(inArray(comments.threadId, shown.map((t) => t.id)))
      .orderBy(asc(comments.createdAt));
    return shown
      .map((t) => ({
        id: t.id,
        nodeId: t.nodeId,
        resolved: !!t.resolvedAt,
        comments: rows
          .filter((c) => c.threadId === t.id)
          .flatMap((c) => {
            const p = c.authorId ? people.get(c.authorId) : undefined;
            if (c.authorId === user.id) return [{ id: c.id, by: 'You', mine: true, body: c.body, createdAt: c.createdAt.getTime() }];
            if (!p) return [{ id: c.id, by: 'The team', mine: false, body: c.body, createdAt: c.createdAt.getTime() }];
            if (visibility === 'own') return [];
            return [{ id: c.id, by: visibility === 'names' ? p.name : `Participant ${p.pseudonym}`, mine: false, body: c.body, createdAt: c.createdAt.getTime() }];
          }),
      }))
      .filter((t) => t.comments.length > 0);
  }

  /** Who they are on the board's projection: the key their own votes and notes carry there. */
  async you(user: User, boardId: string): Promise<{ key: string; visibility: Visibility }> {
    const { visibility, pseudonym } = await this.#me(user, boardId);
    return { key: participantKey(pseudonym), visibility };
  }
}
