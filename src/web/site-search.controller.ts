import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { SiteSearchDto, UpdateSiteSearchDto } from './tools.dto';
import { ToolsService } from './tools.service';

/** Site admins: the search service the assistant's web search uses, for every workspace that switches it on. */
@ApiTags('site')
@ApiBearerAuth()
@Controller('site/search')
export class SiteSearchController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  get(@CurrentUser() user: User): Promise<SiteSearchDto> {
    return this.tools.siteSearch(user);
  }

  /** Set the search service and its key (kept encrypted, never shown again). */
  @Put()
  set(@CurrentUser() user: User, @Body() body: UpdateSiteSearchDto): Promise<SiteSearchDto> {
    return this.tools.setSiteSearch(user, body);
  }
}
