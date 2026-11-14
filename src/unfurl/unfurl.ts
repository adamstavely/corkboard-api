import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/** What a link card shows. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  /** The page's preview picture (https only), if it names one. */
  image: string | null;
  site: string;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

/** Addresses a link may never reach: this machine, private networks, link-local (cloud metadata) and the like. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

/** Resolves a host, refusing it if any address it has is private; used as the connection's own lookup. */
export function guardedLookup(hostname: string, options: object, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses;
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(new Error('That address is not allowed'), '');
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

function get(url: URL): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { lookup: guardedLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': 'CorkboardLinkPreview/1.0', Accept: 'text/html,application/xhtml+xml' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, type: '', body: '' });
        }
        const type = String(res.headers['content-type'] ?? '');
        if (!/html/i.test(type)) {
          res.resume();
          return resolve({ status, type, body: '' });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('close', () => resolve({ status, type, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('The page took too long')));
    req.on('error', reject);
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();

/** The title, description, picture and site name a page gives in its <head>. */
export function readPreview(html: string, url: URL): LinkPreview {
  const head = html.slice(0, 200_000);
  const meta = (name: string) => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (key === name) return decode(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '');
    }
    return '';
  };
  const title = meta('og:title') || meta('twitter:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '');
  const description = meta('og:description') || meta('description') || meta('twitter:description');
  let image: string | null = null;
  const raw = meta('og:image') || meta('twitter:image');
  if (raw) {
    try {
      const resolved = new URL(raw, url);
      if (resolved.protocol === 'https:') image = resolved.href;
    } catch {
      // Not a URL: no picture.
    }
  }
  return { url: url.href, title: title.slice(0, 300) || url.hostname, description: description.slice(0, 500), image, site: meta('og:site_name').slice(0, 100) || url.hostname.replace(/^www\./, '') };
}

/** Fetches a public web page's preview, following a few redirects, never to a private address. */
export async function unfurl(raw: string): Promise<LinkPreview> {
  let url = new URL(raw);
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only web links can be previewed');
    if (url.username || url.password) throw new Error('Links with a password in them are not previewed');
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address is not allowed');
    const res = await get(url);
    if (res.location && res.status >= 300 && res.status < 400) {
      url = new URL(res.location, url);
      continue;
    }
    if (res.status >= 400) throw new Error(`The page answered ${res.status}`);
    return res.body ? readPreview(res.body, url) : { url: url.href, title: url.hostname, description: '', image: null, site: url.hostname.replace(/^www\./, '') };
  }
  throw new Error('Too many redirects');
}
