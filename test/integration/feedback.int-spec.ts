import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { createTestApp, type TestApp } from './app';

const eventually = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('Timed out waiting');
};

describe('Feedback from outside the team', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));

  /** Opens a document over the collaboration socket; resolves synced, or rejects when turned away. */
  function connect(name: string, token: string): Promise<{ doc: Y.Doc; provider: HocuspocusProvider; closed: () => boolean }> {
    const doc = new Y.Doc();
    let closed = false;
    return new Promise((resolve, reject) => {
      const provider: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name,
        token,
        document: doc,
        onSynced: () => resolve({ doc, provider, closed: () => closed }),
        onClose: () => {
          closed = true;
        },
        onAuthenticationFailed: ({ reason }) => {
          provider.destroy();
          reject(new Error(reason));
        },
      });
      providers.push(provider);
    });
  }

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
    return { token, auth, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string, id: me.body.id as string };
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

  it("gives each participant a live projection of the board: nobody's identity, others' feedback as the board allows", async () => {
    const server = t.app.getHttpServer();
    const ada = await person();
    const ola = await person();
    const kai = await person();
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Review' });
    const { body: opened } = await request(server).post(`/boards/${board.id}/feedback`).set(ada.auth).send({ visibility: 'anonymous' }).expect(201);
    await request(server).post(`/feedback/${opened.link.token}/join`).set(ola.auth).expect(201);
    await request(server).post(`/feedback/${opened.link.token}/join`).set(kai.auth).expect(201);

    const team = await connect(board.id, ada.token);
    team.doc.transact(() => {
      const note = new Y.Map<unknown>();
      team.doc.getMap('nodes').set('n1', note);
      note.set('kind', 'note');
      note.set('x', 0);
      note.set('createdBy', { id: ada.id, name: 'Ada' });
      const kais = new Y.Map<unknown>();
      team.doc.getMap('nodes').set('k1', kais);
      kais.set('kind', 'note');
      kais.set('x', 300);
      kais.set('participant', true);
      kais.set('author', kai.id);
    });

    // The real board, and someone else's projection, are closed to a participant.
    await expect(connect(board.id, ola.token)).rejects.toThrow();
    await expect(connect(`${board.id}~p~${kai.id}`, ola.token)).rejects.toThrow();
    await expect(connect(`${board.id}~p~${ola.id}`, ada.token)).rejects.toThrow();

    const mine = await connect(`${board.id}~p~${ola.id}`, ola.token);
    const nodes = mine.doc.getMap<Y.Map<unknown>>('nodes');
    await eventually(() => nodes.has('n1') && nodes.has('k1'));
    expect(JSON.stringify(nodes.toJSON())).not.toContain(ada.id);
    expect(nodes.get('k1')!.get('byline')).toBe('Participant 2');
    // It's read-only.
    nodes.get('n1')!.set('title', 'Mine now');
    await new Promise((r) => setTimeout(r, 300));
    expect((team.doc.getMap('nodes').get('n1') as Y.Map<unknown>).get('title')).toBeUndefined();

    // It follows the board.
    (team.doc.getMap('nodes').get('n1') as Y.Map<unknown>).set('x', 50);
    await eventually(() => nodes.get('n1')!.get('x') === 50);
    // Seeing only their own, Kai's note goes.
    await request(server).put(`/boards/${board.id}/feedback`).set(ada.auth).send({ visibility: 'own' }).expect(200);
    await eventually(() => !nodes.has('k1'));

    // Blocked, they're let go and can't come back.
    await request(server).put(`/boards/${board.id}/feedback/participants/${ola.id}`).set(ada.auth).send({ blocked: true }).expect(204);
    await eventually(() => mine.closed());
    await expect(connect(`${board.id}~p~${ola.id}`, ola.token)).rejects.toThrow();
  });
});
