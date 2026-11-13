import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { FolderDto, FolderNameDto, MoveBoardDto } from './organise.dto';
import { OrganiseService } from './organise.service';

@ApiTags('organise')
@ApiBearerAuth()
@Controller()
export class OrganiseController {
  constructor(private readonly organise: OrganiseService) {}

  /** The workspace's folders, by name. */
  @Get('orgs/:orgId/folders')
  folders(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<FolderDto[]> {
    return this.organise.folders(user, orgId);
  }

  /** Updaters and owners of the workspace: a new folder. */
  @Post('orgs/:orgId/folders')
  createFolder(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: FolderNameDto): Promise<FolderDto> {
    return this.organise.createFolder(user, orgId, body.name);
  }

  @Patch('orgs/:orgId/folders/:folderId')
  renameFolder(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() body: FolderNameDto,
  ): Promise<FolderDto> {
    return this.organise.renameFolder(user, orgId, folderId, body.name);
  }

  /** Its boards stay, unfiled. */
  @Delete('orgs/:orgId/folders/:folderId')
  @HttpCode(204)
  removeFolder(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('folderId', ParseUUIDPipe) folderId: string): Promise<void> {
    return this.organise.removeFolder(user, orgId, folderId);
  }

  /** Updaters and owners of the board: file it in a folder, or take it out (null). */
  @Put('boards/:id/folder')
  @HttpCode(204)
  move(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: MoveBoardDto): Promise<void> {
    return this.organise.moveBoard(user, id, body.folderId);
  }

  /** Star a board for yourself. */
  @Put('boards/:id/star')
  @HttpCode(204)
  star(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organise.star(user, id, true);
  }

  @Delete('boards/:id/star')
  @HttpCode(204)
  unstar(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organise.star(user, id, false);
  }
}
