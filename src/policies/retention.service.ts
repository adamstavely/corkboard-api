import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { BoardsService } from '../boards/boards.service';
import { CollabService, SERVER } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardEvents, boards, boardSnapshots, boardVersions, workspacePolicies } from '../db/schema';
import { forgetBefore, ledgerEntries } from '../ledger/ledger-doc';

const DAY_MS = 86_400_000;
/** The first prune waits for the app to settle after starting. */
const FIRST_MS = 60_000;

/** What one prune removed. */
export interface Pruned {
  events: number;
  versions: number;
  /** Replay's snapshots. */
  snapshots: number;
  ledgerEntries: number;
}

/**
 * Workspaces' retention policies: once a day, board history (activity), saved versions, replay's snapshots and the
 * assistant's undo list older than a workspace keeps are deleted. A board's current state is never touched: it isn't history.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly #log = new Logger('Retention');
  #timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => void this.pruneAll().catch((err: unknown) => this.#log.warn(`Couldn't prune old history: ${String(err)}`));
    this.#timer = setTimeout(() => {
      run();
      this.#timer = setInterval(run, DAY_MS);
      this.#timer.unref();
    }, FIRST_MS);
    this.#timer.unref();
  }

  beforeApplicationShutdown(): void {
    clearTimeout(this.#timer);
    clearInterval(this.#timer);
  }

  /** Every workspace with a retention policy. */
  async pruneAll(now = Date.now()): Promise<void> {
    const rows = await this.db.select({ orgId: workspacePolicies.orgId }).from(workspacePolicies).where(isNotNull(workspacePolicies.retentionDays));
    for (const { orgId } of rows) {
      const pruned = await this.pruneOrg(orgId, now);
      if (pruned.events || pruned.versions || pruned.snapshots || pruned.ledgerEntries)
        this.#log.log(`Workspace ${orgId}: removed ${pruned.events} history lines, ${pruned.versions} versions, ${pruned.snapshots} replay snapshots, ${pruned.ledgerEntries} undo entries`);
    }
  }

  /** One workspace, under its policy as it is now; nothing when it keeps history for good. */
  async pruneOrg(orgId: string, now = Date.now()): Promise<Pruned> {
    const [policy] = await this.db.select({ days: workspacePolicies.retentionDays }).from(workspacePolicies).where(eq(workspacePolicies.orgId, orgId));
    if (!policy?.days) return { events: 0, versions: 0, snapshots: 0, ledgerEntries: 0 };
    const cutoff = new Date(now - policy.days * DAY_MS);
    const ids = (await this.db.select({ id: boards.id }).from(boards).where(eq(boards.orgId, orgId))).map((b) => b.id);
    if (!ids.length) return { events: 0, versions: 0, snapshots: 0, ledgerEntries: 0 };
    const events = await this.db.delete(boardEvents).where(and(inArray(boardEvents.boardId, ids), lt(boardEvents.createdAt, cutoff))).returning({ id: boardEvents.id });
    const versions = await this.db.delete(boardVersions).where(and(inArray(boardVersions.boardId, ids), lt(boardVersions.createdAt, cutoff))).returning({ id: boardVersions.id });
    // Snapshots past the cutoff, then any left that only build on those (until each board's first whole state).
    const old = await this.db.delete(boardSnapshots).where(and(inArray(boardSnapshots.boardId, ids), lt(boardSnapshots.createdAt, cutoff))).returning({ id: boardSnapshots.id });
    const orphans = await this.db
      .delete(boardSnapshots)
      .where(
        and(
          inArray(boardSnapshots.boardId, ids),
          sql`${boardSnapshots.createdAt} < coalesce((select min(k.created_at) from board_snapshots k where k.board_id = ${boardSnapshots.boardId} and k.depth = 0), 'infinity')`,
        ),
      )
      .returning({ id: boardSnapshots.id });
    let ledger = 0;
    for (const id of ids) ledger += await this.#pruneLedger(id, cutoff.getTime());
    return { events: events.length, versions: versions.length, snapshots: old.length + orphans.length, ledgerEntries: ledger };
  }

  /** The board's undo list, through the collaboration server so people with it open see the change; only boards that need it are opened. */
  async #pruneLedger(boardId: string, cutoff: number): Promise<number> {
    const live = this.collab.hocuspocus.documents.get(boardId) as unknown as Y.Doc | undefined;
    if (!live) {
      const state = await this.boards.loadState(boardId);
      if (!state?.length) return 0;
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, new Uint8Array(state));
        if (!ledgerEntries(doc).some((e) => e.at < cutoff)) return 0;
      } finally {
        doc.destroy();
      }
    } else if (!ledgerEntries(live).some((e) => e.at < cutoff)) return 0;
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user: SERVER });
    let removed = 0;
    try {
      await connection.transact((doc) => {
        removed = forgetBefore(doc, cutoff);
      });
    } finally {
      await connection.disconnect();
    }
    return removed;
  }
}
