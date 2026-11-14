import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { RecapRequestDto, SessionRecapDto } from './recap.dto';
import { RecapService } from './recap.service';

@ApiTags('summary')
@ApiBearerAuth()
@Controller('boards/:id/recap')
export class RecapController {
  constructor(private readonly recaps: RecapService) {}

  /** Commenters and up: a model writes the session's decisions, actions and open questions, posted to the board's chat. */
  @Post()
  @HttpCode(200)
  recap(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: RecapRequestDto): Promise<SessionRecapDto> {
    return this.recaps.recap(user, id, body.modelId);
  }
}
