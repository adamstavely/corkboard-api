import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Members and invites', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  /** Signs a new person in; their subject doubles as their email's local part. */
  async function person(claims: Record<string, unknown> = {}) {
    const subject = randomUUID();
    const auth = { Authorization: `Bearer ${await t.token(subject, claims)}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { subject, auth, id: me.body.id as string, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }

  it('lets an admin invite someone, who sees it, accepts it and can then open the boards', async () => {
    const server = t.app.getHttpServer();
    const ada = await person({ name: 'Ada' });
    const grace = await person({ name: 'Grace' });
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Retro' });

    const { body: invite } = await request(server)
      .post(`/orgs/${ada.orgId}/invites`)
      .set(ada.auth)
      .send({ email: grace.email.toUpperCase(), role: 'member' })
      .expect(201);
    expect(invite).toMatchObject({ email: grace.email, role: 'member', invitedByName: 'Ada' });

    const mine = await request(server).get('/me/invites').set(grace.auth).expect(200);
    expect(mine.body).toEqual([
      { id: invite.id, orgId: ada.orgId, orgName: "Ada's workspace", role: 'member', invitedByName: 'Ada' },
    ]);
    await request(server).get(`/boards/${board.id}`).set(grace.auth).expect(404);

    const joined = await request(server).post(`/me/invites/${invite.id}/accept`).set(grace.auth).expect(201);
    expect(joined.body).toEqual({ id: ada.orgId, name: "Ada's workspace", role: 'member' });
    await request(server).get(`/boards/${board.id}`).set(grace.auth).expect(200);
    expect((await request(server).get('/me/invites').set(grace.auth)).body).toEqual([]);

    const members = await request(server).get(`/orgs/${ada.orgId}/members`).set(grace.auth).expect(200);
    expect(members.body.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual([
      'Ada:admin',
      'Grace:member',
    ]);
    expect(members.body.invites).toEqual([]);
  });

  it("keeps invites to admins, and from people who can't prove the email is theirs", async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const unverified = await person({ email_verified: false });
    const outsider = await person();

    await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: unverified.email, role: 'member' });
    expect((await request(server).get('/me/invites').set(unverified.auth)).body).toEqual([]);

    const { body: invite } = await request(server)
      .post(`/orgs/${ada.orgId}/invites`)
      .set(ada.auth)
      .send({ email: 'someone@else.test', role: 'admin' });
    // Not theirs to accept, and they can't see or touch the workspace's invites.
    await request(server).post(`/me/invites/${invite.id}/accept`).set(outsider.auth).expect(404);
    await request(server).get(`/orgs/${ada.orgId}/members`).set(outsider.auth).expect(404);
    await request(server).delete(`/orgs/${ada.orgId}/invites/${invite.id}`).set(outsider.auth).expect(404);
  });

  it('turns away invites from members, duplicates of members, and bad input', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: grace.email, role: 'member' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace.auth).expect(201);

    await request(server).post(`/orgs/${ada.orgId}/invites`).set(grace.auth).send({ email: 'x@y.test', role: 'member' }).expect(403);
    await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: grace.email, role: 'member' }).expect(409);
    await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: 'not-an-email', role: 'member' }).expect(400);
    await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: 'a@b.test', role: 'owner' }).expect(400);
  });

  it('changes and revokes invites; inviting the same email again updates it', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const first = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: 'p@q.test', role: 'member' });
    const again = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: 'P@q.test', role: 'admin' });
    expect(again.body).toMatchObject({ id: first.body.id, role: 'admin' });

    await request(server).patch(`/orgs/${ada.orgId}/invites/${first.body.id}`).set(ada.auth).send({ role: 'member' }).expect(200);
    await request(server).delete(`/orgs/${ada.orgId}/invites/${first.body.id}`).set(ada.auth).expect(204);
    expect((await request(server).get(`/orgs/${ada.orgId}/members`).set(ada.auth)).body.invites).toEqual([]);
  });

  it('declines an invite', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: grace.email, role: 'member' });
    await request(server).post(`/me/invites/${invite.id}/decline`).set(grace.auth).expect(204);
    expect((await request(server).get('/me/invites').set(grace.auth)).body).toEqual([]);
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace.auth).expect(404);
  });

  it('changes roles and removes people, always keeping an admin', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: grace.email, role: 'member' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace.auth);

    // The only admin can't step down or leave.
    await request(server).patch(`/orgs/${ada.orgId}/members/${ada.id}`).set(ada.auth).send({ role: 'member' }).expect(409);
    await request(server).delete(`/orgs/${ada.orgId}/members/${ada.id}`).set(ada.auth).expect(409);
    // Members can't change roles or remove others.
    await request(server).patch(`/orgs/${ada.orgId}/members/${ada.id}`).set(grace.auth).send({ role: 'member' }).expect(403);
    await request(server).delete(`/orgs/${ada.orgId}/members/${ada.id}`).set(grace.auth).expect(403);

    await request(server).patch(`/orgs/${ada.orgId}/members/${grace.id}`).set(ada.auth).send({ role: 'admin' }).expect(204);
    await request(server).delete(`/orgs/${ada.orgId}/members/${ada.id}`).set(ada.auth).expect(204);
    await request(server).get(`/orgs/${ada.orgId}/boards`).set(ada.auth).expect(404);

    // Grace is now the only admin, so she can't leave.
    await request(server).delete(`/orgs/${ada.orgId}/members/${grace.id}`).set(grace.auth).expect(409);
  });
});
