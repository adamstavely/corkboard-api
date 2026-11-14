import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, framesOf, notesOf } from '../../src/assist/board-edit';
import { ledgerEntries } from '../../src/ledger/ledger-doc';
import { ModelError, type ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;

describe("The model's change history", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ models: () => ({ chat: async (req) => ({ text: await script(req), toolCalls: 0 }) }) });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('records what the model changed, and lets updaters take it back exactly', async () => {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    const token = await t.token(subject, { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [slow, flaky] = addNotes(doc, [
      { text: 'Deploys are slow', color: 'yellow' },
      { text: 'Tests are flaky', color: 'yellow' },
    ]);
    await new Promise((r) => setTimeout(r, 300));

    script = async (req) => {
      await req.execute('group_into_frames', { groups: [{ title: 'Delivery', note_ids: [slow, flaky] }] });
      await req.execute('set_note_color', { note_ids: [slow], color: 'pink' });
      return 'Grouped.';
    };
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: m.id, instruction: 'Group these' }).expect(200);
    const wait = async (check: () => boolean) => {
      for (let i = 0; i < 60 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
    };
    await wait(() => ledgerEntries(doc).length === 1);
    const [entry] = ledgerEntries(doc);
    expect(entry).toMatchObject({ model: 'Claude', forName: 'Ada', undone: false });
    expect(entry.action).toMatch(/^Made 1 frame/);
    expect(framesOf(doc).map((f) => f.title)).toEqual(['Delivery']);

    // Asking a question changes nothing, and records nothing.
    script = () => Promise.resolve('Two notes.');
    await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: m.id, instruction: 'How many?' }).expect(200);

    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(readerAuth).expect(403);
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(auth).expect(204);
    await wait(() => framesOf(doc).length === 0);
    expect(notesOf(doc).map((n) => n.color)).toEqual(['yellow', 'yellow']);
    expect(ledgerEntries(doc)).toHaveLength(1);
    expect(ledgerEntries(doc)[0].undone).toBe(true);
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(auth).expect(409);

    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/redo`).set(auth).expect(204);
    await wait(() => framesOf(doc).length === 1);
    expect(notesOf(doc).map((n) => [n.color, n.frame])).toEqual([
      ['pink', 'Delivery'],
      ['yellow', 'Delivery'],
    ]);
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/redo`).set(auth).expect(409);
    provider.destroy();
  });

  it("keeps a failed run's edits in the history, and stops a run whose asker loses edit access", async () => {
    const server = t.app.getHttpServer();
    const ada = randomUUID();
    const auth = { Authorization: `Bearer ${await t.token(ada, { name: 'Ada' })}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const grace = randomUUID();
    const graceAuth = { Authorization: `Bearer ${await t.token(grace, { name: 'Grace' })}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${grace}@corkboard.test`, role: 'updater' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(graceAuth).expect(201);
    const { body: graceMe } = await request(server).get('/me').set(graceAuth);
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: auth.Authorization.slice(7), document: doc, onSynced: (): void => resolve(p) });
    });

    let refused = '';
    script = async (req) => {
      await req.execute('add_notes', { notes: [{ text: 'First' }] });
      // Ada takes Grace's edit access away while the model is still working.
      await request(server).put(`/boards/${board.id}/members/${graceMe.id}`).set(auth).send({ role: 'reader' }).expect(200);
      await req.execute('add_notes', { notes: [{ text: 'Second' }] }).catch((e: Error) => (refused = e.message));
      throw new ModelError('The model timed out');
    };
    await request(server).post(`/boards/${board.id}/assist`).set(graceAuth).send({ modelId: m.id, instruction: 'Add notes' }).expect(502);
    expect(refused).toMatch(/can no longer change this board/);

    for (let i = 0; i < 60 && ledgerEntries(doc).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(notesOf(doc).map((n) => n.text)).toEqual(['First']);
    const [entry] = ledgerEntries(doc);
    expect(entry).toMatchObject({ forName: 'Grace', action: 'Added 1 note (then stopped with an error)' });
    await request(server).post(`/boards/${board.id}/ledger/${entry.id}/undo`).set(auth).expect(204);
    for (let i = 0; i < 60 && notesOf(doc).length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(notesOf(doc)).toEqual([]);
    provider.destroy();
  });
});
