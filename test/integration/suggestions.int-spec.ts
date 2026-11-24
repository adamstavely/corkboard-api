import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import type { ChatRequest } from '../../src/models/adapters/types';
import type { LedgerEntry } from '../../src/ledger/ledger-doc';
import type { Suggestion } from '../../src/suggestions/suggestions-doc';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;
const seen: ChatRequest[] = [];

describe("The model's suggestions", () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      models: () => ({
        chat: async (req) => {
          seen.push(req);
          return { text: await script(req), toolCalls: 0 };
        },
      }),
    });
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  const settle = () => new Promise((r) => setTimeout(r, 300));

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
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Ideas' });
    const model = await t.model(orgId, auth, { label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const doc = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: () => resolve() }));
    });
    return { server, auth, readerAuth, board, model, doc };
  }

  it('puts the changes of someone who asks first to them as a suggestion, made only when accepted, and undoable after', async () => {
    const { server, auth, readerAuth, board, model, doc } = await setup();
    expect((await request(server).get('/me').set(auth)).body.assistantAsksFirst).toBe(false);
    expect((await request(server).patch('/me').set(auth).send({ assistantAsksFirst: true }).expect(200)).body.assistantAsksFirst).toBe(true);
    await request(server).patch('/me').set(auth).send({ assistantAsksFirst: 'yes' }).expect(400);

    const [slow] = addNotes(doc, [{ text: 'Slow deploys', color: 'yellow' }]);
    await settle();
    script = async (req) => {
      expect(req.system).toContain('put to them as one suggestion');
      await req.execute('add_notes', { notes: [{ text: 'Cache the build', color: 'green' }] });
      await req.execute('set_note_color', { note_ids: [slow], color: 'pink' });
      return 'I suggest a caching note and marking the slow deploys.';
    };
    const res = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'What should we do?' }).expect(200);
    expect(res.body).toMatchObject({ notesAdded: 1, notesChanged: 1, suggestionId: expect.any(String) });
    await settle();

    // Nothing has changed on the board; the suggestion is there for everyone to see.
    expect(notesOf(doc).map((n) => [n.text, n.color])).toEqual([['Slow deploys', 'yellow']]);
    const suggestion = doc.getMap<Suggestion>('suggestions').get(res.body.suggestionId)!;
    expect(suggestion).toMatchObject({ model: 'Claude', forName: expect.any(String), asked: 'What should we do?', action: 'Would add 1 note and change 1 note.', done: 'Added 1 note and changed 1 note' });
    expect(suggestion.added.map((n) => n.text)).toEqual(['Cache the build']);
    expect(suggestion.changed).toEqual([{ id: slow, before: { color: 'yellow' }, after: { color: 'pink' } }]);
    expect(doc.getArray<LedgerEntry>('ledger').length).toBe(0);

    await request(server).post(`/boards/${board.id}/suggestions/${suggestion.id}/accept`).set(readerAuth).expect(403);
    await request(server).post(`/boards/${board.id}/suggestions/${suggestion.id}/accept`).set(auth).expect(204);
    await request(server).post(`/boards/${board.id}/suggestions/${suggestion.id}/accept`).set(auth).expect(409);
    await settle();
    expect(notesOf(doc).map((n) => [n.text, n.color]).sort()).toEqual([
      ['Cache the build', 'green'],
      ['Slow deploys', 'pink'],
    ]);
    expect(doc.getMap('suggestions').size).toBe(0);
    const [entry] = doc.getArray<LedgerEntry>('ledger').toArray();
    expect(entry).toMatchObject({ model: 'Claude', action: 'Added 1 note and changed 1 note', undone: false });

    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(auth).expect(204);
    await settle();
    expect(notesOf(doc).map((n) => [n.text, n.color])).toEqual([['Slow deploys', 'yellow']]);
  });

  it('turns a suggestion down without changing anything, and follows a request that says whether to ask', async () => {
    const { server, auth, board, model, doc } = await setup();
    script = async (req) => {
      await req.execute('add_notes', { notes: [{ text: 'Maybe', color: 'blue' }] });
      return 'Added.';
    };
    const asked = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Add one', propose: true }).expect(200);
    await settle();
    expect(notesOf(doc)).toEqual([]);
    await request(server).post(`/boards/${board.id}/suggestions/${asked.body.suggestionId}/reject`).set(auth).expect(204);
    await request(server).post(`/boards/${board.id}/suggestions/${asked.body.suggestionId}/accept`).set(auth).expect(409);
    await settle();
    expect(notesOf(doc)).toEqual([]);
    expect(doc.getMap('suggestions').size).toBe(0);

    // Not asking first (the default), the model changes the board itself.
    const made = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Add one' }).expect(200);
    expect(made.body.suggestionId).toBeNull();
    await settle();
    expect(notesOf(doc).map((n) => n.text)).toEqual(['Maybe']);
  });

  it("keeps an app version made when asking first out of the app's versions until it's accepted, and drops it if not", async () => {
    const { server, auth, board, model } = await setup();
    const page = (title: string) => `<!doctype html><title>${title}</title><p>${title}</p>`;
    let appId = '';
    script = async (req) => {
      appId = /id ([0-9a-f-]{36})/.exec(await req.execute('make_app', { title: 'Tally', html: page('One'), note_ids: null }))![1];
      return 'Made.';
    };
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Make an app' }).expect(200);
    const versions = async () => ((await request(server).get(`/boards/${board.id}/apps/${appId}`).set(auth).expect(200)).body.versions as { version: number }[]).map((v) => v.version);
    const change = (title: string) => {
      script = async (req) => {
        await req.execute('change_app', { app_id: appId, html: page(title), note: title });
        return 'Changed.';
      };
      return request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Change it', propose: true }).expect(200);
    };

    // Turned down: the suggested version never joins the app, and its code is gone.
    const no = await change('Two');
    expect(await versions()).toEqual([1]);
    const preview = await request(server).get(`/boards/${board.id}/apps/${appId}/versions/2`).set(auth).expect(200);
    expect(preview.body).toMatchObject({ suggested: true, html: page('Two') });
    await request(server).post(`/boards/${board.id}/apps/${appId}/restore`).set(auth).send({ version: 2 }).expect(404);
    await request(server).post(`/boards/${board.id}/suggestions/${no.body.suggestionId}/reject`).set(auth).expect(204);
    expect(await versions()).toEqual([1]);
    await request(server).get(`/boards/${board.id}/apps/${appId}/versions/2`).set(auth).expect(404);

    // Accepted: it becomes the app's next version.
    const yes = await change('Three');
    expect(await versions()).toEqual([1]);
    await request(server).post(`/boards/${board.id}/suggestions/${yes.body.suggestionId}/accept`).set(auth).expect(204);
    expect(await versions()).toEqual([2, 1]);
    expect((await request(server).get(`/boards/${board.id}/apps/${appId}/versions/2`).set(auth).expect(200)).body).toMatchObject({ suggested: false, html: page('Three') });
  });

  it('suggests nothing when the model changes nothing', async () => {
    const { server, auth, board, model, doc } = await setup();
    script = () => Promise.resolve('Looks good as it is.');
    const res = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: model.id, instruction: 'Thoughts?', propose: true }).expect(200);
    expect(res.body.suggestionId).toBeNull();
    await settle();
    expect(doc.getMap('suggestions').size).toBe(0);
  });

  it("holds the model's changes, accepted suggestions and undo to the board's locks", async () => {
    const { server, auth, board, model, doc } = await setup();
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const updater = randomUUID();
    const updaterAuth = { Authorization: `Bearer ${await t.token(updater)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${updater}@corkboard.test`, role: 'updater' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(updaterAuth).expect(201);

    const [fixed, free] = addNotes(doc, [{ text: 'Fixed', color: 'yellow' }, { text: 'Free', color: 'yellow' }]);
    doc.getMap<Y.Map<unknown>>('nodes').get(fixed)!.set('locked', true);
    await settle();

    // The model, asked by an updater, can't recolour the locked note; the error goes back to it.
    let refused = '';
    script = async (req) => {
      await req.execute('set_note_color', { note_ids: [fixed], color: 'pink' }).catch((e: Error) => (refused = e.message));
      return 'Tried.';
    };
    await request(server).post(`/boards/${board.id}/assist`).set(updaterAuth).send({ modelId: model.id, instruction: 'Pink it' }).expect(200);
    expect(refused).toContain('locked');
    await settle();
    expect(notesOf(doc).find((n) => n.id === fixed)!.color).toBe('yellow');

    // A suggestion made while the note was free can't be accepted by an updater once an owner has locked it.
    script = async (req) => {
      await req.execute('set_note_color', { note_ids: [free], color: 'pink' });
      return 'Suggested.';
    };
    const asked = await request(server).post(`/boards/${board.id}/assist`).set(updaterAuth).send({ modelId: model.id, instruction: 'Pink it', propose: true }).expect(200);
    doc.getMap<Y.Map<unknown>>('nodes').get(free)!.set('locked', true);
    await settle();
    const res = await request(server).post(`/boards/${board.id}/suggestions/${asked.body.suggestionId}/accept`).set(updaterAuth).expect(403);
    expect(res.body.message).toContain('locked');
    await settle();
    expect(notesOf(doc).find((n) => n.id === free)!.color).toBe('yellow');
    // Still there for an owner to accept.
    expect(doc.getMap('suggestions').has(asked.body.suggestionId)).toBe(true);
    await request(server).post(`/boards/${board.id}/suggestions/${asked.body.suggestionId}/accept`).set(auth).expect(204);
    await settle();
    expect(notesOf(doc).find((n) => n.id === free)!.color).toBe('pink');

    // Nor can an updater undo it while it's locked.
    const [entry] = doc.getArray<LedgerEntry>('ledger').toArray();
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(updaterAuth).expect(403);
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(auth).expect(204);
    await settle();
    expect(notesOf(doc).find((n) => n.id === free)!.color).toBe('yellow');
  });
});
