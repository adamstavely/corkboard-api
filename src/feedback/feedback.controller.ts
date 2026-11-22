import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { MyEstimateDto, PokerEstimateDto } from '../facilitation/poker.dto';
import { SeenFramesDto } from '../facilitation/facilitation.dto';
import { BlockParticipantDto, FeedbackDto, FeedbackJoinDto, OpenFeedbackDto } from './feedback.dto';
import { FeedbackService } from './feedback.service';
import {
  AddParticipantNoteDto,
  EditParticipantNoteDto,
  ParticipantAnswerDto,
  ParticipantCommentDto,
  ParticipantCommentThreadDto,
  ParticipantNoteDto,
  ParticipantReactDto,
  ParticipantVoteDto,
  ParticipantYouDto,
} from './participation.dto';
import { ParticipationService } from './participation.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller()
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly participation: ParticipationService,
  ) {}

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

  // ── What participants do: always as themselves, whatever other participants see ──

  /** A participant: who they are on the board's projection. */
  @Get('feedback/boards/:id/you')
  you(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ParticipantYouDto> {
    return this.participation.you(user, id);
  }

  /** A participant: add a note. The team sees it by their name. */
  @Post('feedback/boards/:id/notes')
  addNote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: AddParticipantNoteDto): Promise<ParticipantNoteDto> {
    return this.participation.addNote(user, id, body);
  }

  /** A participant: change one of their own notes. */
  @Patch('feedback/boards/:id/notes/:noteId')
  @HttpCode(204)
  editNote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('noteId') noteId: string, @Body() body: EditParticipantNoteDto): Promise<void> {
    return this.participation.editNote(user, id, noteId, body);
  }

  /** A participant: remove one of their own notes. */
  @Delete('feedback/boards/:id/notes/:noteId')
  @HttpCode(204)
  removeNote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('noteId') noteId: string): Promise<void> {
    return this.participation.removeNote(user, id, noteId);
  }

  /** A participant: the comments they may see, attributed as the board allows. */
  @Get('feedback/boards/:id/comments')
  comments(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ParticipantCommentThreadDto[]> {
    return this.participation.comments(user, id);
  }

  /** A participant: comment on a note or frame they can see. */
  @Post('feedback/boards/:id/comments')
  comment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ParticipantCommentDto): Promise<ParticipantCommentThreadDto[]> {
    return this.participation.comment(user, id, body.nodeId, body.body);
  }

  @Post('feedback/boards/:id/reactions')
  @HttpCode(204)
  react(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ParticipantReactDto): Promise<void> {
    return this.participation.react(user, id, body.nodeId, body.emoji, body.on);
  }

  @Post('feedback/boards/:id/votes')
  @HttpCode(204)
  vote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ParticipantVoteDto): Promise<void> {
    return this.participation.vote(user, id, body.noteId, body.add);
  }

  @Post('feedback/boards/:id/poll/answers')
  @HttpCode(204)
  answerPoll(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ParticipantAnswerDto): Promise<void> {
    return this.participation.answerPoll(user, id, body.answer);
  }

  @Post('feedback/boards/:id/poker/estimates')
  @HttpCode(204)
  estimate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: PokerEstimateDto): Promise<void> {
    return this.participation.estimate(user, id, body.value);
  }

  @Get('feedback/boards/:id/poker/estimates/mine')
  async myEstimate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<MyEstimateDto> {
    return { value: await this.participation.myEstimate(user, id) };
  }

  /** Frames this participant has had in view for a few seconds: counted for the facilitator, never by who. */
  @Post('feedback/boards/:id/seen')
  @HttpCode(204)
  seen(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SeenFramesDto): Promise<void> {
    return this.participation.seen(user, id, body.frameIds);
  }
}
