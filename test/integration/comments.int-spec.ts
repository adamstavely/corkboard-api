import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { createTestApp, type TestApp } from './app';

describe('Comments', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function person() {
    const subject = randomUUID();
    const token = await t.token(subject);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { token, auth, id: me.body.id as string, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  async function joined(owner: Person, role: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person();
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  it('keeps one thread per note: commenters write and resolve, readers only read, and a new comment reopens it', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const commenter = await joined(ada, 'commenter');
    const reader = await joined(ada, 'reader');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });
    const comment = (who: Person, body: string, nodeId = 'note-1') =>
      request(server).post(`/boards/${board.id}/comments`).set(who.auth).send({ nodeId, body });

    const first = await comment(commenter, '  Is this still true? ').expect(201);
    expect(first.body).toMatchObject({ nodeId: 'note-1', resolvedAt: null, comments: [{ body: 'Is this still true?', author: { id: commenter.id } }] });
    await comment(ada, 'Yes, for now.').expect(201);
    await comment(ada, 'A frame too', 'frame-1').expect(201);
    await comment(reader, 'Me too').expect(403);

    const listed = await request(server).get(`/boards/${board.id}/comments`).set(reader.auth).expect(200);
    expect(listed.body.map((th: { nodeId: string; comments: unknown[] }) => [th.nodeId, th.comments.length])).toEqual([
      ['note-1', 2],
      ['frame-1', 1],
    ]);

    const threadId = first.body.id;
    await request(server).patch(`/boards/${board.id}/threads/${threadId}`).set(reader.auth).send({ resolved: true }).expect(403);
    const resolved = await request(server).patch(`/boards/${board.id}/threads/${threadId}`).set(commenter.auth).send({ resolved: true }).expect(200);
    expect(resolved.body.resolvedAt).not.toBeNull();
    const reopened = await comment(commenter, 'Actually, no.').expect(201);
    expect(reopened.body).toMatchObject({ id: threadId, resolvedAt: null });
    expect(reopened.body.comments).toHaveLength(3);
  });

  it('lets authors and board owners delete comments, drops empty threads, and keeps other workspaces out', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const linus = await joined(ada, 'commenter');
    const stranger = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });

    const { body: thread } = await request(server).post(`/boards/${board.id}/comments`).set(linus.auth).send({ nodeId: 'n', body: 'Mine' });
    const mine = thread.comments[0].id;
    await request(server).delete(`/boards/${board.id}/comments/${mine}`).set(grace.auth).expect(403);
    await request(server).get(`/boards/${board.id}/comments`).set(stranger.auth).expect(404);
    await request(server).delete(`/boards/${board.id}/comments/${mine}`).set(linus.auth).expect(204);
    expect((await request(server).get(`/boards/${board.id}/comments`).set(ada.auth)).body).toEqual([]);

    const { body: again } = await request(server).post(`/boards/${board.id}/comments`).set(linus.auth).send({ nodeId: 'n', body: 'Again' });
    await request(server).delete(`/boards/${board.id}/comments/${again.comments[0].id}`).set(ada.auth).expect(204);
  });

  it('tells everyone with the board open when its comments change', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });

    const heard: string[] = [];
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: board.id,
        token: ada.token,
        document: new Y.Doc(),
        onSynced: (): void => resolve(p),
        onStateless: ({ payload }) => heard.push(payload),
      });
    });
    await request(server).post(`/boards/${board.id}/comments`).set(ada.auth).send({ nodeId: 'n', body: 'Hello' }).expect(201);
    for (let i = 0; i < 60 && heard.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(heard.map((p) => JSON.parse(p))).toEqual([{ type: 'comments' }]);
    provider.destroy();
  });

  it('pins comments to spots on an image, keeping where each sits', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });
    const add = (nodeId: string, body: string, anchor?: { x: number; y: number }) =>
      request(server).post(`/boards/${board.id}/comments`).set(ada.auth).send({ nodeId, body, ...(anchor ? { anchor } : {}) });

    const { body: left } = await add('img@pin-1', 'This logo is too small', { x: 0.1, y: 0.2 }).expect(201);
    expect(left).toMatchObject({ nodeId: 'img@pin-1', anchor: { x: 0.1, y: 0.2 } });
    await add('img@pin-2', 'Check the colour', { x: 0.9, y: 0.75 }).expect(201);
    // A reply keeps the pin where it was.
    const { body: reply } = await add('img@pin-1', 'Agreed', { x: 0.5, y: 0.5 }).expect(201);
    expect(reply.anchor).toEqual({ x: 0.1, y: 0.2 });
    await add('img@pin-3', 'Off the image', { x: 1.5, y: 0.2 }).expect(400);

    const { body: threads } = await request(server).get(`/boards/${board.id}/comments`).set(ada.auth).expect(200);
    expect(threads.map((th: { nodeId: string; anchor: unknown }) => [th.nodeId, th.anchor])).toEqual([
      ['img@pin-1', { x: 0.1, y: 0.2 }],
      ['img@pin-2', { x: 0.9, y: 0.75 }],
    ]);
    await add('note-1', 'A plain comment').expect(201);
    expect((await request(server).get(`/boards/${board.id}/comments`).set(ada.auth)).body.at(-1).anchor).toBeNull();
  });
});
