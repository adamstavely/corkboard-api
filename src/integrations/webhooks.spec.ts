import { createHmac } from 'node:crypto';
import { issueKeysIn, webhookProblem } from './webhooks';

describe('tracker webhooks', () => {
  const secret = 'shh';
  const sign = (raw: string) => createHmac('sha256', secret).update(raw).digest('hex');

  it('believes GitHub and Jira only with the right sha256 signature', () => {
    const raw = '{"action":"closed"}';
    expect(webhookProblem('github', secret, { 'x-hub-signature-256': `sha256=${sign(raw)}` }, Buffer.from(raw))).toBeNull();
    expect(webhookProblem('github', secret, { 'x-hub-signature-256': `sha256=${sign('{}')}` }, Buffer.from(raw))).toBe('That signature does not match');
    expect(webhookProblem('github', secret, {}, Buffer.from(raw))).toBe('That signature does not match');
    expect(webhookProblem('jira', secret, { 'x-hub-signature': `sha256=${sign(raw)}` }, Buffer.from(raw))).toBeNull();
    expect(webhookProblem('jira', 'other', { 'x-hub-signature': `sha256=${sign(raw)}` }, Buffer.from(raw))).toBe('That signature does not match');
  });

  it('believes Linear with its signature and a fresh timestamp', () => {
    const now = 1_800_000_000_000;
    const fresh = JSON.stringify({ type: 'Issue', webhookTimestamp: now - 5_000 });
    const stale = JSON.stringify({ type: 'Issue', webhookTimestamp: now - 120_000 });
    expect(webhookProblem('linear', secret, { 'linear-signature': sign(fresh) }, Buffer.from(fresh), now)).toBeNull();
    expect(webhookProblem('linear', secret, { 'linear-signature': sign(stale) }, Buffer.from(stale), now)).toBe('That webhook is too old');
    expect(webhookProblem('linear', secret, { 'linear-signature': 'zz' }, Buffer.from(fresh), now)).toBe('That signature does not match');
  });

  it('picks out the issue each kind of webhook is about', () => {
    expect(issueKeysIn('github', { repo: 'acme/web' }, { 'x-github-event': 'issues' }, { issue: { number: 4 }, repository: { full_name: 'Acme/Web' } })).toEqual(['#4']);
    expect(issueKeysIn('github', { repo: 'acme/web' }, { 'x-github-event': 'issues' }, { issue: { number: 4 }, repository: { full_name: 'acme/other' } })).toEqual([]);
    expect(issueKeysIn('github', { repo: 'acme/web' }, { 'x-github-event': 'push' }, {})).toEqual([]);
    expect(issueKeysIn('linear', {}, {}, { type: 'Issue', data: { identifier: 'ENG-7' } })).toEqual(['ENG-7']);
    expect(issueKeysIn('linear', {}, {}, { type: 'Comment', data: {} })).toEqual([]);
    expect(issueKeysIn('jira', {}, {}, { webhookEvent: 'jira:issue_updated', issue: { key: 'ENG-12' } })).toEqual(['ENG-12']);
  });
});
