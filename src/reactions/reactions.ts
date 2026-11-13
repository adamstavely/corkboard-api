import { BadRequestException, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import type { ReactDto } from './reactions.dto';

export const REACTIONS = ['👍', '❤️', '🎉', '❓', '👀'] as const;

/** Who reacted to each note or frame, by emoji: `reactions` in the board's document, written only here. */
const reactionsOf = (doc: Y.Doc) => doc.getMap<Record<string, string[]>>('reactions');

/** Adds or takes back a person's reaction. Returns false when the note or frame isn't on the board. */
export function react(doc: Y.Doc, nodeId: string, emoji: string, userId: string, on: boolean): boolean {
  if (!doc.getMap('nodes').has(nodeId)) return false;
  const map = reactionsOf(doc);
  const was = map.get(nodeId) ?? {};
  const people = new Set(was[emoji] ?? []);
  if (on) people.add(userId);
  else people.delete(userId);
  const next = { ...was, [emoji]: [...people] };
  if (!next[emoji].length) delete next[emoji];
  doc.transact(() => {
    if (Object.keys(next).length) map.set(nodeId, next);
    else map.delete(nodeId);
  });
  return true;
}

/** Emoji reactions on notes and frames: commenters and up react, everyone sees them live. */
@Injectable()
export class ReactionsService {
  constructor(
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
  ) {}

  async react(user: User, boardId: string, body: ReactDto): Promise<void> {
    await this.boards.get(user, boardId, 'commenter');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let found = true;
    try {
      await connection.transact((doc) => (found = react(doc, body.nodeId, body.emoji, user.id, body.on)));
    } finally {
      await connection.disconnect();
    }
    if (!found) throw new BadRequestException('That note or frame is not on the board');
  }
}
