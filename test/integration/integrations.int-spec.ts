import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { IssueHttp } from '../../src/integrations/issue-http';
import { createTestApp, type TestApp } from './app';

describe('Sending tasks to issue trackers', () => {
  let t: TestApp;
  const sent: { url: string; body: unknown }[] = [];
  let next = 100;
  /** How the fake tracker behaves: answers at once, answers after a pause, or never answers. */
  let behaviour: 'answer' | 'slow' | 'silent' = 'answer';
  const fakeHttp = {
    request: async (url: string, init: { body?: unknown }) => {
      sent.push({ url, body: init.body });
      if (behaviour === 'silent') throw new Error('The tracker took too long to answer');
      if (behaviour === 'slow') await new Promise((r) => setTimeout(r, 300));
      const n = next++;
      return { status: 201, json: { number: n, html_url: `https://github.com/acme/web/issues/${n}` } };
    },
  };

  beforeAll(async () => {
    t = await createTestApp({ providers: [[IssueHttp, fakeHttp]] });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('lets owners connect GitHub, and updaters send open tasks once, each linked to its issue', async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);

    await request(server).post(`/orgs/${orgId}/integrations`).set(auth).send({ kind: 'github', label: 'Web repo', config: { repo: 'nope' }, token: 'ghp_x' }).expect(400);
    await request(server).post(`/orgs/${orgId}/integrations`).set(readerAuth).send({ kind: 'github', label: 'Web repo', config: { repo: 'acme/web' }, token: 'ghp_x' }).expect(403);
    const { body: gh } = await request(server).post(`/orgs/${orgId}/integrations`).set(auth).send({ kind: 'github', label: 'Web repo', config: { repo: 'acme/web' }, token: 'ghp_secret' }).expect(201);
    expect(gh).toEqual({ id: expect.any(String), kind: 'github', label: 'Web repo', config: { repo: 'acme/web' }, target: 'acme/web' });
    const { body: listed } = await request(server).get(`/orgs/${orgId}/integrations`).set(readerAuth).expect(200);
    expect(JSON.stringify(listed)).not.toContain('ghp_secret');

    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' });
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const tasks = doc.getMap('tasks');
    tasks.set('a', { id: 'a', key: 'T-1', title: 'Second environment', status: 'todo', priority: 0, labels: ['action'], due: '2026-11-20', created: new Date().toISOString() });
    tasks.set('b', { id: 'b', key: 'T-2', title: 'Done already', status: 'done', priority: 0, labels: [], created: new Date().toISOString() });
    tasks.set('c', { id: 'c', key: 'T-3', title: 'Runbook', status: 'doing', priority: 0, labels: [], created: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 300));

    await request(server).post(`/boards/${board.id}/tasks/export`).set(readerAuth).send({ integrationId: gh.id }).expect(403);
    const { body: first } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200);
    expect(first).toEqual({
      exported: [
        { taskId: 'a', taskKey: 'T-1', issueKey: '#100', url: 'https://github.com/acme/web/issues/100' },
        { taskId: 'c', taskKey: 'T-3', issueKey: '#101', url: 'https://github.com/acme/web/issues/101' },
      ],
      failed: [],
      skipped: 0,
    });
    expect(sent[0]).toMatchObject({ url: 'https://api.github.com/repos/acme/web/issues', body: { title: 'Second environment' } });
    expect((sent[0].body as { body: string }).body).toContain('task T-1');
    for (let i = 0; i < 60 && !(tasks.get('a') as { external?: unknown }).external; i++) await new Promise((r) => setTimeout(r, 50));
    expect((tasks.get('a') as { external?: unknown }).external).toEqual({ kind: 'github', key: '#100', url: 'https://github.com/acme/web/issues/100' });

    // Sending again sends nothing new.
    const { body: again } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200);
    expect(again).toEqual({ exported: [], failed: [], skipped: 2 });

    await request(server).delete(`/orgs/${orgId}/integrations/${gh.id}`).set(auth).expect(204);
    await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(404);
    provider.destroy();
  });

  it('makes one issue per task however many exports run at once, and holds a send that got no answer', async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id as string;
    const { body: gh } = await request(server).post(`/orgs/${orgId}/integrations`).set(auth).send({ kind: 'github', label: 'Web repo', config: { repo: 'acme/web' }, token: 'ghp_x' }).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Plan' });
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    doc.getMap('tasks').set('x', { id: 'x', key: 'T-1', title: 'Only once', status: 'todo', priority: 0, labels: [], created: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 300));

    behaviour = 'slow';
    const before = sent.length;
    const both = await Promise.all([1, 2].map(() => request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200)));
    expect(sent.length - before).toBe(1);
    expect(both.flatMap((r) => r.body.exported)).toHaveLength(1);
    expect(both.flatMap((r) => r.body.failed.map((f: { reason: string }) => f.reason))).toEqual(['This task is being sent right now.']);

    // A send that gets no answer may have made an issue: it's held, then retried only when asked for by name.
    doc.getMap('tasks').set('y', { id: 'y', key: 'T-2', title: 'Unclear', status: 'todo', priority: 0, labels: [], created: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 300));
    behaviour = 'silent';
    const { body: lost } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200);
    expect(lost.failed[0].reason).toContain('It may have been created');
    behaviour = 'answer';
    const { body: held } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200);
    expect(held.exported).toEqual([]);
    expect(held.failed[0].reason).toContain('Check the tracker');
    const { body: retried } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id, taskIds: ['y'] }).expect(200);
    expect(retried.exported.map((e: { taskKey: string }) => e.taskKey)).toEqual(['T-2']);
    provider.destroy();
  });
});

