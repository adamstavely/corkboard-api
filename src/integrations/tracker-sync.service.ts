import { BeforeApplicationShutdown, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Subscription } from 'rxjs';
import type * as Y from 'yjs';
import { boardRole } from '../access/roles';
import { ActivityService } from '../activity/activity.service';
import { validTasks, type StoredTask } from '../assist/tasks-doc';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import { changeUnlocked } from '../collab/locks';
import { taskProblem } from '../collab/root-schema';
import { InjectDb, type Db } from '../db/db.module';
import { boardMembers, integrations, issueExports, orgMembers, users, type User } from '../db/schema';
import { SecretBox } from '../models/secret-box';
import { OrgsService } from '../orgs/orgs.service';
import type { BoardSyncDto, WebhookSetupDto } from './integrations.dto';
import { IssueHttp } from './issue-http';
import {
  fetchIssues,
  merge,
  remoteFields,
  STATE_WORDS,
  SYNCED_FIELDS,
  TRACKER_NAMES,
  TrackerError,
  updateIssue,
  type Fields,
  type IssueChange,
  type RemoteIssue,
  type SyncedState,
  type Unsent,
} from './tracker-sync';
import { issueKeysIn, webhookProblem } from './webhooks';

/** The sync, as it appears to the board: its edits are held to the locks as an updater's are. */
const TRACKER: User = { id: '00000000-0000-0000-0000-000000000002', name: 'Issue tracker sync', email: 'tracker-sync@corkboard.invalid', assistantAsksFirst: false, createdAt: new Date(0) };

/** How often the schedule looks for connections that are due. */
const TICK_MS = 30_000;
/** How long after someone stops changing a board's tasks their changes go out. */
const EDIT_SETTLE_MS = 3_000;
/** The longest a failing connection is left before it's tried again. */
const MAX_BACKOFF_MS = 60 * 60_000;
/**
 * A task sent before sync existed has no record of where it and its issue agreed. Its issue counts as changed in the
 * tracker only if it changed this long after the task was sent (making the issue changes it too).
 */
const SENT_GRACE_MS = 60_000;

/** A task as the sync reads it: what the board keeps, with when its synced fields last changed there. */
type SyncTask = StoredTask;
type Link = typeof issueExports.$inferSelect;
type Connection = typeof integrations.$inferSelect;
interface Scope {
  /** Only these boards' tasks; every linked one by default. */
  boardIds?: string[];
  /** Asked for by someone (Sync now): tried even while the connection is backing off. */
  manual?: boolean;
}
/** The people who can open a board, by email; and everyone in the workspace's email, by id. */
interface People {
  byEmail: Map<string, string>;
  emailOf: Map<string, string>;
}

const words = (f: (typeof SYNCED_FIELDS)[number]) => (f === 'title' ? 'Title' : f === 'status' ? 'Status' : 'Assignee');
const asTrackerError = (err: unknown) => (err instanceof TrackerError ? err : new TrackerError((err as Error).message ?? String(err)));

/**
 * Keeps tasks and the issues they were sent as in step: title, status and assignee, both ways. Each connection is
 * checked on a schedule (the guarantee), a few dozen issues to a request, backing off while its tracker fails or asks
 * for a pause; webhooks, edits on the board and Sync now bring a board's turn forward. Where both sides changed the
 * same thing, the later change wins (see merge in tracker-sync.ts). Changes either way go in the board's history.
 */
@Injectable()
export class TrackerSyncService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly #log = new Logger(TrackerSyncService.name);
  readonly #every: number;
  #timer: NodeJS.Timeout | undefined;
  #edits: Subscription | undefined;
  /** Each connection's run under way here, so two never overlap. */
  readonly #running = new Map<string, Promise<void>>();
  /** Boards whose tasks changed, waiting for the edits to settle. */
  readonly #settling = new Map<string, NodeJS.Timeout>();
  readonly #inFlight = new Set<Promise<unknown>>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly collab: CollabService,
    private readonly boards: BoardsService,
    private readonly orgs: OrgsService,
    private readonly secrets: SecretBox,
    private readonly http: IssueHttp,
    private readonly activity: ActivityService,
    private readonly adapterHost: HttpAdapterHost,
    config: ConfigService,
  ) {
    this.#every = config.get<number>('trackerSyncMs') ?? 0;
  }

  /** The time between runs, and the base of the backoff, even with the schedule off. */
  get #interval(): number {
    return this.#every > 0 ? this.#every : 120_000;
  }

  onApplicationBootstrap(): void {
    // Scripts run the app without an HTTP server (see scripts/reindex.ts): they don't sync.
    if (!this.adapterHost.httpAdapter) return;
    this.#edits = this.collab.tasksEdited.subscribe((boardId) => this.#edited(boardId));
    if (this.#every <= 0) return;
    this.#timer = setInterval(() => void this.#track(this.pollDue()), Math.min(TICK_MS, this.#every));
    this.#timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.#timer);
    this.#edits?.unsubscribe();
    for (const t of this.#settling.values()) clearTimeout(t);
    this.#settling.clear();
    await this.settled();
  }

  /** Waits for every run under way to finish. */
  async settled(): Promise<void> {
    while (this.#inFlight.size) await Promise.allSettled([...this.#inFlight]);
  }

  #track<T>(p: Promise<T>): Promise<T> {
    this.#inFlight.add(p);
    void p.then(
      () => this.#inFlight.delete(p),
      () => this.#inFlight.delete(p),
    );
    return p;
  }

  /** Runs each connection that's due and has linked tasks, claiming it first so another API instance doesn't too. */
  async pollDue(): Promise<void> {
    const due = or(isNull(integrations.syncNextAt), lte(integrations.syncNextAt, new Date()));
    const rows = await this.db
      .selectDistinct({ id: integrations.id })
      .from(integrations)
      .innerJoin(issueExports, and(eq(issueExports.integrationId, integrations.id), eq(issueExports.status, 'done')))
      .where(due);
    for (const { id } of rows) {
      const [claimed] = await this.db
        .update(integrations)
        .set({ syncNextAt: new Date(Date.now() + this.#interval) })
        .where(and(eq(integrations.id, id), or(isNull(integrations.syncNextAt), lte(integrations.syncNextAt, new Date()))))
        .returning({ id: integrations.id });
      if (claimed) await this.#run(id, {});
    }
  }

  /** Sync now: this board's linked tasks against every tracker they're in, then how that went. */
  async syncBoard(user: User, boardId: string): Promise<BoardSyncDto> {
    await this.boards.get(user, boardId, 'updater');
    const used = await this.db
      .selectDistinct({ id: issueExports.integrationId })
      .from(issueExports)
      .where(and(eq(issueExports.boardId, boardId), eq(issueExports.status, 'done'), isNotNull(issueExports.integrationId)));
    for (const { id } of used) await this.#run(id!, { boardIds: [boardId], manual: true });
    return this.status(user, boardId);
  }

  /** When each linked task was last compared with its issue, and how each tracker the board uses is doing. */
  async status(user: User, boardId: string): Promise<BoardSyncDto> {
    await this.boards.get(user, boardId);
    const rows = await this.db
      .select({ link: issueExports, tracker: integrations })
      .from(issueExports)
      .innerJoin(integrations, eq(integrations.id, issueExports.integrationId))
      .where(and(eq(issueExports.boardId, boardId), eq(issueExports.status, 'done')));
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    const trackers = new Map(
      rows.map(({ tracker: t }) => [
        t.id,
        {
          integrationId: t.id,
          kind: t.kind,
          label: t.label,
          syncedAt: iso(t.syncedAt),
          error: t.syncError,
          errorAt: iso(t.syncErrorAt),
          retryAt: t.syncError ? iso(t.syncNextAt) : null,
        },
      ]),
    );
    return {
      tasks: rows.map(({ link }) => ({ taskId: link.taskId, issueKey: link.issueKey ?? '', syncedAt: iso(link.syncedAt) })),
      trackers: [...trackers.values()],
    };
  }

  /** Owners: a new webhook secret for a connection (any earlier one stops working), shown this once. */
  async setUpWebhook(user: User, orgId: string, id: string): Promise<WebhookSetupDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const secret = randomBytes(24).toString('hex');
    const [row] = await this.db
      .update(integrations)
      .set({ webhookSecretEncrypted: this.secrets.seal(secret) })
      .where(and(eq(integrations.id, id), eq(integrations.orgId, orgId)))
      .returning({ id: integrations.id });
    if (!row) throw new NotFoundException('Connection not found');
    return { path: `/hooks/trackers/${id}`, secret };
  }

  /**
   * A webhook from a tracker: checked against the connection's secret, then the boards with the issues it names are
   * synced (from the tracker's own answer, not the webhook's word). Returns why it was refused, or null.
   */
  async webhook(id: string, headers: Record<string, string | string[] | undefined>, raw: Buffer | undefined, body: unknown): Promise<string | null> {
    const [row] = await this.db.select().from(integrations).where(eq(integrations.id, id));
    if (!row?.webhookSecretEncrypted || !raw) return 'That webhook is not set up';
    let secret: string;
    try {
      secret = this.secrets.open(row.webhookSecretEncrypted);
    } catch {
      return 'That webhook is not set up';
    }
    const problem = webhookProblem(row.kind, secret, headers, raw);
    if (problem) return problem;
    const keys = issueKeysIn(row.kind, row.config, headers, body);
    if (!keys.length) return null;
    const boards = await this.db
      .selectDistinct({ boardId: issueExports.boardId })
      .from(issueExports)
      .where(and(eq(issueExports.integrationId, id), eq(issueExports.status, 'done'), inArray(issueExports.issueKey, keys)));
    if (boards.length) void this.#track(this.#run(id, { boardIds: boards.map((b) => b.boardId) }));
    return null;
  }

  /** Someone changed a board's tasks: once they've settled, any linked ones that differ from their issues go out. */
  #edited(boardId: string): void {
    clearTimeout(this.#settling.get(boardId));
    const timer = setTimeout(() => {
      this.#settling.delete(boardId);
      void this.#track(this.#afterEdit(boardId)).catch((err: unknown) => this.#log.warn(`Couldn't sync board ${boardId}'s tasks: ${String(err)}`));
    }, EDIT_SETTLE_MS);
    timer.unref();
    this.#settling.set(boardId, timer);
  }

  async #afterEdit(boardId: string): Promise<void> {
    const doc = this.collab.hocuspocus.documents.get(boardId) as unknown as Y.Doc | undefined;
    if (!doc) return;
    const tasks = new Map((validTasks(doc)).filter((t) => t.external).map((t) => [t.id, t]));
    if (!tasks.size) return;
    const links = await this.db
      .select()
      .from(issueExports)
      .where(and(eq(issueExports.boardId, boardId), eq(issueExports.status, 'done'), isNotNull(issueExports.integrationId)));
    const changed = new Set(
      links
        .filter((l) => {
          const t = tasks.get(l.taskId);
          return t && (!l.synced || t.title !== l.synced.board.title || t.status !== l.synced.board.status || (t.assignee ?? null) !== l.synced.board.assignee);
        })
        .map((l) => l.integrationId!),
    );
    for (const id of changed) await this.#run(id, { boardIds: [boardId] });
  }

  /** One run of a connection at a time here; a run asked for while one's under way follows it. */
  #run(id: string, scope: Scope): Promise<void> {
    const before = this.#running.get(id) ?? Promise.resolve();
    const run = before.then(() => this.#sync(id, scope)).catch((err: unknown) => this.#log.error(`Syncing connection ${id} failed: ${String(err)}`));
    this.#running.set(id, run);
    void run.then(() => {
      if (this.#running.get(id) === run) this.#running.delete(id);
    });
    return this.#track(run);
  }

  async #sync(id: string, scope: Scope): Promise<void> {
    const [row] = await this.db.select().from(integrations).where(eq(integrations.id, id));
    if (!row) return;
    // Backing off: only someone asking (Sync now) or the schedule, which waits for it, tries it again.
    if (!scope.manual && scope.boardIds && row.syncFailures > 0 && row.syncNextAt && row.syncNextAt.getTime() > Date.now()) return;
    const links = await this.db
      .select()
      .from(issueExports)
      .where(and(eq(issueExports.integrationId, id), eq(issueExports.status, 'done'), isNotNull(issueExports.issueKey), scope.boardIds ? inArray(issueExports.boardId, scope.boardIds) : undefined));
    if (!links.length) return;

    let token: string;
    let remote: Map<string, RemoteIssue>;
    const send = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => this.http.request(url, init);
    try {
      token = this.secrets.open(row.tokenEncrypted);
      remote = await fetchIssues(send, row.kind, row.config, token, [...new Set(links.map((l) => l.issueKey!))]);
    } catch (err) {
      await this.#failed(row, asTrackerError(err));
      return;
    }
    const byBoard = new Map<string, Link[]>();
    for (const l of links) byBoard.set(l.boardId, [...(byBoard.get(l.boardId) ?? []), l]);
    const people = await this.#people(row.orgId, [...byBoard.keys()]);
    const problems: TrackerError[] = [];
    for (const [boardId, boardLinks] of byBoard) {
      try {
        await this.#syncBoard(row, token, boardId, boardLinks, remote, people.get(boardId)!, problems);
      } catch (err) {
        problems.push(asTrackerError(err));
      }
    }
    if (problems.length) await this.#failed(row, problems[0]);
    else
      await this.db
        .update(integrations)
        .set({ syncedAt: new Date(), syncError: null, syncErrorAt: null, syncFailures: 0, ...(row.syncFailures ? { syncNextAt: new Date(Date.now() + this.#interval) } : {}) })
        .where(eq(integrations.id, id));
  }

  /** Records why a run failed and when to try again: twice as long each time it fails in a row, or as the tracker asked. */
  async #failed(row: Connection, err: TrackerError): Promise<void> {
    const failures = row.syncFailures + 1;
    const wait = Math.max(err.retryAfterMs ?? 0, Math.min(this.#interval * 2 ** (failures - 1), MAX_BACKOFF_MS));
    this.#log.warn(`Syncing ${row.label} (${row.id}) failed ${failures} time(s) in a row: ${err.message}`);
    await this.db
      .update(integrations)
      .set({ syncError: err.message.slice(0, 500), syncErrorAt: new Date(), syncFailures: failures, syncNextAt: new Date(Date.now() + wait) })
      .where(eq(integrations.id, row.id));
  }

  /** For each board, the workspace's people who can open it, by email; and everyone's email by id. */
  async #people(orgId: string, boardIds: string[]): Promise<Map<string, People>> {
    const everyone = await this.db
      .select({ id: users.id, email: users.email, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, orgId));
    const onBoards = await this.db.select().from(boardMembers).where(inArray(boardMembers.boardId, boardIds));
    const emailOf = new Map(everyone.map((p) => [p.id, p.email]));
    return new Map(
      boardIds.map((boardId) => {
        const set = new Map(onBoards.filter((m) => m.boardId === boardId).map((m) => [m.userId, m.role]));
        const byEmail = new Map(everyone.filter((p) => boardRole(p.role, set.get(p.id))).map((p) => [p.email.toLowerCase(), p.id]));
        return [boardId, { byEmail, emailOf }];
      }),
    );
  }

  /** Compares one board's linked tasks with their issues, sends the board's changes out and brings the tracker's in. */
  async #syncBoard(row: Connection, token: string, boardId: string, links: Link[], remote: Map<string, RemoteIssue>, people: People, problems: TrackerError[]): Promise<void> {
    const name = TRACKER_NAMES[row.kind];
    const send = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => this.http.request(url, init);
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user: TRACKER });
    try {
      const doc = connection.document as unknown as Y.Doc;
      const tasks = new Map((validTasks(doc)).map((t) => [t.id, t]));
      /** What to write on the board, task by task, and where the two sides will then agree. */
      const writes: { link: Link; task: SyncTask; issue: RemoteIssue; toBoard: Partial<Fields>; trackerName?: string; synced: SyncedState }[] = [];
      const compared: string[] = [];
      const done: { link: Link; synced: SyncedState }[] = [];

      for (const link of links) {
        const task = tasks.get(link.taskId);
        const issue = remote.get(link.issueKey!);
        if (!task || !issue || task.external?.key !== link.issueKey || task.external.kind !== row.kind) continue;
        const board: Fields = { title: task.title, status: task.status, assignee: task.assignee ?? null };
        const remoteNow = remoteFields(issue);
        const member = issue.assignee?.email ? (people.byEmail.get(issue.assignee.email.toLowerCase()) ?? null) : null;
        const remoteAsBoard: Fields = { title: issue.title.slice(0, 2_000), status: issue.status, assignee: member };
        // When the board last changed them: the time the board's own edit wrote, or (with nothing to go on) now, except
        // for a task never synced, which hasn't changed since it was sent unless it says otherwise.
        const boardAt = Date.parse(task.updated ?? '') || (link.synced ? Date.now() : link.createdAt.getTime() + SENT_GRACE_MS);
        const { toBoard, toTracker } = merge({ board, boardAt, remote: remoteNow, remoteAsBoard, remoteAt: issue.updatedAt, synced: link.synced });

        // The board's changes go out first; one that fails is tried again next time (where they agree is left as it was).
        const remoteAfter: Fields = { ...remoteNow };
        let unsent: Unsent = {};
        if (Object.keys(toTracker).length) {
          const change: IssueChange = {};
          if (toTracker.title !== undefined) change.title = toTracker.title;
          if (toTracker.status !== undefined) change.status = toTracker.status;
          if (toTracker.assignee !== undefined) {
            const email = toTracker.assignee === null ? null : people.emailOf.get(toTracker.assignee);
            if (email === undefined) unsent.assignee = 'they are no longer in the workspace';
            else change.assignee = { email };
          }
          try {
            unsent = { ...unsent, ...(await updateIssue(send, row.kind, row.config, token, issue, change)) };
          } catch (err) {
            problems.push(asTrackerError(err));
            continue;
          }
          if (change.title !== undefined) remoteAfter.title = change.title;
          if (change.status !== undefined && !unsent.status) remoteAfter.status = change.status;
          if (change.assignee && !unsent.assignee) remoteAfter.assignee = change.assignee.email?.toLowerCase() ?? null;
          const sent = SYNCED_FIELDS.filter((f) => toTracker[f] !== undefined && !unsent[f]);
          const lines = [
            ...sent.map((f) => `${words(f)} changed${f === 'status' ? ` to ${STATE_WORDS[toTracker.status!]}` : ''} on the board, sent to ${name}`),
            ...Object.entries(unsent).map(([f, why]) => `${words(f as keyof Fields)} not sent: ${why}`),
          ];
          await this.activity.record(boardId, row.label, 'updated an issue from its task', `${task.key} · ${issue.key}`, lines.join('. '));
        }

        // Where they'll agree once the tracker's changes are on the board: what wasn't sent is left as each side has it.
        const finalBoard: Fields = { ...board, ...toBoard };
        const synced: SyncedState = { board: finalBoard, remote: remoteAfter };
        // Assigned in the tracker to someone not on the board: the task shows their name instead.
        const trackerName = issue.assignee && remoteAfter.assignee === remoteNow.assignee && !(member && member === finalBoard.assignee) ? issue.assignee.name.slice(0, 200) : undefined;
        if (Object.keys(toBoard).length || trackerName !== task.external.assignee) writes.push({ link, task, issue, toBoard, trackerName, synced });
        else if (Object.keys(toTracker).length || !link.synced || !sameState(link.synced, synced)) done.push({ link, synced });
        else compared.push(link.taskId);
      }

      // The tracker's changes, in one edit to the board, held to its locks like an updater's.
      if (writes.length) {
        const applied = new Set<string>();
        await connection.transact((d) =>
          changeUnlocked(d, { role: 'updater', userId: TRACKER.id }, (c) => {
            const map = c.getMap<unknown>('tasks');
            for (const w of writes) {
              const now = map.get(w.link.taskId) as SyncTask | undefined;
              // Changed on the board since it was read: that edit is newer, and the next sync settles it.
              if (!now || JSON.stringify(now) !== JSON.stringify(w.task)) continue;
              const next: SyncTask = { ...now, external: { ...now.external! } };
              if (w.toBoard.title !== undefined) next.title = w.toBoard.title;
              if (w.toBoard.status !== undefined) next.status = w.toBoard.status;
              if (w.toBoard.assignee !== undefined) {
                if (w.toBoard.assignee === null) delete next.assignee;
                else next.assignee = w.toBoard.assignee;
              }
              if (w.trackerName) next.external!.assignee = w.trackerName;
              else delete next.external!.assignee;
              if (taskProblem(w.link.taskId, next)) continue;
              map.set(w.link.taskId, next);
              applied.add(w.link.taskId);
            }
          }),
        );
        for (const w of writes) {
          if (!applied.has(w.link.taskId)) continue;
          done.push({ link: w.link, synced: w.synced });
          const lines = SYNCED_FIELDS.filter((f) => w.toBoard[f] !== undefined).map((f) =>
            f === 'title'
              ? `Title changed to “${w.toBoard.title}” in ${name}`
              : f === 'status'
                ? `Status changed to ${STATE_WORDS[w.toBoard.status!]} in ${name}`
                : w.issue.assignee
                  ? `Assigned to ${w.issue.assignee.name} in ${name}${w.toBoard.assignee ? '' : ', who is not on this board'}`
                  : `Unassigned in ${name}`,
          );
          if (lines.length) await this.activity.record(boardId, row.label, 'updated a task from its issue', `${w.task.key} · ${w.issue.key}`, lines.join('. '));
        }
      }

      const now = new Date();
      for (const { link, synced } of done) {
        await this.db
          .update(issueExports)
          .set({ synced, syncedAt: now })
          .where(and(eq(issueExports.boardId, boardId), eq(issueExports.taskId, link.taskId)));
      }
      if (compared.length) await this.db.update(issueExports).set({ syncedAt: now }).where(and(eq(issueExports.boardId, boardId), inArray(issueExports.taskId, compared)));
    } finally {
      await connection.disconnect();
    }
  }
}

const sameState = (a: SyncedState, b: SyncedState) => SYNCED_FIELDS.every((f) => a.board[f] === b.board[f] && a.remote[f] === b.remote[f]);
