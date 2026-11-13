import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import { BoardsService } from '../boards/boards.service';
import type { User } from '../db/schema';
import { BoardEventDto, BoardVersionDto, SaveVersionDto } from './activity.dto';
import { ActivityService } from './activity.service';
import { VersionsService } from './activity';

@ApiTags('activity')
@ApiBearerAuth()
@Controller('boards/:id')
export class ActivityController {
  constructor(
    private readonly boards: BoardsService,
    private readonly activity: ActivityService,
    private readonly versions: VersionsService,
  ) {}

  /** Anyone on the board: what happened on it, newest first; only after `since` (epoch ms) when given. */
  @Get('activity')
  @ApiQuery({ name: 'since', required: false, type: Number })
  async list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Query('since') since?: string): Promise<BoardEventDto[]> {
    await this.boards.get(user, id);
    const after = Number(since);
    return this.activity.list(id, Number.isFinite(after) && after > 0 ? after : undefined);
  }

  /** Anyone on the board: its saved versions, newest first. */
  @Get('versions')
  listVersions(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardVersionDto[]> {
    return this.versions.list(user, id);
  }

  /** Updaters and owners: save the board as it is now. */
  @Post('versions')
  saveVersion(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveVersionDto): Promise<BoardVersionDto> {
    return this.versions.save(user, id, body.label);
  }

  /** Updaters and owners: bring a version back for everyone (what's there now is saved first). */
  @Post('versions/:versionId/restore')
  @HttpCode(204)
  restore(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string): Promise<void> {
    return this.versions.restore(user, id, versionId);
  }
}
