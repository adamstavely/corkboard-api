import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

describe('Workspace admin', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      models: () => ({
        chat: async (req) => {
          // As the real adapters do, a step at a time.
          req.onUsage?.(1000, 200);
          await req.execute('write_summary', { tldr: 'Deploys are slow.', summary: '', points: [], questions: [] });
          req.onUsage?.(500, 100);
          return { text: 'Done.', toolCalls: 1 };
        },
      }),
    });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('shows owners usage and spend, exports everything without keys, and deletes a workspace once its name is typed', async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);

    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-very-secret' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    addNotes(doc, [{ text: 'Deploys are slow', color: 'yellow' }]);
    await new Promise((r) => setTimeout(r, 300));
    await request(server).post(`/boards/${board.id}/summary`).set(auth).send({ modelId: m.id }).expect(200);

    await request(server).get(`/orgs/${orgId}/admin/usage`).set(readerAuth).expect(403);
    const { body: usage } = await request(server).get(`/orgs/${orgId}/admin/usage`).set(auth).expect(200);
    expect(usage.boards).toEqual([expect.objectContaining({ id: board.id, title: 'Retro', tokens: 1800 })]);
    expect(usage.boards[0].events).toBeGreaterThan(0);
    expect(usage.models).toEqual([{ providerId: m.id, label: 'Claude', calls: 1, inputTokens: 1500, outputTokens: 300, cost: null }]);

    // With prices set, there's a cost.
    await request(server).patch(`/orgs/${orgId}/models/${m.id}`).set(auth).send({ priceInPerMillion: 10, priceOutPerMillion: 50 }).expect(200);
    const { body: priced } = await request(server).get(`/orgs/${orgId}/admin/usage`).set(auth).expect(200);
    expect(priced.models[0].cost).toBe(0.03);
    expect(priced.totals).toMatchObject({ boards: 1, inputTokens: 1500, outputTokens: 300, cost: 0.03 });

    // The export has the board's notes, and never the key.
    const exported = await request(server).get(`/orgs/${orgId}/admin/export`).set(auth).expect(200);
    expect(exported.headers['content-disposition']).toContain('attachment');
    const text = JSON.stringify(exported.body);
    expect(text).toContain('Deploys are slow');
    expect(text).not.toContain('sk-very-secret');
    expect(exported.body.members.map((p: { role: string }) => p.role).sort()).toEqual(['owner', 'reader']);

    // Deleting: not your only workspace, and only with its name typed.
    await request(server).delete(`/orgs/${orgId}/admin`).set(auth).send({ confirm: "Ada's workspace" }).expect(409);
    const other = await t.token(randomUUID(), { name: 'Grace' });
    const otherAuth = { Authorization: `Bearer ${other}` };
    const otherOrg = (await request(server).get('/me').set(otherAuth)).body.orgs[0].id as string;
    const { body: toAda } = await request(server).post(`/orgs/${otherOrg}/invites`).set(otherAuth).send({ email: me.email, role: 'updater' });
    await request(server).post(`/me/invites/${toAda.id}/accept`).set(auth).expect(201);
    await request(server).delete(`/orgs/${orgId}/admin`).set(auth).send({ confirm: 'wrong' }).expect(400);
    await request(server).delete(`/orgs/${orgId}/admin`).set(auth).send({ confirm: "Ada's workspace" }).expect(204);
    await request(server).get(`/boards/${board.id}`).set(auth).expect(404);
    expect((await request(server).get('/me').set(auth)).body.orgs.map((o: { id: string }) => o.id)).toEqual([otherOrg]);
    provider.destroy();
  });
});
