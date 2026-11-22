import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { besideBoard } from '../apps/app-node';
import { topZ } from './board-edit';

/** How big a new diagram is on the board; it draws fitted to its box. */
export const DIAGRAM_SIZE = { w: 560, h: 420 } as const;
/** The longest a diagram's text may be. */
export const MAX_DIAGRAM_CHARS = 8000;

const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');

/**
 * The kinds of Mermaid diagram Corkboard draws, by the word their text starts with; each one draws under the board's
 * strict settings. Keep in step with corkboard-ui's diagram.ts.
 */
export const DIAGRAM_KINDS =
  /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram(?:-v2)?|erDiagram|gantt|pie|journey|timeline|mindmap|quadrantChart|xychart(?:-beta)?|gitGraph|kanban|requirementDiagram|sankey(?:-beta)?|block(?:-beta)?|packet(?:-beta)?)(?=[\s;]|$)/;

/** Where a diagram's image can come from: a file on the board, by id. */
export const BOARD_FILE_IMAGE = /^corkboard-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Front matter at the top of a diagram: only a title may go in it. */
const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
/** A link on a node: click A href "https://…" (the word href may be left out), with a tooltip and target if wanted. */
const CLICK = /^\s*click\s+(\S+)\s+(?:href\s+)?"([^"]*)"(?:\s+"[^"]*")?(?:\s+_(?:blank|self|parent|top))?\s*;?\s*$/;
/** A node's shape data, A@{ … }, and an image's source in it: img: "…" (quoted or not). */
const SHAPE_DATA = /@\{([^}]*)\}/g;
const IMG = /(?:^|[\s,{])img\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/;

/** The text after its front matter, and the front matter's lines; null when the front matter is never closed. */
function splitFrontMatter(source: string): { head: string[]; body: string } | null {
  const text = source.replace(/^\s*\n/, '');
  if (!text.startsWith('---')) return { head: [], body: text };
  const match = FRONT_MATTER.exec(text);
  return match ? { head: match[1].split(/\r?\n/).filter((l) => l.trim()), body: text.slice(match[0].length) } : null;
}

/** A link's address if it's one a diagram may open (a web page or an email), else null. */
export function diagramLinkUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Every image source a diagram's text names. */
export function diagramImageSources(source: string): string[] {
  return [...source.matchAll(SHAPE_DATA)].flatMap(([, data]) => {
    const m = IMG.exec(data);
    return m ? [(m[1] ?? m[2] ?? m[3]).trim()] : [];
  });
}

/** The web addresses of a diagram's images (not the board's own files). */
export const diagramImageUrls = (source: string): string[] => diagramImageSources(source).filter((s) => !BOARD_FILE_IMAGE.test(s));

/**
 * Says what's wrong with a diagram's text, or null. Corkboard draws the Mermaid kinds in DIAGRAM_KINDS; a title may go in
 * front matter, but no other settings; nodes may link to web pages and emails (click A href "https://…") and show images
 * from the board's files or https addresses.
 */
export function diagramProblem(source: unknown): string | null {
  if (typeof source !== 'string' || !source.trim()) return 'A diagram needs its Mermaid text.';
  if (source.length > MAX_DIAGRAM_CHARS) return `A diagram's text can be at most ${MAX_DIAGRAM_CHARS} characters.`;
  if (source.includes('%%{')) return "A diagram can't change Mermaid's settings (%%{init}%%).";
  const split = splitFrontMatter(source);
  if (!split || split.head.length > 1 || split.head.some((line) => !/^\s*title\s*:\s*\S/.test(line))) return 'Only a title (title: …) can go between the --- lines at the top of a diagram.';
  const body = split.body.replace(/^(?:\s*(?:%%[^\n]*)?\n)*\s*/, '');
  if (!DIAGRAM_KINDS.test(body)) {
    return 'Start the text with the kind of diagram: "flowchart TD" (or LR), "sequenceDiagram", "stateDiagram-v2", "classDiagram", "erDiagram", "gantt", "pie", "journey", "timeline", "mindmap", "quadrantChart", "xychart", "gitGraph", "kanban", "requirementDiagram", "sankey", "block" or "packet".';
  }
  for (const line of body.split('\n')) {
    if (!/^\s*click\s/.test(line)) continue;
    const link = CLICK.exec(line);
    if (!link) return 'A diagram link goes to a web address, written as click A href "https://…".';
    if (!diagramLinkUrl(link[2])) return 'Links in a diagram must start with https://, http:// or mailto:.';
  }
  for (const src of diagramImageSources(body)) {
    if (BOARD_FILE_IMAGE.test(src)) continue;
    if (!/^https:\/\//i.test(src) || !diagramLinkUrl(src)) return 'Images in a diagram must be a file on the board (corkboard-file:<its id>) or an https:// address.';
  }
  return null;
}

/** The diagrams on the board, with their text. */
export function diagramsOn(doc: Y.Doc): { id: string; source: string }[] {
  const found: { id: string; source: string }[] = [];
  nodesOf(doc).forEach((node, id) => {
    const source = node instanceof Y.Map ? node.get('source') : undefined;
    if (node instanceof Y.Map && node.get('kind') === 'diagram') found.push({ id, source: typeof source === 'string' ? source : '' });
  });
  return found;
}

/** Puts a diagram beside everything on the board and returns its id. */
export function placeDiagram(doc: Y.Doc, source: string, author = 'assistant'): string {
  const id = randomUUID();
  const at = besideBoard(doc);
  const z = topZ(doc) + 1;
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    nodesOf(doc).set(id, node);
    node.set('kind', 'diagram');
    node.set('x', at.x);
    node.set('y', at.y);
    node.set('w', DIAGRAM_SIZE.w);
    node.set('h', DIAGRAM_SIZE.h);
    node.set('z', z);
    node.set('source', source.trim());
    node.set('author', author);
  });
  return id;
}

/** A diagram's new text; false if there's no diagram with that id. */
export function setDiagramSource(doc: Y.Doc, id: string, source: string): boolean {
  const node = nodesOf(doc).get(id);
  if (!(node instanceof Y.Map) || node.get('kind') !== 'diagram') return false;
  node.set('source', source.trim());
  return true;
}
