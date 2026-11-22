import type { IntegrationConfig, IntegrationKind } from './exporters';
import type { HttpReply } from './issue-http';

export type TaskState = 'todo' | 'doing' | 'done';

type Send = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<HttpReply>;

/** What each tracker is called in the board's history: "Status changed to Done in Jira". */
export const TRACKER_NAMES: Record<IntegrationKind, string> = { github: 'GitHub', linear: 'Linear', jira: 'Jira' };

/** The GitHub label that means "in progress" on an open issue, unless the connection names another. */
export const DEFAULT_DOING_LABEL = 'in progress';

export const STATE_WORDS: Record<TaskState, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };

/** The fields kept in step between a task and its issue. */
export const SYNCED_FIELDS = ['title', 'status', 'assignee'] as const;
export type SyncedField = (typeof SYNCED_FIELDS)[number];

/**
 * A task's or an issue's synced fields. On the board's side `assignee` is a person's user id; on the tracker's, who the
 * issue is assigned to as `assigneeKey` names them (their email, or their name when the tracker keeps it to itself).
 */
export interface Fields {
  title: string;
  status: TaskState;
  assignee: string | null;
}

/** Where a task and its issue last agreed: each side as it was then, in its own terms. */
export interface SyncedState {
  board: Fields;
  remote: Fields;
}

/** An issue as its tracker has it now. */
export interface RemoteIssue {
  key: string;
  title: string;
  status: TaskState;
  /** Who it's assigned to: their email when the tracker shares it, and the name it shows. */
  assignee: { email?: string; name: string } | null;
  /** When it last changed in the tracker (epoch ms). */
  updatedAt: number;
  /** GitHub: its labels, to put on or take off the "in progress" one. */
  labels?: string[];
  /** Linear: its id, for writing to it. */
  id?: string;
}

/** A tracker that answered with an error, or didn't answer. `retryAfterMs` when it asked to be left alone a while. */
export class TrackerError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Who an issue's assignee is, as the tracker's side of the comparison has it. */
export const assigneeKey = (a: RemoteIssue['assignee']): string | null => (a ? (a.email ? a.email.toLowerCase() : `name:${a.name}`) : null);

/** An issue's fields in the tracker's terms. */
export const remoteFields = (issue: RemoteIssue): Fields => ({ title: issue.title, status: issue.status, assignee: assigneeKey(issue.assignee) });

/** What a just-made issue looks like: the task's title, open, and assigned to no one (sending doesn't assign). */
export const freshlySent = (title: string): SyncedState => ({
  board: { title, status: 'todo', assignee: null },
  remote: { title, status: 'todo', assignee: null },
});

// ── Statuses ──

/** GitHub: closed is done; open with the "in progress" label is doing; any other open issue is to do. */
export function githubStatus(state: string, labels: readonly string[], doingLabel = DEFAULT_DOING_LABEL): TaskState {
  if (state.toLowerCase() === 'closed') return 'done';
  return labels.some((l) => l.toLowerCase() === doingLabel.toLowerCase()) ? 'doing' : 'todo';
}

/** Linear, by the type of the issue's workflow state: started is doing; completed and canceled are done. */
export function linearStatus(type: string): TaskState {
  if (type === 'started') return 'doing';
  if (type === 'completed' || type === 'canceled') return 'done';
  return 'todo';
}

/** Jira, by the status's category: new is to do, indeterminate is in progress, done is done. */
export function jiraStatus(categoryKey: string): TaskState {
  if (categoryKey === 'done') return 'done';
  if (categoryKey === 'indeterminate') return 'doing';
  return 'todo';
}

// ── Last change wins ──

export interface MergeInput {
  /** The task now, and when its synced fields last changed on the board (epoch ms). */
  board: Fields;
  boardAt: number;
  /** The issue now in the tracker's terms, and in the board's (its assignee as a member's id, or null). */
  remote: Fields;
  remoteAsBoard: Fields;
  remoteAt: number;
  /** Where they last agreed; null when they never have (a task sent before sync existed). */
  synced: SyncedState | null;
}

/** What to change on each side, in the board's terms. */
export interface MergeResult {
  toBoard: Partial<Fields>;
  toTracker: Partial<Fields>;
}

/**
 * Field by field: what only one side changed since they last agreed goes to the other; what both changed (to
 * different things) is settled by whichever changed last. With nothing to go on (never synced), every difference is
 * settled that way.
 */
export function merge(i: MergeInput): MergeResult {
  const toBoard: Partial<Fields> = {};
  const toTracker: Partial<Fields> = {};
  for (const f of SYNCED_FIELDS) {
    if (i.board[f] === i.remoteAsBoard[f]) continue;
    const boardChanged = !i.synced || i.board[f] !== i.synced.board[f];
    const remoteChanged = !i.synced || i.remote[f] !== i.synced.remote[f];
    if (!boardChanged && !remoteChanged) continue;
    const trackerWins = boardChanged && remoteChanged ? i.remoteAt > i.boardAt : remoteChanged;
    if (trackerWins) (toBoard as Record<string, unknown>)[f] = i.remoteAsBoard[f];
    else (toTracker as Record<string, unknown>)[f] = i.board[f];
  }
  return { toBoard, toTracker };
}

// ── Talking to the trackers ──

/** How many issues one request asks about. */
export const BATCH = 50;

const header = (reply: HttpReply, name: string): string | undefined => {
  const v = reply.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
};

/** How long a tracker asked to be left alone, from Retry-After or a rate limit's reset time. */
export function retryAfter(reply: HttpReply, now = Date.now()): number | undefined {
  const after = Number(header(reply, 'retry-after'));
  if (Number.isFinite(after) && after > 0) return after * 1000;
  // GitHub: x-ratelimit-reset is epoch seconds, with x-ratelimit-remaining 0.
  const reset = Number(header(reply, 'x-ratelimit-reset'));
  if (header(reply, 'x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset * 1000 > now) return reset * 1000 - now;
  return undefined;
}

function failed(who: string, reply: HttpReply): TrackerError {
  const j = reply.json as { message?: unknown; errors?: { message?: unknown }[]; errorMessages?: unknown[] } | null;
  const said = typeof j?.message === 'string' ? j.message : typeof j?.errors?.[0]?.message === 'string' ? j.errors[0].message : Array.isArray(j?.errorMessages) ? String(j.errorMessages[0]) : '';
  const limited = reply.status === 429 || (reply.status === 403 && (header(reply, 'x-ratelimit-remaining') === '0' || /rate limit/i.test(said)));
  const why = limited
    ? 'it asked us to slow down'
    : reply.status === 401 || reply.status === 403
      ? 'the token was refused'
      : reply.status === 404
        ? 'it was not found (check the repository, team or project)'
        : `it answered ${reply.status}`;
  return new TrackerError(`${who}: ${why}${said ? ` (${said})` : ''}`, limited ? (retryAfter(reply) ?? 60_000) : undefined);
}

const githubHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' });
const jiraHeaders = (config: IntegrationConfig, token: string) => ({ Authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString('base64')}` });
const jiraBase = (config: IntegrationConfig) => config.baseUrl!.replace(/\/$/, '');

/** Jira's times have an offset without a colon ("+0000"), which not every parser takes. */
const jiraTime = (s: unknown): number => (typeof s === 'string' ? Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN);

const chunks = <T>(all: readonly T[], size = BATCH): T[][] => Array.from({ length: Math.ceil(all.length / size) }, (_, i) => all.slice(i * size, i * size + size));

/**
 * The issues with these keys as their tracker has them now, a few dozen to a request. An issue that's gone (deleted,
 * or moved out of reach) is simply missing from the answer.
 */
export async function fetchIssues(send: Send, kind: IntegrationKind, config: IntegrationConfig, token: string, keys: readonly string[]): Promise<Map<string, RemoteIssue>> {
  const found = new Map<string, RemoteIssue>();
  if (kind === 'github') {
    const [owner, name] = (config.repo ?? '').split('/');
    const numbers = [...new Set(keys.map((k) => Number(/^#(\d+)$/.exec(k)?.[1])).filter((n) => Number.isInteger(n) && n > 0))];
    for (const batch of chunks(numbers)) {
      const fields = batch.map((n) => `i${n}: issue(number: ${n}) { number title state updatedAt labels(first: 50) { nodes { name } } assignees(first: 1) { nodes { login name email } } }`).join(' ');
      const reply = await send('https://api.github.com/graphql', {
        method: 'POST',
        headers: githubHeaders(token),
        body: { query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name } },
      });
      type Issue = { number: number; title: string; state: string; updatedAt: string; labels: { nodes: { name: string }[] }; assignees: { nodes: { login: string; name: string | null; email: string | null }[] } };
      const repo = (reply.json as { data?: { repository?: Record<string, Issue | null> | null } } | null)?.data?.repository;
      if (reply.status !== 200 || !repo) throw failed('GitHub', reply);
      for (const issue of Object.values(repo)) {
        if (!issue) continue;
        const labels = issue.labels.nodes.map((l) => l.name);
        const who = issue.assignees.nodes[0];
        found.set(`#${issue.number}`, {
          key: `#${issue.number}`,
          title: issue.title,
          status: githubStatus(issue.state, labels, config.doingLabel),
          assignee: who ? { ...(who.email ? { email: who.email } : {}), name: who.name || who.login } : null,
          updatedAt: Date.parse(issue.updatedAt),
          labels,
        });
      }
    }
    return found;
  }
  if (kind === 'linear') {
    const wanted = keys.map((k) => /^([A-Za-z0-9]+)-(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => !!m);
    for (const batch of chunks(wanted)) {
      const reply = await send('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { Authorization: token },
        body: {
          query:
            'query Synced($filter: IssueFilter) { issues(first: 100, includeArchived: true, filter: $filter) { nodes { id identifier title updatedAt state { type } assignee { email name displayName } } } }',
          variables: { filter: { or: batch.map(([, team, n]) => ({ team: { key: { eq: team.toUpperCase() } }, number: { eq: Number(n) } })) } },
        },
      });
      type Issue = { id: string; identifier: string; title: string; updatedAt: string; state: { type: string } | null; assignee: { email?: string | null; name?: string | null; displayName?: string | null } | null };
      const nodes = (reply.json as { data?: { issues?: { nodes?: Issue[] } } } | null)?.data?.issues?.nodes;
      if (reply.status !== 200 || !Array.isArray(nodes)) throw failed('Linear', reply);
      for (const issue of nodes) {
        found.set(issue.identifier, {
          key: issue.identifier,
          id: issue.id,
          title: issue.title,
          status: linearStatus(issue.state?.type ?? ''),
          assignee: issue.assignee ? { ...(issue.assignee.email ? { email: issue.assignee.email } : {}), name: issue.assignee.displayName || issue.assignee.name || issue.assignee.email || 'Someone' } : null,
          updatedAt: Date.parse(issue.updatedAt),
        });
      }
    }
    return found;
  }
  // Jira's bulk fetch reports missing issues apart (issueErrors), rather than failing the lot as a JQL search would.
  for (const batch of chunks(keys.filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)))) {
    const reply = await send(`${jiraBase(config)}/rest/api/3/issue/bulkfetch`, {
      method: 'POST',
      headers: jiraHeaders(config, token),
      body: { issueIdsOrKeys: batch, fields: ['summary', 'status', 'assignee', 'updated'] },
    });
    type Issue = { key: string; fields: { summary?: string; updated?: string; status?: { statusCategory?: { key?: string } }; assignee?: { displayName?: string; emailAddress?: string } | null } };
    const issues = (reply.json as { issues?: Issue[] } | null)?.issues;
    if (reply.status !== 200 || !Array.isArray(issues)) throw failed('Jira', reply);
    for (const issue of issues) {
      const a = issue.fields.assignee;
      found.set(issue.key, {
        key: issue.key,
        title: issue.fields.summary ?? '',
        status: jiraStatus(issue.fields.status?.statusCategory?.key ?? ''),
        assignee: a ? { ...(a.emailAddress ? { email: a.emailAddress } : {}), name: a.displayName || a.emailAddress || 'Someone' } : null,
        updatedAt: jiraTime(issue.fields.updated),
      });
    }
  }
  return found;
}

/** A change for an issue, in the board's terms; the assignee as their email (null to unassign). */
export interface IssueChange {
  title?: string;
  status?: TaskState;
  assignee?: { email: string | null };
}

/** Fields a change couldn't make, each with why. */
export type Unsent = Partial<Record<SyncedField, string>>;

/**
 * Writes a task's changes to its issue. Returns what it couldn't (no one in the tracker with that email, no way to move
 * the issue to that status), in words, which isn't an error: the rest went.
 */
export async function updateIssue(send: Send, kind: IntegrationKind, config: IntegrationConfig, token: string, issue: RemoteIssue, change: IssueChange): Promise<Unsent> {
  const notes: Unsent = {};
  if (kind === 'github') {
    const body: Record<string, unknown> = {};
    if (change.title !== undefined) body['title'] = change.title;
    if (change.status !== undefined) {
      const doing = config.doingLabel || DEFAULT_DOING_LABEL;
      const labels = issue.labels ?? [];
      const without = labels.filter((l) => l.toLowerCase() !== doing.toLowerCase());
      body['state'] = change.status === 'done' ? 'closed' : 'open';
      if (change.status === 'doing' && without.length === labels.length) body['labels'] = [...labels, doing];
      if (change.status === 'todo' && without.length !== labels.length) body['labels'] = without;
    }
    // GitHub doesn't say who has an email address, so assignees only come in from GitHub, never go out to it.
    if (change.assignee) notes.assignee = 'GitHub issues are assigned in GitHub';
    if (!Object.keys(body).length) return notes;
    const n = issue.key.slice(1);
    const reply = await send(`https://api.github.com/repos/${config.repo}/issues/${n}`, { method: 'PATCH', headers: githubHeaders(token), body });
    if (reply.status !== 200) throw failed('GitHub', reply);
    return notes;
  }
  if (kind === 'linear') {
    const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
      const reply = await send('https://api.linear.app/graphql', { method: 'POST', headers: { Authorization: token }, body: { query, variables } });
      const j = reply.json as { data?: T; errors?: unknown[] } | null;
      if (reply.status !== 200 || !j?.data || j.errors?.length) throw failed('Linear', reply);
      return j.data;
    };
    const input: Record<string, unknown> = {};
    if (change.title !== undefined) input['title'] = change.title;
    if (change.status !== undefined) {
      const { issue: found } = await gql<{ issue: { team: { states: { nodes: { id: string; type: string; position: number }[] } } } }>(
        'query States($id: String!) { issue(id: $id) { team { states { nodes { id type position } } } } }',
        { id: issue.id ?? issue.key },
      );
      const types = change.status === 'doing' ? ['started'] : change.status === 'done' ? ['completed'] : ['unstarted', 'backlog'];
      const state = types.flatMap((t) => found.team.states.nodes.filter((s) => s.type === t).sort((a, b) => a.position - b.position))[0];
      if (state) input['stateId'] = state.id;
      else notes.status = `Linear has no ${STATE_WORDS[change.status]} state for this team`;
    }
    if (change.assignee) {
      if (change.assignee.email === null) input['assigneeId'] = null;
      else {
        const { users } = await gql<{ users: { nodes: { id: string }[] } }>('query Who($email: String!) { users(filter: { email: { eqIgnoreCase: $email } }) { nodes { id } } }', { email: change.assignee.email });
        if (users.nodes[0]) input['assigneeId'] = users.nodes[0].id;
        else notes.assignee = `no one in Linear has the email ${change.assignee.email}`;
      }
    }
    if (!Object.keys(input).length) return notes;
    const done = await gql<{ issueUpdate: { success: boolean } }>('mutation Update($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id: issue.id ?? issue.key, input });
    if (!done.issueUpdate.success) throw new TrackerError('Linear: the issue was not updated');
    return notes;
  }
  const base = jiraBase(config);
  const headers = jiraHeaders(config, token);
  const at = `${base}/rest/api/3/issue/${encodeURIComponent(issue.key)}`;
  const fields: Record<string, unknown> = {};
  if (change.title !== undefined) fields['summary'] = change.title;
  if (change.assignee) {
    if (change.assignee.email === null) fields['assignee'] = null;
    else {
      const reply = await send(`${base}/rest/api/3/user/search?query=${encodeURIComponent(change.assignee.email)}`, { method: 'GET', headers });
      if (reply.status !== 200 || !Array.isArray(reply.json)) throw failed('Jira', reply);
      const who = (reply.json as { accountId?: string }[]).find((u) => u.accountId);
      if (who) fields['assignee'] = { accountId: who.accountId };
      else notes.assignee = `no one in Jira has the email ${change.assignee.email}`;
    }
  }
  if (Object.keys(fields).length) {
    const reply = await send(at, { method: 'PUT', headers, body: { fields } });
    if (reply.status !== 204 && reply.status !== 200) throw failed('Jira', reply);
  }
  if (change.status !== undefined) {
    const reply = await send(`${at}/transitions`, { method: 'GET', headers });
    const transitions = (reply.json as { transitions?: { id: string; to?: { statusCategory?: { key?: string } } }[] } | null)?.transitions;
    if (reply.status !== 200 || !Array.isArray(transitions)) throw failed('Jira', reply);
    const to = transitions.find((t) => jiraStatus(t.to?.statusCategory?.key ?? '') === change.status);
    if (!to) notes.status = `Jira has no way to move ${issue.key} to ${STATE_WORDS[change.status]} from where it is`;
    else {
      const moved = await send(`${at}/transitions`, { method: 'POST', headers, body: { transition: { id: to.id } } });
      if (moved.status !== 204 && moved.status !== 200) throw failed('Jira', moved);
    }
  }
  return notes;
}
