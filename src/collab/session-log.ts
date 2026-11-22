import { Injectable } from "@nestjs/common";
import type * as Y from "yjs";

/** A board's session is forgotten this long after the last thing happened on it. */
const KEEP_MS = 12 * 60 * 60_000;
/** Stale sessions are looked for at most this often. */
const PRUNE_MS = 60_000;
/** Limits on what one board's session holds, so a busy or misbehaving board can't grow it without end. */
const MAX_NOTES = 5000;
const MAX_FRAMES = 1000;
const MAX_VIEWERS = 500;

/** Who added a note: a team member, a feedback participant (never named), or nobody anyone may know. */
export type NoteSource =
  | { kind: "member"; id: string }
  | { kind: "participant"; id: string }
  | { kind: "anonymous" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose a note the API added is: a participant's, a signed writing round's (its writer's) or an anonymous round's. The
 * model's notes, and others that don't say whose they are, are nobody's.
 */
export function serverNoteSource(node: Y.Map<unknown>): NoteSource | null {
  const author = node.get("author");
  if (typeof author !== "string") return null;
  if (node.get("participant") === true)
    return UUID.test(author) ? { kind: "participant", id: author } : null;
  if (author === "anonymous") return { kind: "anonymous" };
  return UUID.test(author) ? { kind: "member", id: author } : null;
}

/** Someone with the board open: a team member, or a feedback participant on their own view of it. */
export type Attendee =
  | { kind: "member"; id: string; name: string }
  | { kind: "participant"; id: string };

export interface BoardSession {
  /** Team members who had the board open: when they first and last did. */
  members: Map<string, { name: string; firstAt: number; lastAt: number }>;
  /** Feedback participants who had it open, by id only; they're only ever counted. */
  participants: Map<string, { firstAt: number; lastAt: number }>;
  /** Notes added while the session was kept, by id: who added them and when. */
  notes: Map<string, { source: NoteSource; at: number }>;
  /** For each frame, who looked at it (a member's id, or "p:" and a participant's) and when they last did. */
  views: Map<string, Map<string, number>>;
  /** When the agenda last started from its first step, and when the latest round of dot voting started. */
  agendaStartedAt: number | null;
  voteStartedAt: number | null;
  touchedAt: number;
}

/**
 * What happened on each board lately, for the facilitator's participation view: who had it open, who added notes and
 * who looked at which frames. Kept in memory only, per API instance, and forgotten KEEP_MS after a board goes quiet:
 * it's about the session going on, not a record (the board's history is that).
 */
@Injectable()
export class SessionLog {
  readonly #boards = new Map<string, BoardSession>();
  #prunedAt = 0;

  /** Someone opened the board. */
  joined(boardId: string, who: Attendee, now = Date.now()): void {
    const session = this.#session(boardId, now);
    if (who.kind === "member") {
      const was = session.members.get(who.id);
      session.members.set(who.id, {
        name: who.name,
        firstAt: was?.firstAt ?? now,
        lastAt: now,
      });
    } else {
      const was = session.participants.get(who.id);
      session.participants.set(who.id, {
        firstAt: was?.firstAt ?? now,
        lastAt: now,
      });
    }
  }

  /** Someone closed the board (one of their tabs, at least). */
  left(boardId: string, who: Attendee, now = Date.now()): void {
    this.joined(boardId, who, now);
  }

  noteAdded(
    boardId: string,
    noteId: string,
    source: NoteSource,
    now = Date.now(),
  ): void {
    const session = this.#session(boardId, now);
    if (session.notes.has(noteId) || session.notes.size >= MAX_NOTES) return;
    session.notes.set(noteId, { source, at: now });
  }

  /** Someone has looked at these frames for a while. */
  viewed(
    boardId: string,
    viewer: string,
    frameIds: readonly string[],
    now = Date.now(),
  ): void {
    const session = this.#session(boardId, now);
    for (const frameId of frameIds) {
      let viewers = session.views.get(frameId);
      if (!viewers) {
        if (session.views.size >= MAX_FRAMES) continue;
        viewers = new Map();
        session.views.set(frameId, viewers);
      }
      if (viewers.has(viewer) || viewers.size < MAX_VIEWERS)
        viewers.set(viewer, now);
    }
  }

  agendaStarted(boardId: string, now = Date.now()): void {
    this.#session(boardId, now).agendaStartedAt = now;
  }

  voteStarted(boardId: string, now = Date.now()): void {
    this.#session(boardId, now).voteStartedAt = now;
  }

  /** The board's session, if anything has happened on it lately. */
  of(boardId: string, now = Date.now()): Readonly<BoardSession> | null {
    this.#prune(now);
    return this.#boards.get(boardId) ?? null;
  }

  #session(boardId: string, now: number): BoardSession {
    this.#prune(now);
    let session = this.#boards.get(boardId);
    if (!session) {
      session = {
        members: new Map(),
        participants: new Map(),
        notes: new Map(),
        views: new Map(),
        agendaStartedAt: null,
        voteStartedAt: null,
        touchedAt: now,
      };
      this.#boards.set(boardId, session);
    }
    session.touchedAt = now;
    return session;
  }

  #prune(now: number): void {
    if (now - this.#prunedAt < PRUNE_MS) return;
    this.#prunedAt = now;
    for (const [boardId, session] of this.#boards)
      if (now - session.touchedAt > KEEP_MS) this.#boards.delete(boardId);
  }
}
