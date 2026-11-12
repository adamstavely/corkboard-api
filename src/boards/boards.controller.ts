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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CollabService } from '../collab/collab.service';
import { BoardDocumentDto, BoardDto, CreateBoardDto, UpdateBoardDto } from './boards.dto';
import { BoardsService } from './boards.service';

const toDto = ({ id, orgId, title, createdAt, updatedAt }: BoardDto): BoardDto => ({
  id,
  orgId,
  title,
  createdAt,
  updatedAt,
});

@ApiTags('boards')
@ApiBearerAuth()
@Controller()
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  /** A workspace's boards, most recently changed first. */
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
