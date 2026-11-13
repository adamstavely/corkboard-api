import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BoardSummaryDto, SummariseDto } from './summary.dto';
import { SummaryService } from './summary.service';

@ApiTags('summary')
@ApiBearerAuth()
@Controller('boards/:id/summary')
export class SummaryController {
  constructor(private readonly summaries: SummaryService) {}

  /** Commenters and up: has a model summarise the board, saved in the board for everyone. 502 when the model fails. */
  @Post()
  @HttpCode(200)
  summarise(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SummariseDto): Promise<BoardSummaryDto> {
    return this.summaries.summarise(user, id, body.modelId, body.length);
  }
}
