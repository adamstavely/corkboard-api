import { BadRequestException, Body, Controller, HttpCode, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import * as Y from 'yjs';
import { CurrentUser } from '../auth/current-user';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';

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

export class ReactDto {
  /** A note or frame on the board. */
  @IsString()
  @MaxLength(64)
  nodeId!: string;

  @ApiProperty({ enum: REACTIONS })
  @IsIn(REACTIONS)
  emoji!: string;

  /** Reacts, or takes the reaction back. */
  @IsBoolean()
  on!: boolean;
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
