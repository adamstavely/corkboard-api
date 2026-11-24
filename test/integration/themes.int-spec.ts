import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Workspace diagram looks', () => {
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
    return { auth, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }

  it('starts as Trench Coat; owners suggest, set and reset a look that passes AA; everyone sees it; others may not set it', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const reader = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: reader.email, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(reader.auth).expect(201);

    const { body: start } = await request(server).get(`/orgs/${ada.orgId}/diagram-theme`).set(reader.auth).expect(200);
    expect(start).toMatchObject({ custom: false, theme: { name: 'Trench Coat', font: 'inter' } });

    const { body: suggested } = await request(server)
      .post(`/orgs/${ada.orgId}/diagram-theme/suggest`)
      .set(ada.auth)
      .send({ colours: ['#e4002b', 'not a colour'], name: 'Acme' })
      .expect(200);
    expect(suggested.theme).toMatchObject({ name: 'Acme' });
    expect(suggested.notes[0]).toBe('Built from #e4002b.');
    await request(server).post(`/orgs/${ada.orgId}/diagram-theme/suggest`).set(ada.auth).send({}).expect(400);
    // A private address is never read.
    await request(server).post(`/orgs/${ada.orgId}/diagram-theme/suggest`).set(ada.auth).send({ url: 'http://127.0.0.1/' }).expect(400);

    await request(server).put(`/orgs/${ada.orgId}/diagram-theme`).set(reader.auth).send(suggested.theme).expect(403);
    const dim = { ...suggested.theme, light: ['#555555', ...suggested.theme.light.slice(1)] };
    const { body: refused } = await request(server).put(`/orgs/${ada.orgId}/diagram-theme`).set(ada.auth).send(dim).expect(400);
    expect(refused.message).toContain('needs 4.5:1');
    await request(server).put(`/orgs/${ada.orgId}/diagram-theme`).set(ada.auth).send(suggested.theme).expect(200);
    const { body: now } = await request(server).get(`/orgs/${ada.orgId}/diagram-theme`).set(reader.auth).expect(200);
    expect(now).toEqual({ custom: true, theme: suggested.theme });

    await request(server).delete(`/orgs/${ada.orgId}/diagram-theme`).set(ada.auth).expect(204);
    const { body: after } = await request(server).get(`/orgs/${ada.orgId}/diagram-theme`).set(ada.auth).expect(200);
    expect(after.custom).toBe(false);
  });
});
