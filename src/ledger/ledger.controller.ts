import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { LedgerService } from './ledger.service';

@ApiTags('ledger')
@ApiBearerAuth()
@Controller('boards/:id/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** Updaters and owners: take back one of the model's changes (see the board's `ledger`). 409 if it's already undone. */
  @Post(':entryId/undo')
  @HttpCode(204)
  undo(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string): Promise<void> {
    return this.ledger.undo(user, id, entryId);
  }
}
