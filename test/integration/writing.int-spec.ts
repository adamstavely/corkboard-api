import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { framesOf, inFrame, newFrame, notesOf } from '../../src/assist/board-edit';
import { writingOf } from '../../src/facilitation/writing-doc';
import { createTestApp, type TestApp } from './app';

describe('Hidden writing', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    providers.forEach((p) => p.destroy());
    await t.app.close();
  });

  async function people() {
    const server = t.app.getHttpServer();
    const adaToken = await t.token(randomUUID(), { name: 'Ada Lovelace' });
    const ada = { Authorization: `Bearer ${adaToken}` };
    const orgId = (await request(server).get('/me').set(ada)).body.orgs[0].id as string;
    const join = async (name: string, role: string) => {
      const subject = randomUUID();
      const auth = { Authorization: `Bearer ${await t.token(subject, { name })}` };
      const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(ada).send({ email: `${subject}@corkboard.test`, role });
      await request(server).post(`/me/invites/${invite.id}/accept`).set(auth).expect(201);
      return auth;
    };
    const grace = await join('Grace Hopper', 'commenter');
    const linus = await join('Linus', 'reader');
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(ada).send({ title: 'Retro' });
    // Grace watches the board live, as her browser would.
    const doc = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: grace.Authorization.slice(7), document: doc, onSynced: () => resolve() }));
    });
    return { server, ada, adaToken, grace, linus, board, doc };
  }

  const settle = async (done: () => boolean) => {
    for (let i = 0; i < 60 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
  };

  it('keeps notes with their authors until revealed, then puts them all on the board, unsigned and shuffled', async () => {
    const { server, ada, grace, linus, board, doc } = await people();
    const base = `/boards/${board.id}/writing`;
    await request(server).post(`${base}/drafts`).set(grace).send({ text: 'Too early' }).expect(409);
    await request(server).post(base).set(grace).send({ anonymous: true }).expect(403);
    await request(server).post(base).set(ada).send({ anonymous: true }).expect(204);
    await request(server).post(base).set(ada).send({ anonymous: true }).expect(409);

    await request(server).post(`${base}/drafts`).set(grace).send({ text: 'Deploys are slow', color: 'pink' }).expect(201);
    const { body: second } = await request(server).post(`${base}/drafts`).set(grace).send({ text: 'Typo' }).expect(201);
    await request(server).patch(`${base}/drafts/${second.id}`).set(grace).send({ text: 'Tests are flaky' }).expect(200);
    await request(server).post(`${base}/drafts`).set(ada).send({ text: 'Standups run long' }).expect(201);
    await request(server).post(`${base}/drafts`).set(linus).send({ text: 'Readers only read' }).expect(403);

    // Everyone sees how many, nobody sees what: not in the board's document, not through someone else's list.
    await settle(() => writingOf(doc).notes === 3);
    expect(writingOf(doc)).toMatchObject({ open: true, anonymous: true, notes: 3, writers: 2, startedBy: 'Ada Lovelace' });
    expect(notesOf(doc)).toEqual([]);
    expect(Buffer.from(Y.encodeStateAsUpdate(doc)).toString('utf8')).not.toContain('Deploys');
    const { body: gracesOwn } = await request(server).get(`${base}/drafts`).set(grace).expect(200);
    expect(gracesOwn.map((d: { text: string }) => d.text)).toEqual(['Deploys are slow', 'Tests are flaky']);
    expect((await request(server).get(`${base}/drafts`).set(ada)).body.map((d: { text: string }) => d.text)).toEqual(['Standups run long']);
    await request(server).delete(`${base}/drafts/${gracesOwn[0].id}`).set(ada).expect(404);

    await request(server).post(`${base}/reveal`).set(grace).expect(403);
    const { body: revealed } = await request(server).post(`${base}/reveal`).set(ada).expect(200);
    expect(revealed).toEqual({ revealed: 3 });
    await settle(() => notesOf(doc).length === 3);
    expect(notesOf(doc).map((n) => n.text).sort()).toEqual(['Deploys are slow', 'Standups run long', 'Tests are flaky']);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    expect([...nodes.values()].map((n) => [n.get('author'), n.get('authorName')])).toEqual([
      ['anonymous', undefined],
      ['anonymous', undefined],
      ['anonymous', undefined],
    ]);
    expect(writingOf(doc).open).toBe(false);
    expect((await request(server).get(`${base}/drafts`).set(grace)).body).toEqual([]);
  });

  it('signs revealed notes when not anonymous, puts them in the chosen frame, and a cancelled round shows nothing', async () => {
    const { server, ada, adaToken, grace, board, doc } = await people();
    const base = `/boards/${board.id}/writing`;
    // Ada draws a frame, as the board does.
    const owner = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: adaToken, document: owner, onSynced: () => resolve() }));
    });
    const frameId = newFrame(owner, 'What went well', { x: 0, y: 0, w: 500, h: 200 }, 1, 'ada');
    await settle(() => framesOf(doc).length === 1);

    await request(server).post(base).set(ada).send({ anonymous: false, frameId }).expect(204);
    for (const text of ['One', 'Two', 'Three']) await request(server).post(`${base}/drafts`).set(grace).send({ text }).expect(201);
    await request(server).post(`${base}/reveal`).set(ada).expect(200);
    await settle(() => notesOf(doc).length === 3);
    const frame = framesOf(doc)[0];
    expect(frame.h).toBeGreaterThan(200);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    for (const n of notesOf(doc)) {
      expect(inFrame({ ...n, w: 200, h: 160 }, frame)).toBe(true);
      expect(nodes.get(n.id)?.get('authorName')).toBe('Grace Hopper');
    }

    await request(server).post(base).set(ada).send({ anonymous: true }).expect(204);
    await request(server).post(`${base}/drafts`).set(grace).send({ text: 'Never seen' }).expect(201);
    await request(server).delete(base).set(ada).expect(204);
    await settle(() => !writingOf(doc).open);
    expect(notesOf(doc).map((n) => n.text)).not.toContain('Never seen');
    await request(server).post(`${base}/reveal`).set(ada).expect(409);
  });
});
