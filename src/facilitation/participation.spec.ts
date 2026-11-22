import * as Y from "yjs";
import { SessionLog, serverNoteSource } from "../collab/session-log";
import { setPrivacy, setVoting, castVote } from "./facilitation-doc";
import { setWriting } from "./writing-doc";
import {
  participationOf,
  SESSION_HOURS,
  type ParticipationInput,
} from "./participation";

const ADA = "aaaaaaaa-0000-4000-8000-000000000001";
const BEN = "aaaaaaaa-0000-4000-8000-000000000002";
const CY = "aaaaaaaa-0000-4000-8000-000000000003";
const OLA = "bbbbbbbb-0000-4000-8000-000000000001"; // a feedback participant
const BOARD = "cccccccc-0000-4000-8000-000000000001";
const HOUR = 60 * 60_000;
const NOW = 100 * HOUR;

function node(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): Y.Map<unknown> {
  const n = new Y.Map<unknown>();
  doc.getMap("nodes").set(id, n);
  for (const [k, v] of Object.entries(fields)) n.set(k, v);
  return n;
}

function board(): Y.Doc {
  const doc = new Y.Doc();
  node(doc, "f1", {
    kind: "frame",
    title: "Ideas",
    x: 0,
    y: 0,
    w: 1000,
    h: 1000,
  });
  node(doc, "f2", {
    kind: "frame",
    title: "Risks",
    x: 2000,
    y: 0,
    w: 1000,
    h: 1000,
  });
  return doc;
}

const note = (
  doc: Y.Doc,
  id: string,
  x = 100,
  fields: Record<string, unknown> = {},
) => node(doc, id, { kind: "note", x, y: 100, w: 200, h: 160, ...fields });

function input(
  doc: Y.Doc,
  log: SessionLog,
  extra: Partial<ParticipationInput> = {},
): ParticipationInput {
  return {
    doc,
    session: log.of(BOARD, NOW),
    now: NOW,
    team: new Map([
      [ADA, "Ada"],
      [BEN, "Ben"],
      [CY, "Cy"],
    ]),
    participantIds: new Set([OLA]),
    onlineMembers: new Map(),
    onlineParticipants: new Set(),
    commentAuthors: [],
    ...extra,
  };
}

describe("the participation view", () => {
  it("counts each person's notes, votes, comments and chat this session, quietest first", () => {
    const doc = board();
    const log = new SessionLog();
    for (const [id, name] of [
      [ADA, "Ada"],
      [BEN, "Ben"],
      [CY, "Cy"],
    ])
      log.joined(BOARD, { kind: "member", id, name }, NOW - HOUR);
    note(doc, "n1");
    note(doc, "n2");
    log.noteAdded(BOARD, "n1", { kind: "member", id: ADA }, NOW - HOUR);
    log.noteAdded(BOARD, "n2", { kind: "member", id: ADA }, NOW - HOUR);
    setVoting(doc, true, 3);
    castVote(doc, BEN, "n1", true);
    doc.getArray("chat").push([
      { authorId: CY, name: "Cy", at: NOW - 10_000, text: "hi" },
      { authorId: "model", name: "Model", at: NOW, text: "hello" },
    ]);

    const p = participationOf(
      input(doc, log, {
        commentAuthors: [BEN],
        onlineMembers: new Map([[ADA, "Ada"]]),
      }),
    );
    expect(
      p.people.map((x) => [
        x.name,
        x.notes,
        x.votes,
        x.comments,
        x.chat,
        x.online,
      ]),
    ).toEqual([
      ["Cy", 0, 0, 0, 1, false],
      // Ties go to whoever is here now.
      ["Ada", 2, 0, 0, 0, true],
      ["Ben", 0, 1, 1, 0, false],
    ]);
    expect(p.team).toEqual({
      people: 3,
      online: 1,
      quiet: 0,
      notes: 2,
      votes: 1,
      comments: 1,
      chat: 1,
    });
  });

  it("lists people who were here but added nothing, and says how many", () => {
    const doc = board();
    const log = new SessionLog();
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, NOW - HOUR);
    const p = participationOf(
      input(doc, log, { onlineMembers: new Map([[BEN, "Ben"]]) }),
    );
    expect(p.people.map((x) => x.name)).toEqual(["Ben", "Ada"]);
    expect(p.team.quiet).toBe(2);
  });

  it("leaves out what happened before the session: without an agenda, the last few hours", () => {
    const doc = board();
    const log = new SessionLog();
    const before = NOW - (SESSION_HOURS + 1) * HOUR;
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, before);
    note(doc, "old");
    log.noteAdded(BOARD, "old", { kind: "member", id: ADA }, before);
    doc
      .getArray("chat")
      .push([{ authorId: ADA, name: "Ada", at: before, text: "yesterday" }]);
    const p = participationOf(input(doc, log));
    expect(p.fromAgenda).toBe(false);
    expect(p.since).toBe(NOW - SESSION_HOURS * HOUR);
    expect(p.people).toEqual([]);
  });

  it("starts the session when the agenda started", () => {
    const doc = board();
    const log = new SessionLog();
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, NOW - 2 * HOUR);
    log.agendaStarted(BOARD, NOW - HOUR);
    const p = participationOf(input(doc, log));
    expect(p).toMatchObject({
      since: NOW - HOUR,
      fromAgenda: true,
      people: [],
    });
  });

  it("doesn't count a past round's votes, only this session's or the one running", () => {
    const doc = board();
    note(doc, "n1");
    setVoting(doc, true, 3);
    castVote(doc, ADA, "n1", true);
    setVoting(doc, false, 3);
    expect(participationOf(input(doc, new SessionLog())).team.votes).toBe(0);
    const log = new SessionLog();
    log.voteStarted(BOARD, NOW - HOUR);
    expect(participationOf(input(doc, log)).team.votes).toBe(1);
  });

  it("only counts anonymous notes, never giving them to anyone", () => {
    const doc = board();
    const log = new SessionLog();
    note(doc, "a1", 100, { author: "anonymous" });
    note(doc, "a2", 100, { author: "anonymous" });
    log.noteAdded(
      BOARD,
      "a1",
      serverNoteSource(doc.getMap<Y.Map<unknown>>("nodes").get("a1")!)!,
      NOW - 1000,
    );
    log.noteAdded(
      BOARD,
      "a2",
      serverNoteSource(doc.getMap<Y.Map<unknown>>("nodes").get("a2")!)!,
      NOW - 1000,
    );
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, NOW - 1000);
    const p = participationOf(input(doc, log));
    expect(p.anonymousNotes).toBe(2);
    expect(p.people).toEqual([
      expect.objectContaining({ name: "Ada", notes: 0 }),
    ]);
    expect(p.team.notes).toBe(0);
    // In a frame, they count as notes but not as anyone contributing.
    expect(p.frames.find((f) => f.id === "f1")).toMatchObject({
      notes: 2,
      contributors: 0,
    });
  });

  it("only counts feedback participants, never naming them, whatever they did", () => {
    const doc = board();
    const log = new SessionLog();
    log.joined(BOARD, { kind: "participant", id: OLA }, NOW - 1000);
    note(doc, "p1", 100, {
      author: OLA,
      participant: true,
      authorName: "Ola Nordmann",
    });
    log.noteAdded(
      BOARD,
      "p1",
      serverNoteSource(doc.getMap<Y.Map<unknown>>("nodes").get("p1")!)!,
      NOW - 1000,
    );
    setVoting(doc, true, 3);
    castVote(doc, OLA, "p1", true);
    const p = participationOf(
      input(doc, log, {
        commentAuthors: [OLA],
        onlineParticipants: new Set([OLA]),
        onlineMembers: new Map([[OLA, "Ola Nordmann"]]),
      }),
    );
    expect(p.participants).toEqual({
      people: 1,
      online: 1,
      notes: 1,
      votes: 1,
      comments: 1,
    });
    expect(p.people).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("Ola");
  });

  it("names nobody in private mode, keeping the totals", () => {
    const doc = board();
    const log = new SessionLog();
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, NOW - 1000);
    note(doc, "n1");
    log.noteAdded(BOARD, "n1", { kind: "member", id: ADA }, NOW - 1000);
    setPrivacy(doc, true, "Ben");
    const p = participationOf(input(doc, log));
    expect(p.private).toBe(true);
    expect(p.people).toEqual([]);
    expect(p.team).toMatchObject({ people: 1, notes: 1 });
    expect(JSON.stringify(p)).not.toContain("Ada");
  });

  it("counts hidden writing under way, never more", () => {
    const doc = board();
    setWriting(doc, {
      open: true,
      anonymous: false,
      round: "r1",
      notes: 4,
      writers: 2,
    });
    const p = participationOf(input(doc, new SessionLog()));
    expect(p.writing).toEqual({ open: true, notes: 4, writers: 2 });
    expect(p.people).toEqual([]);
  });

  it("credits a signed writing round’s notes to their writers", () => {
    const doc = board();
    const n = note(doc, "s1", 100, { author: BEN, authorName: "Ben" });
    const log = new SessionLog();
    log.noteAdded(BOARD, "s1", serverNoteSource(n)!, NOW - 1000);
    expect(participationOf(input(doc, log)).people).toEqual([
      expect.objectContaining({ id: BEN, notes: 1 }),
    ]);
  });

  it("doesn't count the model's notes or notes since deleted", () => {
    const doc = board();
    expect(
      serverNoteSource(note(doc, "m1", 100, { author: "assistant" })),
    ).toBeNull();
    const log = new SessionLog();
    log.noteAdded(BOARD, "gone", { kind: "member", id: ADA }, NOW - 1000);
    expect(participationOf(input(doc, log)).team.notes).toBe(0);
  });

  it("says how many looked at each frame and added to it, those nobody looked at first", () => {
    const doc = board();
    const log = new SessionLog();
    log.viewed(BOARD, ADA, ["f1"], NOW - 1000);
    log.viewed(BOARD, `p:${OLA}`, ["f1"], NOW - 1000);
    log.viewed(BOARD, BEN, ["f1"], NOW - (SESSION_HOURS + 1) * HOUR);
    note(doc, "n1", 100);
    note(doc, "n2", 2100);
    log.noteAdded(BOARD, "n1", { kind: "member", id: ADA }, NOW - 1000);
    log.noteAdded(BOARD, "n2", { kind: "member", id: BEN }, NOW - 1000);
    const p = participationOf(input(doc, log));
    expect(p.frames).toEqual([
      { id: "f2", title: "Risks", viewers: 0, contributors: 1, notes: 1 },
      { id: "f1", title: "Ideas", viewers: 2, contributors: 1, notes: 1 },
    ]);
  });
});

describe("the session log", () => {
  it("forgets a board half a day after it went quiet", () => {
    const log = new SessionLog();
    log.joined(BOARD, { kind: "member", id: ADA, name: "Ada" }, 0);
    expect(log.of(BOARD, HOUR)).not.toBeNull();
    expect(log.of(BOARD, 13 * HOUR)).toBeNull();
  });

  it("keeps each frame's viewers once each", () => {
    const log = new SessionLog();
    log.viewed(BOARD, ADA, ["f1", "f1"], 1);
    log.viewed(BOARD, ADA, ["f1"], 2);
    expect(log.of(BOARD, 3)!.views.get("f1")).toEqual(new Map([[ADA, 2]]));
  });
});
