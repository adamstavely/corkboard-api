import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BlockParticipantDto, FeedbackDto, FeedbackJoinDto, OpenFeedbackDto } from './feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** The team: the board's feedback link and who has joined through it, by name. */
  @Get('boards/:id/feedback')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<FeedbackDto> {
    return this.feedback.get(user, id);
  }

  /** Owners and the facilitator: open the board for feedback from anyone signed in with the link, replacing any link. */
  @Post('boards/:id/feedback')
  open(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: OpenFeedbackDto): Promise<FeedbackDto> {
    return this.feedback.open(user, id, body.visibility);
  }

  /** Owners and the facilitator: change what participants see of each other. */
  @Put('boards/:id/feedback')
  setVisibility(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: OpenFeedbackDto): Promise<FeedbackDto> {
    return this.feedback.setVisibility(user, id, body.visibility);
  }

  /** Owners and the facilitator: close the board to feedback; the link stops working. */
  @Delete('boards/:id/feedback')
  @HttpCode(204)
  close(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.feedback.close(user, id);
  }

  /** Owners and the facilitator: keep a participant out, or let them back. */
  @Put('boards/:id/feedback/participants/:userId')
  @HttpCode(204)
  block(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: BlockParticipantDto,
  ): Promise<void> {
    return this.feedback.block(user, id, userId, body.blocked);
  }

  /** Anyone signed in, with the link: join the board as a participant. 410 once the link is off; 403 if blocked. */
  @Post('feedback/:token/join')
  join(@CurrentUser() user: User, @Param('token') token: string): Promise<FeedbackJoinDto> {
    return this.feedback.join(user, token);
  }
}
