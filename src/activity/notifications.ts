import { Body, Controller, Get, HttpCode, Injectable, Logger, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { CurrentUser } from '../auth/current-user';
import { InjectDb, type Db } from '../db/db.module';
import { notifications, type User } from '../db/schema';

export type NotificationKind = 'mention' | 'reply' | 'answer' | 'invite';

export class NotificationDto {
  id!: string;
  kind!: string;
  actor!: string | null;
  title!: string;
  body!: string | null;
  context!: string | null;
  link!: string | null;
  /** Epoch ms. */
  at!: number;
  read!: boolean;
}

export class ReadNotificationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  /** Marks every one read. */
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

/** People named with an @ in a text: "@Ada" or "@Ada Lovelace", any case. */
export function mentioned(text: string, people: readonly { id: string; name: string }[]): string[] {
  const lower = text.toLowerCase();
  const at = (name: string) => {
    const i = lower.indexOf(`@${name.toLowerCase()}`);
    return i >= 0 && !/[\p{L}\p{N}]/u.test(lower[i + name.length + 1] ?? '');
  };
  return people.filter((p) => at(p.name) || at(p.name.split(/\s+/)[0])).map((p) => p.id);
}

/** What people should hear about. Sending never gets in the way of what caused it. */
@Injectable()
export class NotificationsService {
  readonly #log = new Logger(NotificationsService.name);

  constructor(@InjectDb() private readonly db: Db) {}

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
    } catch (err) {
      this.#log.warn(`Couldn't notify ${ids.length} people: ${String(err)}`);
    }
  }

  async mine(user: User): Promise<NotificationDto[]> {
    const rows = await this.db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
    return rows.map((r) => ({
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
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Your latest notifications, newest first. */
  @Get()
  mine(@CurrentUser() user: User): Promise<NotificationDto[]> {
    return this.notifications.mine(user);
  }

  /** Marks some (or all) of your notifications read. */
  @Post('read')
  @HttpCode(204)
  read(@CurrentUser() user: User, @Body() body: ReadNotificationsDto): Promise<void> {
    return this.notifications.read(user, body);
  }
}
