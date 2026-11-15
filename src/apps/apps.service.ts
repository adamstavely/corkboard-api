import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, max } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardApps, boardAppVersions, type User } from '../db/schema';
import { MAX_APP_HTML, showAppVersion } from './app-node';
import type { AppDto, AppVersionDto } from './apps.dto';

/** What's wrong with a mini-app's code, or null if it can go on the board. */
export function htmlProblem(html: unknown): string | null {
  if (typeof html !== 'string' || !html.trim()) return 'The app needs its HTML.';
  if (html.length > MAX_APP_HTML) return `The app's HTML is ${html.length.toLocaleString('en')} characters; the most is ${MAX_APP_HTML.toLocaleString('en')}. Make it smaller.`;
  return null;
}

/**
 * Mini-apps' code, every version kept. The assistant makes them and writes new versions; anyone on the board can see
 * one and its versions; updaters can bring back an earlier version.
 */
@Injectable()
export class AppsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  /** A new app with its first version. */
  async create(boardId: string, by: { userId: string; model: string | null }, title: string, html: string): Promise<{ id: string; version: number }> {
    const problem = htmlProblem(html);
    if (problem) throw new BadRequestException(problem);
    return this.db.transaction(async (tx) => {
      const [app] = await tx.insert(boardApps).values({ boardId, title: title.trim().slice(0, 120) || 'App', createdBy: by.userId }).returning({ id: boardApps.id });
      await tx.insert(boardAppVersions).values({ appId: app.id, version: 1, html, note: 'Made it', model: by.model, createdBy: by.userId });
      return { id: app.id, version: 1 };
    });
  }

  /** A new version of an app on this board; null if there's no such app here. */
  async addVersion(boardId: string, appId: string, by: { userId: string; model: string | null }, html: string, note: string): Promise<number | null> {
    const problem = htmlProblem(html);
    if (problem) throw new BadRequestException(problem);
    return this.db.transaction(async (tx) => {
      const [app] = await tx.select({ id: boardApps.id }).from(boardApps).where(and(eq(boardApps.id, appId), eq(boardApps.boardId, boardId))).for('update');
      if (!app) return null;
      const [{ latest }] = await tx.select({ latest: max(boardAppVersions.version) }).from(boardAppVersions).where(eq(boardAppVersions.appId, appId));
      const version = (latest ?? 0) + 1;
      await tx.insert(boardAppVersions).values({ appId, version, html, note: note.trim().slice(0, 200) || `Version ${version}`, model: by.model, createdBy: by.userId });
      return version;
    });
  }

  /** An app's latest code, for the model to change; null if there's no such app on this board. */
  async latestHtml(boardId: string, appId: string): Promise<{ title: string; version: number; html: string } | null> {
    const [row] = await this.db
      .select({ title: boardApps.title, version: boardAppVersions.version, html: boardAppVersions.html })
      .from(boardApps)
      .innerJoin(boardAppVersions, eq(boardAppVersions.appId, boardApps.id))
      .where(and(eq(boardApps.id, appId), eq(boardApps.boardId, boardId)))
      .orderBy(desc(boardAppVersions.version))
      .limit(1);
    return row ?? null;
  }

  async get(user: User, boardId: string, appId: string): Promise<AppDto> {
    await this.boards.get(user, boardId);
    const [app] = await this.db.select().from(boardApps).where(and(eq(boardApps.id, appId), eq(boardApps.boardId, boardId)));
    if (!app) throw new NotFoundException('App not found');
    const versions = await this.db
      .select({ version: boardAppVersions.version, note: boardAppVersions.note, model: boardAppVersions.model, createdAt: boardAppVersions.createdAt })
      .from(boardAppVersions)
      .where(eq(boardAppVersions.appId, appId))
      .orderBy(desc(boardAppVersions.version));
    return { id: app.id, title: app.title, latest: versions[0]?.version ?? 1, versions };
  }

  async version(user: User, boardId: string, appId: string, version: number): Promise<AppVersionDto> {
    await this.boards.get(user, boardId);
    const [row] = await this.db
      .select({ version: boardAppVersions.version, note: boardAppVersions.note, model: boardAppVersions.model, createdAt: boardAppVersions.createdAt, html: boardAppVersions.html })
      .from(boardAppVersions)
      .innerJoin(boardApps, eq(boardApps.id, boardAppVersions.appId))
      .where(and(eq(boardAppVersions.appId, appId), eq(boardAppVersions.version, version), eq(boardApps.boardId, boardId)));
    if (!row) throw new NotFoundException('That version of the app was not found');
    return row;
  }

  /** Updaters: brings back an earlier version as a new one, shown wherever the app is on the board. */
  async restore(user: User, boardId: string, appId: string, version: number): Promise<AppDto> {
    await this.boards.get(user, boardId, 'updater');
    const old = await this.version(user, boardId, appId, version);
    const added = await this.addVersion(boardId, appId, { userId: user.id, model: null }, old.html, `Restored version ${version}`);
    if (added === null) throw new NotFoundException('App not found');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      await connection.transact((doc) => showAppVersion(doc, appId, added));
    } finally {
      await connection.disconnect();
    }
    const app = await this.get(user, boardId, appId);
    await this.activity.record(boardId, user, 'restored a version of an app', app.title, `Version ${version}`);
    return app;
  }
}
