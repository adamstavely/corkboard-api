import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Picking who you are', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('serves health without a token', async () => {
    await request(t.app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('turns away requests that name nobody', async () => {
    const server = t.app.getHttpServer();
    await request(server).get('/me').expect(401);
    await request(server).get('/me').set('Authorization', 'Basic abc').expect(401);
    await request(server).get('/me').set('Authorization', 'Bearer not-an-id').expect(401);
    await request(server).get('/me').set('Authorization', `Bearer ${randomUUID()}`).expect(401);
  });

  it('adds a person with a workspace of their own, lists them to pick, and refuses the same email twice', async () => {
    const server = t.app.getHttpServer();
    const email = `${randomUUID()}@corkboard.test`;
    const { body: ada } = await request(server).post('/people').send({ name: ' Ada Lovelace ', email: email.toUpperCase() }).expect(201);
    expect(ada).toEqual({ id: expect.any(String), name: 'Ada Lovelace', email });

    const me = await request(server).get('/me').set('Authorization', `Bearer ${ada.id}`).expect(200);
    expect(me.body.orgs).toEqual([{ id: expect.any(String), name: "Ada Lovelace's workspace", role: 'owner' }]);
    expect((await request(server).get('/people').expect(200)).body).toContainEqual(ada);

    await request(server).post('/people').send({ name: 'Another Ada', email }).expect(409);
    await request(server).post('/people').send({ name: '', email: 'x@corkboard.test' }).expect(400);
    await request(server).post('/people').send({ name: 'No email' }).expect(400);
  });
});
