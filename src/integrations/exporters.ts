import type { HttpReply } from './issue-http';

export const INTEGRATION_KINDS = ['github', 'linear', 'jira'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Where a kind of tracker puts issues: a GitHub repository, a Linear team, a Jira site and project. */
export interface IntegrationConfig {
  /** GitHub: "owner/name". */
  repo?: string;
  /** Linear: the team's id. */
  teamId?: string;
  /** Jira: the site (https://acme.atlassian.net), the project key, and the account email the token belongs to. */
  baseUrl?: string;
  projectKey?: string;
  email?: string;
}

/** One task, as it goes out. */
export interface OutgoingIssue {
  title: string;
  body: string;
}

/** The issue made, to link the task to. */
export interface MadeIssue {
  key: string;
  url: string;
}

type Send = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<HttpReply>;

const problem = (who: string, reply: HttpReply) => {
  const j = reply.json as { message?: unknown; errors?: { message?: unknown }[]; errorMessages?: unknown[] } | null;
  const said = typeof j?.message === 'string' ? j.message : typeof j?.errors?.[0]?.message === 'string' ? j.errors[0].message : Array.isArray(j?.errorMessages) ? String(j.errorMessages[0]) : '';
  const why = reply.status === 401 || reply.status === 403 ? 'the token was refused' : reply.status === 404 ? 'it was not found (check the repository, team or project)' : `it answered ${reply.status}`;
  return new Error(`${who}: ${why}${said ? ` (${said})` : ''}`);
};

/** Checks a connection's settings before it's saved; says what's missing. */
export function checkConfig(kind: IntegrationKind, c: IntegrationConfig): string | null {
  if (kind === 'github') return /^[\w.-]+\/[\w.-]+$/.test(c.repo ?? '') ? null : 'GitHub needs a repository as owner/name';
  if (kind === 'linear') return c.teamId?.trim() ? null : 'Linear needs a team id';
  if (!c.baseUrl || !/^https:\/\/[^/]+$/i.test(c.baseUrl.replace(/\/$/, ''))) return 'Jira needs its site address, like https://acme.atlassian.net';
  if (!/^[A-Z][A-Z0-9_]+$/.test(c.projectKey ?? '')) return 'Jira needs a project key, like ENG';
  return c.email?.includes('@') ? null : 'Jira needs the email address the API token belongs to';
}

/** Makes one issue in the tracker. */
export async function createIssue(send: Send, kind: IntegrationKind, config: IntegrationConfig, token: string, issue: OutgoingIssue): Promise<MadeIssue> {
  if (kind === 'github') {
    const reply = await send(`https://api.github.com/repos/${config.repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' },
      body: { title: issue.title, body: issue.body },
    });
    const j = reply.json as { number?: number; html_url?: string } | null;
    if (reply.status !== 201 || !j?.number || !j.html_url) throw problem('GitHub', reply);
    return { key: `#${j.number}`, url: j.html_url };
  }
  if (kind === 'linear') {
    const reply = await send('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token },
      body: {
        query: 'mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
        variables: { input: { teamId: config.teamId, title: issue.title, description: issue.body } },
      },
    });
    const j = reply.json as { data?: { issueCreate?: { success?: boolean; issue?: { identifier?: string; url?: string } } } } | null;
    const made = j?.data?.issueCreate?.issue;
    if (reply.status !== 200 || !j?.data?.issueCreate?.success || !made?.identifier || !made.url) throw problem('Linear', reply);
    return { key: made.identifier, url: made.url };
  }
  const base = config.baseUrl!.replace(/\/$/, '');
  const reply = await send(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString('base64')}` },
    body: {
      fields: {
        project: { key: config.projectKey },
        summary: issue.title,
        issuetype: { name: 'Task' },
        description: { type: 'doc', version: 1, content: issue.body.split('\n\n').map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) },
      },
    },
  });
  const j = reply.json as { key?: string } | null;
  if (reply.status !== 201 || !j?.key) throw problem('Jira', reply);
  return { key: j.key, url: `${base}/browse/${j.key}` };
}
