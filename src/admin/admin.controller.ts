import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { DeleteWorkspaceDto, WorkspaceUsageDto } from './admin.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('orgs/:orgId/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Workspace owners: the last 30 days, board by board, and what the models cost. */
  @Get('usage')
  usage(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<WorkspaceUsageDto> {
    return this.admin.usage(user, orgId);
  }

  /** Workspace owners: everything in the workspace as one JSON file to download (never keys or tokens). */
  @Get('export')
  @ApiProduces('application/json')
  async export(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response): Promise<void> {
    const data = await this.admin.export(user, orgId);
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="corkboard-workspace-${day}.json"` });
    res.send(JSON.stringify(data, null, 2));
  }

  /** Workspace owners: delete the workspace and everything in it, typing its name to confirm. */
  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: DeleteWorkspaceDto): Promise<void> {
    return this.admin.remove(user, orgId, body.confirm);
  }
}
