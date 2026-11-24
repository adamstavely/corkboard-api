import * as Y from 'yjs';
import type { NoteColor } from '../assist/board-edit';
import { fragmentText } from '../boards/board-text';
import { partOf, type Layout } from '../boards/layout';
import { nodesOf, partsOf, rewriteLayout, str } from './flowchart';
import { c4Engine } from './vendor/c4';

/**
 * Editable C4 diagrams, as corkboard-ui draws them (its diagrams/c4.ts; keep the geometry, labels and looks in step):
 * the skill's C4 JSON (or Mermaid C4), laid out by the Ultimate Diagram skill's C4 engine (vendor/).
 */

const TOKENS = {
  font: { metrics: { label: 7.4, title: 7.4, detail: 6.4, note: 6.2, type: 6.6, edgeLabel: 7, edgeWrap: 6.6 } },
  c4: {
    cardW: 156, cardMaxW: 240, cardH: 112, cardLine: 18, pad: 14, tagH: 44, padB: 14, tagPad: 72, emptyW: 200, emptyH: 96, innerGap: 20, innerLinkX: 120, innerLinkY: 64,
    ringV: 72, ringH: 130, ringGap: 34, ringLinkX: 150, ringLinkY: 90, ringStagger: 6, ringStaggerCap: 12, centreGap: 50, rowMax: 8, margin: 48, sep: 24,
    flowAcross: 56, flowAlong: 72, flowPerEdge: 10, flowEdgeCap: 8, flowRowGap: 40, labelMaxW: 140,
  },
};

export const C4_KINDS = ['person', 'system', 'container', 'database', 'queue', 'external'] as const;
export interface C4Element {
  id: string;
  kind: string;
  name: string;
  description?: string;
  tech?: string;
  group?: string;
  icon?: string;
  color?: string;
  core?: boolean;
  side?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  _hidden?: boolean;
}
export interface C4Group {
  id: string;
  name: string;
  kind: string;
  parent?: string;
  collapsed?: boolean;
  core?: boolean;
  side?: string;
  color?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  _hidden?: boolean;
  _collapsed?: boolean;
}
export interface C4Relation {
  from: string;
  to: string;
  label: string;
  tech?: string;
  async?: boolean;
}
export interface C4Data {
  diagramType: 'c4';
  schemaVersion?: number;
  title?: string;
  arrange?: string;
  colorKey?: Record<string, string>;
  groups: C4Group[];
  elements: C4Element[];
  relations: C4Relation[];
  notes?: { id: string; text: string; elements?: string[]; groups?: string[] }[];
}
interface C4Engine {
  layoutDiagram(data: C4Data): void;
  fromMermaid(text: string): { data: C4Data; infos: string[]; warnings: string[] };
}
let engine: C4Engine | undefined;
const c4 = (): C4Engine => (engine ??= c4Engine(TOKENS) as C4Engine);

const S = 1.25;
const PAD = 24;
const TITLE = 56;
const NOTE = { w: 220, h: 140, gap: 24 };
const SLOT_COLOURS: NoteColor[] = ['blue', 'green', 'yellow', 'purple', 'pink', 'gray', 'blue', 'green', 'gray'];
const KIND_COLOUR: Record<string, NoteColor> = { person: 'purple', system: 'blue', container: 'blue', component: 'blue', database: 'blue', queue: 'blue', external: 'gray' };
const KIND_SHAPE: Record<string, 'person' | 'rect' | 'cylinder' | 'queue'> = { person: 'person', database: 'cylinder', queue: 'queue' };
const KIND_NAMES: Record<string, string> = { person: 'Person', system: 'Software System', container: 'Container', component: 'Component', database: 'Database', queue: 'Queue', external: 'External System' };
const colourOf = (e: { kind: string; color?: string }): NoteColor => (e.color && /^[1-9]$/.test(e.color) ? SLOT_COLOURS[Number(e.color) - 1] : (KIND_COLOUR[e.kind] ?? 'blue'));

/** Whether text is a C4 diagram: the skill's JSON (diagramType "c4") or Mermaid C4. */
export function isC4Source(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      return (JSON.parse(t) as { diagramType?: string }).diagramType === 'c4';
    } catch {
      return false;
    }
  }
  return /^\s*C4(Context|Container|Component|Dynamic|Deployment)\b/m.test(t);
}

/** C4 text read as the model; or why it can't be read. */
export function parseC4(text: string): { data: C4Data; warnings: string[] } | { error: string } {
  try {
    const t = text.trim();
    const parsed = t.startsWith('{') ? { data: JSON.parse(t) as C4Data, warnings: [] as string[] } : c4().fromMermaid(t);
    const data = parsed.data;
    if (!Array.isArray(data.elements) || !data.elements.length) return { error: 'The C4 diagram has no elements.' };
    data.groups ??= [];
    data.relations ??= [];
    return { data, warnings: parsed.warnings.map((w) => w.replace(/^\[WARN\]\s*/, '')) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The C4 diagram could not be read.' };
  }
}

const elementLabel = (e: C4Element) => [e.name, `[${KIND_NAMES[e.kind] ?? 'Software System'}${e.tech ? `: ${e.tech}` : ''}]`, e.description ?? ''].filter(Boolean).join('\n');
function readLabel(label: string): { name: string; tech?: string; description?: string } {
  const [name = '', ...rest] = label.split('\n');
  const bracket = rest.findIndex((l) => /^\[.*\]$/.test(l.trim()));
  const tech = bracket >= 0 ? /^\[[^:\]]*(?::\s*(.*))?\]$/.exec(rest[bracket].trim())?.[1] : undefined;
  const description = rest.filter((_, i) => i !== bracket).join(' ').trim();
  return { name: name.trim(), ...(tech ? { tech } : {}), ...(description ? { description } : {}) };
}
const relationLabel = (r: C4Relation) => `${r.label}${r.tech ? ` [${r.tech}]` : ''}`.slice(0, 200);

/** A C4 model laid out afresh as board things (as corkboard-ui's layoutC4). */
export function layoutC4(data: C4Data): Layout {
  c4().layoutDiagram(data);
  const at = (x = 0, y = 0) => ({ x: Math.round(PAD + x * S), y: Math.round(TITLE + y * S) });
  const size = (w = 0, h = 0) => ({ w: Math.max(1, Math.round(w * S)), h: Math.max(1, Math.round(h * S)) });
  const shown = [...data.groups.filter((g) => !g._hidden), ...data.elements.filter((e) => !e._hidden)];
  const right = Math.max(...shown.map((t) => (t.x ?? 0) + (t.w ?? 0)));
  const bottom = Math.max(...shown.map((t) => (t.y ?? 0) + (t.h ?? 0)));
  const keys = Object.entries(data.colorKey ?? {});
  const legendH = keys.length ? 48 : 0;
  const diagram = { w: Math.round(PAD * 2 + right * S), h: Math.round(TITLE + bottom * S + PAD + legendH) };
  const frames: NonNullable<Layout['frames']> = [
    {
      key: 'diagram',
      title: (data.title?.trim() || 'System landscape').slice(0, 200),
      x: 0,
      y: 0,
      ...diagram,
      look: 'outline',
      part: { role: 'diagram', key: 'diagram', type: 'c4', ...(data.arrange ? { extra: { arrange: data.arrange } } : {}) },
    },
  ];
  const groupBox = new Map<string, { x: number; y: number }>();
  const depth = (g: C4Group, n = 0): number => (g.parent && n < 5 ? 1 + depth(data.groups.find((p) => p.id === g.parent) ?? { id: '', name: '', kind: '' }, n + 1) : 0);
  for (const g of [...data.groups].sort((a, b) => depth(a) - depth(b))) {
    const box = { ...at(g.x, g.y), ...size(g.w, g.h) };
    groupBox.set(g.id, box);
    const extra: Record<string, string | boolean> = { kind: g.kind === 'system' ? 'system' : 'boundary' };
    if (g._collapsed) extra['collapsed'] = true;
    if (g._hidden) extra['hidden'] = true;
    if (g.parent) extra['parent'] = g.parent;
    if (g.color) extra['color'] = g.color;
    if (g.core) extra['core'] = true;
    if (g.side) extra['side'] = g.side;
    frames.push({
      key: `group:${g.id}`,
      title: g.name.slice(0, 200),
      ...box,
      look: g._collapsed ? 'card' : 'outline',
      border: g.kind === 'boundary' ? 'dashed' : 'solid',
      ...(g._collapsed || g.color ? { fill: g.color && /^[1-9]$/.test(g.color) ? SLOT_COLOURS[Number(g.color) - 1] : 'blue' } : {}),
      part: { role: 'group', key: g.id, extra },
    });
  }
  const shapes: NonNullable<Layout['shapes']> = data.elements.map((e) => {
    const extra: Record<string, string | boolean> = {};
    if (e.group) extra['group'] = e.group;
    if (e.icon) extra['icon'] = e.icon;
    if (e.color) extra['color'] = e.color;
    if (e.core) extra['core'] = true;
    if (e.side) extra['side'] = e.side;
    if (e._hidden) extra['hidden'] = true;
    const home = e._hidden && e.group ? groupBox.get(e.group) : undefined;
    return {
      key: e.id,
      shape: KIND_SHAPE[e.kind] ?? 'rect',
      color: colourOf(e),
      label: elementLabel(e).slice(0, 2000),
      ...(home ? { x: home.x, y: home.y, w: Math.round(156 * S), h: Math.round(112 * S) } : { ...at(e.x, e.y), ...size(e.w, e.h) }),
      part: { role: 'step' as const, key: e.id, type: e.kind, ...(Object.keys(extra).length ? { extra } : {}) },
    };
  });
  const arrows: NonNullable<Layout['arrows']> = data.relations.map((r) => ({
    from: r.from,
    to: r.to,
    route: 'elbow',
    dash: r.async ? 'dashed' : 'solid',
    weight: 2,
    start: 'none',
    end: 'arrow',
    ...(r.label ? { label: relationLabel(r) } : {}),
  }));
  const texts: NonNullable<Layout['texts']> = [];
  keys.forEach(([slot, name], i) => {
    const x = PAD + i * 200;
    const y = diagram.h - legendH + 8;
    shapes.push({ key: `legend:${slot}`, shape: 'rect', color: SLOT_COLOURS[Number(slot) - 1] ?? 'blue', label: '', x, y, w: 24, h: 24, part: { role: 'legend', key: `legend:${slot}` } });
    texts.push({ key: `legend-name:${slot}`, text: name.slice(0, 60), size: 'sm', x: x + 32, y: Math.max(0, y - 2), w: 160, part: { role: 'legend', key: `legend-name:${slot}` } });
  });
  const notes: NonNullable<Layout['notes']> = (data.notes ?? []).map((n, i) => ({
    key: `note:${n.id}`,
    text: n.text.slice(0, 2000),
    color: 'yellow' as const,
    x: i * (NOTE.w + NOTE.gap),
    y: diagram.h + NOTE.gap * 2,
    w: NOTE.w,
    h: NOTE.h,
    part: { role: 'note' as const, key: n.id },
  }));
  for (const n of data.notes ?? []) for (const id of n.elements ?? []) arrows.push({ from: `note:${n.id}`, to: id, route: 'straight', dash: 'dotted', start: 'none', end: 'none', weight: 1 });
  return { frames, shapes, texts, notes, arrows };
}

// ── On the board ────────────────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number };
const centreIn = (b: Box, f: Box) => b.x + b.w / 2 >= f.x && b.x + b.w / 2 <= f.x + f.w && b.y + b.h / 2 >= f.y && b.y + b.h / 2 <= f.y + f.h;
const xs = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The C4 diagrams on the board: their outer frames' ids. */
export function c4sOn(doc: Y.Doc): string[] {
  const ids: string[] = [];
  nodesOf(doc).forEach((node, id) => {
    const part = node instanceof Y.Map ? partOf(node.get('part')) : null;
    if (part?.role === 'diagram' && part.of === id && part.type === 'c4' && node.get('kind') === 'frame') ids.push(id);
  });
  return ids;
}

/** A C4 diagram on the board read back as the skill's model (as corkboard-ui's readC4, without positions). */
export function readC4(doc: Y.Doc, diagramId: string): C4Data | null {
  const frame = nodesOf(doc).get(diagramId);
  const own = frame instanceof Y.Map ? partOf(frame.get('part')) : null;
  if (!frame || own?.role !== 'diagram' || own.type !== 'c4') return null;
  const parts = partsOf(doc, diagramId);
  const groupFrames = parts.filter((p) => p.part.role === 'group' && p.node.get('kind') === 'frame');
  const groups: C4Group[] = groupFrames.map((g) => {
    const x = g.part.extra ?? {};
    return {
      id: g.part.key,
      name: str(g.node.get('title')),
      kind: x['kind'] === 'system' ? 'system' : 'boundary',
      ...(xs(x['parent']) ? { parent: xs(x['parent']) } : {}),
      collapsed: x['collapsed'] === true,
      ...(xs(x['color']) ? { color: xs(x['color']) } : {}),
      ...(x['core'] === true ? { core: true } : {}),
      ...(xs(x['side']) ? { side: xs(x['side']) } : {}),
    };
  });
  const shapes = parts.filter((p) => p.part.role === 'step' && p.node.get('kind') === 'shape').sort((a, b) => a.y - b.y || a.x - b.x);
  const keyOf = new Map(shapes.map((s) => [s.id, s.part.key]));
  const elements: C4Element[] = shapes.map((s) => {
    const x = s.part.extra ?? {};
    const hidden = x['hidden'] === true;
    const inside = groupFrames.filter((g) => g.part.extra?.['collapsed'] !== true && centreIn(s, g)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const recorded = xs(x['group']);
    const group = hidden ? recorded : (inside?.part.key ?? (recorded && groupFrames.some((g) => g.part.key === recorded && g.part.extra?.['collapsed'] === true) ? recorded : undefined));
    return {
      id: s.part.key,
      kind: (C4_KINDS as readonly string[]).includes(s.part.type ?? '') ? s.part.type! : 'system',
      ...readLabel(str(s.node.get('label'))),
      ...(group ? { group } : {}),
      ...(xs(x['icon']) ? { icon: xs(x['icon']) } : {}),
      ...(xs(x['color']) ? { color: xs(x['color']) } : {}),
      ...(x['core'] === true ? { core: true } : {}),
      ...(xs(x['side']) ? { side: xs(x['side']) } : {}),
    };
  });
  const relations: C4Relation[] = [];
  nodesOf(doc).forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'connector') return;
    const from = keyOf.get(str(node.get('from')));
    const to = keyOf.get(str(node.get('to')));
    if (!from || !to) return;
    const m = /^(.*?)(?:\s*\[([^\]]*)\])?$/.exec(str(node.get('label')).trim());
    relations.push({ from, to, label: (m?.[1] ?? '').trim(), ...(m?.[2] ? { tech: m[2].trim() } : {}), ...(node.get('dash') === 'dashed' || node.get('dash') === 'dotted' ? { async: true } : {}) });
  });
  const colorKey: Record<string, string> = {};
  for (const swatch of parts.filter((p) => p.part.role === 'legend' && p.node.get('kind') === 'shape')) {
    const slot = swatch.part.key.replace(/^legend:/, '');
    const name = parts.find((p) => p.part.key === `legend-name:${slot}`);
    if (name) colorKey[slot] = str(name.node.get('text'));
  }
  const notes = parts
    .filter((p) => p.part.role === 'note' && p.node.get('kind') === 'note')
    .map((n) => {
      const elements: string[] = [];
      nodesOf(doc).forEach((c) => {
        if (c instanceof Y.Map && c.get('kind') === 'connector' && c.get('from') === n.id && keyOf.has(str(c.get('to')))) elements.push(keyOf.get(str(c.get('to')))!);
      });
      const text = n.node.get('text');
      return { id: n.part.key, text: text instanceof Y.XmlFragment ? fragmentText(text) : '', elements };
    });
  const arrange = xs(own.extra?.['arrange']);
  return {
    diagramType: 'c4',
    schemaVersion: 1,
    title: str(frame.get('title')),
    ...(arrange ? { arrange } : {}),
    ...(Object.keys(colorKey).length ? { colorKey } : {}),
    groups,
    elements,
    relations,
    ...(notes.length ? { notes } : {}),
  };
}

/** A C4 diagram on the board as the skill's JSON model, every level of it. */
export function c4Json(doc: Y.Doc, diagramId: string): string | null {
  const data = readC4(doc, diagramId);
  return data ? JSON.stringify(data) : null;
}

/** Rewrites a C4 diagram on the board from a new model, where it is; things kept by id stay the same board things. */
export function rewriteC4(doc: Y.Doc, diagramId: string, data: C4Data, author = 'assistant'): void {
  rewriteLayout(doc, diagramId, layoutC4(data), author);
}

// ── Checks ──────────────────────────────────────────────────────────────────

const LIMITS = { label: 40, children: 12, visible: 80, depth: 2 };

/**
 * What's wrong with a C4 model, for the assistant to fix: the Ultimate Diagram skill's C4 audit and the checkable parts
 * of its writing rules and budgets (references/types/c4.md, scripts/audit_c4.py).
 */
export function c4Checks(data: C4Data): string[] {
  const out: string[] = [];
  const ids = [...data.groups.map((g) => g.id), ...data.elements.map((e) => e.id)];
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) out.push(`The id "${id}" is used twice: ids are unique across groups and elements.`);
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const elements = new Map(data.elements.map((e) => [e.id, e]));
  for (const g of data.groups) {
    if (g.kind !== 'boundary' && g.kind !== 'system') out.push(`Group "${g.id}" is a ${g.kind}: use boundary or system (containers inside containers aren't drawn).`);
    if (g.parent && !groups.has(g.parent)) out.push(`Group "${g.id}" is inside "${g.parent}", which isn't a group.`);
    let depth = 0;
    for (let p = g.parent, seen = new Set([g.id]); p; p = groups.get(p)?.parent) {
      if (seen.has(p)) {
        out.push(`Group "${g.id}" is inside itself: a group can't contain itself.`);
        break;
      }
      seen.add(p);
      depth++;
    }
    if (depth >= LIMITS.depth) out.push(`Group "${g.id}" is nested ${depth + 1} deep: groups nest at most ${LIMITS.depth} deep.`);
    const children = data.elements.filter((e) => e.group === g.id).length + data.groups.filter((c) => c.parent === g.id).length;
    if (!g.collapsed && children > LIMITS.children) out.push(`Group "${g.id}" has ${children} things in it (at most ${LIMITS.children}): split it into smaller groups.`);
  }
  for (const e of data.elements) {
    if (!(C4_KINDS as readonly string[]).includes(e.kind)) out.push(`Element "${e.id}" is a ${e.kind}: use person, system, container, database, queue or external.`);
    if (e.group && !groups.has(e.group)) out.push(`Element "${e.id}" is in group "${e.group}", which doesn't exist.`);
    if (e.kind === 'external' && e.group && groups.get(e.group)?.kind === 'system') out.push(`External "${e.id}" is inside the system "${e.group}": outside systems live outside it.`);
    if (!data.relations.some((r) => r.from === e.id || r.to === e.id)) out.push(`${e.kind === 'person' ? 'Person' : 'Element'} "${e.id}" has no relation: connect it or remove it.`);
  }
  const seen = new Set<string>();
  for (const r of data.relations) {
    const what = `${r.from} -> ${r.to}`;
    for (const end of [r.from, r.to]) if (!elements.has(end)) out.push(`The relation ${what} points at "${end}", which isn't an element (relations join elements, not groups).`);
    if (!r.label?.trim()) out.push(`The relation ${what} has no label: every arrow says what it does.`);
    if (r.from === r.to) out.push(`The relation ${what} joins an element to itself.`);
    const containers = ['container', 'database', 'queue'];
    if (containers.includes(elements.get(r.from)?.kind ?? '') && containers.includes(elements.get(r.to)?.kind ?? '') && !r.tech) out.push(`The relation ${what} joins two containers with no tech: add the protocol (REST, gRPC, AMQP, SQL).`);
    if ((r.label ?? '').length > LIMITS.label) out.push(`The relation ${what} has a label over ${LIMITS.label} characters: shorten it.`);
    const key = `${what}|${r.label}`;
    if (seen.has(key)) out.push(`The relation ${what} appears twice with the label "${r.label}": merge or relabel.`);
    seen.add(key);
  }
  if (data.arrange && !['surround', 'flow', 'layers'].includes(data.arrange)) out.push(`Arrange "${data.arrange}" isn't one: use surround, flow or layers.`);
  if (data.arrange === 'layers') for (const e of data.elements) if (!e.group) out.push(`Element "${e.id}" isn't in a layer: with arrange "layers" every element sits in a top-level group.`);
  const hiddenBy = (e: C4Element) => {
    for (let g = e.group ? groups.get(e.group) : undefined; g; g = g.parent ? groups.get(g.parent) : undefined) if (g.collapsed) return true;
    return false;
  };
  const visible = data.elements.filter((e) => !hiddenBy(e)).length;
  if (visible > LIMITS.visible) out.push(`${visible} elements show at once (at most ${LIMITS.visible}): set collapsed on system groups so it opens at level 1.`);
  for (const n of data.notes ?? []) if (n.text.length > 120) out.push(`Note ${n.id} is ${n.text.length} characters (at most 120).`);
  return out;
}

/** C4 text read and checked; throws (for the model to see) when it can't be read. */
export function readC4Source(source: string): { data: C4Data; checks: string[] } {
  const parsed = parseC4(source);
  if ('error' in parsed) throw new Error(`The C4 diagram couldn't be read: ${parsed.error}`);
  return { data: parsed.data, checks: [...parsed.warnings, ...c4Checks(parsed.data)] };
}
