import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { assertPublicHost, isPrivateAddress } from './addresses';

export { isPrivateAddress } from './addresses';

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

function get(url: URL, agent = 'CorkboardLinkPreview/1.0'): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      { lookup: guardedLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': agent, Accept: 'text/html,application/xhtml+xml' } },
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

/** A public web page's HTML, following a few redirects, never to a private address; the body is empty if it isn't HTML. */
async function fetchPublic(raw: string, agent?: string): Promise<{ url: URL; body: string }> {
  let url = new URL(raw);
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only web links can be read');
    if (url.username || url.password) throw new Error('Links with a password in them are not read');
    assertPublicHost(url);
    const res = await get(url, agent);
    if (res.location && res.status >= 300 && res.status < 400) {
      url = new URL(res.location, url);
      continue;
    }
    if (res.status >= 400) throw new Error(`The page answered ${res.status}`);
    return { url, body: res.body };
  }
  throw new Error('Too many redirects');
}

/** Fetches a public web page's preview, following a few redirects, never to a private address. */
export async function unfurl(raw: string): Promise<LinkPreview> {
  const { url, body } = await fetchPublic(raw);
  return body ? readPreview(body, url) : { url: url.href, title: url.hostname, description: '', image: null, site: url.hostname.replace(/^www\./, '') };
}

/** The most of a page's text the assistant reads. */
export const MAX_PAGE_TEXT = 20_000;

/**
 * What a page says, as plain text: its <main> or <article> if it has one, without its <head>, scripts, styles, navigation, headers
 * and footers; headings, paragraphs and list items each on their own line.
 */
export function readableText(html: string): string {
  let body = html.replace(/<!--[\s\S]*?-->/g, '');
  body = body.replace(/<(head|script|style|noscript|template|svg|iframe|nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(body)?.[2];
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) body = main;
  return body
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/blockquote|\/pre)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => decode(line))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_TEXT);
}

/** A public web page's title and readable text, for the assistant: fetched as unfurl fetches, never from a private address. */
export async function readPage(raw: string): Promise<{ url: string; title: string; text: string }> {
  const { url, body } = await fetchPublic(raw, 'CorkboardAssistant/1.0');
  if (!body) throw new Error("That page isn't a web page the assistant can read.");
  return { url: url.href, title: readPreview(body, url).title, text: readableText(body) };
}
