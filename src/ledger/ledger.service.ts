import { ConflictException, Injectable } from '@nestjs/common';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { undo } from './ledger-doc';

/** Taking back what the model changed on a board. */
@Injectable()
export class LedgerService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  /** Updaters and owners: undoes one of the model's changes, exactly. */
  async undo(user: User, boardId: string, entryId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let problem: string | null = null;
    try {
      await connection.transact((doc) => (problem = undo(doc, entryId)));
    } finally {
      await connection.disconnect();
    }
    if (problem) throw new ConflictException(problem);
  }
}
