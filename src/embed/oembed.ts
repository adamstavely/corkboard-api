/** An embed's size when the consumer doesn't limit it: wide enough for a board, short enough for a page. */
export const EMBED_SIZE = { width: 800, height: 500 };

/** The token in an embed page's address, if `url` is one on one of Corkboard's own origins. */
export function embedToken(url: string, origins: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!origins.includes(parsed.origin)) return null;
  const match = /^\/embed\/([A-Za-z0-9_-]{16,})\/?$/.exec(parsed.pathname);
  return match ? match[1] : null;
}

/** The default size, scaled down (keeping its shape) to fit the consumer's limits. */
export function embedSize(maxwidth?: number, maxheight?: number): { width: number; height: number } {
  const scale = Math.min(1, maxwidth ? maxwidth / EMBED_SIZE.width : 1, maxheight ? maxheight / EMBED_SIZE.height : 1);
  return { width: Math.round(EMBED_SIZE.width * scale), height: Math.round(EMBED_SIZE.height * scale) };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The iframe that shows an embed page. */
export function embedIframe(src: string, title: string, { width, height }: { width: number; height: number }): string {
  return `<iframe src="${escapeHtml(src)}" width="${width}" height="${height}" style="border:0" loading="lazy" allowfullscreen title="${escapeHtml(`${title} (Corkboard board)`)}"></iframe>`;
}
