import * as Y from 'yjs';
import type { SessionRecapDto } from '../summary/recap.dto';

/** Who wrote a chat message: a person's user id, or the model. */
export const MODEL_AUTHOR = 'model';
/** The oldest messages go once a board's chat is this long. */
export const MAX_CHAT = 500;

/** One message in a board's shared chat. It lives in the board's document, so everyone on the board sees it at once. */
export interface ChatMessage {
  id: string;
  /** A person's user id, or MODEL_AUTHOR. */
  authorId: string;
  /** The author's name when they wrote it; the model's is its connection's label. */
  name: string;
  /** Epoch ms. */
  at: number;
  text: string;
  /** On the model's messages: whose message it answers. */
  replyTo?: string;
  /** On the model's messages: notes the answer is about, and the notes the question was about. */
  cited?: string[];
  asked?: string[];
  /** On the model's messages: what it changed on the board. */
  changes?: { notesAdded: number; notesChanged: number; framesAdded: number; notesMoved: number };
  /** On the model's messages: it couldn't answer, and `text` says why. */
  failed?: boolean;
  /** On a session recap: its decisions, actions and open questions (see RecapService). */
  recap?: SessionRecapDto;
}

const chatArray = (doc: Y.Doc) => doc.getArray<ChatMessage>('chat');

/** The board's chat, oldest first. */
export const chatOf = (doc: Y.Doc): ChatMessage[] => chatArray(doc).toArray();

export function appendChat(doc: Y.Doc, message: ChatMessage): void {
  const chat = chatArray(doc);
  doc.transact(() => {
    chat.push([message]);
    if (chat.length > MAX_CHAT) chat.delete(0, chat.length - MAX_CHAT);
  });
}
