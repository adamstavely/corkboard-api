import { fetchIssues, freshlySent, githubStatus, jiraStatus, linearStatus, merge, retryAfter, TrackerError, updateIssue, type Fields, type MergeInput, type RemoteIssue } from './tracker-sync';
import type { HttpReply } from './issue-http';

type Init = { method: string; headers: Record<string, string>; body?: unknown };

/** A fake tracker: answers each request in turn, and keeps what was asked. */
const tracker = (...replies: HttpReply[]) => {
  const calls: { url: string; init: Init }[] = [];
  const send = (url: string, init: Init) => {
    calls.push({ url, init });
    return Promise.resolve(replies.shift() ?? { status: 500, json: null });
  };
  return { calls, send };
};

describe('tracker statuses', () => {
  it('reads GitHub as open, open with the in-progress label, or closed', () => {
    expect(githubStatus('closed', ['in progress'])).toBe('done');
    expect(githubStatus('OPEN', ['bug', 'In Progress'])).toBe('doing');
    expect(githubStatus('open', ['bug'])).toBe('todo');
    expect(githubStatus('open', ['wip'], 'WIP')).toBe('doing');
  });

  it('reads Linear by its workflow state type', () => {
    expect(['backlog', 'unstarted', 'triage'].map(linearStatus)).toEqual(['todo', 'todo', 'todo']);
    expect(linearStatus('started')).toBe('doing');
    expect(['completed', 'canceled'].map(linearStatus)).toEqual(['done', 'done']);
  });

  it('reads Jira by its status category', () => {
    expect(['new', 'indeterminate', 'done', 'undefined'].map(jiraStatus)).toEqual(['todo', 'doing', 'done', 'todo']);
  });
});

describe('settling changes made on both sides', () => {
  const was: Fields = { title: 'Runbook', status: 'todo', assignee: null };
  const base = (over: Partial<MergeInput>): MergeInput => ({
    board: was,
    boardAt: 1_000,
    remote: was,
    remoteAsBoard: was,
    remoteAt: 1_000,
    synced: { board: was, remote: was },
    ...over,
  });

  it('changes nothing when neither side changed', () => {
    expect(merge(base({}))).toEqual({ toBoard: {}, toTracker: {} });
  });

  it('sends what only the board changed, and brings in what only the tracker changed', () => {
    const r = merge(base({ board: { ...was, status: 'doing' }, remote: { ...was, title: 'Write the runbook' }, remoteAsBoard: { ...was, title: 'Write the runbook' } }));
    expect(r).toEqual({ toBoard: { title: 'Write the runbook' }, toTracker: { status: 'doing' } });
  });

  it('lets the later change win when both changed the same field', () => {
    const both = { board: { ...was, status: 'doing' as const }, remote: { ...was, status: 'done' as const }, remoteAsBoard: { ...was, status: 'done' as const } };
    expect(merge(base({ ...both, boardAt: 2_000, remoteAt: 3_000 }))).toEqual({ toBoard: { status: 'done' }, toTracker: {} });
    expect(merge(base({ ...both, boardAt: 4_000, remoteAt: 3_000 }))).toEqual({ toBoard: {}, toTracker: { status: 'doing' } });
  });

  it('leaves alone what both changed to the same thing', () => {
    const done = { ...was, status: 'done' as const };
    expect(merge(base({ board: done, remote: done, remoteAsBoard: done }))).toEqual({ toBoard: {}, toTracker: {} });
  });

  it('notices a new assignee in the tracker by who they are there, even when they are not on the board', () => {
    // Was Ada (ada@acme.com); now someone the board doesn't know: the task is unassigned.
    const r = merge(
      base({
        board: { ...was, assignee: 'ada-id' },
        synced: { board: { ...was, assignee: 'ada-id' }, remote: { ...was, assignee: 'ada@acme.com' } },
        remote: { ...was, assignee: 'name:Grace' },
        remoteAsBoard: { ...was, assignee: null },
      }),
    );
    expect(r).toEqual({ toBoard: { assignee: null }, toTracker: {} });
  });

  it('settles every difference by time when the two have never agreed', () => {
    const r = merge(base({ synced: null, board: { ...was, status: 'doing' }, boardAt: 5_000, remote: { ...was, title: 'New' }, remoteAsBoard: { ...was, title: 'New' }, remoteAt: 2_000 }));
    expect(r).toEqual({ toBoard: {}, toTracker: { status: 'doing', title: 'Runbook' } });
  });

  it('starts a just-sent task as an open, unassigned issue with its title', () => {
    expect(freshlySent('Runbook')).toEqual({ board: { title: 'Runbook', status: 'todo', assignee: null }, remote: { title: 'Runbook', status: 'todo', assignee: null } });
  });
});

describe('reading issues', () => {
  it('asks GitHub for every linked issue in one GraphQL request', async () => {
    const { calls, send } = tracker({
      status: 200,
      json: {
        data: {
          repository: {
            i4: { number: 4, title: 'Runbook', state: 'OPEN', updatedAt: '2026-11-20T10:00:00Z', labels: { nodes: [{ name: 'in progress' }] }, assignees: { nodes: [{ login: 'ada', name: 'Ada', email: 'ada@acme.com' }] } },
            i5: null,
          },
        },
      },
    });
    const found = await fetchIssues(send, 'github', { repo: 'acme/web' }, 'ghp_x', ['#4', '#5', 'nonsense']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/graphql');
    expect((calls[0].init.body as { query: string }).query).toContain('i4: issue(number: 4)');
    expect([...found.keys()]).toEqual(['#4']);
    expect(found.get('#4')).toMatchObject({ status: 'doing', assignee: { email: 'ada@acme.com', name: 'Ada' }, updatedAt: Date.parse('2026-11-20T10:00:00Z') });
  });

  it('asks Linear by team and number, and Jira through its bulk fetch', async () => {
    const linear = tracker({ status: 200, json: { data: { issues: { nodes: [{ id: 'u1', identifier: 'ENG-7', title: 'A', updatedAt: '2026-11-20T10:00:00Z', state: { type: 'completed' }, assignee: null }] } } } });
    const l = await fetchIssues(linear.send, 'linear', { teamId: 't' }, 'lin', ['ENG-7']);
    expect((linear.calls[0].init.body as { variables: unknown }).variables).toEqual({ filter: { or: [{ team: { key: { eq: 'ENG' } }, number: { eq: 7 } }] } });
    expect(l.get('ENG-7')).toMatchObject({ id: 'u1', status: 'done', assignee: null });

    const jira = tracker({
      status: 200,
      json: { issues: [{ key: 'ENG-12', fields: { summary: 'B', updated: '2026-11-20T10:00:00.000+0000', status: { statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Grace' } } }], issueErrors: [] },
    });
    const j = await fetchIssues(jira.send, 'jira', { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', email: 'a@acme.com' }, 'tok', ['ENG-12']);
    expect(jira.calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue/bulkfetch');
    expect(j.get('ENG-12')).toMatchObject({ status: 'doing', assignee: { name: 'Grace' }, updatedAt: Date.parse('2026-11-20T10:00:00Z') });
  });

  it('says when a tracker asks to slow down, and for how long', async () => {
    const { send } = tracker({ status: 429, json: { message: 'Too many' }, headers: { 'retry-after': '30' } });
    const err = await fetchIssues(send, 'github', { repo: 'a/b' }, 'x', ['#1']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as TrackerError).message).toBe('GitHub: it asked us to slow down (Too many)');
    expect((err as TrackerError).retryAfterMs).toBe(30_000);
    expect(retryAfter({ status: 403, json: null, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '110' } }, 100_000)).toBe(10_000);
  });
});

describe('writing issues', () => {
  const issue = (over: Partial<RemoteIssue> = {}): RemoteIssue => ({ key: '#4', title: 'Runbook', status: 'todo', assignee: null, updatedAt: 0, labels: ['bug'], ...over });

  it('moves a GitHub issue with its state and the in-progress label, and leaves assignees to GitHub', async () => {
    const { calls, send } = tracker({ status: 200, json: {} }, { status: 200, json: {} });
    expect(await updateIssue(send, 'github', { repo: 'acme/web' }, 'x', issue(), { status: 'doing', assignee: { email: 'a@b.c' } })).toEqual({ assignee: 'GitHub issues are assigned in GitHub' });
    expect(calls[0]).toMatchObject({ url: 'https://api.github.com/repos/acme/web/issues/4', init: { method: 'PATCH', body: { state: 'open', labels: ['bug', 'in progress'] } } });
    await updateIssue(send, 'github', { repo: 'acme/web' }, 'x', issue({ labels: ['bug', 'in progress'] }), { status: 'done', title: 'New' });
    expect(calls[1].init.body).toEqual({ title: 'New', state: 'closed' });
  });

  it('finds the Linear state and person to set', async () => {
    const { calls, send } = tracker(
      { status: 200, json: { data: { issue: { team: { states: { nodes: [{ id: 's2', type: 'started', position: 2 }, { id: 's1', type: 'started', position: 1 }] } } } } } },
      { status: 200, json: { data: { users: { nodes: [] } } } },
      { status: 200, json: { data: { issueUpdate: { success: true } } } },
    );
    const unsent = await updateIssue(send, 'linear', { teamId: 't' }, 'lin', issue({ key: 'ENG-7', id: 'u1' }), { status: 'doing', assignee: { email: 'nobody@acme.com' } });
    expect(unsent).toEqual({ assignee: 'no one in Linear has the email nobody@acme.com' });
    expect((calls[2].init.body as { variables: unknown }).variables).toEqual({ id: 'u1', input: { stateId: 's1' } });
  });

  it('moves a Jira issue through a transition to the right category', async () => {
    const { calls, send } = tracker(
      { status: 204, json: null },
      { status: 200, json: { transitions: [{ id: '11', to: { statusCategory: { key: 'new' } } }, { id: '31', to: { statusCategory: { key: 'done' } } }] } },
      { status: 204, json: null },
    );
    const config = { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', email: 'a@acme.com' };
    expect(await updateIssue(send, 'jira', config, 'tok', issue({ key: 'ENG-12' }), { title: 'New', status: 'done', assignee: { email: null } })).toEqual({});
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'PUT https://acme.atlassian.net/rest/api/3/issue/ENG-12',
      'GET https://acme.atlassian.net/rest/api/3/issue/ENG-12/transitions',
      'POST https://acme.atlassian.net/rest/api/3/issue/ENG-12/transitions',
    ]);
    expect(calls[0].init.body).toEqual({ fields: { summary: 'New', assignee: null } });
    expect(calls[2].init.body).toEqual({ transition: { id: '31' } });
  });
});
