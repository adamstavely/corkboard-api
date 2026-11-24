import * as Y from 'yjs';
import type { NoteColor } from '../assist/board-edit';
import { fragmentText } from '../boards/board-text';
import { entityColumns, partOf, type ArrowHead, type EntityColumn, type Layout } from '../boards/layout';
import { nodesOf, partsOf, rewriteLayout, str } from './flowchart';
import { erdEngine } from './vendor/erd';

/**
 * Editable ER diagrams, as corkboard-ui draws them (its diagrams/erd.ts; keep the geometry and the arrows' looks in step):
 * Mermaid erDiagram, laid out by the Ultimate Diagram skill's ER engine (vendor/).
 */

const TOKENS = { font: { metrics: { label: 7.4, title: 7.4, detail: 6.4, note: 6.2, type: 6.6, edgeLabel: 7, edgeWrap: 6.6 } } };

type End = 'one' | 'zeroOrOne' | 'oneOrMany' | 'zeroOrMany';
export interface ErEntity {
  id: string;
  name?: string;
  columns: EntityColumn[];
  color?: string;
  box?: { x: number; y: number; w: number; h: number };
}
export interface ErRelationship {
  from: string;
  to: string;
  fromEnd: End;
  toEnd: End;
  identifying?: boolean;
  label?: string;
  columns?: string[];
}
export interface ErData {
  diagramType: 'erd';
  title?: string;
  colorKey?: Record<string, string>;
  detail?: 'keys' | 'names';
  showTypes?: boolean;
  entities: ErEntity[];
  relationships: ErRelationship[];
  notes?: { id: string; text: string; entities?: string[] }[];
}
interface ErEngine {
  layoutDiagram(data: ErData): void;
  fromMermaid(text: string): { data: ErData; infos: string[]; warnings: string[] };
  toMermaid(data: ErData, opts?: object): string;
  mmdErDerive(child: ErEntity, parent: ErEntity, label: string): string[];
}
let engine: ErEngine | undefined;
const er = (): ErEngine => (engine ??= erdEngine(TOKENS) as ErEngine);

const S = 1.25;
const PAD = 24;
const TITLE = 56;
const NOTE = { w: 220, h: 140, gap: 24 };
const SLOT_COLOURS: NoteColor[] = ['blue', 'green', 'yellow', 'purple', 'pink', 'gray', 'blue', 'green'];
const slotColour = (slot?: string): NoteColor => SLOT_COLOURS[(Number(slot) || 1) - 1] ?? 'blue';
const colourSlot = (c: string) => String(SLOT_COLOURS.indexOf(c as NoteColor) + 1 || 1);
const HEAD: Record<End, ArrowHead> = { one: 'one', zeroOrOne: 'zeroOne', oneOrMany: 'oneMany', zeroOrMany: 'zeroMany' };
const END: Partial<Record<string, End>> = { one: 'one', zeroOne: 'zeroOrOne', oneMany: 'oneOrMany', zeroMany: 'zeroOrMany' };

/** Whether Mermaid text is an ER diagram. */
export const isErdSource = (text: string): boolean => /^\s*erDiagram\b/m.test(text.replace(/^---[\s\S]*?---/, ''));

/** Mermaid read as an ER diagram, with the reader's warnings; or why it can't be read. */
export function parseErd(text: string): { data: ErData; warnings: string[] } | { error: string } {
  try {
    const { data, warnings } = er().fromMermaid(text);
    if (!data.entities?.length) return { error: 'The ER diagram has no tables.' };
    return { data, warnings: warnings.map((w) => w.replace(/^\[WARN\]\s*/, '')) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The ER diagram could not be read.' };
  }
}

/** An ER model laid out afresh as board things (as corkboard-ui's layoutErd). */
export function layoutErd(data: ErData): Layout {
  er().layoutDiagram(data);
  const boxes = data.entities.map((e) => e.box ?? { x: 0, y: 0, w: 168, h: 100 });
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const keys = Object.entries(data.colorKey ?? {});
  const legendH = keys.length ? 48 : 0;
  const diagram = { w: Math.round(PAD * 2 + right * S), h: Math.round(TITLE + bottom * S + PAD + legendH) };
  const extra: Record<string, string | boolean> = {};
  if (data.detail) extra['detail'] = data.detail;
  if (data.showTypes === false) extra['hideTypes'] = true;
  const shapes: NonNullable<Layout['shapes']> = [];
  const texts: NonNullable<Layout['texts']> = [];
  keys.forEach(([slot, name], i) => {
    const x = PAD + i * 200;
    const y = diagram.h - legendH + 8;
    shapes.push({ key: `legend:${slot}`, shape: 'rect', color: slotColour(slot), label: '', x, y, w: 24, h: 24, part: { role: 'legend', key: `legend:${slot}` } });
    texts.push({ key: `legend-name:${slot}`, text: name.slice(0, 60), size: 'sm', x: x + 32, y: Math.max(0, y - 2), w: 160, part: { role: 'legend', key: `legend-name:${slot}` } });
  });
  const arrows: NonNullable<Layout['arrows']> = data.relationships.map((r) => ({
    from: r.from,
    to: r.to,
    route: 'curve',
    dash: r.identifying ? 'solid' : 'dashed',
    weight: 2,
    start: HEAD[r.fromEnd] ?? 'zeroMany',
    end: HEAD[r.toEnd] ?? 'one',
    ...(r.label ? { label: r.label.slice(0, 200) } : {}),
  }));
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
  for (const n of data.notes ?? []) for (const id of n.entities ?? []) arrows.push({ from: `note:${n.id}`, to: id, route: 'straight', dash: 'dotted', start: 'none', end: 'none', weight: 1 });
  return {
    frames: [{ key: 'diagram', title: (data.title?.trim() || 'Data model').slice(0, 200), x: 0, y: 0, ...diagram, look: 'outline', part: { role: 'diagram', key: 'diagram', type: 'erd', ...(Object.keys(extra).length ? { extra } : {}) } }],
    entities: data.entities.map((e, i) => ({
      key: e.id,
      name: (e.name ?? e.id).slice(0, 80),
      columns: entityColumns(e.columns),
      color: slotColour(e.color),
      x: Math.round(PAD + boxes[i].x * S),
      y: Math.round(TITLE + boxes[i].y * S),
      w: Math.max(1, Math.round(boxes[i].w * S)),
      h: Math.max(1, Math.round(boxes[i].h * S)),
      part: { role: 'step', key: e.id, type: 'table' },
    })),
    shapes,
    texts,
    notes,
    arrows,
  };
}

/** The ER diagrams on the board: their outer frames' ids. */
export function erdsOn(doc: Y.Doc): string[] {
  const ids: string[] = [];
  nodesOf(doc).forEach((node, id) => {
    const part = node instanceof Y.Map ? partOf(node.get('part')) : null;
    if (part?.role === 'diagram' && part.of === id && part.type === 'erd' && node.get('kind') === 'frame') ids.push(id);
  });
  return ids;
}

/** An ER diagram on the board read back as its model (as corkboard-ui's readErd, without positions). */
export function readErd(doc: Y.Doc, diagramId: string): ErData | null {
  const frame = nodesOf(doc).get(diagramId);
  const own = frame instanceof Y.Map ? partOf(frame.get('part')) : null;
  if (!frame || own?.role !== 'diagram' || own.type !== 'erd') return null;
  const parts = partsOf(doc, diagramId);
  const tables = parts.filter((p) => p.part.role === 'step' && p.node.get('kind') === 'entity').sort((a, b) => a.y - b.y || a.x - b.x);
  const keyOf = new Map(tables.map((t) => [t.id, t.part.key]));
  const entities: ErEntity[] = tables.map((t) => {
    const name = str(t.node.get('name'));
    return { id: t.part.key, ...(name && name !== t.part.key ? { name } : {}), columns: entityColumns(t.node.get('columns')), color: colourSlot(str(t.node.get('color'))) };
  });
  const byKey = new Map(entities.map((e) => [e.id, e]));
  const relationships: ErRelationship[] = [];
  nodesOf(doc).forEach((node) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'connector') return;
    const from = keyOf.get(str(node.get('from')));
    const to = keyOf.get(str(node.get('to')));
    if (!from || !to) return;
    const label = str(node.get('label'));
    // Its join columns, found as the skill's reader finds them (customer_id joins customer).
    const columns = er().mmdErDerive(byKey.get(from)!, byKey.get(to)!, label);
    relationships.push({
      from,
      to,
      fromEnd: END[str(node.get('start'))] ?? 'zeroOrMany',
      toEnd: END[str(node.get('end'))] ?? 'one',
      identifying: node.get('dash') === 'solid',
      ...(label ? { label } : {}),
      ...(columns.length ? { columns } : {}),
    });
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
      const entities: string[] = [];
      nodesOf(doc).forEach((c) => {
        if (c instanceof Y.Map && c.get('kind') === 'connector' && c.get('from') === n.id && keyOf.has(str(c.get('to')))) entities.push(keyOf.get(str(c.get('to')))!);
      });
      const text = n.node.get('text');
      return { id: n.part.key, text: text instanceof Y.XmlFragment ? fragmentText(text) : '', entities };
    });
  const extra = own.extra ?? {};
  return {
    diagramType: 'erd',
    title: str(frame.get('title')),
    ...(Object.keys(colorKey).length ? { colorKey } : {}),
    ...(extra['detail'] === 'keys' || extra['detail'] === 'names' ? { detail: extra['detail'] } : {}),
    ...(extra['hideTypes'] === true ? { showTypes: false } : {}),
    entities,
    relationships,
    ...(notes.length ? { notes } : {}),
  };
}

/** An ER diagram on the board written as Mermaid. */
export function erdMermaid(doc: Y.Doc, diagramId: string): string | null {
  const data = readErd(doc, diagramId);
  return data ? er().toMermaid(data, {}) : null;
}

/** Rewrites an ER diagram on the board from a new model, where it is; tables kept by id stay the same board things. */
export function rewriteErd(doc: Y.Doc, diagramId: string, data: ErData, author = 'assistant'): void {
  rewriteLayout(doc, diagramId, layoutErd(data), author);
}

// ── Checks ──────────────────────────────────────────────────────────────────

/**
 * What's wrong with an ER model, for the assistant to fix: the Ultimate Diagram skill's ER audit and the checkable parts
 * of its writing rules (references/types/erd.md, scripts/audit_erd.py).
 */
export function erdChecks(data: ErData): string[] {
  const out: string[] = [];
  const ids = data.entities.map((e) => e.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) out.push(`The table "${id}" is written twice.`);
  const tables = new Map(data.entities.map((e) => [e.id, e]));
  for (const e of data.entities) {
    const names = e.columns.map((c) => c.name);
    for (const n of new Set(names)) if (names.filter((x) => x === n).length > 1) out.push(`Table "${e.id}" has the column "${n}" twice.`);
    if (!e.columns.some((c) => c.pk)) out.push(`Table "${e.id}" has no primary key: mark one PK, or say why in a note on the table.`);
    for (const c of e.columns) if ((c.note ?? '').length > 120) out.push(`The note on "${e.id}.${c.name}" is over 120 characters.`);
  }
  const used = new Map<string, Set<string>>();
  for (const r of data.relationships) {
    const what = `${r.from} -> ${r.to}`;
    for (const end of [r.from, r.to]) if (!tables.has(end)) out.push(`The relationship ${what} names the table "${end}", which isn't there.`);
    const cols = r.columns ?? [];
    if (r.from === r.to && !cols.length) out.push(`The relationship ${what} is a self-reference without its column: name the FK column, as [manager_id] in the label.`);
    const child = tables.get(r.from);
    for (const n of cols) {
      used.set(r.from, (used.get(r.from) ?? new Set()).add(n));
      const col = child?.columns.find((c) => c.name === n);
      if (child && col && !col.fk) out.push(`The relationship ${what} joins on "${r.from}.${n}", which isn't marked FK.`);
    }
    if (child && cols.length && cols.every((n) => child.columns.find((c) => c.name === n)?.pk) && !r.identifying) out.push(`The relationship ${what} joins on primary key columns only, so it is identifying: draw it with -- not ..`);
  }
  for (const e of data.entities) for (const c of e.columns) if (c.fk && !used.get(e.id)?.has(c.name)) out.push(`"${e.id}.${c.name}" is marked FK but no relationship uses it: add the relationship, or drop FK.`);
  if (data.entities.length > 8 && !data.entities.some((e) => e.color && e.color !== '1')) out.push(`${data.entities.length} tables in one colour: colour them by domain (class a,b c2) and name each colour with %% @colorKey.`);
  for (const n of data.notes ?? []) for (const id of n.entities ?? []) if (!tables.has(id)) out.push(`Note ${n.id} is on the table "${id}", which isn't there.`);
  return out;
}

/** Mermaid read as an ER diagram and checked; throws (for the model to see) when it can't be read. */
export function readErdSource(source: string): { data: ErData; checks: string[] } {
  const parsed = parseErd(source);
  if ('error' in parsed) throw new Error(`The ER diagram couldn't be read: ${parsed.error}`);
  return { data: parsed.data, checks: [...parsed.warnings, ...erdChecks(parsed.data)] };
}
