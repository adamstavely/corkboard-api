import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CreateProviderDto, ProviderDto, ProviderTestDto, UpdateProviderDto } from './providers.dto';
import { ProvidersService } from './providers.service';

/** Site admins: the site's connections to AI providers, which workspaces then choose from. */
@ApiTags('site')
@ApiBearerAuth()
@Controller('site/models')
export class SiteModelsController {
  constructor(private readonly providers: ProvidersService) {}

  /** Every AI connection the site has. */
  @Get()
  list(@CurrentUser() user: User): Promise<ProviderDto[]> {
    return this.providers.siteList(user);
  }

  /** Connect a model; workspaces' owners can then switch it on. */
  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateProviderDto): Promise<ProviderDto> {
    return this.providers.create(user, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProviderDto): Promise<ProviderDto> {
    return this.providers.update(user, id, body);
  }

  /** Remove a connection; every workspace that used it loses it. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.providers.remove(user, id);
  }

  /** Check the connection works, with a one-word reply. */
  @Post(':id/test')
  @HttpCode(200)
  test(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ProviderTestDto> {
    return this.providers.test(user, id);
  }
}
