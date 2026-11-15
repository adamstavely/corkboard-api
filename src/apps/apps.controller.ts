import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AppDto, AppVersionDto, RestoreAppDto } from './apps.dto';
import { AppsService } from './apps.service';

@ApiTags('apps')
@ApiBearerAuth()
@Controller('boards/:id/apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  /** A mini-app on the board (see its `app` items) and its versions. */
  @Get(':appId')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('appId', ParseUUIDPipe) appId: string): Promise<AppDto> {
    return this.apps.get(user, id, appId);
  }

  /** One version's code. */
  @Get(':appId/versions/:version')
  version(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<AppVersionDto> {
    return this.apps.version(user, id, appId, version);
  }

  /** Updaters and owners: bring an earlier version back, as a new version. */
  @Post(':appId/restore')
  restore(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('appId', ParseUUIDPipe) appId: string, @Body() body: RestoreAppDto): Promise<AppDto> {
    return this.apps.restore(user, id, appId, body.version);
  }
}
