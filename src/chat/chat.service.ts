import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { AssistService } from '../assist/assist.service';
import type { AssistTurnDto } from '../assist/assist.dto';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { ProvidersService } from '../models/providers.service';
import { appendChat, chatOf, MODEL_AUTHOR, type ChatMessage } from './chat-doc';
import type { ChatMessageDto, SendChatDto } from './chat.dto';

/** Sent to everyone on a board while the model answers someone, and when it's done. */
export const answering = (personId: string, on: boolean) => JSON.stringify({ type: 'answering', personId, on });

/**
 * A board's shared chat: people talk to each other, and to the model when they mention it. Messages go into the
 * board's document through the server, so the server decides who may post, whatever their connection allows.
 */
@Injectable()
export class ChatService {
  readonly #log = new Logger(ChatService.name);

  constructor(
    private readonly boards: BoardsService,
    private readonly providers: ProvidersService,
    private readonly collab: CollabService,
    private readonly assistant: AssistService,
  ) {}

  async send(user: User, boardId: string, request: SendChatDto): Promise<ChatMessageDto> {
    const board = await this.boards.get(user, boardId, 'commenter');
    if (request.answer && !request.modelId) throw new BadRequestException('Choose a model to answer');
    const model = request.answer ? await this.providers.modelFor(board.orgId, request.modelId!) : undefined;

    const message: ChatMessage = { id: randomUUID(), authorId: user.id, name: user.name, at: Date.now(), text: request.text.trim() };
    let history: AssistTurnDto[] = [];
    await this.#edit(user, boardId, (doc) => {
      history = turns(chatOf(doc));
      appendChat(doc, message);
    });

    // The answer comes into the chat when it's ready; the sender doesn't wait for it.
    if (model) void this.#answer(user, boardId, message, history, request, model.label);
    return { id: message.id, authorId: message.authorId, name: message.name, at: message.at, text: message.text };
  }

  async #answer(user: User, boardId: string, asked: ChatMessage, history: AssistTurnDto[], request: SendChatDto, label: string) {
    const broadcast = (on: boolean) => this.collab.hocuspocus.documents.get(boardId)?.broadcastStateless(answering(user.id, on));
    broadcast(true);
    let reply: ChatMessage;
    try {
      const result = await this.assistant.assist(user, boardId, {
        modelId: request.modelId!,
        instruction: `${user.name}: ${asked.text}`,
        noteIds: request.noteIds,
        history,
      });
      const { reply: text, citedNoteIds, ...changes } = result;
      reply = { ...this.#fromModel(label, user), text, cited: citedNoteIds, asked: request.noteIds ?? [], changes };
    } catch (err) {
      if (!(err instanceof HttpException)) this.#log.error(err);
      const why = err instanceof HttpException ? err.message : 'Something went wrong.';
      reply = { ...this.#fromModel(label, user), text: `I couldn't answer: ${why}`, failed: true };
    }
    try {
      await this.#edit(user, boardId, (doc) => appendChat(doc, reply));
    } catch (err) {
      // The board was deleted, or the person lost access, while the model worked.
      this.#log.warn(`Couldn't post an answer to board ${boardId}: ${String(err)}`);
    } finally {
      broadcast(false);
    }
  }

  #fromModel(label: string, user: User) {
    return { id: randomUUID(), authorId: MODEL_AUTHOR, name: label, at: Date.now(), replyTo: user.id };
  }

  async #edit(user: User, boardId: string, change: (doc: Y.Doc) => void): Promise<void> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      await connection.transact((doc) => change(doc));
    } finally {
      await connection.disconnect();
    }
  }
}

/** The chat as earlier turns for the model: people's messages say who wrote them. Failed answers are left out. */
function turns(chat: ChatMessage[]): AssistTurnDto[] {
  return chat
    .filter((m) => !m.failed)
    .map((m) => (m.authorId === MODEL_AUTHOR ? { role: 'assistant', text: m.text } : { role: 'user', text: `${m.name}: ${m.text}` }));
}
