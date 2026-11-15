import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { UpdateWorkspaceToolsDto, WorkspaceToolsDto } from './tools.dto';
import { ToolsService } from './tools.service';

@ApiTags('models')
@ApiBearerAuth()
@Controller('orgs/:orgId/assistant-tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  /** What the workspace's assistant may use beyond the board. */
  @Get()
  get(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<WorkspaceToolsDto> {
    return this.tools.get(user, orgId);
  }

  /** Owners: switch web search on or off, and set its service and key. */
  @Put()
  update(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: UpdateWorkspaceToolsDto): Promise<WorkspaceToolsDto> {
    return this.tools.update(user, orgId, body);
  }
}
