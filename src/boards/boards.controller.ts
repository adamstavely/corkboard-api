import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BoardDocumentDto, BoardDto, CreateBoardDto, UpdateBoardDto } from './boards.dto';
import { BoardsService, MAX_DOCUMENT_BYTES } from './boards.service';

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
  constructor(private readonly boards: BoardsService) {}

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
  }

  /** The board's content. Until real-time sync arrives, the client loads it here and saves it back below. */
  @Get('boards/:id/document')
  async document(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardDocumentDto> {
    return { state: (await this.boards.document(user, id)).toString('base64') };
  }

  @Put('boards/:id/document')
  @HttpCode(204)
  async saveDocument(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BoardDocumentDto,
  ): Promise<void> {
    const state = Buffer.from(body.state, 'base64');
    if (state.length > MAX_DOCUMENT_BYTES) throw new PayloadTooLargeException('This board is too large to save');
    await this.boards.saveDocument(user, id, state);
  }
}
