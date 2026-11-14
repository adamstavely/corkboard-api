import { Injectable } from '@nestjs/common';
import http from 'node:http';
import https from 'node:https';
import { guardedLookup } from '../unfurl/unfurl';

/** What came back from an issue tracker. */
export interface HttpReply {
  status: number;
  json: unknown;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1024 * 1024;

/**
 * Calls issue trackers' APIs (GitHub, Linear, Jira) over https, through the same private-address guard as link
 * previews, so a Jira address can't be pointed inside the network. Replaced in tests.
 */
@Injectable()
export class IssueHttp {
  request(url: string, init: { method: string; headers: Record<string, string>; body?: unknown }): Promise<HttpReply> {
    const target = new URL(url);
    if (target.protocol !== 'https:') return Promise.reject(new Error('Issue trackers are reached over https only'));
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    return new Promise((resolve, reject) => {
      const req = (target.protocol === 'https:' ? https : http).request(
        target,
        {
          method: init.method,
          lookup: guardedLookup,
          timeout: TIMEOUT_MS,
          headers: { Accept: 'application/json', 'User-Agent': 'Corkboard', ...(body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
        },
        (res) => {
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BYTES) res.destroy();
            else chunks.push(c);
          });
          res.on('close', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json: unknown = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = { message: text.slice(0, 200) };
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('The tracker took too long to answer')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
