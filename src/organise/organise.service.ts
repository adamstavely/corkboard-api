import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { BoardsService } from '../boards/boards.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardFolders, boards, boardStars, boardVisits, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import type { FolderDto } from './organise.dto';

/** Folders a workspace files boards in, and each person's starred and recently opened boards. */
@Injectable()
export class OrganiseService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly boards: BoardsService,
  ) {}

  async folders(user: User, orgId: string): Promise<FolderDto[]> {
    await this.orgs.roleIn(user.id, orgId);
    return this.db.select({ id: boardFolders.id, name: boardFolders.name }).from(boardFolders).where(eq(boardFolders.orgId, orgId)).orderBy(asc(boardFolders.name));
  }

  /** Updaters and owners of the workspace. */
  async createFolder(user: User, orgId: string, name: string): Promise<FolderDto> {
    await this.orgs.require(user.id, orgId, 'updater');
    const [folder] = await this.db.insert(boardFolders).values({ orgId, name: name.trim() }).returning({ id: boardFolders.id, name: boardFolders.name });
    return folder;
  }

  async renameFolder(user: User, orgId: string, folderId: string, name: string): Promise<FolderDto> {
    await this.orgs.require(user.id, orgId, 'updater');
    const [folder] = await this.db
      .update(boardFolders)
      .set({ name: name.trim() })
      .where(and(eq(boardFolders.id, folderId), eq(boardFolders.orgId, orgId)))
      .returning({ id: boardFolders.id, name: boardFolders.name });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  /** Its boards stay, unfiled. */
  async removeFolder(user: User, orgId: string, folderId: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'updater');
    await this.db.delete(boardFolders).where(and(eq(boardFolders.id, folderId), eq(boardFolders.orgId, orgId)));
  }

  /** Updaters and owners of the board: file it in one of its workspace's folders, or take it out. */
  async moveBoard(user: User, boardId: string, folderId: string | null): Promise<void> {
    const board = await this.boards.get(user, boardId, 'updater');
    if (folderId) {
      const [folder] = await this.db.select({ id: boardFolders.id }).from(boardFolders).where(and(eq(boardFolders.id, folderId), eq(boardFolders.orgId, board.orgId)));
      if (!folder) throw new BadRequestException('That folder is not in this workspace');
    }
    await this.db.update(boards).set({ folderId }).where(eq(boards.id, boardId));
  }

  /** Anyone who can open the board: star it for themselves, or not. */
  async star(user: User, boardId: string, on: boolean): Promise<void> {
    await this.boards.get(user, boardId);
    if (on) await this.db.insert(boardStars).values({ userId: user.id, boardId }).onConflictDoNothing();
    else await this.db.delete(boardStars).where(and(eq(boardStars.userId, user.id), eq(boardStars.boardId, boardId)));
  }

  /** Notes that someone opened a board, for their recently opened list. */
  async visit(user: User, boardId: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(boardVisits)
      .values({ userId: user.id, boardId, visitedAt: now })
      .onConflictDoUpdate({ target: [boardVisits.userId, boardVisits.boardId], set: { visitedAt: now } });
  }
}
