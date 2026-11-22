import * as Y from "yjs";
import { framesOf, inFrame, NOTE_SIZE } from "../assist/board-edit";
import type { BoardSession } from "../collab/session-log";
import { privacyOf, votingOf } from "./facilitation-doc";
import { writingOf } from "./writing-doc";

/** Without an agenda, the session is this much of the past. */
export const SESSION_HOURS = 3;

/** One team member's part in the session. Never anyone's anonymous notes, nor a participant's. */
export interface PersonPart {
  id: string;
  name: string;
  online: boolean;
  notes: number;
  votes: number;
  comments: number;
  chat: number;
}

export interface FramePart {
  id: string;
  title: string;
  /** How many people looked at it for a while, and how many added notes in it. */
  viewers: number;
  contributors: number;
  /** Notes added in it this session, anonymous ones too. */
  notes: number;
}

export interface Participation {
  /** Where the session starts (epoch ms), and whether that's when the agenda started rather than SESSION_HOURS ago. */
  since: number;
  fromAgenda: boolean;
  /** Private mode is on: nobody is listed by name, there are only totals. */
  private: boolean;
  /** Quietest first. Empty in private mode. */
  people: PersonPart[];
  /** The team's totals; `quiet` is how many have added nothing yet. */
  team: {
    people: number;
    online: number;
    quiet: number;
    notes: number;
    votes: number;
    comments: number;
    chat: number;
  };
  /** Feedback participants from outside the team: counted, never named or told apart. */
  participants: {
    people: number;
    online: number;
    notes: number;
    votes: number;
    comments: number;
  };
  /** Notes from anonymous writing rounds this session. */
  anonymousNotes: number;
  /** A hidden writing round under way: how many notes from how many people, never what or whose. */
  writing: { open: boolean; notes: number; writers: number };
  frames: FramePart[];
}

export interface ParticipationInput {
  doc: Y.Doc;
  session: Readonly<BoardSession> | null;
  now: number;
  /** The board's workspace members, for their names. */
  team: ReadonlyMap<string, string>;
  /** Everyone who has joined the board to give feedback. */
  participantIds: ReadonlySet<string>;
  /** Who has the board open now. */
  onlineMembers: ReadonlyMap<string, string>;
  onlineParticipants: ReadonlySet<string>;
  /** Who wrote each comment since the session started (null for someone since removed). */
  commentAuthors: readonly (string | null)[];
}

/** Where the session starts: when its agenda started, if it did lately, else SESSION_HOURS ago. */
export function sessionStart(
  session: Readonly<BoardSession> | null,
  now: number,
): { since: number; fromAgenda: boolean } {
  const fallback = now - SESSION_HOURS * 60 * 60_000;
  const agenda = session?.agendaStartedAt ?? null;
  return agenda !== null
    ? { since: agenda, fromAgenda: true }
    : { since: fallback, fromAgenda: false };
}

const rectOf = (node: Y.Map<unknown>) => ({
  x: Number(node.get("x") ?? 0),
  y: Number(node.get("y") ?? 0),
  w: Number(node.get("w") ?? NOTE_SIZE.w),
  h: Number(node.get("h") ?? NOTE_SIZE.h),
});

/**
 * Who has taken part in the session and which frames nobody has looked at, for the facilitator. Anonymous notes and
 * feedback participants are only ever counted; private mode leaves everyone unnamed; hidden writing is only counted.
 */
export function participationOf(input: ParticipationInput): Participation {
  const {
    doc,
    session,
    now,
    team,
    participantIds,
    onlineMembers,
    onlineParticipants,
  } = input;
  const { since, fromAgenda } = sessionStart(session, now);
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const isParticipant = (id: string) => participantIds.has(id);

  // Each team member who was here, or did something, this session.
  const people = new Map<string, PersonPart>();
  const person = (id: string, name?: string): PersonPart => {
    let p = people.get(id);
    if (!p) {
      p = {
        id,
        name: team.get(id) ?? name ?? "Someone",
        online: onlineMembers.has(id),
        notes: 0,
        votes: 0,
        comments: 0,
        chat: 0,
      };
      people.set(id, p);
    }
    return p;
  };
  for (const [id, name] of onlineMembers)
    if (!isParticipant(id)) person(id, name);
  for (const [id, m] of session?.members ?? [])
    if (m.lastAt >= since && !isParticipant(id)) person(id, m.name);
  const participants = {
    people: 0,
    online: 0,
    notes: 0,
    votes: 0,
    comments: 0,
  };
  const participantsHere = new Set([...onlineParticipants]);
  for (const [id, p] of session?.participants ?? [])
    if (p.lastAt >= since) participantsHere.add(id);
  participants.people = participantsHere.size;
  participants.online = onlineParticipants.size;

  // Notes added this session that are still on the board, and where they are.
  let anonymousNotes = 0;
  const sessionNotes: { rect: ReturnType<typeof rectOf>; by: string | null }[] =
    [];
  for (const [id, { source, at }] of session?.notes ?? []) {
    const node = nodes.get(id);
    if (at < since || !(node instanceof Y.Map) || node.get("kind") !== "note")
      continue;
    if (source.kind === "anonymous") anonymousNotes++;
    else if (source.kind === "participant" || isParticipant(source.id))
      participants.notes++;
    else person(source.id).notes++;
    sessionNotes.push({
      rect: rectOf(node),
      by: source.kind === "anonymous" ? null : source.id,
    });
  }

  // Votes in this session's round of dot voting (or the one running now).
  const voting = votingOf(doc);
  const voteStarted = session?.voteStartedAt ?? null;
  if (voting.open || (voteStarted !== null && voteStarted >= since)) {
    doc.getMap<string[]>("votes").forEach((ids, who) => {
      const n = Array.isArray(ids) ? ids.length : 0;
      if (!n) return;
      if (isParticipant(who)) participants.votes += n;
      else person(who).votes += n;
    });
  }

  for (const author of input.commentAuthors) {
    if (!author) continue;
    if (isParticipant(author)) participants.comments++;
    else person(author).comments++;
  }

  for (const m of doc
    .getArray<{ authorId?: unknown; name?: unknown; at?: unknown }>("chat")
    .toArray()) {
    if (
      typeof m.authorId !== "string" ||
      typeof m.at !== "number" ||
      m.at < since
    )
      continue;
    // The model's messages, and anyone who isn't a person on the team.
    if (!team.has(m.authorId) || isParticipant(m.authorId)) continue;
    person(m.authorId).chat++;
  }

  const list = [...people.values()].sort(
    (a, b) =>
      contributed(a) - contributed(b) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name),
  );
  const sum = (k: "notes" | "votes" | "comments" | "chat") =>
    list.reduce((n, p) => n + p[k], 0);

  const frames = framesOf(doc).map((f): FramePart => {
    const viewers = [...(session?.views.get(f.id) ?? [])].filter(
      ([, at]) => at >= since,
    ).length;
    const inside = sessionNotes.filter((n) => inFrame(n.rect, f));
    return {
      id: f.id,
      title: f.title,
      viewers,
      contributors: new Set(inside.map((n) => n.by).filter((by) => by !== null))
        .size,
      notes: inside.length,
    };
  });

  const writing = writingOf(doc);
  const hidden = privacyOf(doc).on;
  return {
    since,
    fromAgenda,
    private: hidden,
    people: hidden ? [] : list,
    team: {
      people: list.length,
      online: list.filter((p) => p.online).length,
      quiet: list.filter((p) => contributed(p) === 0).length,
      notes: sum("notes"),
      votes: sum("votes"),
      comments: sum("comments"),
      chat: sum("chat"),
    },
    participants,
    anonymousNotes,
    writing: {
      open: writing.open,
      notes: writing.open ? writing.notes : 0,
      writers: writing.open ? writing.writers : 0,
    },
    // Frames nobody has looked at first.
    frames: frames.sort(
      (a, b) => a.viewers - b.viewers || a.contributors - b.contributors,
    ),
  };
}

/** Everything someone has added this session. */
const contributed = (p: PersonPart) => p.notes + p.votes + p.comments + p.chat;
