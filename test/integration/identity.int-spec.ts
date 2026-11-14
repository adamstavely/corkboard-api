import { HocuspocusProvider } from '@hocuspocus/provider';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { hashToken } from '../../src/auth/users.service';
import { PasskeysService } from '../../src/auth/passkeys.service';
import { CollabService } from '../../src/collab/collab.service';
import { DB, type Db } from '../../src/db/db.module';
import { sessions, users } from '../../src/db/schema';
import { createTestApp, type TestApp } from './app';
import { SoftAuthenticator } from './authenticator';

/** Production mode: no picker, so who someone is rests on their passkey and nothing they typed. */
describe('Identity with the development picker off', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    process.env.PEOPLE_PICKER = 'false';
    t = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.PEOPLE_PICKER;
    for (const p of providers) p.destroy();
    await t.app.close();
  });

  async function signUp(email = `${randomUUID()}@corkboard.test`, name = 'Someone') {
    const server = t.app.getHttpServer();
    const key = new SoftAuthenticator();
    const { body: opts } = await request(server).post('/auth/sign-up/options').send({ name, email }).expect(201);
    const { body } = await request(server).post('/auth/sign-up/verify').send({ challengeId: opts.challengeId, response: key.create(opts.options) }).expect(200);
    const auth = { Authorization: `Bearer ${body.token as string}` };
    const { body: me } = await request(server).get('/me').set(auth).expect(200);
    return { token: body.token as string, auth, id: me.id as string, orgId: me.orgs[0].id as string, key };
  }

  /** A live board connection, and whether it has been closed. */
  function connect(boardId: string, token: string) {
    return new Promise<{ closed: () => boolean; provider: HocuspocusProvider }>((resolve, reject) => {
      let closed = false;
      const provider: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token,
        document: new Y.Doc(),
        onSynced: (): void => resolve({ closed: () => closed, provider }),
        onClose: () => (closed = true),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
      });
      providers.push(provider);
    });
  }

  const until = async (check: () => boolean, ms: number) => {
    for (const end = Date.now() + ms; !check() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
  };

  it('joins a workspace only through the invite link, not by signing up with the invited email', async () => {
    const server = t.app.getHttpServer();
    const owner = await signUp(undefined, 'Ada');
    const invitedEmail = `${randomUUID()}@corkboard.test`;
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: invitedEmail, role: 'owner' }).expect(201);
    expect(invite.token).toMatch(/^cbi_/);

    // Someone else signs up claiming that email: they see no invite and can't take it by id.
    const impostor = await signUp(invitedEmail, 'Mallory');
    expect((await request(server).get('/me/invites').set(impostor.auth).expect(200)).body).toEqual([]);
    await request(server).post(`/me/invites/${invite.id}/accept`).set(impostor.auth).expect(404);
    await request(server).post('/invites/accept').set(impostor.auth).send({ token: 'cbi_guessing-is-not-enough' }).expect(404);
    expect((await request(server).get(`/orgs/${owner.orgId}/members`).set(owner.auth)).body.members).toHaveLength(1);

    // The person with the link sees what it's for, joins once, and the link is spent.
    const grace = await signUp(undefined, 'Grace');
    const { body: preview } = await request(server).post('/invites/lookup').set(grace.auth).send({ token: invite.token }).expect(200);
    expect(preview).toMatchObject({ orgId: owner.orgId, orgName: "Ada's workspace", role: 'owner', invitedByName: 'Ada' });
    const { body: joined } = await request(server).post('/invites/accept').set(grace.auth).send({ token: invite.token }).expect(201);
    expect(joined).toEqual({ id: owner.orgId, name: "Ada's workspace", role: 'owner' });
    await request(server).post('/invites/accept').set(impostor.auth).send({ token: invite.token }).expect(404);

    // Inviting again makes a new link; the old one stops working.
    const { body: first } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: 'later@corkboard.test', role: 'reader' }).expect(201);
    const { body: second } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: 'later@corkboard.test', role: 'updater' }).expect(201);
    await request(server).post('/invites/lookup').set(grace.auth).send({ token: first.token }).expect(404);
    expect((await request(server).post('/invites/lookup').set(grace.auth).send({ token: second.token }).expect(200)).body.role).toBe('updater');
  });

  it('closes board connections when their session signs out', async () => {
    const server = t.app.getHttpServer();
    const ada = await signUp();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Plan' }).expect(201);
    const live = await connect(board.id, ada.token);

    await request(server).post('/auth/sign-out').set(ada.auth).expect(204);
    await until(live.closed, 3000);
    expect(live.closed()).toBe(true);
    // And it can't come back in on that token.
    await expect(connect(board.id, ada.token)).rejects.toThrow();
  });

  it('closes connections whose session has expired or was ended elsewhere', async () => {
    const server = t.app.getHttpServer();
    const ada = await signUp();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Plan' }).expect(201);
    const live = await connect(board.id, ada.token);

    // As if it ran out (or another API instance signed it out): the sweep finds it.
    const db = t.app.get<Db>(DB);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashToken(ada.token)));
    await t.app.get(CollabService).sweepSessions();
    await until(live.closed, 3000);
    expect(live.closed()).toBe(true);
  });

  it("removes passkeys one at a time, so two at once can't remove the last", async () => {
    const server = t.app.getHttpServer();
    const ada = await signUp();
    const laptop = new SoftAuthenticator();
    const { body: addOpts } = await request(server).post('/me/passkeys/options').set(ada.auth).send({ label: 'Laptop' }).expect(201);
    await request(server).post('/me/passkeys/verify').set(ada.auth).send({ challengeId: addOpts.challengeId, response: laptop.create(addOpts.options) }).expect(201);
    const { body: keys } = await request(server).get('/me/passkeys').set(ada.auth).expect(200);
    expect(keys).toHaveLength(2);

    const user = (await t.app.get<Db>(DB).query.users.findFirst({ where: eq(users.id, ada.id) }))!;
    const passkeys = t.app.get(PasskeysService);
    const results = await Promise.allSettled([passkeys.remove(user, keys[0].id), passkeys.remove(user, keys[1].id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await request(server).get('/me/passkeys').set(ada.auth).expect(200)).body).toHaveLength(1);
  });
});
