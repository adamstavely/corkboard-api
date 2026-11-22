import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IntegrationConfig, IntegrationKind } from './exporters';

type Headers = Record<string, string | string[] | undefined>;

/** How far a Linear webhook's own timestamp may be from now before it's taken as a replay. */
export const LINEAR_MAX_AGE_MS = 60_000;

const one = (h: Headers, name: string): string => {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

const sameHex = (given: string, expected: string): boolean => {
  if (!/^[0-9a-f]+$/i.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
};

/**
 * Why a tracker's webhook isn't to be believed, or null when its signature (an HMAC-SHA256 of the raw body with the
 * connection's secret) checks out: GitHub's X-Hub-Signature-256 and Jira's X-Hub-Signature ("sha256=…"), Linear's
 * Linear-Signature (bare hex, and a timestamp in the body no more than a minute old).
 */
export function webhookProblem(kind: IntegrationKind, secret: string, headers: Headers, raw: Buffer, now = Date.now()): string | null {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  if (kind === 'linear') {
    if (!sameHex(one(headers, 'linear-signature'), expected)) return 'That signature does not match';
    let at = NaN;
    try {
      at = Number((JSON.parse(raw.toString('utf8')) as { webhookTimestamp?: unknown }).webhookTimestamp);
    } catch {
      return 'That is not JSON';
    }
    return Number.isFinite(at) && Math.abs(now - at) <= LINEAR_MAX_AGE_MS ? null : 'That webhook is too old';
  }
  const signed = one(headers, kind === 'github' ? 'x-hub-signature-256' : 'x-hub-signature');
  const [method, hex] = signed.split('=', 2);
  return method === 'sha256' && hex && sameHex(hex, expected) ? null : 'That signature does not match';
}

/** The issues a webhook says changed, by their keys as tasks link them (#42, ENG-7); empty for anything else. */
export function issueKeysIn(kind: IntegrationKind, config: IntegrationConfig, headers: Headers, body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>;
  if (kind === 'github') {
    if (one(headers, 'x-github-event') !== 'issues') return [];
    const issue = b['issue'] as { number?: unknown } | undefined;
    const repo = (b['repository'] as { full_name?: unknown } | undefined)?.full_name;
    // Only this connection's repository: a hook set up on another one can't reach these tasks.
    if (typeof repo !== 'string' || repo.toLowerCase() !== (config.repo ?? '').toLowerCase()) return [];
    return Number.isInteger(issue?.number) ? [`#${issue!.number as number}`] : [];
  }
  if (kind === 'linear') {
    const data = b['data'] as { identifier?: unknown } | undefined;
    return b['type'] === 'Issue' && typeof data?.identifier === 'string' ? [data.identifier] : [];
  }
  const key = (b['issue'] as { key?: unknown } | undefined)?.key;
  return typeof key === 'string' ? [key] : [];
}
