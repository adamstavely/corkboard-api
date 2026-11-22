import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { CollabService, SERVER } from '../../src/collab/collab.service';
import { DB, type Db } from '../../src/db/db.module';
import { boardDocuments, boardEvents, boardVersions } from '../../src/db/schema';
import { ledgerEntries, type LedgerEntry } from '../../src/ledger/ledger-doc';
import { createTestApp, type TestApp } from './app';

const DAY = 86_400_000;
const DEFAULTS = {
  shareWithPeople: 'board_owners',
  shareLinks: 'board_owners',
  editableLinks: true,
  linkPassword: false,
  linkMaxDays: null as number | null,
  exports: 'everyone',
  feedback: 'board_owners',
  retentionDays: null as number | null,
  embeds: true,
};

describe('Workspace policies', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function person() {
    const subject = randomUUID();
    const token = await t.token(subject);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { token, auth, id: me.body.id as string, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  async function joined(owner: Person, role: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person();
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  /** A workspace (Ada owns it), a board Grace owns without owning the workspace, and Linus who can edit it. */
  async function team() {
    const server = t.app.getHttpServer();
    const ada = await person();
    const grace = await joined(ada, 'updater');
    const linus = await joined(ada, 'updater');
    const reader = await joined(ada, 'reader');
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(grace.auth).send({ title: 'Plan' }).expect(201);
    return { server, ada, grace, linus, reader, board: board as { id: string } };
  }

  /** Sets the policies of Ada's workspace, as `who`. */
  const setPolicies = (ada: Person, change: Partial<typeof DEFAULTS>, status = 200, who = ada) =>
    request(t.app.getHttpServer())
      .put(`/orgs/${ada.orgId}/policies`)
      .set(who.auth)
      .send({ ...DEFAULTS, ...change })
      .expect(status);

  function connect(boardId: string, token: string, document = new Y.Doc()): Promise<HocuspocusProvider> {
    return new Promise((resolve, reject) => {
      const p: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token,
        document,
        onSynced: (): void => resolve(p),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
      });
      providers.push(p);
    });
  }

  it('shows every member the policies, and lets only workspace owners change them', async () => {
    const { server, ada, grace, reader } = await team();
    expect((await request(server).get(`/orgs/${ada.orgId}/policies`).set(reader.auth).expect(200)).body).toEqual(DEFAULTS);
    await setPolicies(ada, { exports: 'editors' }, 403, grace);
    await setPolicies(ada, { shareLinks: 'everyone' }, 400);
    await setPolicies(ada, { linkMaxDays: 0 }, 400);
    const { body } = await setPolicies(ada, { exports: 'editors', retentionDays: 90 });
    expect(body).toMatchObject({ exports: 'editors', retentionDays: 90 });
    expect((await request(server).get(`/orgs/${ada.orgId}/policies`).set(grace.auth)).body.exports).toBe('editors');
  });

  it('decides who may share a board with people, and never lets them give more than their own role', async () => {
    const { server, ada, grace, linus, reader, board } = await team();
    const share = (who: Person, member: Person, role: string | null) => request(server).put(`/boards/${board.id}/members/${member.id}`).set(who.auth).send({ role });

    // By default board owners share; someone who can only edit is told which policy stops them.
    const refused = await share(linus, reader, 'commenter').expect(403);
    expect(refused.body).toMatchObject({ policy: 'shareWithPeople', message: "This workspace's policy lets only board owners share boards with people." });
    await share(grace, reader, 'commenter').expect(200);

    await setPolicies(ada, { shareWithPeople: 'editors' });
    await share(linus, reader, 'updater').expect(200);
    await share(linus, reader, 'owner').expect(403);
    await share(linus, grace, 'reader').expect(403);
    const policy = (await request(server).get(`/boards/${board.id}/policy`).set(reader.auth).expect(200)).body;
    expect(policy.shareWithPeople).toEqual({ allowed: true, reason: null });

    await setPolicies(ada, { shareWithPeople: 'workspace_owners' });
    expect((await share(grace, reader, 'reader').expect(403)).body.message).toBe("This workspace's policy lets only workspace owners share boards with people.");
    await share(ada, reader, 'reader').expect(200);
  });

  it('decides who may make share links, and whether they may let guests edit', async () => {
    const { server, ada, grace, linus, board } = await team();
    const { body: editable } = await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({ canEdit: true }).expect(201);
    await request(server).post(`/boards/${board.id}/links`).set(linus.auth).send({}).expect(403);

    await setPolicies(ada, { shareLinks: 'workspace_owners', editableLinks: false });
    const refused = await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({}).expect(403);
    expect(refused.body.policy).toBe('shareLinks');
    await request(server).get(`/boards/${board.id}/links`).set(grace.auth).expect(403);
    expect((await request(server).post(`/boards/${board.id}/links`).set(ada.auth).send({ canEdit: true }).expect(403)).body.policy).toBe('editableLinks');
    await request(server).post(`/boards/${board.id}/links`).set(ada.auth).send({}).expect(201);

    // The editable link made before still opens, read-only, guests included.
    expect((await request(server).get(`/shared/${editable.token}`).expect(200)).body.canEdit).toBe(false);
    const guestDoc = new Y.Doc();
    await connect(board.id, `link:${editable.token}`, guestDoc);
    const ownerDoc = new Y.Doc();
    await connect(board.id, grace.token, ownerDoc);
    addNotes(guestDoc, [{ text: 'From a guest', color: 'pink' }]);
    await new Promise((r) => setTimeout(r, 400));
    expect(notesOf(ownerDoc)).toHaveLength(0);

    // A board owner can still turn a link off.
    await request(server).delete(`/boards/${board.id}/links/${editable.id}`).set(grace.auth).expect(204);
    const policy = (await request(server).get(`/boards/${board.id}/policy`).set(grace.auth)).body;
    expect(policy.shareLinks.allowed).toBe(false);
    expect(policy.editableLinks.allowed).toBe(false);
    const adas = (await request(server).get(`/boards/${board.id}/policy`).set(ada.auth).expect(200)).body;
    expect(adas.shareLinks.allowed).toBe(true);
    expect(adas.editableLinks).toEqual({ allowed: false, reason: "This workspace's policy doesn't allow share links that let guests edit." });
  });

  it('puts a password on share links, and limits wrong guesses', async () => {
    const { server, ada, grace, board } = await team();
    const { body: plain } = await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({}).expect(201);
    const plainGuest = await connect(board.id, `link:${plain.token}`);
    let closed = false;
    plainGuest.on('close', () => (closed = true));

    await setPolicies(ada, { linkPassword: true });
    for (let i = 0; i < 60 && !closed; i++) await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
    expect((await request(server).get(`/shared/${plain.token}`).expect(403)).body.policy).toBe('linkPassword');
    expect((await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({}).expect(403)).body.policy).toBe('linkPassword');

    const { body: link } = await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({ password: 'open sesame' }).expect(201);
    expect(link.hasPassword).toBe(true);
    expect((await request(server).get(`/shared/${link.token}`).expect(403)).body.passwordRequired).toBe(true);
    await expect(connect(board.id, `link:${link.token}`)).rejects.toThrow();
    await request(server).post(`/shared/${link.token}/unlock`).send({ password: 'wrong one' }).expect(403);
    const { body } = await request(server).post(`/shared/${link.token}/unlock`).send({ password: 'open sesame' }).expect(200);
    expect((await request(server).get(`/shared/${link.token}`).set('X-Link-Pass', body.pass).expect(200)).body.title).toBe('Plan');
    await request(server).get(`/shared/${link.token}`).set('X-Link-Pass', `${body.pass}x`).expect(403);
    await connect(board.id, `link:${link.token}:${body.pass}`);

    // Four more wrong guesses (five in all), then even the right password waits.
    for (let i = 0; i < 4; i++) await request(server).post(`/shared/${link.token}/unlock`).send({ password: `guess ${i}` }).expect(403);
    const blocked = await request(server).post(`/shared/${link.token}/unlock`).send({ password: 'open sesame' }).expect(429);
    expect(blocked.body.message).toMatch(/Too many wrong passwords/);
  });

  it('makes share links expire within the longest the workspace allows, cutting older ones short', async () => {
    const { server, ada, grace, board } = await team();
    const { body: forever } = await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({}).expect(201);
    expect(forever.expiresAt).toBeNull();

    await setPolicies(ada, { linkMaxDays: 7 });
    const [listed] = (await request(server).get(`/boards/${board.id}/links`).set(grace.auth)).body;
    expect(listed.expiresAt).toBe(forever.createdAt + 7 * DAY);
    expect((await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({}).expect(403)).body.policy).toBe('linkMaxDays');
    await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({ expiresInDays: 8 }).expect(403);
    await request(server).post(`/boards/${board.id}/links`).set(grace.auth).send({ expiresInDays: 7 }).expect(201);
    await request(server).patch(`/boards/${board.id}/links/${forever.id}`).set(grace.auth).send({ expiresAt: null }).expect(403);
    await request(server).patch(`/boards/${board.id}/links/${forever.id}`).set(grace.auth).send({ expiresAt: Date.now() + DAY }).expect(200);
    expect((await request(server).get(`/boards/${board.id}/policy`).set(grace.auth)).body.linkMaxDays).toBe(7);
  });

  it('decides who may export, sending tasks to trackers included', async () => {
    const { server, ada, grace, linus, reader, board } = await team();
    expect((await request(server).get(`/boards/${board.id}/policy`).set(reader.auth)).body.exports.allowed).toBe(true);
    await setPolicies(ada, { exports: 'board_owners' });
    const refused = await request(server).post(`/boards/${board.id}/tasks/export`).set(linus.auth).send({ integrationId: randomUUID() }).expect(403);
    expect(refused.body).toMatchObject({ policy: 'exports', message: "This workspace's policy lets only board owners export boards." });
    expect((await request(server).get(`/boards/${board.id}/policy`).set(linus.auth)).body.exports).toEqual({ allowed: false, reason: refused.body.message });
    // A board owner gets past the policy (to a tracker that isn't there).
    await request(server).post(`/boards/${board.id}/tasks/export`).set(grace.auth).send({ integrationId: randomUUID() }).expect(404);
  });

  it('decides who may open a board for outside feedback', async () => {
    const { server, ada, grace, linus, board } = await team();
    await setPolicies(ada, { feedback: 'workspace_owners' });
    const refused = await request(server).post(`/boards/${board.id}/feedback`).set(grace.auth).send({ visibility: 'anonymous' }).expect(403);
    expect(refused.body.policy).toBe('feedback');
    await request(server).post(`/boards/${board.id}/feedback`).set(ada.auth).send({ visibility: 'anonymous' }).expect(201);
    // The board's owner can still close it.
    await request(server).delete(`/boards/${board.id}/feedback`).set(grace.auth).expect(204);

    await setPolicies(ada, { feedback: 'editors' });
    await request(server).post(`/boards/${board.id}/feedback`).set(linus.auth).send({ visibility: 'names' }).expect(201);
  });

  it('prunes history, versions and the undo list past the retention period, never the board itself', async () => {
    const { server, ada, grace, board } = await team();
    const db = t.app.get<Db>(DB);
    const old = new Date(Date.now() - 40 * DAY);
    const doc = new Y.Doc();
    await connect(board.id, grace.token, doc);
    addNotes(doc, [{ text: 'Still here', color: 'yellow' }]);
    await request(server).post(`/boards/${board.id}/versions`).set(grace.auth).send({ label: 'Recent' }).expect(201);
    await db.insert(boardEvents).values({ boardId: board.id, actorName: 'Someone', action: 'did something long ago', createdAt: old });
    await db.insert(boardVersions).values({ boardId: board.id, state: Buffer.from(Y.encodeStateAsUpdate(doc)), label: 'Old', createdAt: old });
    const entry = (id: string, at: number): LedgerEntry => ({ id, at, model: 'Claude', forName: 'Grace', action: 'Changed', created: [], createdNodes: [], removed: [], changed: [], undone: false });
    const connection = await t.app.get(CollabService).hocuspocus.openDirectConnection(board.id, { user: SERVER });
    await connection.transact((d) => d.getArray<LedgerEntry>('ledger').push([entry('old', old.getTime()), entry('new', Date.now())]));
    await connection.disconnect();

    await setPolicies(ada, { retentionDays: 30 });
    const events = await db.select().from(boardEvents).where(eq(boardEvents.boardId, board.id));
    expect(events.map((e) => e.action)).not.toContain('did something long ago');
    expect(events.length).toBeGreaterThan(0);
    const versions = (await request(server).get(`/boards/${board.id}/versions`).set(grace.auth)).body as { label: string }[];
    expect(versions.map((v) => v.label)).toContain('Recent');
    expect(versions.map((v) => v.label)).not.toContain('Old');
    for (let i = 0; i < 60 && ledgerEntries(doc).length !== 1; i++) await new Promise((r) => setTimeout(r, 50));
    expect(ledgerEntries(doc).map((e) => e.id)).toEqual(['new']);
    expect(notesOf(doc).map((n) => n.text)).toEqual(['Still here']);
    await new Promise((r) => setTimeout(r, 2500));
    const [stored] = await db.select().from(boardDocuments).where(eq(boardDocuments.boardId, board.id));
    const saved = new Y.Doc();
    Y.applyUpdate(saved, new Uint8Array(stored.state));
    expect(notesOf(saved).map((n) => n.text)).toEqual(['Still here']);
  });
});
