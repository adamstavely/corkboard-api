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
import { BoardDocumentDto, BoardDto, BoardMemberDto, BoardTemplateDto, CreateBoardDto, NextSessionDto, SetBoardRoleDto, UpdateBoardDto } from './boards.dto';
import { carryOver, nextTitle } from './next-session';
import type * as Y from 'yjs';
import { BoardsService, type BoardWithRole } from './boards.service';
import { OrganiseService } from '../organise/organise.service';
import { applyTemplate, TEMPLATES } from './templates';

const toDto = ({ id, orgId, title, createdAt, updatedAt, role, folderId = null, starred = false, lastVisitedAt = null, continuesId = null }: BoardWithRole): BoardDto => ({
  id,
  orgId,
  title,
  createdAt,
  updatedAt,
  role,
  folderId,
  starred,
  lastVisitedAt,
  continuesId,
});

@ApiTags('boards')
@ApiBearerAuth()
@Controller()
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly organise: OrganiseService,
  ) {}

  /** The workspace's boards the person can open, most recently changed first. */
  @Get('orgs/:orgId/boards')
  async list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<BoardDto[]> {
    return (await this.boards.list(user, orgId)).map(toDto);
  }

  /** The boards a new one can start from. */
  @Get('board-templates')
  templates(): BoardTemplateDto[] {
    return TEMPLATES.map(({ id, name, description, columns }) => ({ id, name, description, columns: columns.map((c) => c.title) }));
  }

  /** Updaters and owners of the workspace: a new board, blank or from a template, which they own. */
  @Post('orgs/:orgId/boards')
  async create(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateBoardDto,
  ): Promise<BoardDto> {
    const board = await this.boards.create(user, orgId, body.title);
    const template = TEMPLATES.find((t) => t.id === body.template);
    if (template) {
      const connection = await this.collab.hocuspocus.openDirectConnection(board.id, { user });
      try {
        await connection.transact((doc) => applyTemplate(doc, template));
      } finally {
        await connection.disconnect();
      }
    }
    return toDto(board);
  }

  /**
   * Updaters and owners: the next session's board. It has the same frames, the tasks not yet done, and their notes; it
   * goes in the same workspace and folder, owned by whoever started it.
   */
  @Post('boards/:id/next')
  async next(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: NextSessionDto): Promise<BoardDto> {
    const last = await this.boards.get(user, id, 'updater');
    const board = await this.boards.create(user, last.orgId, body.title?.trim() || nextTitle(last.title), last.id);
    if (last.folderId) await this.organise.moveBoard(user, board.id, last.folderId);
    const from = await this.collab.hocuspocus.openDirectConnection(last.id, { user });
    const to = await this.collab.hocuspocus.openDirectConnection(board.id, { user });
    try {
      await to.transact((doc) => carryOver(from.document as unknown as Y.Doc, doc));
    } finally {
      await Promise.all([from.disconnect(), to.disconnect()]);
    }
    return toDto({ ...board, folderId: last.folderId });
  }

  @Get('boards/:id')
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardDto> {
    const board = await this.boards.get(user, id);
    await this.organise.visit(user, id);
    return toDto(board);
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
