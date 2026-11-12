import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CreateProviderDto, ProviderDto, ProviderTestDto, UpdateProviderDto } from './providers.dto';
import { ProvidersService } from './providers.service';

@ApiTags('models')
@ApiBearerAuth()
@Controller('orgs/:orgId/models')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  /** The models this workspace can use. */
  @Get()
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<ProviderDto[]> {
    return this.providers.list(user, orgId);
  }

  /** Admins: connect a model. */
  @Post()
  create(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: CreateProviderDto): Promise<ProviderDto> {
    return this.providers.create(user, orgId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProviderDto,
  ): Promise<ProviderDto> {
    return this.providers.update(user, orgId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.providers.remove(user, orgId, id);
  }

  /** Admins: check the connection works, with a one-word reply. */
  @Post(':id/test')
  @HttpCode(200)
  test(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string): Promise<ProviderTestDto> {
    return this.providers.test(user, orgId, id);
  }
}
