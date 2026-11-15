import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { SuggestionsService } from './suggestions.service';

@ApiTags('suggestions')
@ApiBearerAuth()
@Controller('boards/:id/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** Updaters and owners: make one of the model's suggestions (see the board's `suggestions`). 409 if it's gone. */
  @Post(':suggestionId/accept')
  @HttpCode(204)
  accept(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('suggestionId', ParseUUIDPipe) suggestionId: string): Promise<void> {
    return this.suggestions.accept(user, id, suggestionId);
  }

  /** Updaters and owners: turn one down. 409 if it's gone. */
  @Post(':suggestionId/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('suggestionId', ParseUUIDPipe) suggestionId: string): Promise<void> {
    return this.suggestions.reject(user, id, suggestionId);
  }
}
