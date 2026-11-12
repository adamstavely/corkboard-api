import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { atLeast, boardRole, needs, type Role } from '../access/roles';
import { InjectDb, type Db } from '../db/db.module';
import {
  boardDocuments,
  boardMembers,
  boards,
  orgMembers,
  users,
  type Board,
  type BoardAccess,
  type OrgRole,
  type User,
} from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { SearchIndex } from '../search/search-index';

/** A board with the role the person asking has on it. */
export type BoardWithRole = Board & { role: Role };

/** Someone in the board's workspace, and what they may do on it. */
export interface BoardMember {
  userId: string;
  name: string;
  email: string | null;
  workspaceRole: OrgRole;
  /** Set on this board, replacing the workspace role; null when it follows the workspace. */
  boardRole: BoardAccess | null;
  /** What they may do here; null when they can't open it. */
  role: Role | null;
}

@Injectable()
export class BoardsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly search: SearchIndex,
  ) {}

  /** The workspace's boards the user can open, most recently changed first, each with their role on it. */
  async list(user: User, orgId: string): Promise<BoardWithRole[]> {
    const orgRole = await this.orgs.roleIn(user.id, orgId);
    const rows = await this.db
      .select({ board: boards, onBoard: boardMembers.role })
      .from(boards)
      .leftJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, user.id)))
      .where(eq(boards.orgId, orgId))
      .orderBy(desc(boards.updatedAt));
    return rows.flatMap(({ board, onBoard }) => {
      const role = boardRole(orgRole, onBoard);
      return role ? [{ ...board, role }] : [];
    });
  }

  /** Ids of the workspace's boards kept from the user, so search can leave them out. */
  async hiddenFrom(user: User, orgId: string): Promise<string[]> {
    if ((await this.orgs.roleIn(user.id, orgId)) === 'owner') return [];
    const rows = await this.db
      .select({ id: boards.id })
      .from(boardMembers)
      .innerJoin(boards, eq(boards.id, boardMembers.boardId))
      .where(and(eq(boards.orgId, orgId), eq(boardMembers.userId, user.id), eq(boardMembers.role, 'none')));
    return rows.map((r) => r.id);
  }

  /** A new board, owned by whoever made it. Updaters and owners of the workspace can make them. */
  async create(user: User, orgId: string, title: string): Promise<BoardWithRole> {
    await this.orgs.require(user.id, orgId, 'updater');
    const board = await this.db.transaction(async (tx) => {
      const [made] = await tx.insert(boards).values({ orgId, title: title.trim(), createdBy: user.id }).returning();
      await tx.insert(boardMembers).values({ boardId: made.id, userId: user.id, role: 'owner' });
      return made;
    });
    await this.search.indexBoard(board);
    return { ...board, role: 'owner' };
  }

  /**
   * A board and the user's role on it. A board they can't open – in another workspace, or kept from them – is
   * reported as missing, so its existence doesn't leak.
   */
  async access(user: User, boardId: string): Promise<BoardWithRole> {
    const [row] = await this.db
      .select({ board: boards, orgRole: orgMembers.role, onBoard: boardMembers.role })
      .from(boards)
      .innerJoin(orgMembers, and(eq(orgMembers.orgId, boards.orgId), eq(orgMembers.userId, user.id)))
      .leftJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, user.id)))
      .where(eq(boards.id, boardId));
    const role = row && boardRole(row.orgRole, row.onBoard);
    if (!row || !role) throw new NotFoundException('Board not found');
    return { ...row.board, role };
  }

  /** A board the user can open with at least role `min`; 403 if their role is lower. */
  async get(user: User, boardId: string, min: Role = 'reader'): Promise<BoardWithRole> {
    const board = await this.access(user, boardId);
    if (!atLeast(board.role, min)) throw new ForbiddenException(needs(min));
    return board;
  }

  async rename(user: User, boardId: string, title: string): Promise<BoardWithRole> {
    const { role } = await this.get(user, boardId, 'updater');
    const [board] = await this.db
      .update(boards)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(eq(boards.id, boardId))
      .returning();
    await this.search.indexBoard(board);
    return { ...board, role };
  }

  async remove(user: User, boardId: string): Promise<void> {
    await this.get(user, boardId, 'owner');
    await this.db.delete(boards).where(eq(boards.id, boardId));
    await this.search.removeBoard(boardId);
  }

  /** Everyone in the board's workspace and what they may do on it; anyone who can open the board can see this. */
  async members(user: User, boardId: string): Promise<BoardMember[]> {
    const board = await this.get(user, boardId);
    const rows = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, workspaceRole: orgMembers.role, boardRole: boardMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .leftJoin(boardMembers, and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, orgMembers.userId)))
      .where(eq(orgMembers.orgId, board.orgId))
      .orderBy(asc(users.name));
    return rows.map((r) => ({ ...r, role: boardRole(r.workspaceRole, r.boardRole) ?? null }));
  }

  /**
   * Sets someone's role on one board, replacing their workspace role there (`none` keeps them out), or with null
   * returns them to their workspace role. Board owners can; workspace owners own every board and can't be changed.
   */
  async setRole(user: User, boardId: string, memberId: string, role: BoardAccess | null): Promise<BoardMember> {
    const board = await this.get(user, boardId, 'owner');
    const [member] = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, workspaceRole: orgMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, board.orgId), eq(orgMembers.userId, memberId)));
    if (!member) throw new NotFoundException('Only people in the workspace can be given a role on its boards');
    if (member.workspaceRole === 'owner') {
      throw new ConflictException('Workspace owners own every board. Change their workspace role first.');
    }
    if (role === null) {
      await this.db.delete(boardMembers).where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, memberId)));
    } else {
      await this.db
        .insert(boardMembers)
        .values({ boardId, userId: memberId, role })
        .onConflictDoUpdate({ target: [boardMembers.boardId, boardMembers.userId], set: { role } });
    }
    return { ...member, boardRole: role, role: boardRole(member.workspaceRole, role) ?? null };
  }

  async document(user: User, boardId: string): Promise<Buffer> {
    await this.access(user, boardId);
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
