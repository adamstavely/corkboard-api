import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CastVoteDto, SetTimerDto, SetVotingDto } from './facilitation.dto';
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
}
