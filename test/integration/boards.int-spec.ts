import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { framesOf, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

describe('Boards', () => {
  let t: TestApp;
  const as = async (subject: string) => ({ Authorization: `Bearer ${await t.token(subject)}` });

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  /** Signs a new person in and returns their own workspace's id. */
  async function workspaceOf(subject: string): Promise<string> {
    const me = await request(t.app.getHttpServer()).get('/me').set(await as(subject)).expect(200);
    return me.body.orgs[0].id;
  }

  it('creates, lists, renames and deletes boards', async () => {
    const subject = randomUUID();
    const orgId = await workspaceOf(subject);
    const server = t.app.getHttpServer();

    const created = await request(server)
      .post(`/orgs/${orgId}/boards`)
      .set(await as(subject))
      .send({ title: '  Q3 retro ' })
      .expect(201);
    expect(created.body).toMatchObject({ orgId, title: 'Q3 retro' });
    const id = created.body.id;

    const list = await request(server).get(`/orgs/${orgId}/boards`).set(await as(subject)).expect(200);
    expect(list.body.map((b: { id: string }) => b.id)).toEqual([id]);

    await request(server).patch(`/boards/${id}`).set(await as(subject)).send({ title: 'Q3 retro (final)' }).expect(200);
    const got = await request(server).get(`/boards/${id}`).set(await as(subject)).expect(200);
    expect(got.body.title).toBe('Q3 retro (final)');

    await request(server).delete(`/boards/${id}`).set(await as(subject)).expect(204);
    await request(server).get(`/boards/${id}`).set(await as(subject)).expect(404);
  });

  it('rejects an empty title and unknown fields', async () => {
    const subject = randomUUID();
    const orgId = await workspaceOf(subject);
    const server = t.app.getHttpServer();
    await request(server).post(`/orgs/${orgId}/boards`).set(await as(subject)).send({ title: '' }).expect(400);
    await request(server).post(`/orgs/${orgId}/boards`).set(await as(subject)).send({ title: 'x', owner: 'y' }).expect(400);
  });

  it('starts a board with an empty document, and takes no writes over HTTP', async () => {
    const subject = randomUUID();
    const orgId = await workspaceOf(subject);
    const server = t.app.getHttpServer();
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(await as(subject)).send({ title: 'Plan' });

    const empty = await request(server).get(`/boards/${board.id}/document`).set(await as(subject)).expect(200);
    expect(empty.body).toEqual({ state: '' });
    // Editing goes through the collaboration socket (see collab.int-spec.ts).
    await request(server).put(`/boards/${board.id}/document`).set(await as(subject)).send({ state: '' }).expect(404);
  });

  it('starts a board from a template, saved before anyone opens it', async () => {
    const subject = randomUUID();
    const orgId = await workspaceOf(subject);
    const server = t.app.getHttpServer();
    const { body: templates } = await request(server).get('/board-templates').set(await as(subject)).expect(200);
    expect(templates.find((tp: { id: string }) => tp.id === 'retro')).toMatchObject({ name: 'Retrospective', columns: ['What went well', 'What could be better', 'Action items'] });

    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(await as(subject)).send({ title: 'Sprint 12', template: 'retro' }).expect(201);
    const { body: saved } = await request(server).get(`/boards/${board.id}/document`).set(await as(subject)).expect(200);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(saved.state, 'base64'));
    expect(framesOf(doc).map((f) => f.title)).toEqual(['What went well', 'What could be better', 'Action items']);
    // Each column's hint note sits inside it.
    expect(notesOf(doc).map((n) => n.frame)).toEqual(['What went well', 'What could be better', 'Action items']);

    await request(server).post(`/orgs/${orgId}/boards`).set(await as(subject)).send({ title: 'x', template: 'nope' }).expect(400);
  });

  it("hides other workspaces' boards as if they didn't exist", async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const orgId = await workspaceOf(owner);
    await workspaceOf(stranger);
    const server = t.app.getHttpServer();
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(await as(owner)).send({ title: 'Private' });

    await request(server).get(`/boards/${board.id}`).set(await as(stranger)).expect(404);
    await request(server).get(`/boards/${board.id}/document`).set(await as(stranger)).expect(404);
    await request(server).delete(`/boards/${board.id}`).set(await as(stranger)).expect(404);
    await request(server).get(`/orgs/${orgId}/boards`).set(await as(stranger)).expect(404);
    await request(server).post(`/orgs/${orgId}/boards`).set(await as(stranger)).send({ title: 'x' }).expect(404);
  });
});
