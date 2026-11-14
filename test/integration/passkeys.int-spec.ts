import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { SoftAuthenticator } from './authenticator';

describe('Passkeys', () => {
  describe('with the development picker off', () => {
    let t: TestApp;
    beforeAll(async () => {
      process.env.PEOPLE_PICKER = 'false';
      t = await createTestApp();
    });
    afterAll(async () => {
      delete process.env.PEOPLE_PICKER;
      await t.app.close();
    });

    it('signs people up and in with a passkey, and turns away everything else', async () => {
      const server = t.app.getHttpServer();
      expect((await request(server).get('/auth/config').expect(200)).body).toEqual({ picker: false });
      await request(server).get('/people').expect(404);

      // Sign up: the browser makes a passkey; the account and a session come back.
      const phone = new SoftAuthenticator();
      const email = `${randomUUID()}@corkboard.test`;
      const { body: up } = await request(server).post('/auth/sign-up/options').send({ name: 'Ada Lovelace', email, label: 'Phone' }).expect(201);
      expect(up.options).toMatchObject({ rp: { id: 'localhost', name: 'Corkboard' }, user: { name: email, displayName: 'Ada Lovelace' } });
      const { body: signedUp } = await request(server).post('/auth/sign-up/verify').send({ challengeId: up.challengeId, response: phone.create(up.options) }).expect(200);
      expect(signedUp.token).toMatch(/^cbs_/);
      expect(signedUp.person).toMatchObject({ name: 'Ada Lovelace', email });
      const auth = { Authorization: `Bearer ${signedUp.token}` };
      const { body: me } = await request(server).get('/me').set(auth).expect(200);
      expect(me.orgs).toHaveLength(1);

      // The challenge is used up, and the email is taken.
      await request(server).post('/auth/sign-up/verify').send({ challengeId: up.challengeId, response: phone.create(up.options) }).expect(400);
      await request(server).post('/auth/sign-up/options').send({ name: 'Someone', email }).expect(409);

      // An id is no longer a way in.
      await request(server).get('/me').set({ Authorization: `Bearer ${me.id}` }).expect(401);

      // Sign out, then back in with the same passkey.
      await request(server).post('/auth/sign-out').set(auth).expect(204);
      await request(server).get('/me').set(auth).expect(401);
      const { body: inOpts } = await request(server).post('/auth/sign-in/options').expect(201);
      const { body: signedIn } = await request(server).post('/auth/sign-in/verify').send({ challengeId: inOpts.challengeId, response: phone.get(inOpts.options) }).expect(200);
      expect(signedIn.person.id).toBe(me.id);
      const again = { Authorization: `Bearer ${signedIn.token}` };

      // A passkey from somewhere else, or a forged signature, doesn't get in.
      const stranger = new SoftAuthenticator();
      stranger.create({ challenge: 'x', user: { id: 'x' } });
      const { body: o2 } = await request(server).post('/auth/sign-in/options').expect(201);
      await request(server).post('/auth/sign-in/verify').send({ challengeId: o2.challengeId, response: stranger.get(o2.options) }).expect(401);
      const { body: o3 } = await request(server).post('/auth/sign-in/options').expect(201);
      // The right passkey, but a signature over some other challenge.
      const answer = phone.get(o3.options) as { response: { signature: string } };
      answer.response.signature = (phone.get({ challenge: 'some-other-challenge' }) as { response: { signature: string } }).response.signature;
      await request(server).post('/auth/sign-in/verify').send({ challengeId: o3.challengeId, response: answer }).expect(401);

      // A second passkey, on a laptop; the last one can't be removed.
      const laptop = new SoftAuthenticator();
      const { body: addOpts } = await request(server).post('/me/passkeys/options').set(again).send({ label: 'Laptop' }).expect(201);
      const { body: added } = await request(server).post('/me/passkeys/verify').set(again).send({ challengeId: addOpts.challengeId, response: laptop.create(addOpts.options) }).expect(201);
      expect(added.label).toBe('Laptop');
      const { body: keys } = await request(server).get('/me/passkeys').set(again).expect(200);
      expect(keys.map((k: { label: string }) => k.label)).toEqual(['Phone', 'Laptop']);
      await request(server).delete(`/me/passkeys/${keys[0].id}`).set(again).expect(204);
      await request(server).delete(`/me/passkeys/${keys[1].id}`).set(again).expect(409);

      // The laptop signs in now.
      const { body: o4 } = await request(server).post('/auth/sign-in/options').expect(201);
      await request(server).post('/auth/sign-in/verify').send({ challengeId: o4.challengeId, response: laptop.get(o4.options) }).expect(200);
    });
  });

  describe('with the development picker on', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp();
    });
    afterAll(async () => {
      await t.app.close();
    });

    it('lets someone added with the picker claim their account with a passkey', async () => {
      const server = t.app.getHttpServer();
      expect((await request(server).get('/auth/config')).body).toEqual({ picker: true });
      const subject = randomUUID();
      const id = await t.token(subject, { name: 'Grace' });
      const { body: up } = await request(server).post('/auth/sign-up/options').send({ name: 'Grace', email: `${subject}@corkboard.test` }).expect(201);
      const { body } = await request(server).post('/auth/sign-up/verify').send({ challengeId: up.challengeId, response: new SoftAuthenticator().create(up.options) }).expect(200);
      expect(body.person.id).toBe(id);
      // Once it has a passkey, nobody else can claim it.
      await request(server).post('/auth/sign-up/options').send({ name: 'Grace', email: `${subject}@corkboard.test` }).expect(409);
    });
  });
});
