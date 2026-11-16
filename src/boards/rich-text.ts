import * as Y from 'yjs';

/**
 * A note's rich text as plain data, so a template keeps it as written: lists, code, maths, headings and the marks on
 * its words (bold, links, highlights). An element is its name, attributes and children; a run of text is its delta.
 */
export type RichNode = { n: string; a?: Record<string, unknown>; c?: RichNode[] } | { t: { insert: string; attributes?: Record<string, unknown> }[] };

/** The blocks a note's editor writes (corkboard-ui's note-text.ts: Tiptap's StarterKit, and maths). */
const ELEMENTS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote', 'hardBreak', 'horizontalRule', 'math', 'mathBlock']);
const MAX_JSON = 20_000;
const MAX_DEPTH = 12;

/** A note's text as rich data. */
export function richOf(fragment: Y.XmlFragment): RichNode[] {
  const walk = (node: Y.XmlElement | Y.XmlText): RichNode =>
    node instanceof Y.XmlText
      ? { t: (node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]).flatMap((op) => (typeof op.insert === 'string' ? [{ insert: op.insert, ...(op.attributes ? { attributes: op.attributes } : {}) }] : [])) }
      : {
          n: node.nodeName,
          ...(Object.keys(node.getAttributes()).length ? { a: node.getAttributes() } : {}),
          ...(node.length ? { c: node.toArray().map((child) => walk(child as Y.XmlElement | Y.XmlText)) } : {}),
        };
  return fragment.toArray().map((child) => walk(child as Y.XmlElement | Y.XmlText));
}

/** What's wrong with rich text from a layout, or null if a note can hold it. */
export function richProblem(rich: unknown): string | null {
  if (!Array.isArray(rich)) return 'rich text that is not a list';
  try {
    if (JSON.stringify(rich).length > MAX_JSON) return 'rich text that is too long';
  } catch {
    return 'rich text that is not plain data';
  }
  const check = (node: unknown, depth: number): boolean => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return false;
    const v = node as Record<string, unknown>;
    if ('t' in v) return Array.isArray(v['t']) && v['t'].every((op) => !!op && typeof op === 'object' && typeof (op as { insert?: unknown }).insert === 'string');
    if (typeof v['n'] !== 'string' || !ELEMENTS.has(v['n'])) return false;
    if (v['a'] !== undefined && (!v['a'] || typeof v['a'] !== 'object' || Array.isArray(v['a']))) return false;
    return v['c'] === undefined || (Array.isArray(v['c']) && v['c'].every((c) => check(c, depth + 1)));
  };
  return rich.every((n) => check(n, 0)) ? null : 'rich text the board cannot show';
}

/** Rich data as the Yjs nodes of a note's text, to insert into its fragment. */
export function richNodes(rich: RichNode[]): (Y.XmlElement | Y.XmlText)[] {
  const build = (node: RichNode): Y.XmlElement | Y.XmlText => {
    if ('t' in node) {
      const text = new Y.XmlText();
      text.applyDelta(node.t);
      return text;
    }
    const el = new Y.XmlElement(node.n);
    for (const [k, v] of Object.entries(node.a ?? {})) el.setAttribute(k, v as string);
    if (node.c?.length) el.insert(0, node.c.map(build));
    return el;
  };
  return rich.map(build);
}
