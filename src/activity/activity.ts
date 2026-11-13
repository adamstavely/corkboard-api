import { Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { and, desc, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { CurrentUser } from '../auth/current-user';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardVersions, type User } from '../db/schema';
import { BoardEventDto, BoardVersionDto, SaveVersionDto } from './activity.dto';
import { ActivityService } from './activity.service';
import { restoreInto } from './versions';

/** Saved states of boards: made as people edit (see BoardsService.storeState) and by hand, and restored. */
@Injectable()
export class VersionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  async list(user: User, boardId: string): Promise<BoardVersionDto[]> {
    await this.boards.get(user, boardId);
    const rows = await this.db
      .select({ id: boardVersions.id, label: boardVersions.label, createdAt: boardVersions.createdAt, createdBy: boardVersions.createdBy })
      .from(boardVersions)
      .where(eq(boardVersions.boardId, boardId))
      .orderBy(desc(boardVersions.createdAt))
      .limit(100);
    const names = new Map<string, string>();
    for (const m of await this.boards.members(user, boardId)) names.set(m.userId, m.name);
    return rows.map((r) => ({ id: r.id, label: r.label, at: r.createdAt.getTime(), by: r.createdBy ? (names.get(r.createdBy) ?? 'Someone') : null }));
  }

  /** Updaters and owners: saves the board as it is now. */
  async save(user: User, boardId: string, label?: string): Promise<BoardVersionDto> {
    await this.boards.get(user, boardId, 'updater');
    const state = await this.#current(user, boardId);
    const name = label?.trim() || 'Saved version';
    const [row] = await this.db.insert(boardVersions).values({ boardId, state, createdBy: user.id, label: name }).returning();
    await this.activity.record(boardId, user, 'saved a version', name);
    return { id: row.id, label: row.label, at: row.createdAt.getTime(), by: user.name };
  }

  /** Updaters and owners: brings a version back for everyone, saving what's there first so it can be undone. */
  async restore(user: User, boardId: string, versionId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const [version] = await this.db
      .select()
      .from(boardVersions)
      .where(and(eq(boardVersions.id, versionId), eq(boardVersions.boardId, boardId)));
    if (!version) throw new NotFoundException('Version not found');
    const when = version.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    await this.db.insert(boardVersions).values({ boardId, state: await this.#current(user, boardId), createdBy: user.id, label: `Before restoring ${version.label}` });
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      await connection.transact((doc) => restoreInto(doc, new Uint8Array(version.state)));
    } finally {
      await connection.disconnect();
    }
    await this.activity.record(boardId, user, 'restored a version', version.label, `Saved ${when} UTC`);
  }

  async #current(user: User, boardId: string): Promise<Buffer> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      return Buffer.from(Y.encodeStateAsUpdate(connection.document as unknown as Y.Doc));
    } finally {
      await connection.disconnect();
    }
  }
}

@ApiTags('activity')
@ApiBearerAuth()
@Controller('boards/:id')
export class ActivityController {
  constructor(
    private readonly boards: BoardsService,
    private readonly activity: ActivityService,
    private readonly versions: VersionsService,
  ) {}

  /** Anyone on the board: what happened on it, newest first; only after `since` (epoch ms) when given. */
  @Get('activity')
  @ApiQuery({ name: 'since', required: false, type: Number })
  async list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Query('since') since?: string): Promise<BoardEventDto[]> {
    await this.boards.get(user, id);
    const after = Number(since);
    return this.activity.list(id, Number.isFinite(after) && after > 0 ? after : undefined);
  }

  /** Anyone on the board: its saved versions, newest first. */
  @Get('versions')
  listVersions(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardVersionDto[]> {
    return this.versions.list(user, id);
  }

  /** Updaters and owners: save the board as it is now. */
  @Post('versions')
  saveVersion(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveVersionDto): Promise<BoardVersionDto> {
    return this.versions.save(user, id, body.label);
  }

  /** Updaters and owners: bring a version back for everyone (what's there now is saved first). */
  @Post('versions/:versionId/restore')
  @HttpCode(204)
  restore(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<void> {
    return this.versions.restore(user, id, versionId);
  }
}
