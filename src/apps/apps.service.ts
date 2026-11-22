import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type * as Y from 'yjs';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { canChangeLocked, changeUnlocked, LockedError } from '../collab/locks';
import { InjectDb, type Db } from '../db/db.module';
import { boardApps, boardAppVersions, type User } from '../db/schema';
import { appNodes, MAX_APP_HTML, showAppVersion } from './app-node';
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

  /**
   * A new version of an app on this board; null if there's no such app here. One made for a suggestion stays out of the
   * app's versions until the suggestion is accepted (settleSuggested).
   */
  async addVersion(boardId: string, appId: string, by: { userId: string; model: string | null }, html: string, note: string, suggestionId: string | null = null): Promise<number | null> {
    const problem = htmlProblem(html);
    if (problem) throw new BadRequestException(problem);
    return this.db.transaction(async (tx) => {
      const [app] = await tx.select({ id: boardApps.id }).from(boardApps).where(and(eq(boardApps.id, appId), eq(boardApps.boardId, boardId))).for('update');
      if (!app) return null;
      const [{ latest }] = await tx.select({ latest: max(boardAppVersions.version) }).from(boardAppVersions).where(eq(boardAppVersions.appId, appId));
      const version = (latest ?? 0) + 1;
      await tx.insert(boardAppVersions).values({ appId, version, html, note: note.trim().slice(0, 200) || `Version ${version}`, model: by.model, createdBy: by.userId, suggestionId });
      return version;
    });
  }

  /** A suggestion was accepted (its versions join their apps) or turned down (its versions go). */
  async settleSuggested(boardId: string, suggestionId: string, accepted: boolean): Promise<void> {
    const onBoard = this.db.select({ id: boardApps.id }).from(boardApps).where(eq(boardApps.boardId, boardId));
    const these = and(eq(boardAppVersions.suggestionId, suggestionId), inArray(boardAppVersions.appId, onBoard));
    if (accepted) await this.db.update(boardAppVersions).set({ suggestionId: null }).where(these);
    else await this.db.delete(boardAppVersions).where(these);
  }

  /** An app's latest code, for the model to change; null if there's no such app on this board. */
  async latestHtml(boardId: string, appId: string): Promise<{ title: string; version: number; html: string } | null> {
    const [row] = await this.db
      .select({ title: boardApps.title, version: boardAppVersions.version, html: boardAppVersions.html })
      .from(boardApps)
      .innerJoin(boardAppVersions, eq(boardAppVersions.appId, boardApps.id))
      .where(and(eq(boardApps.id, appId), eq(boardApps.boardId, boardId), isNull(boardAppVersions.suggestionId)))
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
      .where(and(eq(boardAppVersions.appId, appId), isNull(boardAppVersions.suggestionId)))
      .orderBy(desc(boardAppVersions.version));
    return { id: app.id, title: app.title, latest: versions[0]?.version ?? 1, versions };
  }

  async version(user: User, boardId: string, appId: string, version: number): Promise<AppVersionDto> {
    await this.boards.get(user, boardId);
    const [row] = await this.db
      .select({ version: boardAppVersions.version, note: boardAppVersions.note, model: boardAppVersions.model, createdAt: boardAppVersions.createdAt, html: boardAppVersions.html, suggestionId: boardAppVersions.suggestionId })
      .from(boardAppVersions)
      .innerJoin(boardApps, eq(boardApps.id, boardAppVersions.appId))
      .where(and(eq(boardAppVersions.appId, appId), eq(boardAppVersions.version, version), eq(boardApps.boardId, boardId)));
    if (!row) throw new NotFoundException('That version of the app was not found');
    // A suggested version can be looked at (its suggestion previews it), but says so.
    const { suggestionId, ...rest } = row;
    return { ...rest, suggested: suggestionId !== null };
  }

  /** Updaters: brings back an earlier version as a new one, shown wherever the app is on the board. */
  async restore(user: User, boardId: string, appId: string, version: number): Promise<AppDto> {
    const { role } = await this.boards.get(user, boardId, 'updater');
    const old = await this.version(user, boardId, appId, version);
    if (old.suggested) throw new NotFoundException('That version of the app is only suggested so far');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      // A locked app on the board stays as it is for those who may not change locked things: refused before it's saved.
      const doc = connection.document as unknown as Y.Doc;
      if (!canChangeLocked(doc, role, user.id) && appNodes(doc, appId).some((n) => n.get('locked') === true)) {
        throw new ForbiddenException('That app is locked on the board. Only the board\'s owners and the facilitator can change it.');
      }
      const added = await this.addVersion(boardId, appId, { userId: user.id, model: null }, old.html, `Restored version ${version}`);
      if (added === null) throw new NotFoundException('App not found');
      await connection.transact((d) => changeUnlocked(d, { role, userId: user.id }, (t) => showAppVersion(t, appId, added)));
    } catch (e) {
      if (e instanceof LockedError) throw new ForbiddenException(e.message);
      throw e;
    } finally {
      await connection.disconnect();
    }
    const app = await this.get(user, boardId, appId);
    await this.activity.record(boardId, user, 'restored a version of an app', app.title, `Version ${version}`);
    return app;
  }
}
