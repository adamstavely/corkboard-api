import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Workspace logo packs', () => {
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

  it('lets workspace owners add a pack in batches, refusing logos that are not plain drawings, and everyone use it', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const reader = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: reader.email, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(reader.auth).expect(201);

    const { body: first } = await request(server)
      .post(`/orgs/${ada.orgId}/logo-packs/aws/logos`)
      .set(ada.auth)
      .send({ logos: { s3: { vb: '0 0 64 64', body: '<path d="M0 0h64v64H0z" fill="#3f8624"/>' }, bad: { vb: '0 0 1 1', body: '<script>x</script>' } }, licence: 'Vendor terms' })
      .expect(200);
    expect(first).toMatchObject({ name: 'aws', added: 1, total: 1, refused: [{ name: 'bad' }] });
    const { body: second } = await request(server)
      .post(`/orgs/${ada.orgId}/logo-packs/aws/logos`)
      .set(ada.auth)
      .send({ logos: { lambda: { vb: '0 0 64 64', body: '<circle cx="32" cy="32" r="30"/>' } } })
      .expect(200);
    expect(second).toMatchObject({ added: 1, total: 2 });

    const { body: packs } = await request(server).get(`/orgs/${ada.orgId}/logo-packs`).set(reader.auth).expect(200);
    expect(packs).toEqual([{ name: 'aws', licence: 'Vendor terms', logos: { s3: expect.any(Object), lambda: expect.any(Object) } }]);
    // Only owners change them, packs have plain names, and devicon is taken.
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/gcp/logos`).set(reader.auth).send({ logos: {} }).expect(403);
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/Not%20OK/logos`).set(ada.auth).send({ logos: {} }).expect(400);
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/devicon/logos`).set(ada.auth).send({ logos: {} }).expect(400);
    await request(server).delete(`/orgs/${ada.orgId}/logo-packs/aws`).set(reader.auth).expect(403);
    await request(server).delete(`/orgs/${ada.orgId}/logo-packs/aws`).set(ada.auth).expect(204);
    await request(server).get(`/orgs/${ada.orgId}/logo-packs`).set(ada.auth).expect(200, []);
  });
});
