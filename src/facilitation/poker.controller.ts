import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { MyEstimateDto, PokerEstimateDto, StartPokerDto } from './poker.dto';
import { PokerService } from './poker.service';

@ApiTags('facilitation')
@ApiBearerAuth()
@Controller('boards/:id/poker')
export class PokerController {
  constructor(private readonly poker: PokerService) {}

  /** Updaters and owners: start a round of planning poker on a task, a note or a title, clearing the last one. */
  @Post()
  @HttpCode(204)
  start(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: StartPokerDto): Promise<void> {
    return this.poker.start(user, id, body.deck, body);
  }

  /** Commenters and up, until the estimates are revealed: your estimate, replacing any you gave before. */
  @Post('estimates')
  @HttpCode(204)
  estimate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: PokerEstimateDto): Promise<void> {
    return this.poker.estimate(user, id, body.value);
  }

  /** Commenters and up: your estimate in the running round. Nobody else's until they're revealed. */
  @Get('estimates/mine')
  async mine(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<MyEstimateDto> {
    return { value: await this.poker.mine(user, id) };
  }

  /** Updaters and owners: show everyone's estimates at once. */
  @Put('reveal')
  @HttpCode(204)
  reveal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.poker.reveal(user, id);
  }

  /** Updaters and owners: put planning poker away. */
  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.poker.clear(user, id);
  }
}
