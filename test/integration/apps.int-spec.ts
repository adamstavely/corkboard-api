import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import type { ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;
const PAGE = '<!doctype html><title>Tally</title><script>addEventListener("message", (e) => document.body.textContent = e.data.notes.length)</script>';

describe('Mini-apps', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp({ models: () => ({ chat: async (req) => ({ text: await script(req), toolCalls: 0 }) }) });
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  const settle = () => new Promise((r) => setTimeout(r, 300));
  const appItems = (doc: Y.Doc) => [...doc.getMap<Y.Map<unknown>>('nodes').values()].filter((n) => n.get('kind') === 'app').map((n) => n.toJSON());

  async function setup() {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID());
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });
    const { body: model } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const doc = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: () => resolve() }));
    });
    return { server, auth, readerAuth, orgId, board, model, doc };
  }

  it('lets the model make an app from notes, read it and give it new versions, all kept', async () => {
    const { server, auth, readerAuth, board, model, doc } = await setup();
    const [idea] = addNotes(doc, [{ text: 'Ship faster', color: 'yellow' }]);
    await settle();

    let appId = '';
    script = async (req) => {
      expect(req.system).toContain('corkboard:notes');
      const made = await req.execute('make_app', { title: 'Tally', html: PAGE, note_ids: [idea, 'not-a-note'] });
      appId = /id ([0-9a-f-]{36})/.exec(made)![1];
      const big = await req.execute('make_app', { title: 'Huge', html: 'x'.repeat(200_001), note_ids: null }).catch((err: Error) => err.message);
      expect(big).toContain('the most is 200,000');
      return 'Made a tally.';
    };
    const res = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Count these' }).expect(200);
    expect(res.body.reply).toBe('Made a tally.');
    await settle();
    expect(appItems(doc)).toEqual([expect.objectContaining({ kind: 'app', appId, title: 'Tally', version: 1, sources: [idea] })]);

    // Anyone on the board sees the app and its code.
    const { body: app } = await request(server).get(`/boards/${board.id}/apps/${appId}`).set(readerAuth).expect(200);
    expect(app).toMatchObject({ id: appId, title: 'Tally', latest: 1, versions: [{ version: 1, note: 'Made it', model: 'Claude' }] });
    expect((await request(server).get(`/boards/${board.id}/apps/${appId}/versions/1`).set(readerAuth).expect(200)).body.html).toBe(PAGE);

    script = async (req) => {
      expect(req.prompt).toContain(`"apps":[{"id":"${appId}","title":"Tally","version":1}]`);
      expect(await req.execute('read_app', { app_id: appId })).toContain(PAGE);
      return req.execute('change_app', { app_id: appId, html: PAGE.replace('Tally', 'Tally v2'), note: 'Renamed it' });
    };
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Rename it' }).expect(200);
    await settle();
    expect(appItems(doc)[0]).toMatchObject({ version: 2 });

    // An updater can bring version 1 back, as version 3; a reader can't.
    await request(server).post(`/boards/${board.id}/apps/${appId}/restore`).set(readerAuth).send({ version: 1 }).expect(403);
    const { body: restored } = await request(server).post(`/boards/${board.id}/apps/${appId}/restore`).set(auth).send({ version: 1 }).expect(201);
    expect(restored.versions.map((v: { version: number; note: string }) => [v.version, v.note])).toEqual([
      [3, 'Restored version 1'],
      [2, 'Renamed it'],
      [1, 'Made it'],
    ]);
    await settle();
    expect(appItems(doc)[0]).toMatchObject({ version: 3 });
    expect((await request(server).get(`/boards/${board.id}/apps/${appId}/versions/3`).set(auth).expect(200)).body.html).toBe(PAGE);
  });

  it("keeps each board's apps to itself, and offers no app tools where the workspace switched them off", async () => {
    const { server, auth, orgId, board, model } = await setup();
    let appId = '';
    script = async (req) => {
      appId = /id ([0-9a-f-]{36})/.exec(await req.execute('make_app', { title: 'X', html: PAGE, note_ids: null }))![1];
      return 'ok';
    };
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'App' }).expect(200);
    const { body: other } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Other' });
    await request(server).get(`/boards/${other.id}/apps/${appId}`).set(auth).expect(404);
    await request(server).get(`/boards/${other.id}/apps/${appId}/versions/1`).set(auth).expect(404);
    script = async (req) => {
      expect(await req.execute('change_app', { app_id: appId, html: PAGE, note: 'x' }).catch((err: Error) => err.message)).toContain('no app with that id');
      return 'ok';
    };
    await request(server).post(`/boards/${other.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Change it' }).expect(200);

    await request(server).put(`/orgs/${orgId}/assistant-tools`).set(auth).send({ miniApps: false }).expect(200);
    script = (req) => {
      const names = req.tools.map((tool) => tool.name);
      expect(names).not.toContain('make_app');
      expect(names).not.toContain('change_app');
      expect(names).toContain('read_app');
      return Promise.resolve('ok');
    };
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'App' }).expect(200);
  });
});
