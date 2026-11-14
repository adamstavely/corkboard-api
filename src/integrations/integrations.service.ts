import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { integrations, users, type User } from '../db/schema';
import { SecretBox } from '../models/secret-box';
import { OrgsService } from '../orgs/orgs.service';
import { checkConfig, createIssue, type IntegrationConfig, type IntegrationKind } from './exporters';
import type { CreateIntegrationDto, ExportResultDto, IntegrationDto } from './integrations.dto';
import { IssueHttp } from './issue-http';

/** A task as the board keeps it, and the issue it went out as. */
interface StoredTask {
  id: string;
  key: string;
  title: string;
  status: string;
  assignee?: string;
  due?: string;
  labels?: string[];
  external?: { kind: string; key: string; url: string };
  [k: string]: unknown;
}

const target = (kind: IntegrationKind, c: IntegrationConfig) =>
  kind === 'github' ? c.repo ?? '' : kind === 'linear' ? `Linear team ${c.teamId ?? ''}` : `${c.projectKey ?? ''} on ${(c.baseUrl ?? '').replace(/^https:\/\//, '')}`;

const view = (row: typeof integrations.$inferSelect): IntegrationDto => ({
  id: row.id,
  kind: row.kind,
  label: row.label,
  config: row.config,
  target: target(row.kind, row.config),
});

/**
 * A workspace's issue trackers, and sending a board's tasks to one. Owners connect them; anyone who can change a
 * board can send its tasks. Each task remembers the issue it became, so it isn't sent twice.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly secrets: SecretBox,
    private readonly http: IssueHttp,
    private readonly activity: ActivityService,
  ) {}

  async list(user: User, orgId: string): Promise<IntegrationDto[]> {
    await this.orgs.require(user.id, orgId, 'reader');
    return (await this.db.select().from(integrations).where(eq(integrations.orgId, orgId)).orderBy(asc(integrations.createdAt))).map(view);
  }

  async create(user: User, orgId: string, body: CreateIntegrationDto): Promise<IntegrationDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const config: IntegrationConfig = Object.fromEntries(Object.entries(body.config).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
    const wrong = checkConfig(body.kind, config);
    if (wrong) throw new BadRequestException(wrong);
    if (!this.secrets.ready) throw new ServiceUnavailableException('This server can’t store tokens yet (MODEL_KEY_SECRET is not set).');
    const [row] = await this.db
      .insert(integrations)
      .values({ orgId, kind: body.kind, label: body.label.trim(), config: config as Record<string, string>, tokenEncrypted: this.secrets.seal(body.token.trim()), createdBy: user.id })
      .returning();
    return view(row);
  }

  async remove(user: User, orgId: string, id: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    const gone = await this.db.delete(integrations).where(and(eq(integrations.id, id), eq(integrations.orgId, orgId))).returning({ id: integrations.id });
    if (!gone.length) throw new NotFoundException('Connection not found');
  }

  /** Sends tasks to the tracker one by one; those that fail are reported, and the rest still go. */
  async export(user: User, boardId: string, integrationId: string, taskIds?: string[]): Promise<ExportResultDto> {
    const board = await this.boards.get(user, boardId, 'updater');
    const [row] = await this.db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.orgId, board.orgId)));
    if (!row) throw new NotFoundException('Connection not found');
    const token = this.secrets.open(row.tokenEncrypted);

    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      const doc = connection.document as unknown as Y.Doc;
      const all = [...doc.getMap<StoredTask>('tasks').values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      const chosen = taskIds?.length ? all.filter((t) => taskIds.includes(t.id)) : all.filter((t) => t.status !== 'done');
      const fresh = chosen.filter((t) => !t.external);
      const assignees = new Map(
        (fresh.some((t) => t.assignee) ? await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, fresh.flatMap((t) => (t.assignee ? [t.assignee] : [])))) : []).map((u) => [u.id, u.name]),
      );
      const result: ExportResultDto = { exported: [], failed: [], skipped: chosen.length - fresh.length };
      for (const task of fresh) {
        const body = [
          `From the Corkboard board “${board.title}”, task ${task.key}.`,
          task.assignee && assignees.get(task.assignee) ? `Owner: ${assignees.get(task.assignee)}` : '',
          task.due ? `Due: ${task.due}` : '',
          task.labels?.length ? `Labels: ${task.labels.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        try {
          const made = await createIssue((url, init) => this.http.request(url, init), row.kind, row.config, token, { title: task.title, body });
          await connection.transact((d) => {
            const tasks = d.getMap<StoredTask>('tasks');
            const now = tasks.get(task.id);
            if (now) tasks.set(task.id, { ...now, external: { kind: row.kind, key: made.key, url: made.url } });
          });
          result.exported.push({ taskId: task.id, taskKey: task.key, issueKey: made.key, url: made.url });
        } catch (err) {
          result.failed.push({ taskId: task.id, taskKey: task.key, reason: (err as Error).message });
          // A refused token or a missing repository fails every task the same way: stop there.
          if (/token was refused|not found/.test((err as Error).message)) break;
        }
      }
      if (result.exported.length) await this.activity.record(boardId, user, `sent tasks to ${row.label}`, `${result.exported.length} task${result.exported.length === 1 ? '' : 's'}`);
      return result;
    } finally {
      await connection.disconnect();
    }
  }
}
