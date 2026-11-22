import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { MAX_STATES, ReplayService } from './replay';
import { ReplayDto, ReplayStatesDto } from './replay.dto';

@ApiTags('activity')
@ApiBearerAuth()
@Controller('boards/:id/replay')
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  /**
   * Anyone on the board (as for its versions): the points in its history replay can show, oldest first, what people
   * did meanwhile, and where "this session" starts.
   */
  @Get()
  frames(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ReplayDto> {
    return this.replay.frames(user, id);
  }

  /** Anyone on the board: the board at up to 30 consecutive points from `from` on, to step through. */
  @Get('states')
  @ApiQuery({ name: 'from', type: String, format: 'uuid' })
  @ApiQuery({ name: 'count', required: false, type: Number })
  states(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from', ParseUUIDPipe) from: string,
    @Query('count', new DefaultValuePipe(MAX_STATES), ParseIntPipe) count: number,
  ): Promise<ReplayStatesDto> {
    return this.replay.states(user, id, from, count);
  }
}
