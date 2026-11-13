import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { notesOf } from '../assist/board-edit';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { castVote, setTimer, setVoting, votingOf } from './facilitation-doc';

const DEFAULT_VOTES = 3;

/** Dot voting and the shared timer. Updaters and owners run them; commenters and up vote. */
@Injectable()
export class FacilitationService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  async setVoting(user: User, boardId: string, open: boolean, votesEach = DEFAULT_VOTES): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => {
      if (!open && !votingOf(doc).open) throw new ConflictException('No vote is running');
      setVoting(doc, open, votesEach);
    });
  }

  async vote(user: User, boardId: string, noteId: string, add: boolean): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    await this.#edit(user, boardId, (doc) => {
      if (add && !notesOf(doc).some((n) => n.id === noteId)) throw new BadRequestException('That note is not on the board');
      const problem = castVote(doc, user.id, noteId, add);
      if (problem) throw new ConflictException(problem);
    });
  }

  async setTimer(user: User, boardId: string, seconds: number | null, label = ''): Promise<void> {
    await this.boards.get(user, boardId, 'updater');
    await this.#edit(user, boardId, (doc) => setTimer(doc, seconds, label.trim(), user.name));
  }

  async #edit(user: User, boardId: string, change: (doc: Y.Doc) => void): Promise<void> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      // A refusal thrown inside leaves the document as it was.
      let failure: Error | undefined;
      await connection.transact((doc) => {
        try {
          change(doc);
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err));
        }
      });
      if (failure) throw failure;
    } finally {
      await connection.disconnect();
    }
  }
}
