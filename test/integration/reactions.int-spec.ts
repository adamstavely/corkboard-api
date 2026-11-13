import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

describe('Reactions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('lets commenters react to notes, keeps readers out, and the model sees the counts', async () => {
    const server = t.app.getHttpServer();
    const owner = randomUUID();
    const token = await t.token(owner);
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const join = async (role: string) => {
      const s = randomUUID();
      const a = { Authorization: `Bearer ${await t.token(s)}` };
      const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${s}@corkboard.test`, role });
      await request(server).post(`/me/invites/${invite.id}/accept`).set(a).expect(201);
      return a;
    };
    const commenter = await join('commenter');
    const reader = await join('reader');
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'B' });
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [note] = addNotes(doc, [{ text: 'Ship it', color: 'yellow' }]);
    await new Promise((r) => setTimeout(r, 300));
    const react = (who: typeof auth, body: object) => request(server).post(`/boards/${board.id}/reactions`).set(who).send(body);

    await react(commenter, { nodeId: note, emoji: '🎉', on: true }).expect(204);
    await react(auth, { nodeId: note, emoji: '🎉', on: true }).expect(204);
    await react(reader, { nodeId: note, emoji: '🎉', on: true }).expect(403);
    await react(auth, { nodeId: note, emoji: '💩', on: true }).expect(400);
    await react(auth, { nodeId: 'nope', emoji: '👍', on: true }).expect(400);
    for (let i = 0; i < 40 && !notesOf(doc)[0].reactions; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    expect(notesOf(doc)[0].reactions).toEqual({ '🎉': 2 });
    provider.destroy();
  });
});
