import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gt, inArray, sql, sum } from 'drizzle-orm';
import * as Y from 'yjs';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import {
  boardEvents,
  boardFolders,
  boards,
  boardVisits,
  commentThreads,
  comments,
  integrations,
  modelProviders,
  modelUsage,
  orgMembers,
  orgs,
  users,
  type User,
} from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { BoardsService } from '../boards/boards.service';
import { SearchIndex } from '../search/search-index';
import type { WorkspaceUsageDto } from './admin.dto';

const DAYS = 30;

/** Workspace owners' view of the whole workspace: usage and spend, a full export, and deleting it. */
@Injectable()
export class AdminService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly search: SearchIndex,
  ) {}

  async usage(user: User, orgId: string): Promise<WorkspaceUsageDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const since = new Date(Date.now() - DAYS * 86_400_000);
    const list = await this.db.select({ id: boards.id, title: boards.title, updatedAt: boards.updatedAt }).from(boards).where(eq(boards.orgId, orgId)).orderBy(desc(boards.updatedAt));
    const ids = list.map((b) => b.id);
    const byBoard = async <T extends { boardId: string | null; n: unknown }>(rows: Promise<T[]>) => new Map((await rows).map((r) => [r.boardId, Number(r.n ?? 0)]));
    const [events, visitors, tokens] = ids.length
      ? await Promise.all([
          byBoard(this.db.select({ boardId: boardEvents.boardId, n: count() }).from(boardEvents).where(and(inArray(boardEvents.boardId, ids), gt(boardEvents.createdAt, since))).groupBy(boardEvents.boardId)),
          byBoard(this.db.select({ boardId: boardVisits.boardId, n: countDistinct(boardVisits.userId) }).from(boardVisits).where(and(inArray(boardVisits.boardId, ids), gt(boardVisits.visitedAt, since))).groupBy(boardVisits.boardId)),
          byBoard(
            this.db
              .select({ boardId: modelUsage.boardId, n: sql<number>`sum(${modelUsage.inputTokens} + ${modelUsage.outputTokens})` })
              .from(modelUsage)
              .where(and(eq(modelUsage.orgId, orgId), gt(modelUsage.createdAt, since)))
              .groupBy(modelUsage.boardId),
          ),
        ])
      : [new Map<string | null, number>(), new Map<string | null, number>(), new Map<string | null, number>()];

    const spend = await this.db
      .select({
        providerId: modelUsage.providerId,
        label: modelUsage.providerLabel,
        calls: count(),
        input: sum(modelUsage.inputTokens),
        output: sum(modelUsage.outputTokens),
        priceIn: modelProviders.priceInPerMillion,
        priceOut: modelProviders.priceOutPerMillion,
      })
      .from(modelUsage)
      .leftJoin(modelProviders, eq(modelProviders.id, modelUsage.providerId))
      .where(and(eq(modelUsage.orgId, orgId), gt(modelUsage.createdAt, since)))
      .groupBy(modelUsage.providerId, modelUsage.providerLabel, modelProviders.priceInPerMillion, modelProviders.priceOutPerMillion);
    const models = spend.map((s) => {
      const input = Number(s.input ?? 0);
      const output = Number(s.output ?? 0);
      const priced = s.priceIn !== null && s.priceOut !== null && s.priceIn !== undefined && s.priceOut !== undefined;
      return {
        providerId: s.providerId,
        label: s.label,
        calls: Number(s.calls),
        inputTokens: input,
        outputTokens: output,
        cost: priced ? Math.round(((input / 1e6) * s.priceIn! + (output / 1e6) * s.priceOut!) * 100) / 100 : null,
      };
    });
    const priced = models.filter((m) => m.cost !== null);
    return {
      since: since.getTime(),
      boards: list.map((b) => ({ id: b.id, title: b.title, updatedAt: b.updatedAt.getTime(), events: events.get(b.id) ?? 0, visitors: visitors.get(b.id) ?? 0, tokens: tokens.get(b.id) ?? 0 })),
      models,
      totals: {
        boards: list.length,
        events: [...events.values()].reduce((a, b) => a + b, 0),
        inputTokens: models.reduce((a, m) => a + m.inputTokens, 0),
        outputTokens: models.reduce((a, m) => a + m.outputTokens, 0),
        cost: priced.length ? Math.round(priced.reduce((a, m) => a + m.cost!, 0) * 100) / 100 : null,
      },
    };
  }

  /**
   * Everything in the workspace as one JSON document: its members, boards (their notes, frames, other things, tasks
   * and chat, as plain data), folders, comments, and its models and trackers without their keys.
   */
  async export(user: User, orgId: string): Promise<Record<string, unknown>> {
    await this.orgs.require(user.id, orgId, 'owner');
    const [org] = await this.db.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) throw new NotFoundException('Workspace not found');
    const members = await this.db.select({ name: users.name, email: users.email, role: orgMembers.role }).from(orgMembers).innerJoin(users, eq(users.id, orgMembers.userId)).where(eq(orgMembers.orgId, orgId));
    const folders = await this.db.select({ id: boardFolders.id, name: boardFolders.name }).from(boardFolders).where(eq(boardFolders.orgId, orgId));
    const list = await this.db.select().from(boards).where(eq(boards.orgId, orgId));
    const threads = list.length ? await this.db.select().from(commentThreads).where(inArray(commentThreads.boardId, list.map((b) => b.id))) : [];
    const said = threads.length
      ? await this.db
          .select({ threadId: comments.threadId, body: comments.body, at: comments.createdAt, author: users.name })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorId))
          .where(inArray(comments.threadId, threads.map((t) => t.id)))
      : [];
    const boardsOut = [];
    for (const b of list) {
      const doc = new Y.Doc();
      const live = this.collab.hocuspocus.documents.get(b.id) as unknown as Y.Doc | undefined;
      const state = live ? Y.encodeStateAsUpdate(live) : await this.boards.loadState(b.id);
      if (state && state.length) Y.applyUpdate(doc, new Uint8Array(state));
      boardsOut.push({
        id: b.id,
        title: b.title,
        folderId: b.folderId,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        content: doc.getMap('nodes').toJSON(),
        tasks: doc.getMap('tasks').toJSON(),
        chat: doc.getArray('chat').toJSON(),
        comments: threads
          .filter((t) => t.boardId === b.id)
          .map((t) => ({ on: t.nodeId, resolved: !!t.resolvedAt, comments: said.filter((c) => c.threadId === t.id).map((c) => ({ by: c.author ?? 'Someone who left', at: c.at, text: c.body })) })),
      });
      doc.destroy();
    }
    const models = await this.db.select({ label: modelProviders.label, kind: modelProviders.kind, model: modelProviders.model }).from(modelProviders).where(eq(modelProviders.orgId, orgId));
    const trackers = await this.db.select({ label: integrations.label, kind: integrations.kind, config: integrations.config }).from(integrations).where(eq(integrations.orgId, orgId));
    return { workspace: { id: org.id, name: org.name }, exportedAt: new Date().toISOString(), members, folders, boards: boardsOut, models, trackers };
  }

  /**
   * Deletes the workspace and everything in it, for good. The name must be typed out, and nobody can delete the last
   * workspace they belong to.
   */
  async remove(user: User, orgId: string, confirm: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    const [org] = await this.db.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) throw new NotFoundException('Workspace not found');
    if (confirm.trim() !== org.name) throw new BadRequestException('Type the workspace’s name exactly to delete it');
    const [{ n }] = await this.db.select({ n: count() }).from(orgMembers).where(eq(orgMembers.userId, user.id));
    if (n <= 1) throw new ConflictException("This is your only workspace, so it can't be deleted");
    const list = await this.db.select({ id: boards.id }).from(boards).where(eq(boards.orgId, orgId));
    await this.db.delete(orgs).where(eq(orgs.id, orgId));
    for (const { id } of list) {
      this.collab.closeBoard(id);
      await this.search.removeBoard(id).catch(() => undefined);
    }
  }
}
