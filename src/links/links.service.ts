import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { InjectDb, type Db } from '../db/db.module';
import { boards, boardShareLinks, users, type User } from '../db/schema';
import type { ShareLinkDto, SharedBoardDto } from './links.dto';

type LinkRow = typeof boardShareLinks.$inferSelect;

/** Whether a link still opens its board. */
export const isLive = (link: Pick<LinkRow, 'revokedAt' | 'expiresAt'>, now = Date.now()) => !link.revokedAt && (!link.expiresAt || link.expiresAt.getTime() > now);

/** Share links: board owners make and revoke them; anyone with one can view the board, read-only. */
@Injectable()
export class LinksService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly activity: ActivityService,
  ) {}

  async list(user: User, boardId: string): Promise<ShareLinkDto[]> {
    await this.boards.get(user, boardId, 'owner');
    const rows = await this.db
      .select({ link: boardShareLinks, by: users.name })
      .from(boardShareLinks)
      .leftJoin(users, eq(users.id, boardShareLinks.createdBy))
      .where(eq(boardShareLinks.boardId, boardId))
      .orderBy(desc(boardShareLinks.createdAt));
    return rows.map(({ link, by }) => toDto(link, by ?? 'Someone'));
  }

  async create(user: User, boardId: string, label?: string, expiresInDays?: number): Promise<ShareLinkDto> {
    await this.boards.get(user, boardId, 'owner');
    const [link] = await this.db
      .insert(boardShareLinks)
      .values({
        boardId,
        token: randomBytes(24).toString('base64url'),
        label: label?.trim() || null,
        createdBy: user.id,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      })
      .returning();
    await this.activity.record(boardId, user, 'made a share link', link.label ?? undefined);
    return toDto(link, user.name);
  }

  async setExpiry(user: User, boardId: string, linkId: string, expiresAt: number | null): Promise<ShareLinkDto> {
    await this.boards.get(user, boardId, 'owner');
    const [link] = await this.db
      .update(boardShareLinks)
      .set({ expiresAt: expiresAt === null ? null : new Date(expiresAt) })
      .where(and(eq(boardShareLinks.id, linkId), eq(boardShareLinks.boardId, boardId)))
      .returning();
    if (!link) throw new NotFoundException('Link not found');
    return toDto(link, user.name);
  }

  /** It stops working at once; anyone viewing through it is let go (see CollabService). */
  async revoke(user: User, boardId: string, linkId: string): Promise<LinkRow> {
    await this.boards.get(user, boardId, 'owner');
    const [link] = await this.db
      .update(boardShareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(boardShareLinks.id, linkId), eq(boardShareLinks.boardId, boardId)))
      .returning();
    if (!link) throw new NotFoundException('Link not found');
    await this.activity.record(boardId, user, 'revoked a share link', link.label ?? undefined);
    return link;
  }

  /** The link behind a token, if it still opens its board. */
  async byToken(token: string): Promise<LinkRow | null> {
    const [link] = await this.db.select().from(boardShareLinks).where(eq(boardShareLinks.token, token));
    return link && isLive(link) ? link : null;
  }

  /** For the shared page: what the link opens, counting the open. */
  async open(token: string): Promise<SharedBoardDto> {
    const [row] = await this.db
      .select({ link: boardShareLinks, title: boards.title })
      .from(boardShareLinks)
      .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
      .where(eq(boardShareLinks.token, token));
    if (!row) throw new NotFoundException('This link does not open anything');
    if (!isLive(row.link)) throw new GoneException('This link has been turned off or has expired');
    await this.db
      .update(boardShareLinks)
      .set({ opens: sql`${boardShareLinks.opens} + 1`, lastOpenedAt: new Date() })
      .where(eq(boardShareLinks.id, row.link.id));
    return { boardId: row.link.boardId, title: row.title };
  }
}

function toDto(link: LinkRow, by: string): ShareLinkDto {
  return {
    id: link.id,
    token: link.token,
    label: link.label,
    createdBy: by,
    createdAt: link.createdAt.getTime(),
    expiresAt: link.expiresAt?.getTime() ?? null,
    revoked: !!link.revokedAt,
    opens: link.opens,
    lastOpenedAt: link.lastOpenedAt?.getTime() ?? null,
  };
}
