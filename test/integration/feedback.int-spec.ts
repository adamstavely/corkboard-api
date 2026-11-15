import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

describe('Feedback from outside the team', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function person() {
    const subject = randomUUID();
    const auth = { Authorization: `Bearer ${await t.token(subject)}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { auth, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string, id: me.body.id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  async function joined(owner: Person, role: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person();
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  it('lets anyone signed in join by link as a participant, under a pseudonym, until blocked or closed', async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const ola = await person();
    const kai = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Homepage review' });
    const feedback = `/boards/${board.id}/feedback`;

    // Updaters who aren't the facilitator can't open it; owners can.
    await request(server).post(feedback).set(grace.auth).send({ visibility: 'anonymous' }).expect(403);
    await request(server).post(feedback).set(ola.auth).send({ visibility: 'anonymous' }).expect(404);
    const { body: opened } = await request(server).post(feedback).set(ada.auth).send({ visibility: 'anonymous' }).expect(201);
    expect(opened.link.visibility).toBe('anonymous');
    const join = (who: Person) => request(server).post(`/feedback/${opened.link.token}/join`).set(who.auth);

    const { body: olaJoin } = await join(ola).expect(201);
    expect(olaJoin).toMatchObject({ boardId: board.id, title: 'Homepage review', member: false, you: { pseudonym: 1 } });
    await join(ola).expect(201);
    expect((await join(kai).expect(201)).body.you.pseudonym).toBe(2);
    // Someone in the workspace opens the board as themselves.
    expect((await join(grace).expect(201)).body).toMatchObject({ member: true, you: null });
    await request(server).post('/feedback/not-a-token/join').set(ola.auth).expect(404);

    // The team sees who joined, by name; outsiders can't look.
    const { body: team } = await request(server).get(feedback).set(grace.auth).expect(200);
    expect(team.participants.map((p: { pseudonym: number }) => p.pseudonym)).toEqual([1, 2]);
    expect(team.participants[0].userId).toBe(ola.id);
    await request(server).get(feedback).set(ola.auth).expect(404);

    await request(server).put(feedback).set(ada.auth).send({ visibility: 'own' }).expect(200);
    await request(server).put(`${feedback}/participants/${ola.id}`).set(ada.auth).send({ blocked: true }).expect(204);
    await join(ola).expect(403);
    await request(server).put(`${feedback}/participants/${ola.id}`).set(ada.auth).send({ blocked: false }).expect(204);
    await join(ola).expect(201);

    await request(server).delete(feedback).set(ada.auth).expect(204);
    await join(kai).expect(410);
    expect((await request(server).get(feedback).set(ada.auth).expect(200)).body.link).toBeNull();

    // Every step is in the board's history, under the real person.
    const { body: events } = await request(server).get(`/boards/${board.id}/activity`).set(ada.auth).expect(200);
    const actions = JSON.stringify(events);
    expect(actions).toContain('joined to give feedback');
    expect(actions).toContain('blocked a participant');
  });
});
