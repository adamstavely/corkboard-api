import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { SavedTemplateDto, SaveTemplateDto } from './saved-templates.dto';
import { SavedTemplatesService } from './saved-templates.service';

@ApiTags('boards')
@ApiBearerAuth()
@Controller()
export class SavedTemplatesController {
  constructor(private readonly templates: SavedTemplatesService) {}

  /** Everyone in the workspace: the templates its people saved from their boards, newest first. */
  @Get('orgs/:orgId/board-templates')
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<SavedTemplateDto[]> {
    return this.templates.list(user, orgId);
  }

  /** Updaters and owners: save this board as a template for the workspace (its frames, notes, text, shapes, tables, views, arrows and agenda). */
  @Post('boards/:id/as-template')
  save(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SaveTemplateDto): Promise<SavedTemplateDto> {
    return this.templates.save(user, id, body);
  }

  /** Whoever saved it, or the workspace's owners: delete a saved template. Boards made from it keep what they have. */
  @Delete('orgs/:orgId/board-templates/:templateId')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('templateId', ParseUUIDPipe) templateId: string): Promise<void> {
    return this.templates.remove(user, orgId, templateId);
  }
}
