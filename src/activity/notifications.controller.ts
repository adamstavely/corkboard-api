import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { NotificationDto, ReadNotificationsDto } from './notifications.dto';
import { NotificationsService } from './notifications';

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
