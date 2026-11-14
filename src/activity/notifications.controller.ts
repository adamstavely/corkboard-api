import { Body, Controller, Get, HttpCode, Post, Sse, type MessageEvent } from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { NotificationDto, ReadNotificationsDto } from './notifications.dto';
import { NotificationHub } from './notification-hub';
import { NotificationsService } from './notifications';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly hub: NotificationHub,
  ) {}

  /**
   * A live stream (server-sent events) that says "changed" the moment you have a new notification; fetch the list
   * then. A "ping" every 25 seconds keeps proxies from closing it.
   */
  @Sse('stream')
  stream(@CurrentUser() user: User): Observable<MessageEvent> {
    return merge(
      this.hub.changes(user.id).pipe(map((): MessageEvent => ({ type: 'changed', data: '' }))),
      interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: '' }))),
    );
  }

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
