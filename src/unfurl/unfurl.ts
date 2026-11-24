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

/** What a request wants back: the kind of answer it takes, and how much of it. */
interface Want {
  agent: string;
  accept: string;
  /** The content types it reads; anything else comes back with an empty body. */
  type: RegExp;
  max: number;
  /** Whether a body bigger than max is an error (an image) or is cut short (a page, whose head is what's read). */
  whole?: boolean;
  /** Whether every hop must be https (an image a diagram shows). */
  httpsOnly?: boolean;
}

const PAGE: Want = { agent: 'CorkboardLinkPreview/1.0', accept: 'text/html,application/xhtml+xml', type: /html/i, max: MAX_BYTES };

function get(url: URL, want: Want = PAGE): Promise<{ status: number; location?: string; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { lookup: guardedLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': want.agent, Accept: want.accept } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location, type: '', body: Buffer.alloc(0) });
      }
      const type = String(res.headers['content-type'] ?? '');
      if (!want.type.test(type)) {
        res.resume();
        return resolve({ status, type, body: Buffer.alloc(0) });
      }
      let size = 0;
      let tooBig = false;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > want.max) {
          tooBig = true;
          res.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('close', () => (tooBig && want.whole ? reject(new Error(`It's bigger than ${Math.round(want.max / 1024)} KB`)) : resolve({ status, type, body: Buffer.concat(chunks) })));
      res.on('error', reject);
    });
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
async function fetchPublic(raw: string, want: Want = PAGE): Promise<{ url: URL; type: string; body: Buffer }> {
  let url = new URL(raw);
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only web links can be read');
    if (want.httpsOnly && url.protocol !== 'https:') throw new Error('Only https images are shown');
    if (url.username || url.password) throw new Error('Links with a password in them are not read');
    assertPublicHost(url);
    const res = await get(url, want);
    if (res.location && res.status >= 300 && res.status < 400) {
      url = new URL(res.location, url);
      continue;
    }
    if (res.status >= 400) throw new Error(`The page answered ${res.status}`);
    return { url, type: res.type, body: res.body };
  }
  throw new Error('Too many redirects');
}

/** Fetches a public web page's preview, following a few redirects, never to a private address. */
export async function unfurl(raw: string): Promise<LinkPreview> {
  const { url, body } = await fetchPublic(raw);
  return body.length ? readPreview(body.toString('utf8'), url) : { url: url.href, title: url.hostname, description: '', image: null, site: url.hostname.replace(/^www\./, '') };
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
  const { url, body } = await fetchPublic(raw, { ...PAGE, agent: 'CorkboardAssistant/1.0' });
  if (!body.length) throw new Error("That page isn't a web page the assistant can read.");
  const html = body.toString('utf8');
  return { url: url.href, title: readPreview(html, url).title, text: readableText(html) };
}

/** The most CSS read from a page for its look: its own <style>s, inline styles and up to four stylesheets. */
const MAX_STYLES = 4;
const STYLES: Want = { agent: 'CorkboardTheme/1.0', accept: 'text/css', type: /css/i, max: MAX_BYTES };

/**
 * A public web page's styles, for working out its look (colours, fonts, corners): fetched as unfurl fetches, never from
 * a private address. Only text comes back; nothing in it runs.
 */
export async function readStyles(raw: string): Promise<{ url: string; html: string; css: string }> {
  const { url, body } = await fetchPublic(raw, { ...PAGE, agent: 'CorkboardTheme/1.0' });
  if (!body.length) throw new Error("That page isn't a web page whose look can be read.");
  const html = body.toString('utf8');
  const own = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]);
  const inline = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => `x{${m[1]}}`);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel\s*=\s*["']?stylesheet/i.test(tag))
    .flatMap((tag) => {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      try {
        return href ? [new URL(decode(href), url).href] : [];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_STYLES);
  const sheets = await Promise.all(links.map((href) => fetchPublic(href, STYLES).then((r) => r.body.toString('utf8'), () => '')));
  return { url: url.href, html, css: [...own, ...inline, ...sheets].join('\n') };
}

/** The most an image in a diagram may weigh. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** The picture formats a diagram shows, told apart by their first bytes (what the server says it is isn't trusted). */
export function imageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * A picture from a public https address, for a diagram to show: fetched as unfurl fetches (never from a private address,
 * a few redirects at most), no bigger than MAX_IMAGE_BYTES, and a PNG, JPEG, GIF or WebP by its own bytes.
 */
export async function fetchImage(raw: string): Promise<{ type: string; data: Buffer }> {
  if (!/^https:\/\//i.test(raw)) throw new Error('Only https images are shown');
  const { body } = await fetchPublic(raw, { agent: 'CorkboardDiagram/1.0', accept: 'image/png,image/jpeg,image/gif,image/webp', type: /^image\//i, max: MAX_IMAGE_BYTES, whole: true, httpsOnly: true });
  const type = imageType(body);
  if (!type) throw new Error("It isn't a PNG, JPEG, GIF or WebP picture");
  return { type, data: body };
}

/** How the server fetches a diagram's pictures: from the web, or a stand-in in tests. */
export type ImageFetch = (url: string) => Promise<{ type: string; data: Buffer }>;
export const IMAGE_FETCH = Symbol('IMAGE_FETCH');
