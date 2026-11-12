import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CollabService } from '../collab/collab.service';
import { BoardDocumentDto, BoardDto, BoardMemberDto, CreateBoardDto, SetBoardRoleDto, UpdateBoardDto } from './boards.dto';
import { BoardsService } from './boards.service';

const toDto = ({ id, orgId, title, createdAt, updatedAt, role }: BoardDto): BoardDto => ({
  id,
  orgId,
  title,
  createdAt,
  updatedAt,
  role,
});

@ApiTags('boards')
@ApiBearerAuth()
@Controller()
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  /** The workspace's boards the person can open, most recently changed first. */
  @Get('orgs/:orgId/boards')
  async list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<BoardDto[]> {
    return (await this.boards.list(user, orgId)).map(toDto);
  }

  @Post('orgs/:orgId/boards')
  async create(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateBoardDto,
  ): Promise<BoardDto> {
    return toDto(await this.boards.create(user, orgId, body.title));
  }

  @Get('boards/:id')
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardDto> {
    return toDto(await this.boards.get(user, id));
  }

  @Patch('boards/:id')
  async rename(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBoardDto,
  ): Promise<BoardDto> {
    return toDto(await this.boards.rename(user, id, body.title));
  }

  /** Who's in the board's workspace and what each may do on this board. */
  @Get('boards/:id/members')
  async members(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardMemberDto[]> {
    return this.boards.members(user, id);
  }

  /** Board owners: give someone a role on this board, or (null) return them to their workspace role. */
  @Put('boards/:id/members/:userId')
  async setRole(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SetBoardRoleDto,
  ): Promise<BoardMemberDto> {
    const member = await this.boards.setRole(user, id, userId, body.role);
    // If they have it open, they reconnect with their new role (or are turned away).
    this.collab.disconnect(userId, [id]);
    return member;
  }

  /** Board owners: delete the board, for everyone. */
  @Delete('boards/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.boards.remove(user, id);
    this.collab.closeBoard(id);
  }

  /** The board's content as last saved, read-only: editing happens over the collaboration socket (/collab). */
  @Get('boards/:id/document')
  async document(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardDocumentDto> {
    return { state: (await this.boards.document(user, id)).toString('base64') };
  }
}
