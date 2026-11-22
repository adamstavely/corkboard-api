import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { BoardsService } from '../boards/boards.service';
import { InjectDb, type Db } from '../db/db.module';
import { boardSnapshots, boardVersions, type User } from '../db/schema';
import { ActivityService } from './activity.service';
import { asSteps, materialize, sessionStart } from './replay-chain';
import type { ReplayDto, ReplayFrameDto, ReplayStatesDto } from './replay.dto';

/** Versions replay reaches back to at most, besides the snapshots; older ones are still in the versions list. */
const MAX_VERSIONS = 500;
/** What happened meanwhile, at most. */
const MAX_EVENTS = 2000;
/** Points sent at once. */
export const MAX_STATES = 30;

/**
 * Replay: the board as it was at each point of its history, to step through how it grew. Anyone who can see its
 * versions can replay it: the same people, the same content (see replay-chain.ts for how the points are kept).
 */
@Injectable()
export class ReplayService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly activity: ActivityService,
  ) {}

  async frames(user: User, boardId: string): Promise<ReplayDto> {
    const board = await this.boards.get(user, boardId);
    const frames = await this.#frames(boardId);
    const events = frames.length ? await this.activity.from(boardId, frames[0].at, MAX_EVENTS, { owner: board.role === 'owner' }) : [];
    const from = sessionStart(
      frames.map((f) => f.at),
      events,
    );
    // The board as it was as the session began: the last point before it, or its first.
    const before = from === null ? -1 : frames.findLastIndex((f) => f.at <= from);
    const start = before >= 0 ? frames[before] : frames.find((f) => from !== null && f.at >= from);
    return { frames, events, sessionStartId: start?.id ?? null };
  }

  /** The board at `count` points from `fromId` on: the first whole, the rest as what changed since the one before. */
  async states(user: User, boardId: string, fromId: string, count: number): Promise<ReplayStatesDto> {
    await this.boards.get(user, boardId);
    const frames = await this.#frames(boardId);
    const i = frames.findIndex((f) => f.id === fromId);
    if (i < 0) throw new NotFoundException('That point is no longer in the board’s history');
    const wanted = frames.slice(i, i + Math.max(1, Math.min(count, MAX_STATES)));

    const whole = new Map<string, Uint8Array>();
    const versionIds = wanted.filter((f) => f.kind === 'version').map((f) => f.id);
    if (versionIds.length) {
      const rows = await this.db
        .select({ id: boardVersions.id, state: boardVersions.state })
        .from(boardVersions)
        .where(and(eq(boardVersions.boardId, boardId), inArray(boardVersions.id, versionIds)));
      for (const r of rows) whole.set(r.id, new Uint8Array(r.state));
    }
    const snaps = wanted.filter((f) => f.kind === 'snapshot');
    if (snaps.length) {
      // From the last whole state at or before the first wanted, so each can be built up.
      const [key] = await this.db
        .select({ at: boardSnapshots.createdAt })
        .from(boardSnapshots)
        .where(and(eq(boardSnapshots.boardId, boardId), eq(boardSnapshots.depth, 0), lte(boardSnapshots.createdAt, new Date(snaps[0].at))))
        .orderBy(desc(boardSnapshots.createdAt))
        .limit(1);
      if (key) {
        const rows = await this.db
          .select({ id: boardSnapshots.id, state: boardSnapshots.state, depth: boardSnapshots.depth })
          .from(boardSnapshots)
          .where(and(eq(boardSnapshots.boardId, boardId), gte(boardSnapshots.createdAt, key.at), lte(boardSnapshots.createdAt, new Date(snaps[snaps.length - 1].at))))
          .orderBy(asc(boardSnapshots.createdAt));
        for (const [id, state] of materialize(rows)) if (snaps.some((s) => s.id === id)) whole.set(id, state);
      }
    }
    // A point pruned in the meantime is left out; the rest still build on each other.
    const present = wanted.filter((f) => whole.has(f.id));
    const steps = asSteps(present.map((f) => whole.get(f.id)!));
    return { states: present.map((f, n) => ({ id: f.id, update: Buffer.from(steps[n]).toString('base64') })) };
  }

  /**
   * Every point, oldest first: the snapshots, and the versions (all saved by hand, and the autosaves from before the
   * snapshots begin, which they'd only repeat after).
   */
  async #frames(boardId: string): Promise<ReplayFrameDto[]> {
    const snaps = await this.db
      .select({ id: boardSnapshots.id, at: boardSnapshots.createdAt, depth: boardSnapshots.depth })
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, boardId))
      .orderBy(asc(boardSnapshots.createdAt));
    // Only from the first whole state: anything before it can't be built.
    const firstWhole = snaps.findIndex((s) => s.depth === 0);
    const usable = firstWhole < 0 ? [] : snaps.slice(firstWhole);
    const versions = await this.db
      .select({ id: boardVersions.id, at: boardVersions.createdAt, label: boardVersions.label, by: boardVersions.createdBy })
      .from(boardVersions)
      .where(eq(boardVersions.boardId, boardId))
      .orderBy(desc(boardVersions.createdAt))
      .limit(MAX_VERSIONS);
    const since = usable.length ? usable[0].at.getTime() : Infinity;
    const frames: ReplayFrameDto[] = [
      ...usable.map((s) => ({ id: s.id, at: s.at.getTime(), kind: 'snapshot' as const, label: null })),
      ...versions.filter((v) => v.by !== null || v.at.getTime() < since).map((v) => ({ id: v.id, at: v.at.getTime(), kind: 'version' as const, label: v.label })),
    ];
    return frames.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }
}
