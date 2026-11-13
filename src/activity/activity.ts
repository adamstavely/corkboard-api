import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardVersions, type User } from '../db/schema';
import type { BoardVersionDto } from './activity.dto';
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
    await this.db.insert(boardVersions).values({ boardId, state: await this.#current(user, boardId), createdBy: user.id, label: `Before restoring ${version.label.replace(/^(Before restoring )+/, '')}` });
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
