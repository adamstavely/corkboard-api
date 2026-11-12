import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SearchIndex } from '../../src/search/search-index';
import { createTestApp, type TestApp } from './app';

describe('Search', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function signIn(subject: string) {
    const auth = { Authorization: `Bearer ${await t.token(subject)}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { auth, orgId: me.body.orgs[0].id as string };
  }

  it('finds boards by title, follows renames and deletes, and stays within the workspace', async () => {
    const server = t.app.getHttpServer();
    const ada = await signIn(randomUUID());
    const grace = await signIn(randomUUID());
    const word = `quokka${Date.now()}`;
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: `${word} planning` });
    await request(server).post(`/orgs/${grace.orgId}/boards`).set(grace.auth).send({ title: `${word} elsewhere` });
    const search = (who: typeof ada, q: string) =>
      t.app.get(SearchIndex).refresh().then(() => request(server).get(`/orgs/${who.orgId}/search`).query({ q }).set(who.auth).expect(200));

    expect((await search(ada, word)).body.map((h: { boardId: string }) => h.boardId)).toEqual([board.id]);

    await request(server).patch(`/boards/${board.id}`).set(ada.auth).send({ title: 'Roadmap' }).expect(200);
    expect((await search(ada, 'roadmap')).body.map((h: { title: string }) => h.title)).toEqual(['Roadmap']);

    await request(server).delete(`/boards/${board.id}`).set(ada.auth).expect(204);
    expect((await search(ada, 'roadmap')).body).toEqual([]);
  });

  it("needs a query, and membership of the workspace", async () => {
    const server = t.app.getHttpServer();
    const ada = await signIn(randomUUID());
    const grace = await signIn(randomUUID());
    await request(server).get(`/orgs/${ada.orgId}/search`).set(ada.auth).expect(400);
    await request(server).get(`/orgs/${ada.orgId}/search`).query({ q: 'x' }).set(grace.auth).expect(404);
  });
});
