import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { ReactDto } from './reactions.dto';
import { ReactionsService } from './reactions';

@ApiTags('reactions')
@ApiBearerAuth()
@Controller('boards/:id/reactions')
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  /** Commenters and up: react to a note or frame with one of a few emoji, or take it back. */
  @Post()
  @HttpCode(204)
  react(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReactDto): Promise<void> {
    return this.reactions.react(user, id, body);
  }
}
