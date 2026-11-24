import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AddedLogosDto, AddLogosDto, LogoDto, LogoPackDto } from './logos.dto';
import { LogosService } from './logos.service';

@ApiTags('logos')
@ApiBearerAuth()
@ApiExtraModels(LogoDto)
@Controller()
export class LogosController {
  constructor(private readonly logos: LogosService) {}

  /** Anyone in the workspace: its logo packs, for diagrams. */
  @Get('orgs/:orgId/logo-packs')
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<LogoPackDto[]> {
    return this.logos.list(user, orgId);
  }

  /**
   * Workspace owners: add logos to a pack (made if it's new), from a vendor's own icon download. Each logo is checked
   * and kept as plain SVG drawing; any that isn't is refused, with why. Send a big pack in batches of up to 2 MB.
   */
  @Post('orgs/:orgId/logo-packs/:name/logos')
  @HttpCode(200)
  add(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('name') name: string, @Body() body: AddLogosDto): Promise<AddedLogosDto> {
    return this.logos.add(user, orgId, name, body);
  }

  /** Workspace owners: remove a logo pack. Shapes using its logos show none. */
  @Delete('orgs/:orgId/logo-packs/:name')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('name') name: string): Promise<void> {
    await this.logos.remove(user, orgId, name);
  }
}
