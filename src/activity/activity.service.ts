import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, isNull, ne, or } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { boardEvents, type User } from '../db/schema';

export interface BoardEvent {
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

/** A board's activity: what happened, who did it and when. Recording never gets in the way of the thing recorded. */
@Injectable()
export class ActivityService {
  readonly #log = new Logger(ActivityService.name);

  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * `restricted`: who did it shows only to the board's owners and in the audit export, for what was anonymous on the
   * board. The person is recorded either way.
   */
  async record(boardId: string, actor: Pick<User, 'id' | 'name'> | string, action: string, target?: string, detail?: string, { restricted = false } = {}): Promise<void> {
    try {
      await this.db.insert(boardEvents).values({
        boardId,
        actorId: typeof actor === 'string' ? null : actor.id,
        actorName: typeof actor === 'string' ? actor : actor.name,
        action,
        target: target?.slice(0, 200) ?? null,
        detail: detail?.slice(0, 1000) ?? null,
        restricted,
      });
    } catch (err) {
      this.#log.warn(`Couldn't record "${action}" on board ${boardId}: ${String(err)}`);
    }
  }

  /** Newest first; only after `since` (epoch ms) when given. Restricted events say who only to owners. */
  async list(boardId: string, since?: number, limit = 200, { owner = false, notBy }: { owner?: boolean; notBy?: string } = {}): Promise<BoardEvent[]> {
    const rows = await this.db
      .select()
      .from(boardEvents)
      // Times go out in whole milliseconds and are kept finer, so "after" starts at the next millisecond.
      .where(
        and(
          eq(boardEvents.boardId, boardId),
          since ? gte(boardEvents.createdAt, new Date(since + 1)) : undefined,
          // Someone's own doings, left out (a null actor is the API's own, and stays).
          notBy ? or(isNull(boardEvents.actorId), ne(boardEvents.actorId, notBy)) : undefined,
        ),
      )
      .orderBy(desc(boardEvents.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, at: r.createdAt.getTime(), actor: r.restricted && !owner ? 'Someone' : r.actorName, action: r.action, target: r.target, detail: r.detail }));
  }
}
