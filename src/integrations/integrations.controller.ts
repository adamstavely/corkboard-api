import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CreateIntegrationDto, ExportResultDto, ExportTasksDto, IntegrationDto } from './integrations.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller()
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

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

  /** Updaters and owners: send the board's open tasks (or these) to a tracker; each remembers its issue. */
  @Post('boards/:id/tasks/export')
  @HttpCode(200)
  export(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ExportTasksDto): Promise<ExportResultDto> {
    return this.integrations.export(user, id, body.integrationId, body.taskIds);
  }
}
