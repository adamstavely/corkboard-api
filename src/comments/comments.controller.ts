import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AddCommentDto, CommentThreadDto, ResolveThreadDto } from './comments.dto';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@ApiBearerAuth()
@Controller('boards/:id')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /** Every comment thread on the board, resolved ones included. */
  @Get('comments')
  list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<CommentThreadDto[]> {
    return this.comments.list(user, id);
  }

  /** Commenters and up: comment on a note or frame. Returns its thread. */
  @Post('comments')
  add(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: AddCommentDto): Promise<CommentThreadDto> {
    return this.comments.add(user, id, body.nodeId, body.body);
  }

  /** Commenters and up: resolve a thread, or reopen it. */
  @Patch('threads/:threadId')
  resolve(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: ResolveThreadDto,
  ): Promise<CommentThreadDto> {
    return this.comments.resolve(user, id, threadId, body.resolved);
  }

  /** Its author, or a board owner: delete a comment. */
  @Delete('comments/:commentId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.comments.remove(user, id, commentId);
  }
}
