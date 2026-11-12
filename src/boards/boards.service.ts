import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boardDocuments, boards, orgMembers, type Board, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';

/** Most a board's document may grow to, encoded. Generous for stickies; a guard against runaway clients. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

@Injectable()
export class BoardsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
  ) {}

  async list(user: User, orgId: string): Promise<Board[]> {
    await this.orgs.roleIn(user.id, orgId);
    return this.db.select().from(boards).where(eq(boards.orgId, orgId)).orderBy(desc(boards.updatedAt));
  }

  async create(user: User, orgId: string, title: string): Promise<Board> {
    await this.orgs.roleIn(user.id, orgId);
    const [board] = await this.db.insert(boards).values({ orgId, title: title.trim(), createdBy: user.id }).returning();
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
    return board;
  }

  async remove(user: User, boardId: string): Promise<void> {
    await this.get(user, boardId);
    await this.db.delete(boards).where(eq(boards.id, boardId));
  }

  async document(user: User, boardId: string): Promise<Buffer> {
    await this.get(user, boardId);
    const doc = await this.db.query.boardDocuments.findFirst({ where: eq(boardDocuments.boardId, boardId) });
    return doc?.state ?? Buffer.alloc(0);
  }

  async saveDocument(user: User, boardId: string, state: Buffer): Promise<void> {
    await this.get(user, boardId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(boardDocuments)
        .values({ boardId, state, updatedAt: now })
        .onConflictDoUpdate({ target: boardDocuments.boardId, set: { state, updatedAt: now } });
      await tx.update(boards).set({ updatedAt: now }).where(eq(boards.id, boardId));
    });
  }
}
