import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BoardSyncDto, CreateIntegrationDto, ExportResultDto, ExportTasksDto, IntegrationDto, WebhookSetupDto } from './integrations.dto';
import { IntegrationsService } from './integrations.service';
import { TrackerSyncService } from './tracker-sync.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller()
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly sync: TrackerSyncService,
  ) {}

  /** Anyone in the workspace: its issue trackers (never their tokens). */
  @Get('orgs/:orgId/integrations')
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<IntegrationDto[]> {
    return this.integrations.list(user, orgId);
  }

  /** Workspace owners: connect GitHub, Linear or Jira. */
  @Post('orgs/:orgId/integrations')
  create(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: CreateIntegrationDto): Promise<IntegrationDto> {
    return this.integrations.create(user, orgId, body);
  }

  @Delete('orgs/:orgId/integrations/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.integrations.remove(user, orgId, id);
  }

  /**
   * Workspace owners: a new secret for the tracker to sign its webhooks with, and where to send them. Shown this once;
   * any earlier secret stops working. Webhooks only bring syncs forward: linked tasks are checked on a schedule anyway.
   */
  @Post('orgs/:orgId/integrations/:id/webhook')
  @HttpCode(200)
  setUpWebhook(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string): Promise<WebhookSetupDto> {
    return this.sync.setUpWebhook(user, orgId, id);
  }

  /** Anyone who can open the board: when each task sent to a tracker was last synced with its issue, and any tracker failing. */
  @Get('boards/:id/tasks/sync')
  syncStatus(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardSyncDto> {
    return this.sync.status(user, id);
  }

  /** Updaters and owners: sync the board's linked tasks with their issues now (title, status, assignee, both ways). */
  @Post('boards/:id/tasks/sync')
  @HttpCode(200)
  syncNow(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardSyncDto> {
    return this.sync.syncBoard(user, id);
  }

  /** Updaters and owners: send the board's open tasks (or these) to a tracker; each remembers its issue. */
  @Post('boards/:id/tasks/export')
  @HttpCode(200)
  export(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExportTasksDto): Promise<ExportResultDto> {
    return this.integrations.export(user, id, body.integrationId, body.taskIds);
  }
}
