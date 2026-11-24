/**
 * A logo from a vendor's icon pack, made safe to keep: its viewBox, and its drawing as plain SVG markup. Anything that
 * isn't plain drawing is refused rather than cleaned up: scripts, styles, text, comments, event handlers, links out of
 * the file and data URLs. The board draws logos as pictures (<img>), which can't run anything either.
 */
export interface Logo {
  vb: string;
  body: string;
}

/** The drawing elements a logo may use. */
const ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use']);
/** The attributes they may have. */
const ATTRIBUTES = new Set([
  'id', 'd', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'opacity', 'transform', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'points',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'fx', 'fy', 'clip-path', 'clip-rule', 'mask', 'maskunits',
  'maskcontentunits', 'clippathunits', 'href', 'xlink:href', 'style', 'class', 'display', 'visibility', 'vector-effect', 'isolation', 'mix-blend-mode',
]);
/** What a style attribute may set. */
const STYLES = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'stop-color', 'stop-opacity', 'isolation', 'mix-blend-mode', 'display', 'clip-rule']);

const VIEWBOX = /^-?\d+(?:\.\d+)?(?:[ ,]+-?\d+(?:\.\d+)?){3}$/;
const OPEN = /<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*"[^"<>]*")*)\s*(\/?)>/y;
const CLOSE = /<\/([a-zA-Z][\w:-]*)\s*>/y;
const ATTRIBUTE = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"<>]*)"/g;
export const MAX_LOGO_CHARS = 60_000;

/** Whether an attribute's value is plain: no script, no data or outside URL; a url() only to something in the same logo. */
function plainValue(value: string): boolean {
  const v = value.toLowerCase();
  if (/javascript:|data:|vbscript:|expression\s*\(|@import|&#|\\/.test(v)) return false;
  return [...v.matchAll(/url\(([^)]*)\)/g)].every(([, inner]) => /^\s*['"]?#[\w.-]+['"]?\s*$/.test(inner));
}

/** A logo checked and written back as plain SVG markup; or why it's refused. */
export function cleanLogo(raw: { vb?: unknown; body?: unknown }): Logo | { error: string } {
  if (typeof raw.vb !== 'string' || !VIEWBOX.test(raw.vb.trim())) return { error: 'it has no viewBox of four numbers' };
  if (typeof raw.body !== 'string' || !raw.body.trim()) return { error: 'it draws nothing' };
  if (raw.body.length > MAX_LOGO_CHARS) return { error: `it is over ${MAX_LOGO_CHARS / 1000} KB` };
  const src = raw.body;
  const out: string[] = [];
  const open: string[] = [];
  let at = 0;
  while (at < src.length) {
    const space = /\s*/y;
    space.lastIndex = at;
    space.exec(src);
    at = space.lastIndex;
    if (at >= src.length) break;
    if (src.startsWith('</', at)) {
      CLOSE.lastIndex = at;
      const m = CLOSE.exec(src);
      if (!m || open.pop() !== m[1].toLowerCase()) return { error: 'its markup is not well formed' };
      out.push(`</${m[1]}>`);
      at = CLOSE.lastIndex;
      continue;
    }
    if (src[at] !== '<') return { error: 'it has text in it' };
    OPEN.lastIndex = at;
    const m = OPEN.exec(src);
    if (!m) return { error: 'it has markup other than drawing (a comment, a script, a style…)' };
    const name = m[1].toLowerCase();
    if (!ELEMENTS.has(name)) return { error: `it uses <${m[1]}>, which a logo may not` };
    const attrs: string[] = [];
    for (const [, key, value] of m[2].matchAll(ATTRIBUTE)) {
      const k = key.toLowerCase();
      if (!ATTRIBUTES.has(k)) return { error: `it uses the attribute ${key}, which a logo may not` };
      if (!plainValue(value)) return { error: `its ${key} points outside the logo or runs something` };
      if ((k === 'href' || k === 'xlink:href') && !/^#[\w.-]+$/.test(value)) return { error: 'it links outside itself' };
      if (k === 'style') {
        const declarations = value.split(';').map((d) => d.trim()).filter(Boolean);
        for (const d of declarations) {
          const [prop, ...rest] = d.split(':');
          if (!STYLES.has(prop.trim().toLowerCase()) || !rest.join(':').trim()) return { error: `its style sets ${prop.trim()}, which a logo may not` };
        }
      }
      attrs.push(`${key}="${value}"`);
    }
    out.push(`<${m[1]}${attrs.length ? ' ' + attrs.join(' ') : ''}${m[3] ? '/' : ''}>`);
    if (!m[3]) open.push(name);
    at = OPEN.lastIndex;
  }
  if (open.length) return { error: 'its markup is not well formed' };
  return { vb: raw.vb.trim().replace(/,/g, ' ').replace(/\s+/g, ' '), body: out.join('') };
}

/** A logo's or a pack's name: lower case, words joined by hyphens. */
export const LOGO_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const PACK_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
