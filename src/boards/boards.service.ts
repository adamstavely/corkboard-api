import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boardDocuments, boards, orgMembers, type Board, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { SearchIndex } from '../search/search-index';

@Injectable()
export class BoardsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly search: SearchIndex,
  ) {}

  async list(user: User, orgId: string): Promise<Board[]> {
    await this.orgs.roleIn(user.id, orgId);
    return this.db.select().from(boards).where(eq(boards.orgId, orgId)).orderBy(desc(boards.updatedAt));
  }

  async create(user: User, orgId: string, title: string): Promise<Board> {
    await this.orgs.roleIn(user.id, orgId);
    const [board] = await this.db.insert(boards).values({ orgId, title: title.trim(), createdBy: user.id }).returning();
    await this.search.indexBoard(board);
    return board;
  }

  /** A board the user can see: one in an org they belong to. Any other is reported as missing. */
  async get(user: User, boardId: string): Promise<Board> {
    const [row] = await this.db
      .select({ board: boards })
      .from(boards)
      .innerJoin(orgMembers, and(eq(orgMembers.orgId, boards.orgId), eq(orgMembers.userId, user.id)))
      .where(eq(boards.id, boardId));
    if (!row) throw new NotFoundException('Board not found');
    return row.board;
  }

  async rename(user: User, boardId: string, title: string): Promise<Board> {
    await this.get(user, boardId);
    const [board] = await this.db
      .update(boards)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(eq(boards.id, boardId))
      .returning();
    await this.search.indexBoard(board);
    return board;
  }

  async remove(user: User, boardId: string): Promise<void> {
    await this.get(user, boardId);
    await this.db.delete(boards).where(eq(boards.id, boardId));
    await this.search.removeBoard(boardId);
  }

  async document(user: User, boardId: string): Promise<Buffer> {
    await this.get(user, boardId);
    const doc = await this.db.query.boardDocuments.findFirst({ where: eq(boardDocuments.boardId, boardId) });
    return doc?.state ?? Buffer.alloc(0);
  }

  /** A board's stored document, for the collaboration server; it has already checked access. */
  async loadState(boardId: string): Promise<Buffer | undefined> {
    const doc = await this.db.query.boardDocuments.findFirst({ where: eq(boardDocuments.boardId, boardId) });
    return doc?.state;
  }

  /** Saves a board's document and marks the board changed. Returns the board, or undefined if it's been deleted. */
  async storeState(boardId: string, state: Buffer): Promise<Board | undefined> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [board] = await tx.update(boards).set({ updatedAt: now }).where(eq(boards.id, boardId)).returning();
      if (!board) return undefined;
      await tx
        .insert(boardDocuments)
        .values({ boardId, state, updatedAt: now })
        .onConflictDoUpdate({ target: boardDocuments.boardId, set: { state, updatedAt: now } });
      return board;
    });
  }
}
