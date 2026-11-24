/**
 * A workspace's (or a board's) look for diagrams: the fills of its six colour slots in light and dark, the text colour
 * on them, a font and a corner radius. Trench Coat's look is the default. Every theme is contrast-checked: text on each
 * fill meets WCAG 2.2 AA (4.5:1) in both modes. A theme can be built from a few brand colours, or read off a website
 * (a port of the Ultimate Diagram skill's extract_tokens, reading the page's CSS as text: only colours, a font family
 * name and corner sizes are taken from it). Kept the same as corkboard-ui's diagrams/diagram-theme.ts.
 */

/** The board's colours a diagram uses, in the order a theme gives its fills. */
export const THEME_SLOTS = ['blue', 'green', 'yellow', 'purple', 'pink', 'gray'] as const;
export const THEME_FONTS = ['inter', 'system', 'serif', 'rounded', 'mono'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

export interface DiagramTheme {
  name: string;
  /** Six fills, one a slot, as #rrggbb. */
  light: string[];
  dark: string[];
  /** The text on the fills. */
  ink: { light: string; dark: string };
  font: ThemeFont;
  /** Corner radius of boxes, in px (0 to 24). */
  radius: number;
}

/** WCAG 2.2 AA for normal text. */
export const MIN_CONTRAST = 4.5;

// ---------------------------------------------------------------------------------------------------------------
// Colour maths: sRGB, relative luminance, OKLab / OKLCH (Björn Ottosson)

const HEX = /^#[0-9a-f]{6}$/;
type Rgb = [number, number, number];

/** A colour as #rrggbb, from #rgb, #rrggbb, #rrggbbaa (opaque only) or rgb()/rgba(); null if it isn't one, or is see-through. */
export function normHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return `#${[...m[1]].map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})(ff)?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    if (alpha < 1) return null;
    const rgb = [m[1], m[2], m[3]].map(Number);
    if (rgb.some((c) => c > 255)) return null;
    return toHex(rgb as Rgb);
  }
  return null;
}
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (x: number) => 255 * ((x = Math.min(1, Math.max(0, x))) <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = toRgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A colour as OKLCH: lightness 0–1, chroma, hue in degrees. */
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** A colour from OKLCH, chroma reduced until it fits in sRGB. */
export function fromOklch(L: number, C: number, H: number): string {
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos((H * Math.PI) / 180);
    const b = c * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (rgb.every((x) => x >= -0.0005 && x <= 1.0005)) return toHex(rgb.map(gamma) as Rgb);
  }
  return toHex([gamma(L ** 3), gamma(L ** 3), gamma(L ** 3)]);
}

// ---------------------------------------------------------------------------------------------------------------
// Themes

/** Trench Coat's own look for diagrams (the board's note colours). */
export const TRENCH_COAT: DiagramTheme = {
  name: 'Trench Coat',
  light: ['#cfe6ff', '#d4f2cf', '#fff3a8', '#e6dbff', '#ffd3e2', '#ececec'],
  dark: ['#24405e', '#2c4a2a', '#5c5222', '#3f3360', '#5e2f40', '#3a3a3a'],
  ink: { light: '#1a1a1a', dark: '#f1f1f1' },
  font: 'inter',
  radius: 8,
};

/** What's wrong with a theme, if anything: malformed values, and fills whose text falls short of AA. */
export function themeProblems(raw: unknown): string[] {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: string[] = [];
  if (typeof t['name'] !== 'string' || !t['name'].trim() || t['name'].length > 60) out.push('Name the look (up to 60 characters).');
  const ink = (t['ink'] ?? {}) as Record<string, unknown>;
  for (const mode of ['light', 'dark'] as const) {
    const fills = t[mode];
    if (!Array.isArray(fills) || fills.length !== THEME_SLOTS.length || !fills.every((f) => typeof f === 'string' && HEX.test(f))) out.push(`Give six ${mode} fills as #rrggbb.`);
    if (typeof ink[mode] !== 'string' || !HEX.test(ink[mode])) out.push(`Give the ${mode} text colour as #rrggbb.`);
  }
  if (!THEME_FONTS.includes(t['font'] as ThemeFont)) out.push(`The font is one of ${THEME_FONTS.join(', ')}.`);
  if (!Number.isInteger(t['radius']) || (t['radius'] as number) < 0 || (t['radius'] as number) > 24) out.push('Corners are 0 to 24 px.');
  if (out.length) return out;
  const theme = t as unknown as DiagramTheme;
  for (const mode of ['light', 'dark'] as const)
    theme[mode].forEach((fill, i) => {
      const ratio = contrast(fill, theme.ink[mode]);
      if (ratio < MIN_CONTRAST) out.push(`Text on the ${mode} ${THEME_SLOTS[i]} fill (${fill}) is ${ratio.toFixed(2)}:1; it needs ${MIN_CONTRAST}:1.`);
    });
  return out;
}

/** A theme's own fields only, in order (anything else dropped). */
export const cleanTheme = (t: DiagramTheme): DiagramTheme => ({
  name: t.name.trim(),
  light: [...t.light],
  dark: [...t.dark],
  ink: { light: t.ink.light, dark: t.ink.dark },
  font: t.font,
  radius: t.radius,
});

/** Moves a fill's lightness, keeping its hue, until text of this colour on it meets AA. */
function readable(fill: string, ink: string): string {
  if (contrast(fill, ink) >= MIN_CONTRAST) return fill;
  const [L, C, H] = toOklch(fill);
  const up = toOklch(ink)[0] < 0.5;
  for (let step = 1; step <= 60; step++) {
    const next = fromOklch(Math.min(1, Math.max(0, L + (up ? 0.01 : -0.01) * step)), C, H);
    if (contrast(next, ink) >= MIN_CONTRAST) return next;
  }
  return up ? '#ffffff' : '#000000';
}

/**
 * A full theme from a few brand colours: six soft fills (from the brands' hues, more hues spread round the first when
 * there are fewer than five, and a near-neutral), a dark set of each, and every fill moved until its text passes AA.
 */
export function themeFromBrand(brand: readonly string[], opts: { name?: string; font?: ThemeFont; radius?: number } = {}): DiagramTheme {
  const hues = brand.map((h) => toOklch(h)).filter(([, C]) => C > 0.03);
  const base = hues[0] ?? toOklch('#2f6fde');
  const picked: [number, number][] = hues.slice(0, 5).map(([, C, H]) => [C, H]);
  for (let i = 1; picked.length < 5; i++) picked.push([base[1], (base[2] + i * 72) % 360]);
  const ink = { ...TRENCH_COAT.ink };
  const light = [...picked.map(([C, H]) => fromOklch(0.92, Math.min(C * 0.4, 0.07), H)), fromOklch(0.93, 0.008, base[2])].map((f) => readable(f, ink.light));
  const dark = [...picked.map(([C, H]) => fromOklch(0.36, Math.min(C * 0.55, 0.08), H)), fromOklch(0.33, 0.01, base[2])].map((f) => readable(f, ink.dark));
  return { name: opts.name?.trim().slice(0, 60) || 'Brand', light, dark, ink, font: opts.font ?? 'inter', radius: Math.round(Math.min(24, Math.max(0, opts.radius ?? 8))) };
}

/** A family name's nearest of the fonts diagrams offer. */
export function nearestFont(family: string): ThemeFont {
  const f = family.toLowerCase();
  if (/mono|code|courier|consol/.test(f)) return 'mono';
  if (/nunito|quicksand|varela|rounded|comfortaa/.test(f)) return 'rounded';
  if (/sans/.test(f)) return 'inter';
  if (/serif|georgia|times|garamond|merriweather|playfair|lora|baskerville/.test(f)) return 'serif';
  if (/system-ui|-apple-system|blinkmacsystemfont|segoe/.test(f)) return 'system';
  return 'inter';
}

/**
 * A page's look from its CSS: its brand colours (by how much they're used, more where they're named as such or on
 * links, buttons and headers; greys, near-white and near-black aside), its main font and its buttons' corners.
 */
export function readLook(css: string): { brand: string[]; font: ThemeFont; radius: number | null; notes: string[] } {
  const notes: string[] = [];
  const score = new Map<string, number>();
  const add = (hex: string | null, weight: number) => {
    if (!hex) return;
    const [L, C] = toOklch(hex);
    if (C < 0.04 || L > 0.97 || L < 0.12) return;
    score.set(hex, (score.get(hex) ?? 0) + weight);
  };
  const colour = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
  for (const rule of css.slice(0, 2_000_000).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = rule[1].toLowerCase();
    const body = rule[2];
    for (const decl of body.split(';')) {
      const [prop = '', value = ''] = decl.split(/:(.*)/s);
      const name = prop.trim().toLowerCase();
      const brandish = /^--.*(primary|brand|accent|main|theme)/.test(name);
      const weight = brandish ? 8 : /\b(a|button|\.btn|header|nav)\b/.test(selector) ? 3 : 1;
      for (const m of value.matchAll(colour)) add(normHex(m[0]), weight);
    }
  }
  // Similar colours count as one: each kept colour takes the score of those near it.
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const brand: string[] = [];
  for (const [hex] of ranked) {
    const [L, C, H] = toOklch(hex);
    const near = brand.some((b) => {
      const [l2, c2, h2] = toOklch(b);
      const dh = Math.min(Math.abs(H - h2), 360 - Math.abs(H - h2));
      return Math.abs(L - l2) < 0.12 && Math.abs(C - c2) < 0.08 && dh < 18;
    });
    if (!near) brand.push(hex);
    if (brand.length === 5) break;
  }
  if (!brand.length) notes.push('No brand colours were found in its styles; the fills start from a blue.');
  const families = [...css.matchAll(/(?:^|[;{\s])font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].split(',')[0].replace(/["']/g, '').trim()).filter((f) => /^[\w .-]{1,60}$/.test(f));
  const counts = new Map<string, number>();
  for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1);
  const family = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const font = family ? nearestFont(family) : 'inter';
  if (family) notes.push(`Its font, ${family}, is drawn as the nearest diagrams offer: ${font}.`);
  const radii = [...css.matchAll(/(?:button|\.btn)[^{}]*\{[^{}]*border-radius\s*:\s*(\d+(?:\.\d+)?)(px|rem)/gi)].map((m) => Number(m[1]) * (m[2] === 'rem' ? 16 : 1)).sort((a, b) => a - b);
  const radius = radii.length ? Math.round(Math.min(24, radii[Math.floor(radii.length / 2)])) : null;
  return { brand, font, radius, notes };
}
