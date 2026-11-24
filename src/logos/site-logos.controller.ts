import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AddedLogosDto, AddLogosDto, LogoPackDto } from './logos.dto';
import { LogosService } from './logos.service';

/** Site admins: Corkboard's icon library (the cloud vendors' icons), which every workspace's diagrams use. */
@ApiTags('site')
@ApiBearerAuth()
@Controller('site/logo-packs')
export class SiteLogosController {
  constructor(private readonly logos: LogosService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<LogoPackDto[]> {
    return this.logos.siteList(user);
  }

  /** Add logos to a pack from the vendor's own download, in batches of up to 2 MB; `replace` on the first batch of an update. */
  @Post(':name/logos')
  @HttpCode(200)
  add(@CurrentUser() user: User, @Param('name') name: string, @Body() body: AddLogosDto): Promise<AddedLogosDto> {
    return this.logos.siteAdd(user, name, body);
  }

  /** Remove a pack: shapes using its logos show none. */
  @Delete(':name')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('name') name: string): Promise<void> {
    await this.logos.siteRemove(user, name);
  }
}
