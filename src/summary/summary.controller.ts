import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BoardSummaryDto, SummariseDto } from './summary.dto';
import { SummaryService } from './summary.service';
import { CatchUpDto, CatchUpRequestDto } from './catchup.dto';
import { CatchUpService } from './catchup.service';

@ApiTags('summary')
@ApiBearerAuth()
@Controller('boards/:id/summary')
export class SummaryController {
  constructor(
    private readonly summaries: SummaryService,
    private readonly catchUps: CatchUpService,
  ) {}

  /** Commenters and up: has a model summarise the board, saved in the board for everyone. 502 when the model fails. */
  @Post()
  @HttpCode(200)
  summarise(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SummariseDto): Promise<BoardSummaryDto> {
    return this.summaries.summarise(user, id, body.modelId, body.length);
  }

  /** Commenters and up: what others did on the board since `since`, summed up by a model. Not saved. */
  @Post('catch-up')
  @HttpCode(200)
  catchUp(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: CatchUpRequestDto): Promise<CatchUpDto> {
    return this.catchUps.catchUp(user, id, body.modelId, body.since);
  }
}
