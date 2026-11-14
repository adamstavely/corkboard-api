import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, newFrame, notesOf, placeNotes } from '../../src/assist/board-edit';
import { breakoutsOf } from '../../src/facilitation/breakouts-doc';
import { timerOf, voteCounts, votingOf } from '../../src/facilitation/facilitation-doc';
import { createTestApp, type TestApp } from './app';

const eventually = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('Timed out waiting');
};

describe('Dot voting and the shared timer', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function person() {
    const subject = randomUUID();
    const token = await t.token(subject);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { token, auth, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  async function joined(owner: Person, role: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person();
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  function open(boardId: string, who: Person): Promise<Y.Doc> {
    const doc = new Y.Doc();
    return new Promise((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: boardId, token: who.token, document: doc, onSynced: () => resolve(doc) }));
    });
  }

  it('lets updaters run a vote that commenters take part in, and the model sees the results', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const commenter = await joined(ada, 'commenter');
    const reader = await joined(ada, 'reader');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Retro' });
    const doc = await open(board.id, ada);
    const [slow, flaky] = addNotes(doc, [
      { text: 'Deploys are slow', color: 'yellow' },
      { text: 'Tests are flaky', color: 'yellow' },
    ]);
    await new Promise((r) => setTimeout(r, 300));
    const vote = (who: Person, noteId: string, add = true) => request(server).post(`/boards/${board.id}/votes`).set(who.auth).send({ noteId, add });

    await vote(commenter, slow).expect(409);
    await request(server).put(`/boards/${board.id}/voting`).set(commenter.auth).send({ open: true }).expect(403);
    await request(server).put(`/boards/${board.id}/voting`).set(ada.auth).send({ open: true, votesEach: 2 }).expect(204);
    await eventually(() => votingOf(doc).open);

    await vote(commenter, slow).expect(204);
    await vote(commenter, slow).expect(204);
    await vote(commenter, flaky).expect(409);
    await vote(ada, flaky).expect(204);
    await vote(reader, slow).expect(403);
    await vote(ada, randomUUID()).expect(400);

    await request(server).put(`/boards/${board.id}/voting`).set(ada.auth).send({ open: false }).expect(204);
    await eventually(() => !votingOf(doc).open);
    expect(voteCounts(doc)).toEqual(new Map([[slow, 2], [flaky, 1]]));
    expect(notesOf(doc).find((n) => n.id === slow)?.votes).toBe(2);
    await request(server).put(`/boards/${board.id}/voting`).set(ada.auth).send({ open: false }).expect(409);
  });

  it('lets updaters start and stop a timer everyone sees', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const commenter = await joined(ada, 'commenter');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });
    const doc = await open(board.id, commenter);

    await request(server).put(`/boards/${board.id}/timer`).set(commenter.auth).send({ seconds: 60 }).expect(403);
    await request(server).put(`/boards/${board.id}/timer`).set(ada.auth).send({ seconds: 5 }).expect(400);
    await request(server).put(`/boards/${board.id}/timer`).set(ada.auth).send({ seconds: 300, label: 'Add notes' }).expect(204);
    await eventually(() => timerOf(doc).endsAt !== null);
    expect(timerOf(doc)).toMatchObject({ seconds: 300, label: 'Add notes' });
    expect(timerOf(doc).endsAt! - Date.now()).toBeGreaterThan(290_000);
    await request(server).put(`/boards/${board.id}/timer`).set(ada.auth).send({ seconds: null }).expect(204);
    await eventually(() => timerOf(doc).endsAt === null);
  });

  it('splits everyone on the board into breakout groups with their own timers and votes, then brings them back', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'commenter');
    const linus = await joined(ada, 'commenter');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Big retro' });
    const doc = await open(board.id, ada);
    await open(board.id, grace);
    await open(board.id, linus);
    const left = newFrame(doc, 'Group A', { x: 0, y: 0, w: 600, h: 500 }, 1, 'ada');
    const right = newFrame(doc, 'Group B', { x: 800, y: 0, w: 600, h: 500 }, 2, 'ada');
    const [inA] = placeNotes(doc, [{ text: 'In A', color: 'yellow', author: 'ada' }], left);
    const [inB] = placeNotes(doc, [{ text: 'In B', color: 'yellow', author: 'ada' }], right);
    await new Promise((r) => setTimeout(r, 300));

    await request(server).post(`/boards/${board.id}/breakouts`).set(grace.auth).send({ frameIds: [left, right] }).expect(403);
    await request(server).post(`/boards/${board.id}/breakouts`).set(ada.auth).send({ frameIds: [left] }).expect(400);
    await request(server).post(`/boards/${board.id}/breakouts`).set(ada.auth).send({ frameIds: [left, right], minutes: 5 }).expect(204);
    await eventually(() => breakoutsOf(doc).open);
    const groups = breakoutsOf(doc).groups;
    expect(groups.map((g) => g.members.length).sort()).toEqual([1, 2]);
    expect(groups.every((g) => g.endsAt !== null && g.endsAt > Date.now() + 4 * 60_000)).toBe(true);

    // Grace moves to group B and votes there; not on group A's notes.
    await request(server).post(`/boards/${board.id}/breakouts/join`).set(grace.auth).send({ frameId: right }).expect(204);
    await eventually(() => breakoutsOf(doc).groups.find((g) => g.frameId === right)!.members.some((m) => m.name.startsWith('Person')));
    await request(server).put(`/boards/${board.id}/voting`).set(ada.auth).send({ open: true, votesEach: 3 }).expect(204);
    await request(server).post(`/boards/${board.id}/votes`).set(grace.auth).send({ noteId: inA, add: true }).expect(409);
    await request(server).post(`/boards/${board.id}/votes`).set(grace.auth).send({ noteId: inB, add: true }).expect(204);

    // One group gets more time; then everyone comes back.
    await request(server).put(`/boards/${board.id}/breakouts/${right}/timer`).set(ada.auth).send({ seconds: 600 }).expect(204);
    await eventually(() => breakoutsOf(doc).groups.find((g) => g.frameId === right)!.seconds === 600);
    await request(server).delete(`/boards/${board.id}/breakouts`).set(ada.auth).expect(204);
    await eventually(() => !breakoutsOf(doc).open);
    await request(server).post(`/boards/${board.id}/votes`).set(grace.auth).send({ noteId: inA, add: true }).expect(204);
    await request(server).delete(`/boards/${board.id}/breakouts`).set(ada.auth).expect(409);
  });
});
