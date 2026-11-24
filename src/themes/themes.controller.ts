import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { DiagramLookDto, DiagramThemeDto, SuggestThemeDto, ThemeSuggestionDto } from './themes.dto';
import { ThemesService } from './themes.service';

@ApiTags('themes')
@ApiBearerAuth()
@Controller()
export class ThemesController {
  constructor(private readonly themes: ThemesService) {}

  /** Anyone in the workspace: its look for diagrams (Trench Coat's when it has none of its own). */
  @Get('orgs/:orgId/diagram-theme')
  get(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<DiagramLookDto> {
    return this.themes.get(user, orgId);
  }

  /** Workspace owners: set its look. Refused, with why, unless text on every fill meets WCAG 2.2 AA in light and dark. */
  @Put('orgs/:orgId/diagram-theme')
  set(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: DiagramThemeDto): Promise<DiagramLookDto> {
    return this.themes.set(user, orgId, body);
  }

  /** Workspace owners: go back to Trench Coat's look. */
  @Delete('orgs/:orgId/diagram-theme')
  @HttpCode(204)
  async reset(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<void> {
    await this.themes.reset(user, orgId);
  }

  /** Workspace owners: a look to start from, read off a website or built from brand colours; nothing is saved. */
  @Post('orgs/:orgId/diagram-theme/suggest')
  @HttpCode(200)
  suggest(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: SuggestThemeDto): Promise<ThemeSuggestionDto> {
    return this.themes.suggest(user, orgId, body);
  }
}
