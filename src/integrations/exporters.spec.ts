import { checkConfig, createIssue } from './exporters';

describe('issue tracker exporters', () => {
  const capture = (status: number, json: unknown) => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: unknown } }[] = [];
    const send = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
      calls.push({ url, init });
      return Promise.resolve({ status, json });
    };
    return { calls, send };
  };
  const issue = { title: 'Set up the second environment', body: 'From the board.\n\nOwner: Grace' };

  it('opens a GitHub issue', async () => {
    const { calls, send } = capture(201, { number: 42, html_url: 'https://github.com/acme/web/issues/42' });
    expect(await createIssue(send, 'github', { repo: 'acme/web' }, 'ghp_x', issue)).toEqual({ key: '#42', url: 'https://github.com/acme/web/issues/42' });
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/web/issues');
    expect(calls[0].init.headers['Authorization']).toBe('Bearer ghp_x');
  });

  it('creates a Linear issue through GraphQL', async () => {
    const { calls, send } = capture(200, { data: { issueCreate: { success: true, issue: { identifier: 'ENG-7', url: 'https://linear.app/acme/issue/ENG-7' } } } });
    expect(await createIssue(send, 'linear', { teamId: 't1' }, 'lin_x', issue)).toEqual({ key: 'ENG-7', url: 'https://linear.app/acme/issue/ENG-7' });
    expect((calls[0].init.body as { variables: { input: { teamId: string } } }).variables.input.teamId).toBe('t1');
  });

  it('creates a Jira task with basic auth and a document description', async () => {
    const { calls, send } = capture(201, { key: 'ENG-12' });
    const made = await createIssue(send, 'jira', { baseUrl: 'https://acme.atlassian.net/', projectKey: 'ENG', email: 'a@acme.com' }, 'tok', issue);
    expect(made).toEqual({ key: 'ENG-12', url: 'https://acme.atlassian.net/browse/ENG-12' });
    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/issue');
    expect(calls[0].init.headers['Authorization']).toBe(`Basic ${Buffer.from('a@acme.com:tok').toString('base64')}`);
    expect((calls[0].init.body as { fields: { description: { content: unknown[] } } }).fields.description.content).toHaveLength(2);
  });

  it('says why a tracker refused, in words', async () => {
    await expect(createIssue(capture(401, { message: 'Bad credentials' }).send, 'github', { repo: 'a/b' }, 'x', issue)).rejects.toThrow('GitHub: the token was refused (Bad credentials)');
    await expect(createIssue(capture(404, {}).send, 'jira', { baseUrl: 'https://a.atlassian.net', projectKey: 'X', email: 'a@b.c' }, 'x', issue)).rejects.toThrow('Jira: it was not found');
  });

  it('checks settings before saving them', () => {
    expect(checkConfig('github', { repo: 'acme/web' })).toBeNull();
    expect(checkConfig('github', { repo: 'acme' })).toMatch(/owner\/name/);
    expect(checkConfig('jira', { baseUrl: 'http://jira.local', projectKey: 'ENG', email: 'a@b.c' })).toMatch(/site address/);
    expect(checkConfig('jira', { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', email: 'a@b.c' })).toBeNull();
  });
});
