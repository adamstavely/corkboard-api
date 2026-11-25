import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Workspaces', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function person(name: string) {
    const subject = randomUUID();
    const auth = { Authorization: `Bearer ${await t.token(subject, { name })}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { auth, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }

  it('lets anyone start a workspace they own, invite people to it and rename it', async () => {
    const server = t.app.getHttpServer();
    const ada = await person('Ada');
    const grace = await person('Grace');

    const { body: org } = await request(server).post('/orgs').set(ada.auth).send({ name: '  Technical Directors ' }).expect(201);
    expect(org).toMatchObject({ name: 'Technical Directors', role: 'owner' });
    const me = await request(server).get('/me').set(ada.auth).expect(200);
    expect(me.body.orgs.map((o: { name: string }) => o.name)).toEqual(["Ada's workspace", 'Technical Directors']);

    // Nobody else is in it, and it doesn't show for them until they're invited.
    const members = await request(server).get(`/orgs/${org.id}/members`).set(ada.auth).expect(200);
    expect(members.body.members.map((m: { name: string }) => m.name)).toEqual(['Ada']);
    await request(server).get(`/orgs/${org.id}/members`).set(grace.auth).expect(404);
    await request(server).post(`/orgs/${org.id}/boards`).set(ada.auth).send({ title: 'Architecture' }).expect(201);

    const { body: invite } = await request(server).post(`/orgs/${org.id}/invites`).set(ada.auth).send({ email: grace.email, role: 'updater' }).expect(201);
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace.auth).expect(201);

    // Only an owner renames it; outsiders don't learn it exists.
    await request(server).patch(`/orgs/${org.id}`).set(grace.auth).send({ name: 'Mine now' }).expect(403);
    await request(server).patch(`/orgs/${org.id}`).set((await person('Eve')).auth).send({ name: 'Mine now' }).expect(404);
    const { body: renamed } = await request(server).patch(`/orgs/${org.id}`).set(ada.auth).send({ name: 'TD architecture' }).expect(200);
    expect(renamed).toEqual({ id: org.id, name: 'TD architecture', role: 'owner' });
    const graceSees = await request(server).get('/me').set(grace.auth).expect(200);
    expect(graceSees.body.orgs).toContainEqual({ id: org.id, name: 'TD architecture', role: 'updater' });
  });

  it('wants a name', async () => {
    const ada = await person('Ada');
    const server = t.app.getHttpServer();
    await request(server).post('/orgs').set(ada.auth).send({ name: '   ' }).expect(400);
    await request(server).post('/orgs').set(ada.auth).send({ name: 'x'.repeat(81) }).expect(400);
    await request(server).patch(`/orgs/${ada.orgId}`).set(ada.auth).send({}).expect(400);
  });
});
