import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { EnableModelDto, ProviderDto, WorkspaceModelDto } from './providers.dto';
import { ProvidersService } from './providers.service';

/** A workspace's models: the site's AI connections its owners switched on. Workspaces don't connect models themselves. */
@ApiTags('models')
@ApiBearerAuth()
@Controller('orgs/:orgId/models')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  /** The models this workspace's people can use. */
  @Get()
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<ProviderDto[]> {
    return this.providers.list(user, orgId);
  }

  /** Workspace owners: every model the site offers, and whether this workspace uses it. */
  @Get('choices')
  choices(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<WorkspaceModelDto[]> {
    return this.providers.choices(user, orgId);
  }

  /** Workspace owners: let this workspace's people use one of the site's models, or stop. */
  @Put(':id/enabled')
  @HttpCode(204)
  async setEnabled(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: EnableModelDto): Promise<void> {
    await this.providers.setEnabled(user, orgId, id, body.enabled);
  }
}
