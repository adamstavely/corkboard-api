import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { validTasks } from '../assist/tasks-doc';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { integrations, issueExports, users, type User } from '../db/schema';
import { SecretBox } from '../models/secret-box';
import { OrgsService } from '../orgs/orgs.service';
import { PoliciesService } from '../policies/policies.service';
import { checkConfig, createIssue, type IntegrationConfig, type IntegrationKind } from './exporters';
import type { CreateIntegrationDto, ExportResultDto, IntegrationDto } from './integrations.dto';
import { IssueHttp } from './issue-http';

/**
 * How long a send may hold a task before its claim is taken as left behind by a crash or restart: well past the
 * tracker request's own time limit, so a send still under way is never mistaken for one.
 */
export const CLAIM_LEASE_MS = 5 * 60_000;

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
  readonly #log = new Logger(IntegrationsService.name);
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly secrets: SecretBox,
    private readonly http: IssueHttp,
    private readonly activity: ActivityService,
    private readonly policies: PoliciesService,
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
    await this.policies.check(user, board, 'exports');
    const [row] = await this.db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.orgId, board.orgId)));
    if (!row) throw new NotFoundException('Connection not found');
    const token = this.secrets.open(row.tokenEncrypted);

    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      const doc = connection.document as unknown as Y.Doc;
      const all = (validTasks(doc) as unknown as StoredTask[]).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      const chosen = taskIds?.length ? all.filter((t) => taskIds.includes(t.id)) : all.filter((t) => t.status !== 'done');
      const fresh = chosen.filter((t) => !t.external);
      const assignees = new Map(
        (fresh.some((t) => t.assignee) ? await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, fresh.flatMap((t) => (t.assignee ? [t.assignee] : [])))) : []).map((u) => [u.id, u.name]),
      );
      const result: ExportResultDto = { exported: [], failed: [], skipped: chosen.length - fresh.length };
      const link = (taskId: string, made: { key: string; url: string }) =>
        connection.transact((d) => {
          const tasks = d.getMap<StoredTask>('tasks');
          const now = tasks.get(taskId);
          if (now && !now.external) tasks.set(taskId, { ...now, external: { kind: row.kind, key: made.key, url: made.url } });
        });
      for (const task of fresh) {
        // Claim the task first, so another export running now can't send it too. Asked for by name, an earlier send
        // that ended without an answer is tried again (the person has checked the tracker).
        const claim = await this.#claim(boardId, task.id, row.id, row.kind, !!taskIds?.includes(task.id));
        if (claim.kind === 'done') {
          await link(task.id, claim);
          result.skipped++;
          continue;
        }
        if (claim.kind === 'busy') {
          result.failed.push({ taskId: task.id, taskKey: task.key, reason: claim.reason, ...(claim.mayExist ? { mayExist: true } : {}) });
          continue;
        }
        const body = [
          `From the Corkboard board “${board.title}”, task ${task.key}.`,
          task.assignee && assignees.get(task.assignee) ? `Owner: ${assignees.get(task.assignee)}` : '',
          task.due ? `Due: ${task.due}` : '',
          task.labels?.length ? `Labels: ${task.labels.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        let answered = false;
        let made: { key: string; url: string };
        try {
          made = await createIssue(
            (url, init) => this.http.request(url, init).then((reply) => ((answered = true), reply)),
            row.kind,
            row.config,
            token,
            { title: task.title, body },
          );
        } catch (err) {
          const message = (err as Error).message;
          if (answered) {
            // The tracker said no: nothing was made, so the task is free to send again.
            await this.db.delete(issueExports).where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, task.id)));
            result.failed.push({ taskId: task.id, taskKey: task.key, reason: message });
          } else {
            // No answer: it may have been made. Held until someone checks and sends it again by name.
            await this.db.update(issueExports).set({ status: 'unknown' }).where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, task.id)));
            result.failed.push({ taskId: task.id, taskKey: task.key, reason: `${message} It may have been created: check ${row.label} before sending it again.`, mayExist: true });
          }
          // A refused token or a missing repository fails every task the same way: stop there.
          if (/token was refused|not found/.test(message)) break;
          continue;
        }
        // The issue exists now. Whatever fails from here, the claim is never let go (that would send it twice): what's
        // left is recording it here and linking the task, which sending the task again finishes without a new issue.
        try {
          await this.db
            .update(issueExports)
            .set({ status: 'done', issueKey: made.key, url: made.url })
            .where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, task.id)));
        } catch (err) {
          this.#log.error(`Created ${made.key} (${made.url}) for task ${task.id} on board ${boardId} but couldn't record it: ${String(err)}`);
          // Linked on the board, the task is never sent again (only tasks without an issue are).
          const linked = await link(task.id, made).then(
            () => true,
            () => false,
          );
          result.failed.push({
            taskId: task.id,
            taskKey: task.key,
            reason: linked ? `Created as ${made.key}, but it couldn't be recorded here; the task is linked to it.` : `Created as ${made.key} (${made.url}), but it couldn't be recorded or linked here. Don't send it again; link it by hand.`,
          });
          continue;
        }
        try {
          await link(task.id, made);
          result.exported.push({ taskId: task.id, taskKey: task.key, issueKey: made.key, url: made.url });
        } catch {
          result.failed.push({ taskId: task.id, taskKey: task.key, reason: `Created as ${made.key}, but the task couldn't be linked to it. Send it again to link it; no new issue is made.` });
        }
      }
      if (result.exported.length) await this.activity.record(boardId, user, `sent tasks to ${row.label}`, `${result.exported.length} task${result.exported.length === 1 ? '' : 's'}`);
      return result;
    } finally {
      await connection.disconnect();
    }
  }

  /**
   * Claims a task for sending: free, or already sent (with its issue), or held by another send that's under way or
   * ended without an answer. `retryUnknown` takes over one that ended without an answer.
   */
  async #claim(
    boardId: string,
    taskId: string,
    integrationId: string,
    kind: 'github' | 'linear' | 'jira',
    retryUnknown: boolean,
  ): Promise<{ kind: 'claimed' } | { kind: 'done'; key: string; url: string } | { kind: 'busy'; reason: string; mayExist?: boolean }> {
    const [claimed] = await this.db
      .insert(issueExports)
      .values({ boardId, taskId, integrationId, kind, status: 'pending' })
      .onConflictDoNothing()
      .returning({ taskId: issueExports.taskId });
    if (claimed) return { kind: 'claimed' };
    let [held] = await this.db.select().from(issueExports).where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, taskId)));
    if (!held) return this.#claim(boardId, taskId, integrationId, kind, retryUnknown);
    // A claim pending past its lease was left by a send that never finished (a crash or restart): it may have made the
    // issue, so it's treated as a send that got no answer.
    if (held.status === 'pending' && held.claimedAt.getTime() < Date.now() - CLAIM_LEASE_MS) {
      const [abandoned] = await this.db
        .update(issueExports)
        .set({ status: 'unknown' })
        .where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, taskId), eq(issueExports.status, 'pending'), lt(issueExports.claimedAt, new Date(Date.now() - CLAIM_LEASE_MS))))
        .returning();
      if (abandoned) held = abandoned;
    }
    if (held.status === 'done' && held.issueKey && held.url) return { kind: 'done', key: held.issueKey, url: held.url };
    if (held.status === 'unknown' && retryUnknown) {
      const [taken] = await this.db
        .update(issueExports)
        .set({ status: 'pending', integrationId, kind, claimedAt: new Date() })
        .where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, taskId), eq(issueExports.status, 'unknown')))
        .returning({ taskId: issueExports.taskId });
      if (taken) return { kind: 'claimed' };
    }
    return held.status === 'unknown'
      ? { kind: 'busy', reason: 'An earlier send got no answer and may have created an issue. Check the tracker, then send this task again.', mayExist: true }
      : { kind: 'busy', reason: 'This task is being sent right now.' };
  }
}
