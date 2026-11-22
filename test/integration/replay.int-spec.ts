import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { KEYFRAME_EVERY, SNAPSHOT_CAP } from '../../src/activity/replay-chain';
import { BoardsService } from '../../src/boards/boards.service';
import { DB, type Db } from '../../src/db/db.module';
import { boardSnapshots, workspacePolicies } from '../../src/db/schema';
import { RetentionService } from '../../src/policies/retention.service';
import { createTestApp, type TestApp } from './app';

const DAY = 86_400_000;

const eventually = async (check: () => Promise<boolean>, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await check()) return;
  throw new Error('Timed out waiting');
};

describe('Replay', () => {
  let t: TestApp;
  let db: Db;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get<Db>(DB);
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function people() {
    const server = t.app.getHttpServer();
    const adaToken = await t.token(randomUUID(), { name: 'Ada Lovelace' });
    const ada = { Authorization: `Bearer ${adaToken}` };
    const { body: me } = await request(server).get('/me').set(ada);
    const orgId = me.orgs[0].id as string;
    const graceSubject = randomUUID();
    const grace = { Authorization: `Bearer ${await t.token(graceSubject, { name: 'Grace Hopper' })}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(ada).send({ email: `${graceSubject}@corkboard.test`, role: 'commenter' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace).expect(201);
    const stranger = { Authorization: `Bearer ${await t.token(randomUUID())}` };
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(ada).send({ title: 'Retro' });
    return { server, ada, adaToken, grace, stranger, orgId, board: board as { id: string } };
  }

  function connect(boardId: string, token: string, document: Y.Doc): Promise<HocuspocusProvider> {
    return new Promise((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: boardId, token, document, onSynced: (): void => resolve(p) });
      providers.push(p);
    });
  }

  const snapshotsOf = (boardId: string) => db.select().from(boardSnapshots).where(eq(boardSnapshots.boardId, boardId)).orderBy(asc(boardSnapshots.createdAt));
  /** Moves a board's snapshots back in time, as if they were taken that long ago. */
  const age = (boardId: string, ms: number) =>
    db
      .update(boardSnapshots)
      .set({ createdAt: sql`${boardSnapshots.createdAt} - ${`${ms} milliseconds`}::interval` })
      .where(eq(boardSnapshots.boardId, boardId));

  it('keeps snapshots as people edit and replays the board at each, to anyone who can see its versions', async () => {
    const { server, ada, adaToken, grace, stranger, board } = await people();
    const doc = new Y.Doc();
    await connect(board.id, adaToken, doc);
    addNotes(doc, [{ text: 'First idea', color: 'yellow' }]);
    await eventually(async () => (await snapshotsOf(board.id)).length === 1);
    // Thirty seconds later, someone writes again: only what changed is kept.
    await age(board.id, 31_000);
    addNotes(doc, [{ text: 'Second idea', color: 'pink' }]);
    await eventually(async () => (await snapshotsOf(board.id)).length === 2);
    const rows = await snapshotsOf(board.id);
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
    // Edits within thirty seconds don't add another.
    addNotes(doc, [{ text: 'Third idea', color: 'blue' }]);
    await new Promise((r) => setTimeout(r, 2500));
    expect(await snapshotsOf(board.id)).toHaveLength(2);
    await request(server).post(`/boards/${board.id}/versions`).set(ada).send({ label: 'After ideas' }).expect(201);

    const { body: replay } = await request(server).get(`/boards/${board.id}/replay`).set(grace).expect(200);
    expect(replay.frames.map((f: { kind: string; label: string | null }) => f.label ?? f.kind)).toEqual(['snapshot', 'snapshot', 'After ideas']);
    expect(replay.sessionStartId).toBe(replay.frames[0].id);
    expect(replay.events.map((e: { action: string }) => e.action)).toContain('saved a version');

    const { body: states } = await request(server).get(`/boards/${board.id}/replay/states`).query({ from: replay.frames[0].id }).set(grace).expect(200);
    expect(states.states.map((s: { id: string }) => s.id)).toEqual(replay.frames.map((f: { id: string }) => f.id));
    const seen = new Y.Doc();
    const texts = states.states.map((s: { update: string }) => {
      Y.applyUpdate(seen, new Uint8Array(Buffer.from(s.update, 'base64')));
      return notesOf(seen)
        .map((n) => n.text)
        .sort();
    });
    expect(texts).toEqual([['First idea'], ['First idea', 'Second idea'], ['First idea', 'Second idea', 'Third idea']]);

    // A run from the middle starts whole.
    const { body: later } = await request(server).get(`/boards/${board.id}/replay/states`).query({ from: replay.frames[1].id, count: 1 }).set(ada).expect(200);
    expect(later.states).toHaveLength(1);
    const alone = new Y.Doc();
    Y.applyUpdate(alone, new Uint8Array(Buffer.from(later.states[0].update, 'base64')));
    expect(notesOf(alone)).toHaveLength(2);

    await request(server).get(`/boards/${board.id}/replay/states`).query({ from: randomUUID() }).set(ada).expect(404);
    await request(server).get(`/boards/${board.id}/replay`).set(stranger).expect(404);
    await request(server).get(`/boards/${board.id}/replay/states`).query({ from: replay.frames[0].id }).set(stranger).expect(404);
  });

  it('keeps at most so many snapshots a board, dropping the oldest whole state and what builds on it', async () => {
    const { board } = await people();
    const doc = new Y.Doc();
    addNotes(doc, [{ text: 'Busy board', color: 'yellow' }]);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const vector = Buffer.from(Y.encodeStateVector(doc));
    const start = Date.now() - DAY;
    await db.insert(boardSnapshots).values(
      Array.from({ length: SNAPSHOT_CAP }, (_, i) => ({ boardId: board.id, state, vector, depth: i % KEYFRAME_EVERY, createdAt: new Date(start + i * 1000) })),
    );
    // The next is a whole state, which puts the board over.
    await t.app.get(BoardsService).storeState(board.id, state);
    const rows = await snapshotsOf(board.id);
    expect(rows).toHaveLength(SNAPSHOT_CAP + 1 - KEYFRAME_EVERY);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].createdAt.getTime()).toBe(start + KEYFRAME_EVERY * 1000);
  });

  it("prunes snapshots past the workspace's retention period, and what only built on them", async () => {
    const { server, ada, orgId, board } = await people();
    const doc = new Y.Doc();
    addNotes(doc, [{ text: 'Kept', color: 'yellow' }]);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const vector = Buffer.from(Y.encodeStateVector(doc));
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
    await db.insert(boardSnapshots).values([
      { boardId: board.id, state, vector, depth: 0, createdAt: at(40) },
      { boardId: board.id, state, vector, depth: 1, createdAt: at(35) },
      // Within the period, but built on what goes: it can't be shown, so it goes too.
      { boardId: board.id, state, vector, depth: 2, createdAt: at(10) },
      { boardId: board.id, state, vector, depth: 0, createdAt: at(5) },
      { boardId: board.id, state, vector, depth: 1, createdAt: at(4) },
    ]);
    await db.insert(workspacePolicies).values({ orgId, retentionDays: 30 }).onConflictDoUpdate({ target: workspacePolicies.orgId, set: { retentionDays: 30 } });
    const pruned = await t.app.get(RetentionService).pruneOrg(orgId);
    expect(pruned.snapshots).toBe(3);
    const rows = await snapshotsOf(board.id);
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
    const { body: replay } = await request(server).get(`/boards/${board.id}/replay`).set(ada).expect(200);
    expect(replay.frames.filter((f: { kind: string }) => f.kind === 'snapshot')).toHaveLength(2);
  });
});
