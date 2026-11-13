import { ConflictException, Injectable } from '@nestjs/common';
import type * as Y from 'yjs';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { redo, undo } from './ledger-doc';

/** Taking back what the model changed on a board, and putting it back again. */
@Injectable()
export class LedgerService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  /** Updaters and owners: undoes one of the model's changes, exactly. */
  undo(user: User, boardId: string, entryId: string): Promise<void> {
    return this.#apply(user, boardId, (doc) => undo(doc, entryId));
  }

  /** Updaters and owners: puts an undone change back. */
  redo(user: User, boardId: string, entryId: string): Promise<void> {
    return this.#apply(user, boardId, (doc) => redo(doc, entryId));
  }

  async #apply(user: User, boardId: string, change: (doc: Y.Doc) => string | null): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let problem: string | null = null;
    try {
      await connection.transact((doc) => (problem = change(doc)));
    } finally {
      await connection.disconnect();
    }
    if (problem) throw new ConflictException(problem);
  }
}
