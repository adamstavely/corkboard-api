import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import { ModelError, type ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;

describe('Board summary', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ models: () => ({ chat: async (req) => ({ text: await script(req), toolCalls: 0 }) }) });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it("saves a model's summary in the board for everyone, citing only the board's notes", async () => {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    const token = await t.token(subject, { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [slow] = addNotes(doc, [{ text: 'Deploys are slow', color: 'yellow' }]);
    await new Promise((r) => setTimeout(r, 300));

    script = async (req) => {
      expect(req.prompt).toContain('Deploys are slow');
      await req.execute('write_summary', {
        tldr: 'Deploys are the problem.',
        summary: 'The team found deploys slow.',
        points: [{ text: 'Speed up deploys', note_ids: [slow, 'invented'] }],
        questions: ['What makes them slow?'],
      });
      return 'Done.';
    };
    const res = await request(server).post(`/boards/${board.id}/summary`).set(auth).send({ modelId: m.id, length: 'detailed' }).expect(200);
    expect(res.body).toMatchObject({ tldr: 'Deploys are the problem.', length: 'detailed', model: 'Claude', by: 'Ada', basis: [slow], fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(res.body.points).toEqual([{ id: expect.any(String), text: 'Speed up deploys', sources: [slow] }]);

    // Everyone on the board has it.
    for (let i = 0; i < 40 && doc.getMap('summary').get('tldr') !== 'Deploys are the problem.'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(doc.getMap('summary').get('questions')).toEqual(['What makes them slow?']);

    script = () => Promise.reject(new ModelError('Claude is overloaded.'));
    await request(server).post(`/boards/${board.id}/summary`).set(auth).send({ modelId: m.id }).expect(502);
    provider.destroy();
  });
});
