import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AgendaGoDto, AnswerPollDto, SetPrivacyDto, EndPollDto, StartPollDto, BreakoutTimerDto, BringEveryoneDto, SetAgendaDto, CastVoteDto, JoinBreakoutDto, SetTimerDto, SetVotingDto, StartBreakoutsDto } from './facilitation.dto';
import { FacilitationService } from './facilitation.service';

@ApiTags('facilitation')
@ApiBearerAuth()
@Controller('boards/:id')
export class FacilitationController {
  constructor(private readonly facilitation: FacilitationService) {}

  /** Updaters and owners: open a round of dot voting (clearing the last), or close it to show the results. */
  @Put('voting')
  @HttpCode(204)
  setVoting(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetVotingDto): Promise<void> {
    return this.facilitation.setVoting(user, id, body.open, body.votesEach);
  }

  /** Commenters and up, while a vote runs: add a vote to a note, or take one back. 409 when out of votes. */
  @Post('votes')
  @HttpCode(204)
  vote(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: CastVoteDto): Promise<void> {
    return this.facilitation.vote(user, id, body.noteId, body.add);
  }

  /** Updaters and owners: start the board's shared timer, or stop it. */
  @Put('timer')
  @HttpCode(204)
  setTimer(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetTimerDto): Promise<void> {
    return this.facilitation.setTimer(user, id, body.seconds, body.label);
  }

  /** Updaters and owners: split everyone with the board open across these frames, each group with its own timer. */
  @Post('breakouts')
  @HttpCode(204)
  startBreakouts(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: StartBreakoutsDto): Promise<void> {
    return this.facilitation.startBreakouts(user, id, body.frameIds, body.minutes);
  }

  /** Commenters and up: move yourself into a breakout group. */
  @Post('breakouts/join')
  @HttpCode(204)
  joinBreakout(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: JoinBreakoutDto): Promise<void> {
    return this.facilitation.joinBreakout(user, id, body.frameId);
  }

  /** Updaters and owners: start or stop one group's timer. */
  @Put('breakouts/:frameId/timer')
  @HttpCode(204)
  setBreakoutTimer(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('frameId', ParseUUIDPipe) frameId: string,
    @Body() body: BreakoutTimerDto,
  ): Promise<void> {
    return this.facilitation.setBreakoutTimer(user, id, frameId, body.seconds);
  }

  /** Updaters and owners: bring everyone back together. */
  @Delete('breakouts')
  @HttpCode(204)
  endBreakouts(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.facilitation.endBreakouts(user, id);
  }

  /** Updaters and owners: take the facilitator's seat (owners can take it from someone). */
  @Post('facilitator')
  @HttpCode(204)
  claimFacilitator(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.facilitation.claimFacilitator(user, id);
  }

  @Delete('facilitator')
  @HttpCode(204)
  releaseFacilitator(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.facilitation.releaseFacilitator(user, id);
  }

  /** The facilitator: bring everyone's view to this. */
  @Post('spotlight')
  @HttpCode(204)
  bringEveryone(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: BringEveryoneDto): Promise<void> {
    return this.facilitation.bringEveryone(user, id, body);
  }

  /** Updaters and owners: the session's agenda, a step at a time, each with its time and frame. */
  @Put('agenda')
  @HttpCode(204)
  setAgenda(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetAgendaDto): Promise<void> {
    return this.facilitation.setAgenda(user, id, body.steps);
  }

  /** The facilitator: go to a step (its timer starts, everyone goes to its frame), or end the agenda. */
  @Post('agenda/go')
  @HttpCode(204)
  goToStep(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: AgendaGoDto): Promise<void> {
    return this.facilitation.goToStep(user, id, body.step);
  }

  /** Updaters and owners: start a poll (a question with options, or a fist-to-five), clearing the last one. */
  @Post('poll')
  @HttpCode(204)
  startPoll(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: StartPollDto): Promise<void> {
    return this.facilitation.startPoll(user, id, body.question, body.kind, body.options);
  }

  /** Updaters and owners: close the poll to show its result, or clear it away. */
  @Put('poll/end')
  @HttpCode(204)
  endPoll(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: EndPollDto): Promise<void> {
    return this.facilitation.endPoll(user, id, body.clear ?? false);
  }

  /** Commenters and up, while a poll is open: answer it, or change an answer. */
  @Post('poll/answers')
  @HttpCode(204)
  answerPoll(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: AnswerPollDto): Promise<void> {
    return this.facilitation.answerPoll(user, id, body.answer);
  }

  /** The facilitator: private mode on or off (pointers, selections and names hidden). */
  @Put('privacy')
  @HttpCode(204)
  setPrivacy(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetPrivacyDto): Promise<void> {
    return this.facilitation.setPrivacy(user, id, body.on);
  }
}
