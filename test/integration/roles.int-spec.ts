import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { SearchIndex } from '../../src/search/search-index';
import { createTestApp, type TestApp } from './app';

const eventually = async (check: () => boolean | Promise<boolean>, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await check()) return;
  throw new Error('Timed out waiting');
};

describe('Workspace and board roles', () => {
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
    return { token, auth, id: me.body.id as string, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  /** Someone who joined `owner`'s workspace with `role`. */
  async function joined(owner: Person, role: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person();
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  function open(boardId: string, who: Person, document = new Y.Doc()): Promise<HocuspocusProvider> {
    return new Promise((resolve, reject) => {
      const provider: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token: who.token,
        document,
        onSynced: (): void => resolve(provider),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
      });
      providers.push(provider);
    });
  }

  it('lets workspace readers and commenters see boards but not make or change them', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const reader = await joined(ada, 'reader');
    const commenter = await joined(ada, 'commenter');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Plan' }).expect(201);
    expect(board.role).toBe('owner');

    for (const who of [reader, commenter]) {
      await request(server).post(`/orgs/${ada.orgId}/boards`).set(who.auth).send({ title: 'Mine' }).expect(403);
      const got = await request(server).get(`/boards/${board.id}`).set(who.auth).expect(200);
      expect(got.body.role).toBe(who === reader ? 'reader' : 'commenter');
      await request(server).patch(`/boards/${board.id}`).set(who.auth).send({ title: 'x' }).expect(403);
      await request(server).delete(`/boards/${board.id}`).set(who.auth).expect(403);
    }

    // On the live board, a reader sees Ada's notes, but the server drops the reader's own edits.
    const adaDoc = new Y.Doc();
    await open(board.id, ada, adaDoc);
    addNotes(adaDoc, [{ text: 'From Ada', color: 'yellow' }]);
    const readerDoc = new Y.Doc();
    await open(board.id, reader, readerDoc);
    await eventually(() => notesOf(readerDoc).length === 1);
    addNotes(readerDoc, [{ text: 'From the reader', color: 'yellow' }]);
    await new Promise((r) => setTimeout(r, 500));
    expect(notesOf(adaDoc).map((n) => n.text)).toEqual(['From Ada']);
  });

  it('lets a board raise or lower a workspace role, and keeps hidden boards out of lists and search', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const linus = await joined(ada, 'reader');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Secret roadmap' });

    // Lower Grace to no access: the board is gone for her, everywhere.
    const lowered = await request(server).put(`/boards/${board.id}/members/${grace.id}`).set(ada.auth).send({ role: 'none' }).expect(200);
    expect(lowered.body).toMatchObject({ workspaceRole: 'updater', boardRole: 'none', role: null });
    await request(server).get(`/boards/${board.id}`).set(grace.auth).expect(404);
    expect((await request(server).get(`/orgs/${ada.orgId}/boards`).set(grace.auth)).body).toEqual([]);
    await t.app.get(SearchIndex).refresh();
    const hits = await request(server).get(`/orgs/${ada.orgId}/search`).query({ q: 'roadmap' }).set(grace.auth).expect(200);
    expect(hits.body).toEqual([]);
    const adaHits = await request(server).get(`/orgs/${ada.orgId}/search`).query({ q: 'roadmap' }).set(ada.auth).expect(200);
    expect(adaHits.body.map((h: { boardId: string }) => h.boardId)).toEqual([board.id]);
    await expect(open(board.id, grace)).rejects.toThrow();

    // Raise Linus, a workspace reader, to updater on this board only.
    await request(server).put(`/boards/${board.id}/members/${linus.id}`).set(ada.auth).send({ role: 'updater' }).expect(200);
    await request(server).patch(`/boards/${board.id}`).set(linus.auth).send({ title: 'Roadmap' }).expect(200);
    // …but he can't manage it, and back to his workspace role he can't change it.
    await request(server).put(`/boards/${board.id}/members/${grace.id}`).set(linus.auth).send({ role: 'reader' }).expect(403);
    await request(server).put(`/boards/${board.id}/members/${linus.id}`).set(ada.auth).send({ role: null }).expect(200);
    await request(server).patch(`/boards/${board.id}`).set(linus.auth).send({ title: 'x' }).expect(403);

    const members = await request(server).get(`/boards/${board.id}/members`).set(linus.auth).expect(200);
    expect(members.body.map((m: { userId: string; role: string | null }) => [m.userId, m.role])).toEqual(
      expect.arrayContaining([
        [ada.id, 'owner'],
        [grace.id, null],
        [linus.id, 'reader'],
      ]),
    );
  });

  it("never changes a workspace owner's board role, and only works for people in the workspace", async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const owner = await joined(ada, 'owner');
    const stranger = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });

    await request(server).put(`/boards/${board.id}/members/${owner.id}`).set(ada.auth).send({ role: 'none' }).expect(409);
    await request(server).put(`/boards/${board.id}/members/${stranger.id}`).set(ada.auth).send({ role: 'reader' }).expect(404);
    await request(server).put(`/boards/${board.id}/members/${owner.id}`).set(ada.auth).send({ role: 'boss' }).expect(400);
  });

  it('makes whoever creates a board its owner, and only owners delete boards', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const linus = await joined(ada, 'updater');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(grace.auth).send({ title: "Grace's" }).expect(201);
    expect(board.role).toBe('owner');

    await request(server).delete(`/boards/${board.id}`).set(linus.auth).expect(403);
    await request(server).put(`/boards/${board.id}/members/${linus.id}`).set(grace.auth).send({ role: 'reader' }).expect(200);
    await request(server).delete(`/boards/${board.id}`).set(grace.auth).expect(204);
  });

  it('reconnects someone whose role changes, and drops their board roles when they leave the workspace', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });

    const provider = await open(board.id, grace);
    let closed = false;
    provider.on('close', () => (closed = true));
    await request(server).put(`/boards/${board.id}/members/${grace.id}`).set(ada.auth).send({ role: 'reader' }).expect(200);
    await eventually(() => closed);

    await request(server).delete(`/orgs/${ada.orgId}/members/${grace.id}`).set(ada.auth).expect(204);
    // Back in the workspace later, she starts from her workspace role again.
    const again = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: grace.email, role: 'updater' });
    await request(server).post(`/me/invites/${again.body.id}/accept`).set(grace.auth).expect(201);
    const got = await request(server).get(`/boards/${board.id}`).set(grace.auth).expect(200);
    expect(got.body.role).toBe('updater');
  });
});
