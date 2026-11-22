import { HocuspocusProvider } from '@hocuspocus/provider';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { IssueHttp } from '../../src/integrations/issue-http';
import { TrackerSyncService } from '../../src/integrations/tracker-sync.service';
import { createTestApp, type TestApp } from './app';

/** A GitHub issue in the fake tracker. */
interface FakeIssue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  labels: string[];
  assignee: { login: string; name: string; email: string } | null;
  updatedAt: number;
}

describe('Keeping tasks in step with their issues', () => {
  let t: TestApp;
  const issues = new Map<number, FakeIssue>();
  const calls: { method: string; url: string; body?: unknown }[] = [];
  /** Set to make the fake tracker fail every request. */
  let failing: { status: number; headers?: Record<string, string> } | null = null;
  let next = 1;

  /** A fake GitHub: makes issues, answers the sync's GraphQL reads, and takes its PATCHes. Never the real one. */
  const fakeHttp = {
    request: (url: string, init: { method: string; body?: unknown }) => {
      calls.push({ method: init.method, url, body: init.body });
      if (failing) return Promise.resolve({ status: failing.status, json: { message: 'Down for maintenance' }, headers: failing.headers ?? {} });
      if (init.method === 'POST' && url === 'https://api.github.com/repos/acme/web/issues') {
        const n = next++;
        issues.set(n, { number: n, title: (init.body as { title: string }).title, state: 'OPEN', labels: [], assignee: null, updatedAt: Date.now() });
        return Promise.resolve({ status: 201, json: { number: n, html_url: `https://github.com/acme/web/issues/${n}` } });
      }
      if (init.method === 'POST' && url === 'https://api.github.com/graphql') {
        const query = (init.body as { query: string }).query;
        const repository = Object.fromEntries(
          [...query.matchAll(/i(\d+): issue/g)].map(([, n]) => {
            const i = issues.get(Number(n));
            return [
              `i${n}`,
              i && {
                number: i.number,
                title: i.title,
                state: i.state,
                updatedAt: new Date(i.updatedAt).toISOString(),
                labels: { nodes: i.labels.map((name) => ({ name })) },
                assignees: { nodes: i.assignee ? [i.assignee] : [] },
              },
            ];
          }),
        );
        return Promise.resolve({ status: 200, json: { data: { repository } } });
      }
      const patch = /^https:\/\/api\.github\.com\/repos\/acme\/web\/issues\/(\d+)$/.exec(url);
      if (init.method === 'PATCH' && patch) {
        const i = issues.get(Number(patch[1]))!;
        const b = init.body as { title?: string; state?: string; labels?: string[] };
        if (b.title !== undefined) i.title = b.title;
        if (b.state) i.state = b.state === 'closed' ? 'CLOSED' : 'OPEN';
        if (b.labels) i.labels = b.labels;
        i.updatedAt = Date.now();
        return Promise.resolve({ status: 200, json: {} });
      }
      return Promise.resolve({ status: 404, json: { message: 'Not Found' } });
    },
  };

  beforeAll(async () => {
    t = await createTestApp({ providers: [[IssueHttp, fakeHttp]] });
  });
  afterAll(async () => {
    await t.app.close();
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await wait(50);
  };

  /** A workspace with GitHub connected, a board with Grace on it, and one task sent as an issue. */
  async function setup() {
    const server = t.app.getHttpServer();
    const owner = randomUUID();
    const token = await t.token(owner, { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id as string;
    const grace = randomUUID();
    const graceEmail = `grace-${grace}@acme.test`;
    const graceAuth = { Authorization: `Bearer ${await t.token(grace, { name: 'Grace', email: graceEmail })}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: graceEmail, role: 'updater' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(graceAuth).expect(201);
    const graceId = (await request(server).get('/me').set(graceAuth)).body.id as string;

    const { body: gh } = await request(server).post(`/orgs/${orgId}/integrations`).set(auth).send({ kind: 'github', label: 'Web repo', config: { repo: 'acme/web' }, token: 'ghp_x' }).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Plan' });
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const tasks = doc.getMap<Record<string, unknown>>('tasks');
    tasks.set('a', { id: 'a', key: 'T-1', title: 'Runbook', status: 'todo', priority: 0, labels: [], created: new Date().toISOString() });
    await wait(300);
    const { body: sent } = await request(server).post(`/boards/${board.id}/tasks/export`).set(auth).send({ integrationId: gh.id }).expect(200);
    const n = Number(sent.exported[0].issueKey.slice(1));
    await until(() => !!tasks.get('a')?.['external']);
    const task = () => tasks.get('a')!;
    /** Changes the task on the board, as the UI does: with the time it changed. */
    const edit = (change: Record<string, unknown>, at = Date.now()) => tasks.set('a', { ...task(), ...change, updated: new Date(at).toISOString() });
    const syncNow = () => request(server).post(`/boards/${board.id}/tasks/sync`).set(auth).expect(200);
    const activity = async () => (await request(server).get(`/boards/${board.id}/activity`).set(auth).expect(200)).body as { actor: string; action: string; detail: string }[];
    return { server, auth, orgId, gh, board, provider, task, edit, issue: issues.get(n)!, n, graceId, graceEmail, syncNow, activity };
  }

  it('brings status, title and assignee changed in the tracker onto the board on its schedule', async () => {
    const { board, provider, task, issue, graceId, graceEmail, activity, server, auth } = await setup();
    Object.assign(issue, { state: 'CLOSED', title: 'Write the runbook', assignee: { login: 'grace', name: 'Grace H', email: graceEmail.toUpperCase() }, updatedAt: Date.now() + 120_000 });

    const before = calls.length;
    await t.app.get(TrackerSyncService).pollDue();
    // Every linked issue of the connection in one request.
    expect(calls.slice(before).filter((c) => c.url.endsWith('/graphql'))).toHaveLength(1);
    await until(() => task()['status'] === 'done');
    expect(task()).toMatchObject({ status: 'done', title: 'Write the runbook', assignee: graceId });
    expect(await activity()).toContainEqual(
      expect.objectContaining({ actor: 'Web repo', action: 'updated a task from its issue', detail: 'Title changed to “Write the runbook” in GitHub. Status changed to Done in GitHub. Assigned to Grace H in GitHub' }),
    );
    const { body: status } = await request(server).get(`/boards/${board.id}/tasks/sync`).set(auth).expect(200);
    expect(status.tasks).toEqual([{ taskId: 'a', issueKey: `#${issue.number}`, syncedAt: expect.any(String) }]);
    expect(status.trackers).toEqual([expect.objectContaining({ label: 'Web repo', kind: 'github', syncedAt: expect.any(String), error: null, retryAt: null })]);

    // Claimed for its interval: polling again straight away asks the tracker nothing.
    const after = calls.length;
    await t.app.get(TrackerSyncService).pollDue();
    expect(calls.slice(after).filter((c) => c.url.endsWith('/graphql'))).toHaveLength(0);
    provider.destroy();
  });

  it('shows who has the issue by name when they are not on the board, without assigning anyone', async () => {
    const { provider, task, issue, syncNow } = await setup();
    Object.assign(issue, { assignee: { login: 'stranger', name: 'Sam Stranger', email: 'sam@elsewhere.test' }, updatedAt: Date.now() + 120_000 });
    await syncNow();
    await until(() => !!(task()['external'] as { assignee?: string }).assignee);
    expect(task()['assignee']).toBeUndefined();
    expect(task()['external']).toMatchObject({ assignee: 'Sam Stranger' });
    provider.destroy();
  });

  it('sends changes made on the board to the issue soon after they are made', async () => {
    const { provider, edit, issue, activity } = await setup();
    edit({ status: 'doing', title: 'Runbook v2' });
    // Out a few seconds after the edits settle, without anyone asking.
    for (let i = 0; i < 100 && issue.title !== 'Runbook v2'; i++) await wait(100);
    await t.app.get(TrackerSyncService).settled();
    expect(issue).toMatchObject({ title: 'Runbook v2', state: 'OPEN', labels: ['in progress'] });
    expect((await activity()).map((e) => e.detail)).toContain('Title changed on the board, sent to GitHub. Status changed to In progress on the board, sent to GitHub');

    edit({ status: 'done' });
    for (let i = 0; i < 100 && issue.state !== 'CLOSED'; i++) await wait(100);
    expect(issue.state).toBe('CLOSED');
    provider.destroy();
  });

  it('settles a change made on both sides by whichever was made last', async () => {
    const { provider, task, edit, issue, syncNow, activity } = await setup();
    // The board moved it to In progress; later, someone closed the issue: the tracker's is newer, so it wins.
    edit({ status: 'doing' }, Date.now() - 60_000);
    Object.assign(issue, { state: 'CLOSED', updatedAt: Date.now() });
    await syncNow();
    await until(() => task()['status'] === 'done');
    expect(task()['status']).toBe('done');
    expect(issue.state).toBe('CLOSED');
    expect((await activity()).map((e) => e.detail)).toContain('Status changed to Done in GitHub');

    // Now the tracker renames it, and the board renames it again after: the board's is newer.
    Object.assign(issue, { title: 'Tracker title', updatedAt: Date.now() - 30_000 });
    edit({ title: 'Board title' });
    await syncNow();
    expect(issue.title).toBe('Board title');
    expect(task()['title']).toBe('Board title');
    provider.destroy();
  });

  it('takes webhooks only with the right signature, and syncs the board they name', async () => {
    const { server, auth, orgId, gh, provider, task, issue } = await setup();
    const hook = (body: object, secret: string) => {
      const raw = JSON.stringify(body);
      return request(server)
        .post(`/hooks/trackers/${gh.id}`)
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'issues')
        .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
        .send(raw);
    };
    const payload = { action: 'closed', issue: { number: issue.number }, repository: { full_name: 'acme/web' } };
    // Not set up yet: refused.
    await hook(payload, 'guess').expect(401);
    const { body: setUp } = await request(server).post(`/orgs/${orgId}/integrations/${gh.id}/webhook`).set(auth).expect(200);
    expect(setUp).toEqual({ path: `/hooks/trackers/${gh.id}`, secret: expect.stringMatching(/^[0-9a-f]{48}$/) });
    expect((await request(server).get(`/orgs/${orgId}/integrations`).set(auth)).body[0]).toMatchObject({ webhook: true });

    Object.assign(issue, { state: 'CLOSED', updatedAt: Date.now() + 120_000 });
    const before = calls.length;
    const refused = await hook(payload, 'wrong secret').expect(401);
    expect(refused.body.message).toBe('That signature does not match');
    await t.app.get(TrackerSyncService).settled();
    expect(calls.length).toBe(before);

    await hook(payload, setUp.secret).expect(202);
    await t.app.get(TrackerSyncService).settled();
    await until(() => task()['status'] === 'done');
    expect(task()['status']).toBe('done');
    provider.destroy();
  });

  it('shows a failing tracker, backs off, and recovers on Sync now', async () => {
    const { server, auth, board, provider, task, issue, syncNow } = await setup();
    failing = { status: 429, headers: { 'retry-after': '600' } };
    const { body: down } = await syncNow();
    expect(down.trackers[0]).toMatchObject({ error: 'GitHub: it asked us to slow down (Down for maintenance)', errorAt: expect.any(String) });
    // It asked for ten minutes: the next try is no sooner.
    expect(Date.parse(down.trackers[0].retryAt) - Date.now()).toBeGreaterThan(9 * 60_000);

    failing = null;
    Object.assign(issue, { title: 'Back again', updatedAt: Date.now() + 120_000 });
    const { body: up } = await request(server).post(`/boards/${board.id}/tasks/sync`).set(auth).expect(200);
    expect(up.trackers[0]).toMatchObject({ error: null, retryAt: null });
    await until(() => task()['title'] === 'Back again');
    expect(task()['title']).toBe('Back again');
    provider.destroy();
  });

  it('lets readers see how syncing goes, only updaters sync now, and only owners set up webhooks', async () => {
    const { server, auth, orgId, gh, board, provider } = await setup();
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    await request(server).get(`/boards/${board.id}/tasks/sync`).set(readerAuth).expect(200);
    await request(server).post(`/boards/${board.id}/tasks/sync`).set(readerAuth).expect(403);
    await request(server).post(`/orgs/${orgId}/integrations/${gh.id}/webhook`).set(readerAuth).expect(403);
    provider.destroy();
  });
});
