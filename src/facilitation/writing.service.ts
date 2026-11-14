import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, countDistinct, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { framesOf, placeNotes, type AuthoredNote, type NoteColor } from '../assist/board-edit';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { noteDrafts, users, type User } from '../db/schema';
import type { NoteDraftDto } from './writing.dto';
import { setWriting, writingOf, type Writing } from './writing-doc';

/** Nobody writes more than this many hidden notes in one round. */
const MAX_DRAFTS = 50;

const view = (d: typeof noteDrafts.$inferSelect): NoteDraftDto => ({ id: d.id, text: d.text, color: d.color, at: d.createdAt.getTime() });

/**
 * Hidden writing: during a round, people's notes are kept on the server where only their author sees them; everyone
 * sees only how many have been written. A facilitator (updater or owner) reveals them onto the board all at once,
 * without names if the round is anonymous. Commenters can write too: it's how a retro hears from everyone.
 */
@Injectable()
export class WritingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  async start(user: User, boardId: string, anonymous: boolean, frameId?: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const round = randomUUID();
    await this.#edit(user, boardId, (doc) => {
      if (writingOf(doc).open) throw new ConflictException('A writing round is already running');
      if (frameId && !framesOf(doc).some((f) => f.id === frameId)) throw new BadRequestException('That frame is not on the board');
      setWriting(doc, { open: true, anonymous, round, frameId: frameId ?? null, startedBy: user.name, notes: 0, writers: 0 });
    });
    // Anything left from an earlier round that was never revealed goes.
    await this.db.delete(noteDrafts).where(and(eq(noteDrafts.boardId, boardId), ne(noteDrafts.round, round)));
    await this.activity.record(boardId, user, 'started hidden writing', anonymous ? 'Anonymous' : undefined);
  }

  /** Your notes in the round that's running. */
  async mine(user: User, boardId: string): Promise<NoteDraftDto[]> {
    await this.boards.get(user, boardId, 'commenter');
    const round = (await this.#writing(user, boardId)).round;
    if (!round) return [];
    const rows = await this.db
      .select()
      .from(noteDrafts)
      .where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, round), eq(noteDrafts.authorId, user.id)))
      .orderBy(asc(noteDrafts.createdAt));
    return rows.map(view);
  }

  async write(user: User, boardId: string, text: string, color: NoteColor = 'yellow'): Promise<NoteDraftDto> {
    await this.boards.get(user, boardId, 'commenter');
    const writing = await this.#writing(user, boardId);
    if (!writing.open || !writing.round) throw new ConflictException('No writing round is running');
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(noteDrafts)
      .where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, writing.round), eq(noteDrafts.authorId, user.id)));
    if (n >= MAX_DRAFTS) throw new ConflictException(`That's ${MAX_DRAFTS} notes: the most for one round`);
    const [row] = await this.db.insert(noteDrafts).values({ boardId, round: writing.round, authorId: user.id, text: text.trim(), color }).returning();
    await this.#recount(user, boardId, writing.round);
    return view(row);
  }

  async edit(user: User, boardId: string, draftId: string, text: string, color?: NoteColor): Promise<NoteDraftDto> {
    await this.boards.get(user, boardId, 'commenter');
    const [row] = await this.db
      .update(noteDrafts)
      .set({ text: text.trim(), ...(color ? { color } : {}) })
      .where(and(eq(noteDrafts.id, draftId), eq(noteDrafts.boardId, boardId), eq(noteDrafts.authorId, user.id)))
      .returning();
    if (!row) throw new NotFoundException('Note not found');
    return view(row);
  }

  async remove(user: User, boardId: string, draftId: string): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    const [row] = await this.db
      .delete(noteDrafts)
      .where(and(eq(noteDrafts.id, draftId), eq(noteDrafts.boardId, boardId), eq(noteDrafts.authorId, user.id)))
      .returning();
    if (!row) throw new NotFoundException('Note not found');
    await this.#recount(user, boardId, row.round);
  }

  /** Puts every note from the round on the board at once, and ends it. Anonymous rounds are shuffled and unsigned. */
  async reveal(user: User, boardId: string): Promise<{ revealed: number }> {
    await this.boards.get(user, boardId, 'updater');
    const writing = await this.#writing(user, boardId);
    if (!writing.open || !writing.round) throw new ConflictException('No writing round is running');
    const rows = await this.db
      .select({ draft: noteDrafts, name: users.name })
      .from(noteDrafts)
      .innerJoin(users, eq(users.id, noteDrafts.authorId))
      .where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, writing.round)))
      .orderBy(asc(noteDrafts.authorId), asc(noteDrafts.createdAt));
    const notes: AuthoredNote[] = rows.map(({ draft, name }) => ({
      text: draft.text,
      color: draft.color as NoteColor,
      ...(writing.anonymous ? { author: 'anonymous' } : { author: draft.authorId, authorName: name }),
    }));
    // Shuffled, so where a note lands says nothing about who wrote it.
    if (writing.anonymous) notes.sort(() => Math.random() - 0.5);
    await this.#edit(user, boardId, (doc) => {
      if (!writingOf(doc).open) throw new ConflictException('No writing round is running');
      placeNotes(doc, notes, writing.frameId ?? undefined);
      setWriting(doc, { open: false, round: null, notes: 0, writers: 0 });
    });
    await this.db.delete(noteDrafts).where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, writing.round)));
    await this.activity.record(boardId, user, 'revealed the hidden notes', `${notes.length} note${notes.length === 1 ? '' : 's'}`);
    return { revealed: notes.length };
  }

  /** Ends the round without revealing anything; the notes are thrown away. */
  async cancel(user: User, boardId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const writing = await this.#writing(user, boardId);
    if (!writing.open) throw new ConflictException('No writing round is running');
    await this.#edit(user, boardId, (doc) => setWriting(doc, { open: false, round: null, notes: 0, writers: 0 }));
    if (writing.round) await this.db.delete(noteDrafts).where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, writing.round)));
    await this.activity.record(boardId, user, 'cancelled hidden writing');
  }

  /** Tells everyone how many notes there are now, and from how many people. */
  async #recount(user: User, boardId: string, round: string): Promise<void> {
    const [{ notes, writers }] = await this.db
      .select({ notes: count(), writers: countDistinct(noteDrafts.authorId) })
      .from(noteDrafts)
      .where(and(eq(noteDrafts.boardId, boardId), eq(noteDrafts.round, round)));
    await this.#edit(user, boardId, (doc) => {
      if (writingOf(doc).round === round) setWriting(doc, { notes, writers });
    });
  }

  async #writing(user: User, boardId: string): Promise<Writing> {
    let writing!: Writing;
    await this.#edit(user, boardId, (doc) => (writing = writingOf(doc)));
    return writing;
  }

  async #edit(user: User, boardId: string, change: (doc: Y.Doc) => void): Promise<void> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
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
