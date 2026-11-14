import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import { chatOf } from '../../src/chat/chat-doc';
import type { ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;

describe('Session recap', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ models: () => ({ chat: async (req) => ({ text: await script(req), toolCalls: 0 }) }) });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('posts the decisions, owners and open questions to the chat, citing only real notes', async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Sprint 12 retro' });

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [blueGreen, grace] = addNotes(doc, [
      { text: 'Decision: blue-green deploys', color: 'yellow' },
      { text: 'Grace sets up the second environment by Friday', color: 'green' },
    ]);
    await new Promise((r) => setTimeout(r, 300));

    script = async (req) => {
      expect(req.prompt).toContain('Sprint 12 retro');
      await req.execute('write_recap', {
        title: 'Sprint 12 retro',
        decisions: [{ text: 'Move to blue-green deploys', note_ids: [blueGreen, 'invented'] }],
        actions: [{ text: 'Set up the second environment', owner: 'Grace', due: 'Friday', note_ids: [grace] }, { text: '  ', note_ids: [] }],
        questions: ['Who pays for the second environment?'],
      });
      return 'Done.';
    };
    const { body: recap } = await request(server).post(`/boards/${board.id}/recap`).set(auth).send({ modelId: m.id }).expect(200);
    expect(recap).toMatchObject({
      title: 'Sprint 12 retro',
      decisions: [{ text: 'Move to blue-green deploys', sources: [blueGreen] }],
      actions: [{ text: 'Set up the second environment', owner: 'Grace', due: 'Friday', sources: [grace] }],
      questions: ['Who pays for the second environment?'],
      model: 'Claude',
      by: 'Ada',
    });

    for (let i = 0; i < 60 && !chatOf(doc).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [posted] = chatOf(doc);
    expect(posted).toMatchObject({ authorId: 'model', name: 'Claude', text: 'Recap: Sprint 12 retro (1 decision, 1 action, 1 open question)' });
    expect(posted.recap?.actions[0].owner).toBe('Grace');

    // A model that only talks, without writing the recap, is a failure, and nothing is posted.
    script = () => Promise.resolve('Here is a recap in words.');
    await request(server).post(`/boards/${board.id}/recap`).set(auth).send({ modelId: m.id }).expect(502);
    expect(chatOf(doc)).toHaveLength(1);
    provider.destroy();
  });
});
