import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { NotificationHub } from './notification-hub';
import { boardRole } from '../access/roles';
import { boardMembers, boards, notifications, orgMembers, type User } from '../db/schema';
import type { NotificationDto, ReadNotificationsDto } from './notifications.dto';

export type NotificationKind = 'mention' | 'reply' | 'answer' | 'invite';

/**
 * A mention picked from a list: "@[Ada Lovelace](<their user id>)". It names one person even when two share a name,
 * and reads as "@Ada Lovelace" wherever the text is shown.
 */
const MENTION = /@\[([^[\]\n]{1,200})\]\(([0-9a-f-]{36})\)/gi;

/** The text as people read it: each picked mention as "@Name". */
export function plainMentions(text: string): string {
  return text.replace(MENTION, '@$1');
}

/**
 * The people a text mentions: those picked from a list (by id), and those typed by name, "@Ada" or "@Ada Lovelace",
 * any case. Only people in `people` count, so someone who can't open the board is never among them.
 */
export function mentioned(text: string, people: readonly { id: string; name: string }[]): string[] {
  const known = new Set(people.map((p) => p.id));
  const picked = [...text.matchAll(MENTION)].map((m) => m[2].toLowerCase()).filter((id) => known.has(id));
  // A picked mention names its person by id alone: its name isn't read again, so a namesake isn't told too.
  const lower = text.replace(MENTION, ' ').toLowerCase();
  const at = (name: string) => {
    const i = lower.indexOf(`@${name.toLowerCase()}`);
    return i >= 0 && !/[\p{L}\p{N}]/u.test(lower[i + name.length + 1] ?? '');
  };
  const typed = people.filter((p) => at(p.name) || at(p.name.split(/\s+/)[0])).map((p) => p.id);
  return [...new Set([...picked, ...typed])];
}

/** What people should hear about. Sending never gets in the way of what caused it. */
@Injectable()
export class NotificationsService {
  readonly #log = new Logger(NotificationsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly hub: NotificationHub,
  ) {}

  async notify(
    userIds: Iterable<string>,
    n: { kind: NotificationKind; actor?: string; title: string; body?: string; context?: string; link?: string; boardId?: string },
  ): Promise<void> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    try {
      await this.db.insert(notifications).values(
        ids.map((userId) => ({
          userId,
          boardId: n.boardId ?? null,
          kind: n.kind,
          actorName: n.actor ?? null,
          title: n.title,
          body: n.body?.slice(0, 300) ?? null,
          context: n.context ?? null,
          link: n.link ?? null,
        })),
      );
      await this.hub.announce(ids);
    } catch (err) {
      this.#log.warn(`Couldn't notify ${ids.length} people: ${String(err)}`);
    }
  }

  /** Their newest notifications; ones about a board they can no longer open are left out, so its text stays private. */
  async mine(user: User): Promise<NotificationDto[]> {
    const rows = await this.db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
    const boardIds = [...new Set(rows.map((r) => r.boardId).filter((id): id is string => !!id))];
    const open = new Set(
      boardIds.length
        ? (
            await this.db
              .select({ id: boards.id, orgRole: orgMembers.role, onBoard: boardMembers.role })
              .from(boards)
              .innerJoin(orgMembers, and(eq(orgMembers.orgId, boards.orgId), eq(orgMembers.userId, user.id)))
              .leftJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, user.id)))
              .where(inArray(boards.id, boardIds))
          )
            .filter((b) => boardRole(b.orgRole, b.onBoard))
            .map((b) => b.id)
        : [],
    );
    return rows.filter((r) => !r.boardId || open.has(r.boardId)).map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: r.actorName,
      title: r.title,
      body: r.body,
      context: r.context,
      link: r.link,
      at: r.createdAt.getTime(),
      read: !!r.readAt,
    }));
  }

  async read(user: User, body: ReadNotificationsDto): Promise<void> {
    const mine = and(eq(notifications.userId, user.id), isNull(notifications.readAt));
    if (body.all) await this.db.update(notifications).set({ readAt: new Date() }).where(mine);
    else if (body.ids?.length) await this.db.update(notifications).set({ readAt: new Date() }).where(and(mine, inArray(notifications.id, body.ids)));
    // Their other tabs and devices catch up too.
    await this.hub.announce([user.id]).catch(() => undefined);
  }
}
