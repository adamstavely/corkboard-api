import { ConflictException, Injectable } from '@nestjs/common';
import type * as Y from 'yjs';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { ledgerEntries, redo, undo } from './ledger-doc';
import { ActivityService } from '../activity/activity.service';

/** Taking back what the model changed on a board, and putting it back again. */
@Injectable()
export class LedgerService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  /** Updaters and owners: undoes one of the model's changes, exactly. */
  undo(user: User, boardId: string, entryId: string): Promise<void> {
    return this.#apply(user, boardId, (doc) => undo(doc, entryId), "undid the model's change", entryId);
  }

  /** Updaters and owners: puts an undone change back. */
  redo(user: User, boardId: string, entryId: string): Promise<void> {
    return this.#apply(user, boardId, (doc) => redo(doc, entryId), "redid the model's change", entryId);
  }

  async #apply(user: User, boardId: string, change: (doc: Y.Doc) => string | null, action: string, entryId: string): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let problem: string | null = null;
    let what: string | undefined;
    try {
      await connection.transact((doc) => {
        what = ledgerEntries(doc).find((e) => e.id === entryId)?.action;
        problem = change(doc);
      });
    } finally {
      await connection.disconnect();
    }
    if (problem) throw new ConflictException(problem);
    await this.activity.record(boardId, user, action, what);
  }
}
