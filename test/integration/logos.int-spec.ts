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

  const S3 = { vb: '0 0 64 64', body: '<path d="M0 0h64v64H0z" fill="#3f8624"/>' };
  const LAMBDA = { vb: '0 0 64 64', body: '<circle cx="32" cy="32" r="30"/>' };

  it("lets workspace owners keep their own logos, refusing ones that aren't plain drawings, and everyone use them", async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const reader = await person();
    const { body: invite } = await request(server).post(`/orgs/${ada.orgId}/invites`).set(ada.auth).send({ email: reader.email, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(reader.auth).expect(201);

    const { body: first } = await request(server)
      .post(`/orgs/${ada.orgId}/logo-packs/company/logos`)
      .set(ada.auth)
      .send({ logos: { brand: S3, bad: { vb: '0 0 1 1', body: '<script>x</script>' } } })
      .expect(200);
    expect(first).toMatchObject({ name: 'company', added: 1, total: 1, refused: [{ name: 'bad' }] });
    const { body: packs } = await request(server).get(`/orgs/${ada.orgId}/logo-packs`).set(reader.auth).expect(200);
    expect(packs.filter((p: { site: boolean }) => !p.site)).toEqual([{ name: 'company', licence: null, logos: { brand: expect.any(Object) }, site: false, updatedAt: expect.any(String) }]);
    // The cloud vendors' packs come from the site's library, not from workspaces.
    const { body: refused } = await request(server)
      .post(`/orgs/${ada.orgId}/logo-packs/aws/logos`)
      .set(ada.auth)
      .send({ logos: { s3: S3 } })
      .expect(400);
    expect(refused.message).toContain("Corkboard's icon library");
    // Only owners change them, packs have plain names, and devicon is taken.
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/ours/logos`).set(reader.auth).send({ logos: {} }).expect(403);
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/Not%20OK/logos`).set(ada.auth).send({ logos: {} }).expect(400);
    await request(server).post(`/orgs/${ada.orgId}/logo-packs/devicon/logos`).set(ada.auth).send({ logos: {} }).expect(400);
    await request(server).delete(`/orgs/${ada.orgId}/logo-packs/company`).set(reader.auth).expect(403);
    await request(server).delete(`/orgs/${ada.orgId}/logo-packs/company`).set(ada.auth).expect(204);
  });

  it("lets only site admins keep the cloud icon library, replace a pack with a vendor's new download, and every workspace use it", async () => {
    const server = t.app.getHttpServer();
    const admin = await t.siteAdmin();
    const ada = await person();
    const grace = await person();

    await request(server)
      .post('/site/logo-packs/azure/logos')
      .set(ada.auth)
      .send({ logos: { vm: S3 } })
      .expect(403);
    await request(server).get('/site/logo-packs').set(ada.auth).expect(403);
    await request(server)
      .post('/site/logo-packs/azure/logos')
      .set(admin)
      .send({ logos: { vm: S3 }, licence: 'Microsoft terms' })
      .expect(200);
    await request(server)
      .post('/site/logo-packs/azure/logos')
      .set(admin)
      .send({ logos: { functions: LAMBDA } })
      .expect(200);

    // Two workspaces that have nothing to do with each other (or with the site admin) both see it.
    for (const who of [ada, grace]) {
      const { body: packs } = await request(server).get(`/orgs/${who.orgId}/logo-packs`).set(who.auth).expect(200);
      expect(packs.find((p: { name: string }) => p.name === 'azure')).toMatchObject({ site: true, licence: 'Microsoft terms', logos: { vm: expect.any(Object), functions: expect.any(Object) } });
    }
    // A vendor's new download replaces the pack: its first batch with replace, the rest without.
    const { body: replaced } = await request(server)
      .post('/site/logo-packs/azure/logos')
      .set(admin)
      .send({ logos: { 'app-service': S3 }, replace: true })
      .expect(200);
    expect(replaced).toMatchObject({ added: 1, total: 1 });
    const { body: now } = await request(server).get('/site/logo-packs').set(admin).expect(200);
    expect(Object.keys(now.find((p: { name: string }) => p.name === 'azure').logos)).toEqual(['app-service']);
    // A site admin has no way into a workspace for it, nor learns it's there.
    await request(server).get(`/orgs/${ada.orgId}/logo-packs`).set(admin).expect(404);
    await request(server).delete('/site/logo-packs/azure').set(ada.auth).expect(403);
    await request(server).delete('/site/logo-packs/azure').set(admin).expect(204);
  });
});
