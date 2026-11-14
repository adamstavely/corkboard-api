import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

describe('Folders, stars, recent boards and share links', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function setup() {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID());
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Plan' });
    return { server, token, auth, readerAuth, orgId, board };
  }

  it('files boards in folders, stars them for one person, and remembers when each was opened', async () => {
    const { server, auth, readerAuth, orgId, board } = await setup();
    const { body: folder } = await request(server).post(`/orgs/${orgId}/folders`).set(auth).send({ name: 'Q3' }).expect(201);
    await request(server).post(`/orgs/${orgId}/folders`).set(readerAuth).send({ name: 'Mine' }).expect(403);
    await request(server).put(`/boards/${board.id}/folder`).set(auth).send({ folderId: folder.id }).expect(204);
    await request(server).put(`/boards/${board.id}/folder`).set(readerAuth).send({ folderId: null }).expect(403);
    await request(server).put(`/boards/${board.id}/star`).set(readerAuth).expect(204);
    await request(server).get(`/boards/${board.id}`).set(readerAuth).expect(200);

    const [forReader] = (await request(server).get(`/orgs/${orgId}/boards`).set(readerAuth)).body;
    expect(forReader).toMatchObject({ folderId: folder.id, starred: true });
    expect(new Date(forReader.lastVisitedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const [forOwner] = (await request(server).get(`/orgs/${orgId}/boards`).set(auth)).body;
    expect(forOwner).toMatchObject({ starred: false, lastVisitedAt: null });

    expect((await request(server).get(`/orgs/${orgId}/folders`).set(readerAuth)).body).toEqual([{ id: folder.id, name: 'Q3' }]);
    await request(server).delete(`/orgs/${orgId}/folders/${folder.id}`).set(auth).expect(204);
    expect((await request(server).get(`/orgs/${orgId}/boards`).set(auth)).body[0].folderId).toBeNull();
  });

  it('lets anyone with a share link view the board live, read-only, until the owner turns it off', async () => {
    const { server, token, auth, readerAuth, board } = await setup();
    await request(server).post(`/boards/${board.id}/links`).set(readerAuth).send({}).expect(403);
    const { body: link } = await request(server).post(`/boards/${board.id}/links`).set(auth).send({ label: 'For the client', expiresInDays: 7 }).expect(201);
    expect(link).toMatchObject({ label: 'For the client', revoked: false, opens: 0 });
    expect(link.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const opened = await request(server).get(`/shared/${link.token}`).expect(200);
    expect(opened.body).toEqual({ boardId: board.id, title: 'Plan', canEdit: false });
    await request(server).get('/shared/not-a-token').expect(404);

    // The owner edits; the guest sees it live, and can't change anything.
    const ownerDoc = new Y.Doc();
    const guestDoc = new Y.Doc();
    const connect = (doc: Y.Doc, tok: string) =>
      new Promise<HocuspocusProvider>((resolve, reject) => {
        const p: HocuspocusProvider = new HocuspocusProvider({
          url: t.collabUrl,
          name: board.id,
          token: tok,
          document: doc,
          onSynced: (): void => resolve(p),
          onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
        });
        providers.push(p);
      });
    await connect(ownerDoc, token);
    const guest = await connect(guestDoc, `link:${link.token}`);
    addNotes(ownerDoc, [{ text: 'Visible to guests', color: 'yellow' }]);
    for (let i = 0; i < 60 && notesOf(guestDoc).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(notesOf(guestDoc).map((n) => n.text)).toEqual(['Visible to guests']);
    addNotes(guestDoc, [{ text: 'From a guest', color: 'pink' }]);
    await new Promise((r) => setTimeout(r, 400));
    expect(notesOf(ownerDoc)).toHaveLength(1);

    let closed = false;
    guest.on('close', () => (closed = true));
    await request(server).delete(`/boards/${board.id}/links/${link.id}`).set(auth).expect(204);
    for (let i = 0; i < 60 && !closed; i++) await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
    await request(server).get(`/shared/${link.token}`).expect(410);
    await expect(connect(new Y.Doc(), `link:${link.token}`)).rejects.toThrow();
    const [listed] = (await request(server).get(`/boards/${board.id}/links`).set(auth)).body;
    expect(listed).toMatchObject({ revoked: true, opens: 1 });
  });

  it("lets a link's viewers go when it expires, and at once when its expiry is moved into the past", async () => {
    const { server, auth, board } = await setup();
    const make = async () => (await request(server).post(`/boards/${board.id}/links`).set(auth).send({}).expect(201)).body as { id: string; token: string };
    const watch = (tok: string) =>
      new Promise<{ closed: () => boolean }>((resolve, reject) => {
        let closed = false;
        const p: HocuspocusProvider = new HocuspocusProvider({
          url: t.collabUrl,
          name: board.id,
          token: `link:${tok}`,
          document: new Y.Doc(),
          onSynced: (): void => resolve({ closed: () => closed }),
          onClose: () => (closed = true),
          onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
        });
        providers.push(p);
      });
    const until = async (check: () => boolean, ms: number) => {
      for (const end = Date.now() + ms; !check() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
    };

    const soon = await make();
    const soonGuest = await watch(soon.token);
    await request(server).patch(`/boards/${board.id}/links/${soon.id}`).set(auth).send({ expiresAt: Date.now() + 1500 }).expect(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(soonGuest.closed()).toBe(false);
    await until(soonGuest.closed, 3000);
    expect(soonGuest.closed()).toBe(true);

    const past = await make();
    const pastGuest = await watch(past.token);
    await request(server).patch(`/boards/${board.id}/links/${past.id}`).set(auth).send({ expiresAt: Date.now() - 1000 }).expect(200);
    await until(pastGuest.closed, 2000);
    expect(pastGuest.closed()).toBe(true);
  });

  it('lets guests on an editable link change the board, but never chat or votes', async () => {
    const { server, token, auth, board } = await setup();
    const { body: link } = await request(server).post(`/boards/${board.id}/links`).set(auth).send({ canEdit: true }).expect(201);
    expect(link.canEdit).toBe(true);
    expect((await request(server).get(`/shared/${link.token}`).expect(200)).body.canEdit).toBe(true);

    const open = (tok: string) =>
      new Promise<Y.Doc>((resolve) => {
        const doc = new Y.Doc();
        providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: tok, document: doc, onSynced: () => resolve(doc) }));
      });
    const ownerDoc = await open(token);
    const guestDoc = await open(`link:${link.token}`);
    addNotes(guestDoc, [{ text: 'From a guest', color: 'pink' }]);
    guestDoc.getArray('chat').push([{ id: 'x', authorId: 'someone', name: 'Someone', at: 1, text: 'Forged' }]);
    for (let i = 0; i < 60 && !notesOf(ownerDoc).length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(notesOf(ownerDoc).map((n) => n.text)).toEqual(['From a guest']);
    expect(ownerDoc.getArray('chat').length).toBe(0);
  });
});
