import { readPage } from '../unfurl/unfurl';

/** The web search services a workspace can use, with its own key. */
export const SEARCH_PROVIDERS = ['brave', 'tavily'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

/** One search result. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/** What the assistant can do on the web: search with the workspace's service, and read a public page. */
export interface Web {
  search(provider: SearchProvider, key: string, query: string, signal?: AbortSignal): Promise<WebResult[]>;
  read(url: string): Promise<{ url: string; title: string; text: string }>;
}

/** Replaced in tests, so they never reach the internet. */
export const WEB = Symbol('WEB');

const RESULTS = 6;
const SEARCH_MS = 10_000;

/** A field of a search result as plain text: Brave marks matches with <strong>. */
const textOf = (v: unknown) => (typeof v === 'string' ? v.replace(/<[^>]+>/g, '') : '');

/** Search results from Brave's or Tavily's answer, whichever asked. */
export function resultsOf(provider: SearchProvider, body: unknown): WebResult[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = provider === 'brave' ? ((b['web'] as Record<string, unknown> | undefined)?.['results'] ?? []) : (b['results'] ?? []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: Record<string, unknown>) => ({
      title: textOf(r['title']),
      url: textOf(r['url']),
      snippet: textOf(provider === 'brave' ? r['description'] : r['content']),
    }))
    .filter((r) => /^https?:\/\//.test(r.url))
    .slice(0, RESULTS);
}

/** The real web, through the search services' APIs. */
export function realWeb(fetchImpl: typeof fetch = globalThis.fetch): Web {
  return {
    async search(provider, key, query, signal) {
      const timeout = AbortSignal.timeout(SEARCH_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const res =
        provider === 'brave'
          ? await fetchImpl(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(RESULTS) }).toString()}`, {
              headers: { Accept: 'application/json', 'X-Subscription-Token': key },
              signal: both,
            })
          : await fetchImpl('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: JSON.stringify({ query, max_results: RESULTS }),
              signal: both,
            });
      if (res.status === 401 || res.status === 403) throw new Error("The workspace's web search key was refused. An owner can change it under AI models.");
      if (!res.ok) throw new Error(`Web search answered ${res.status}. Try again later.`);
      return resultsOf(provider, await res.json());
    },
    read: readPage,
  };
}
