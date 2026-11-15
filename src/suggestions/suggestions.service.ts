import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { ChangeTracker, record } from '../ledger/ledger-doc';
import { applySuggestion, take, type Suggestion } from './suggestions-doc';

/** Accepting the model's suggestions onto a board, or turning them down. */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  /** Updaters and owners: makes a suggestion's changes, kept in the history so they can be undone like the model's own. */
  async accept(user: User, boardId: string, id: string): Promise<void> {
    const s = await this.#take(user, boardId, id, (doc, found) => {
      const tracker = new ChangeTracker();
      applySuggestion(doc, found, tracker);
      if (!tracker.empty) {
        record(doc, { id: randomUUID(), at: Date.now(), model: found.model, forName: found.forName, action: found.done, ...tracker.changes(), undone: false });
      }
    });
    await this.activity.record(boardId, user, "accepted the model's suggestion", s.model, s.action);
  }

  /** Updaters and owners: drops a suggestion, changing nothing. */
  async reject(user: User, boardId: string, id: string): Promise<void> {
    const s = await this.#take(user, boardId, id, () => undefined);
    await this.activity.record(boardId, user, "turned down the model's suggestion", s.model, s.action);
  }

  async #take(user: User, boardId: string, id: string, then: (doc: Y.Doc, s: Suggestion) => void): Promise<Suggestion> {
    await this.boards.get(user, boardId, 'updater');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let found: Suggestion | undefined;
    try {
      await connection.transact((doc) => {
        found = take(doc, id);
        if (found) then(doc, found);
      });
    } finally {
      await connection.disconnect();
    }
    if (!found) throw new ConflictException('That suggestion has already been accepted or turned down');
    return found;
  }
}
