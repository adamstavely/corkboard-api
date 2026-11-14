import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BreakoutTimerDto, CastVoteDto, JoinBreakoutDto, SetTimerDto, SetVotingDto, StartBreakoutsDto } from './facilitation.dto';
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
}
