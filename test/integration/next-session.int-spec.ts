import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { framesOf, newFrame, notesOf, placeNotes } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

describe('The next session', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    providers.forEach((p) => p.destroy());
    await t.app.close();
  });

  const open = (boardId: string, token: string) =>
    new Promise<Y.Doc>((resolve) => {
      const doc = new Y.Doc();
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: boardId, token, document: doc, onSynced: () => resolve(doc) }));
    });

  it("starts a new board from the last one: same frames, open tasks carried, linked, in the same folder", async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: folder } = await request(server).post(`/orgs/${orgId}/folders`).set(auth).send({ name: 'Retros' }).expect(201);
    const { body: last } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Sprint 12 retro' });
    await request(server).put(`/boards/${last.id}/folder`).set(auth).send({ folderId: folder.id }).expect(204);

    const doc = await open(last.id, token);
    const actions = newFrame(doc, 'Action items', { x: 0, y: 0, w: 500, h: 400 }, 1, 'ada');
    const [cache] = placeNotes(doc, [{ text: 'Grace: build cache', color: 'yellow', author: 'ada' }], actions);
    doc.getMap('tasks').set('t1', { id: 't1', key: 'T-7', title: 'Build cache', status: 'todo', priority: 0, labels: [], created: '2026-11-01', noteId: cache });
    await new Promise((r) => setTimeout(r, 300));

    await request(server).post(`/boards/${last.id}/next`).set(readerAuth).send({}).expect(403);
    const { body: next } = await request(server).post(`/boards/${last.id}/next`).set(auth).send({}).expect(201);
    expect(next).toMatchObject({ title: 'Sprint 13 retro', continuesId: last.id, folderId: folder.id, role: 'owner' });
    expect((await request(server).get(`/boards/${next.id}`).set(auth)).body.continuesId).toBe(last.id);

    const nextDoc = await open(next.id, token);
    expect(framesOf(nextDoc).map((f) => f.title)).toEqual(['Action items']);
    expect(notesOf(nextDoc).map((n) => n.text)).toEqual(['Grace: build cache']);
    expect([...nextDoc.getMap<{ key: string }>('tasks').values()].map((t) => t.key)).toEqual(['T-1']);

    const { body: named } = await request(server).post(`/boards/${last.id}/next`).set(auth).send({ title: 'Special retro' }).expect(201);
    expect(named.title).toBe('Special retro');
  });
});
