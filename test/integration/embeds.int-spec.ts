import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

const UI = 'http://localhost:4300';
const POLICIES = {
  shareWithPeople: 'board_owners',
  shareLinks: 'board_owners',
  editableLinks: true,
  linkPassword: false,
  linkMaxDays: null as number | null,
  exports: 'everyone',
  feedback: 'board_owners',
  retentionDays: null as number | null,
  embeds: true,
};

describe('Live embeds', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function owner() {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID());
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(server).get('/me').set(auth).expect(200);
    const orgId = me.body.orgs[0].id as string;
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Roadmap <Q3>' }).expect(201);
    const setPolicies = (change: Partial<typeof POLICIES>) => request(server).put(`/orgs/${orgId}/policies`).set(auth).send({ ...POLICIES, ...change }).expect(200);
    return { server, token, auth, orgId, board: board as { id: string }, setPolicies };
  }

  function connect(boardId: string, token: string, document = new Y.Doc()): Promise<HocuspocusProvider> {
    return new Promise((resolve, reject) => {
      const p: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token,
        document,
        onSynced: (): void => resolve(p),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
      });
      providers.push(p);
    });
  }

  const closes = (p: HocuspocusProvider) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not let go')), 3000);
      p.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  it('makes one read-only link to embed, and shows the board live through it, read-only', async () => {
    const { server, token, auth, board } = await owner();
    const { body: link } = await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200);
    expect(link).toMatchObject({ embed: true, canEdit: false, hasPassword: false, label: 'Embed' });
    expect((await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200)).body.id).toBe(link.id);

    expect((await request(server).get(`/embed/${link.token}`).expect(200)).body).toEqual({ boardId: board.id, title: 'Roadmap <Q3>', canEdit: false });
    const ownerDoc = new Y.Doc();
    await connect(board.id, token, ownerDoc);
    const embedDoc = new Y.Doc();
    const embed = await connect(board.id, `embed:${link.token}`, embedDoc);
    addNotes(ownerDoc, [{ text: 'Live', color: 'yellow' }]);
    for (let i = 0; i < 60 && !notesOf(embedDoc).length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(notesOf(embedDoc).map((n) => n.text)).toEqual(['Live']);
    addNotes(embedDoc, [{ text: 'From the embed', color: 'pink' }]);
    await new Promise((r) => setTimeout(r, 400));
    expect(notesOf(ownerDoc)).toHaveLength(1);

    // Revoking the link stops the embed, and a new embed link is made after.
    const gone = closes(embed);
    await request(server).delete(`/boards/${board.id}/links/${link.id}`).set(auth).expect(204);
    await gone;
    await request(server).get(`/embed/${link.token}`).expect(410);
    expect((await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200)).body.id).not.toBe(link.id);
  });

  it('describes an embed page over oEmbed, with an iframe sized to fit', async () => {
    const { server, auth, board } = await owner();
    const { body: link } = await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200);
    const url = `${UI}/embed/${link.token}`;
    const { body } = await request(server).get('/oembed').query({ url, format: 'json', maxwidth: 400 }).expect(200);
    expect(body).toEqual({
      version: '1.0',
      type: 'rich',
      title: 'Roadmap <Q3>',
      provider_name: 'Corkboard',
      provider_url: UI,
      html: `<iframe src="${url}" width="400" height="250" style="border:0" loading="lazy" allowfullscreen title="Roadmap &lt;Q3&gt; (Corkboard board)"></iframe>`,
      width: 400,
      height: 250,
      cache_age: 300,
    });
    await request(server).get('/oembed').query({ url, format: 'xml' }).expect(501);
    await request(server).get('/oembed').query({ url: `https://elsewhere.test/embed/${link.token}` }).expect(404);
    await request(server).get('/oembed').query({ url: `${UI}/shared/${link.token}` }).expect(404);
    await request(server).get('/oembed').query({ url: `${UI}/embed/${'x'.repeat(32)}` }).expect(404);
  });

  it("keeps embeds out when the workspace turns them off, and won't embed a link with a password", async () => {
    const { server, auth, orgId, board, setPolicies } = await owner();
    const { body: link } = await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200);
    const embed = await connect(board.id, `embed:${link.token}`);

    const gone = closes(embed);
    await setPolicies({ embeds: false });
    await gone;
    for (const res of [
      await request(server).get(`/embed/${link.token}`).expect(403),
      await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(403),
      await request(server).get('/oembed').query({ url: `${UI}/embed/${link.token}` }).expect(403),
    ]) {
      expect(res.body).toMatchObject({ policy: 'embeds', message: "This workspace's policy doesn't allow embedding boards in other tools." });
    }
    await expect(connect(board.id, `embed:${link.token}`)).rejects.toThrow();
    expect((await request(server).get(`/boards/${board.id}/policy`).set(auth)).body.embeds.allowed).toBe(false);
    // The link itself still works as a share link.
    await request(server).get(`/shared/${link.token}`).expect(200);

    await setPolicies({ embeds: true });
    const { body: locked } = await request(server).post(`/boards/${board.id}/links`).set(auth).send({ password: 'open sesame' }).expect(201);
    expect((await request(server).get(`/embed/${locked.token}`).expect(403)).body.policy).toBe('linkPassword');
    await expect(connect(board.id, `embed:${locked.token}`)).rejects.toThrow();

    await setPolicies({ linkPassword: true });
    expect((await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(403)).body.policy).toBe('linkPassword');
    expect((await request(server).get(`/orgs/${orgId}/policies`).set(auth)).body.embeds).toBe(true);
  });

  it("refuses framing on everything the API answers, embed answers included", async () => {
    const { server, auth, board } = await owner();
    const { body: link } = await request(server).post(`/boards/${board.id}/links/embed`).set(auth).expect(200);
    for (const res of [
      await request(server).get('/health'),
      await request(server).get(`/embed/${link.token}`),
      await request(server).get('/oembed').query({ url: `${UI}/embed/${link.token}` }),
      await request(server).get('/no-such-route'),
    ]) {
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });
});
