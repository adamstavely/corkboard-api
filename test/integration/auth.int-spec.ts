import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Sign-in', () => {
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

  it('turns away requests without a valid token', async () => {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    await request(server).get('/me').expect(401);
    await request(server).get('/me').set('Authorization', 'Basic abc').expect(401);
    await request(server).get('/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await request(server).get('/me').set('Authorization', `Bearer ${await t.foreignToken(subject)}`).expect(401);
    for (const claims of [{ iss: 'https://elsewhere.test' }, { aud: 'another-app' }, { exp: Math.floor(Date.now() / 1000) - 60 }]) {
      await request(server).get('/me').set('Authorization', `Bearer ${await t.token(subject, claims)}`).expect(401);
    }
  });

  it('gives a new person a workspace of their own, once', async () => {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    const auth = { Authorization: `Bearer ${await t.token(subject, { name: 'Ada Lovelace' })}` };

    const [a, b] = await Promise.all([request(server).get('/me').set(auth), request(server).get('/me').set(auth)]);
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body).toMatchObject({ name: 'Ada Lovelace', email: `${subject}@corkboard.test` });
    expect(a.body.orgs).toEqual([{ id: expect.any(String), name: "Ada Lovelace's workspace", role: 'owner' }]);

    const again = await request(server).get('/me').set(auth).expect(200);
    expect(again.body.orgs).toHaveLength(1);
  });

  it('keeps name and email in step with the identity provider', async () => {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    await request(server).get('/me').set('Authorization', `Bearer ${await t.token(subject, { name: 'Grace' })}`);
    const renamed = await request(server)
      .get('/me')
      .set('Authorization', `Bearer ${await t.token(subject, { name: 'Grace Hopper', email: 'grace@navy.test' })}`)
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Grace Hopper', email: 'grace@navy.test' });
  });
});
