import * as Y from 'yjs';
import type { NoteColor } from '../assist/board-edit';
import { fragmentText } from '../boards/board-text';
import { partOf, type Layout } from '../boards/layout';
import { nodesOf, partsOf, rewriteLayout, str } from './flowchart';
import { usecaseEngine } from './vendor/usecase';

/**
 * Editable use case diagrams, as corkboard-ui draws them (its diagrams/usecase.ts; keep the geometry and the arrows' looks
 * in step): Mermaid marked `%% @type usecase`, laid out by the Ultimate Diagram skill's use case engine (vendor/).
 */

const TOKENS = { font: { metrics: { label: 7.4, title: 7.4, detail: 6.4, note: 6.2, type: 6.6, edgeLabel: 7, edgeWrap: 6.6 } } };

export interface UcActor {
  id: string;
  name: string;
  kind?: 'person' | 'system' | 'time';
  parent?: string;
  abstract?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}
export interface UcCase {
  id: string;
  name: string;
  subject?: string;
  color?: string;
  refs?: string[];
  level?: string;
  extensionPoints?: string[];
  parent?: string;
  abstract?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}
export interface UcLink {
  id: string;
  type: 'association' | 'include' | 'extend';
  from: string;
  to: string;
  condition?: string;
  extensionPoint?: string;
  navigable?: boolean;
}
export interface UcData {
  diagramType: 'usecase';
  title?: string;
  colorKey?: Record<string, string>;
  subjects: { id: string; name: string; x?: number; y?: number; w?: number; h?: number }[];
  actors: UcActor[];
  useCases: UcCase[];
  links: UcLink[];
  notes?: { id: string; text: string; useCases?: string[]; actors?: string[] }[];
}
interface UcEngine {
  layoutDiagram(data: UcData): void;
  fromMermaid(text: string): { data: UcData; infos: string[]; warnings: string[] };
  toMermaid(data: UcData, opts?: object): string;
}
let engine: UcEngine | undefined;
const ucEngine = (): UcEngine => (engine ??= usecaseEngine(TOKENS) as UcEngine);

const S = 1.25;
const PAD = 24;
const TITLE = 56;
const NOTE = { w: 220, h: 140, gap: 24 };
const SLOT_COLOURS: NoteColor[] = ['blue', 'green', 'yellow', 'purple', 'pink', 'gray', 'blue', 'green'];
const slotColour = (slot: string | undefined): NoteColor => SLOT_COLOURS[(Number(slot) || 1) - 1] ?? 'blue';
const colourSlot = (colour: string): string => String(SLOT_COLOURS.indexOf(colour as NoteColor) + 1 || 1);
const STEREOTYPE: Record<string, string> = { system: '«system»', time: '«time»' };

/** Whether Mermaid text is a use case diagram. */
export const isUsecaseSource = (text: string): boolean => /^\s*%%\s*@type\s+usecase\b/m.test(text) && /^\s*(flowchart|graph)\b/m.test(text);

/** Mermaid read as a use case diagram, with the reader's warnings; or why it can't be read. */
export function parseUsecase(text: string): { data: UcData; warnings: string[] } | { error: string } {
  try {
    const { data, warnings } = ucEngine().fromMermaid(text);
    if (!data.useCases?.length && !data.actors?.length) return { error: 'The use case diagram has no actors or use cases.' };
    return { data, warnings: warnings.map((w) => w.replace(/^\[WARN\]\s*/, '')) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The use case diagram could not be read.' };
  }
}

const linkLabel = (l: UcLink) =>
  l.type === 'include' ? '«include»' : l.type === 'extend' ? `«extend»${l.extensionPoint ? ` (${l.extensionPoint})` : ''}${l.condition ? `: ${l.condition}` : ''}` : '';

/** A use case diagram's model laid out afresh as board things, from the layout's top-left. */
export function layoutUsecase(data: UcData): Layout {
  ucEngine().layoutDiagram(data);
  const at = (x = 0, y = 0) => ({ x: Math.round(PAD + x * S), y: Math.round(TITLE + y * S) });
  const size = (w = 0, h = 0) => ({ w: Math.max(1, Math.round(w * S)), h: Math.max(1, Math.round(h * S)) });
  const things = [...data.subjects, ...data.actors, ...data.useCases];
  const right = Math.max(...things.map((t) => (t.x ?? 0) + (t.w ?? 0)));
  const bottom = Math.max(...things.map((t) => (t.y ?? 0) + (t.h ?? 0)));
  const keys = Object.entries(data.colorKey ?? {});
  const legendH = keys.length ? 48 : 0;
  const diagram = { w: Math.round(PAD * 2 + right * S), h: Math.round(TITLE + bottom * S + PAD + legendH) };
  const frames: NonNullable<Layout['frames']> = [
    { key: 'diagram', title: (data.title?.trim() || 'Use cases').slice(0, 200), x: 0, y: 0, ...diagram, look: 'outline', part: { role: 'diagram', key: 'diagram', type: 'usecase' } },
    ...data.subjects.map((s) => ({ key: `group:${s.id}`, title: s.name.slice(0, 200), ...at(s.x, s.y), ...size(s.w, s.h), look: 'card' as const, part: { role: 'group' as const, key: s.id } })),
  ];
  const shapes: NonNullable<Layout['shapes']> = [];
  for (const a of data.actors) {
    const person = !a.kind || a.kind === 'person';
    shapes.push({
      key: a.id,
      shape: person ? 'actor' : 'rect',
      color: 'gray',
      label: (person ? a.name : `${STEREOTYPE[a.kind!]}\n${a.name}`).slice(0, 2000),
      ...at(a.x, a.y),
      ...size(a.w, a.h),
      part: { role: 'step', key: a.id, type: person ? 'actor' : a.kind!, ...(a.abstract ? { extra: { abstract: true } } : {}) },
    });
  }
  for (const u of data.useCases) {
    const extra: Record<string, string | string[] | boolean> = {};
    if (u.refs?.length) extra['refs'] = u.refs;
    if (u.extensionPoints?.length) extra['points'] = u.extensionPoints;
    if (u.abstract) extra['abstract'] = true;
    shapes.push({
      key: u.id,
      shape: 'ellipse',
      color: slotColour(u.color),
      label: u.name.slice(0, 2000),
      ...at(u.x, u.y),
      ...size(u.w, u.h),
      part: { role: 'step', key: u.id, type: u.level === 'subfunction' ? 'subfunction' : 'usecase', ...(Object.keys(extra).length ? { extra } : {}) },
    });
  }
  const arrows: NonNullable<Layout['arrows']> = data.links.map((l) => ({
    from: l.from,
    to: l.to,
    route: 'curve',
    dash: l.type === 'association' ? 'solid' : 'dashed',
    weight: 2,
    start: 'none',
    end: l.type !== 'association' || l.navigable ? 'arrow' : 'none',
    ...(linkLabel(l) ? { label: linkLabel(l).slice(0, 200) } : {}),
  }));
  for (const t of [...data.actors, ...data.useCases]) if (t.parent) arrows.push({ from: t.id, to: t.parent, route: 'curve', start: 'none', end: 'triangle' });
  const texts: NonNullable<Layout['texts']> = [];
  keys.forEach(([slot, name], i) => {
    const x = PAD + i * 200;
    const y = diagram.h - legendH + 8;
    shapes.push({ key: `legend:${slot}`, shape: 'rect', color: slotColour(slot), label: '', x, y, w: 24, h: 24, part: { role: 'legend', key: `legend:${slot}` } });
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
  for (const n of data.notes ?? []) for (const id of [...(n.useCases ?? []), ...(n.actors ?? [])]) arrows.push({ from: `note:${n.id}`, to: id, route: 'straight', dash: 'dotted', start: 'none', end: 'none', weight: 1 });
  return { frames, shapes, texts, notes, arrows };
}

// ── On the board ────────────────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number };
const centreIn = (b: Box, f: Box) => b.x + b.w / 2 >= f.x && b.x + b.w / 2 <= f.x + f.w && b.y + b.h / 2 >= f.y && b.y + b.h / 2 <= f.y + f.h;

/** The use case diagrams on the board: their outer frames' ids. */
export function usecasesOn(doc: Y.Doc): string[] {
  const ids: string[] = [];
  nodesOf(doc).forEach((node, id) => {
    const part = node instanceof Y.Map ? partOf(node.get('part')) : null;
    if (part?.role === 'diagram' && part.of === id && part.type === 'usecase' && node.get('kind') === 'frame') ids.push(id);
  });
  return ids;
}

/** A use case diagram on the board read back as its model (as corkboard-ui's readUsecase does, without positions). */
export function readUsecase(doc: Y.Doc, diagramId: string): UcData | null {
  const frame = nodesOf(doc).get(diagramId);
  const own = frame instanceof Y.Map ? partOf(frame.get('part')) : null;
  if (!frame || own?.role !== 'diagram' || own.type !== 'usecase') return null;
  const parts = partsOf(doc, diagramId);
  const subjects = parts.filter((p) => p.part.role === 'group' && p.node.get('kind') === 'frame').sort((a, b) => a.y - b.y || a.x - b.x);
  const things = parts.filter((p) => p.part.role === 'step' && p.node.get('kind') === 'shape').sort((a, b) => a.y - b.y || a.x - b.x);
  const keyOf = new Map(things.map((t) => [t.id, t.part.key]));
  const links: UcLink[] = [];
  const parents = new Map<string, string>();
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'connector') return;
    const from = keyOf.get(str(node.get('from')));
    const to = keyOf.get(str(node.get('to')));
    if (!from || !to) return;
    const label = str(node.get('label'));
    if (node.get('end') === 'triangle') parents.set(from, to);
    else if (str(node.get('dash')) !== 'solid' && node.get('dash') !== undefined) {
      if (/extend/i.test(label)) {
        const m = /extend»?\s*(?:\(([^)]*)\))?\s*(?::\s*(.*))?$/i.exec(label);
        links.push({ id, type: 'extend', from, to, ...(m?.[1] ? { extensionPoint: m[1].trim() } : {}), ...(m?.[2] ? { condition: m[2].trim() } : {}) });
      } else links.push({ id, type: 'include', from, to });
    } else links.push({ id, type: 'association', from, to, ...(node.get('end') === 'arrow' ? { navigable: true } : {}) });
  });
  const actors: UcActor[] = [];
  const useCases: UcCase[] = [];
  for (const t of things) {
    const key = t.part.key;
    const extra = t.part.extra ?? {};
    const label = str(t.node.get('label'));
    if (t.part.type === 'usecase' || t.part.type === 'subfunction') {
      const subject = subjects.find((s) => centreIn(t, s));
      useCases.push({
        id: key,
        name: label,
        ...(subject ? { subject: subject.part.key } : {}),
        color: colourSlot(str(t.node.get('color'))),
        ...(Array.isArray(extra['refs']) ? { refs: extra['refs'] } : {}),
        ...(Array.isArray(extra['points']) ? { extensionPoints: extra['points'] } : {}),
        ...(extra['abstract'] === true ? { abstract: true } : {}),
        ...(t.part.type === 'subfunction' ? { level: 'subfunction' } : {}),
        ...(parents.has(key) ? { parent: parents.get(key) } : {}),
      });
    } else {
      const kind = t.part.type === 'system' || t.part.type === 'time' ? t.part.type : 'person';
      actors.push({
        id: key,
        name: kind === 'person' ? label : label.replace(/^«(system|time)»\s*/, ''),
        ...(kind === 'person' ? {} : { kind }),
        ...(extra['abstract'] === true ? { abstract: true } : {}),
        ...(parents.has(key) ? { parent: parents.get(key) } : {}),
      });
    }
  }
  const colorKey: Record<string, string> = {};
  for (const swatch of parts.filter((p) => p.part.role === 'legend' && p.node.get('kind') === 'shape')) {
    const slot = swatch.part.key.replace(/^legend:/, '');
    const name = parts.find((p) => p.part.key === `legend-name:${slot}`);
    if (name) colorKey[colourSlot(str(swatch.node.get('color')))] = str(name.node.get('text'));
  }
  const notes = parts
    .filter((p) => p.part.role === 'note' && p.node.get('kind') === 'note')
    .map((n) => {
      const joined: string[] = [];
      nodesOf(doc).forEach((c) => {
        if (c instanceof Y.Map && c.get('kind') === 'connector' && c.get('from') === n.id && keyOf.has(str(c.get('to')))) joined.push(keyOf.get(str(c.get('to')))!);
      });
      const text = n.node.get('text');
      return { id: n.part.key, text: text instanceof Y.XmlFragment ? fragmentText(text) : '', useCases: joined.filter((k) => useCases.some((u) => u.id === k)), actors: joined.filter((k) => actors.some((a) => a.id === k)) };
    });
  return {
    diagramType: 'usecase',
    title: str(frame.get('title')),
    ...(Object.keys(colorKey).length ? { colorKey } : {}),
    subjects: subjects.map((s) => ({ id: s.part.key, name: str(s.node.get('title')) })),
    actors,
    useCases,
    links,
    ...(notes.length ? { notes } : {}),
  };
}

/** A use case diagram on the board written as Mermaid. */
export function usecaseMermaid(doc: Y.Doc, diagramId: string): string | null {
  const data = readUsecase(doc, diagramId);
  return data ? ucEngine().toMermaid(data, {}) : null;
}

/** Rewrites a use case diagram on the board from a new model, where it is; things kept by id stay the same board things. */
export function rewriteUsecase(doc: Y.Doc, diagramId: string, data: UcData, author = 'assistant'): void {
  rewriteLayout(doc, diagramId, layoutUsecase(data), author);
}

// ── Checks ──────────────────────────────────────────────────────────────────

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** A use case's goal, without its requirement id ("FR-01: Check out" → "Check out"). */
const goalOf = (name: string) => name.replace(/^[A-Z][A-Z0-9]*-?\d+[A-Za-z0-9.-]*:\s*/, '');
const CRUD = /^(create|add|read|view|see|update|edit|change|delete|remove)\s+(.+)$/i;

/**
 * What's wrong with a use case diagram as written, for the assistant to fix: the Ultimate Diagram skill's use case
 * audit and the checkable parts of its writing rules (references/types/usecase.md, scripts/audit_usecase.py).
 */
export function usecaseChecks(data: UcData): string[] {
  const out: string[] = [];
  const actors = new Map(data.actors.map((a) => [a.id, a]));
  const cases = new Map(data.useCases.map((u) => [u.id, u]));
  const name = (id: string) => `"${actors.get(id)?.name ?? cases.get(id)?.name ?? id}"`;
  for (const l of data.links) {
    const ends = [l.from, l.to];
    if (l.type === 'association' && !(ends.some((e) => actors.has(e)) && ends.some((e) => cases.has(e))))
      out.push(`The association ${name(l.from)} — ${name(l.to)} should join an actor to a use case.`);
    if (l.type !== 'association' && !ends.every((e) => cases.has(e))) out.push(`The «${l.type}» from ${name(l.from)} to ${name(l.to)} should join two use cases.`);
    if (l.type === 'extend' && l.extensionPoint && !(cases.get(l.to)?.extensionPoints ?? []).includes(l.extensionPoint))
      out.push(`The «extend» into ${name(l.to)} names the extension point "${l.extensionPoint}", which ${name(l.to)} doesn't list: add %% @points ${l.to} ${l.extensionPoint}.`);
  }
  // Everyone takes part, and every goal is reached.
  for (const a of data.actors) {
    const takesPart = data.links.some((l) => l.type === 'association' && (l.from === a.id || l.to === a.id)) || data.actors.some((b) => b.parent === a.id) || !!a.parent;
    if (!takesPart) out.push(`Actor ${name(a.id)} has no association: join it to the use cases it takes part in, or remove it.`);
    if (words(a.name) > 3) out.push(`Actor ${name(a.id)} has ${words(a.name)} words (at most 3): name the role, and put qualifiers in a note.`);
  }
  const reached = new Set<string>();
  for (const l of data.links) if (l.type === 'association') for (const e of [l.from, l.to]) if (cases.has(e)) reached.add(e);
  for (let changed = true; changed; ) {
    changed = false;
    for (const l of data.links) {
      const pairs = l.type === 'include' ? [[l.from, l.to]] : l.type === 'extend' ? [[l.to, l.from]] : [];
      for (const [from, to] of pairs) {
        if (reached.has(from) && !reached.has(to)) {
          reached.add(to);
          changed = true;
        }
      }
    }
    for (const u of data.useCases) {
      if (u.parent && reached.has(u.parent) && !reached.has(u.id)) {
        reached.add(u.id);
        changed = true;
      }
    }
  }
  for (const u of data.useCases) {
    if (!reached.has(u.id)) out.push(`Use case ${name(u.id)} isn't reached by any actor: give it an association, or join it with «include», «extend» or "is a".`);
    if (words(goalOf(u.name)) > 5) out.push(`Use case ${name(u.id)} has ${words(goalOf(u.name))} words (at most 5): a verb and its object.`);
    if (u.color && u.color !== '1' && !data.colorKey?.[u.color]) out.push(`Use case ${name(u.id)} is coloured c${u.color}, which the colour key doesn't name: add %% @colorKey ${u.color} <feature area>.`);
  }
  // Create/read/update/delete of one thing is one goal.
  const crud = new Map<string, string[]>();
  for (const u of data.useCases) {
    const m = CRUD.exec(goalOf(u.name).trim());
    if (m) crud.set(m[2].toLowerCase(), [...(crud.get(m[2].toLowerCase()) ?? []), u.id]);
  }
  for (const [object, ids] of crud) if (ids.length >= 3) out.push(`${ids.map(name).join(', ')} are one goal: make them "Manage ${object}" unless different actors or rules apply.`);
  // «include» never loops.
  const includes = (from: string, seen: Set<string>): boolean =>
    data.links.some((l) => l.type === 'include' && l.from === from && (seen.has(l.to) || includes(l.to, new Set([...seen, l.to]))));
  for (const u of data.useCases) if (includes(u.id, new Set([u.id]))) {
    out.push(`«include» runs in a circle from ${name(u.id)}: an included use case never includes its includer.`);
    break;
  }
  for (const n of data.notes ?? []) {
    if (!n.text.trim()) out.push(`Note ${n.id} has no text: remove it.`);
    if (n.text.length > 120) out.push(`Note ${n.id} is ${n.text.length} characters (at most 120).`);
    if (!(n.useCases?.length || n.actors?.length)) out.push(`Note ${n.id} is joined to nothing: join it with -.- to what it explains.`);
  }
  return out;
}

/** Mermaid read as a use case diagram and checked; throws (for the model to see) when it can't be read. */
export function readUsecaseSource(source: string): { data: UcData; checks: string[] } {
  const parsed = parseUsecase(source);
  if ('error' in parsed) throw new Error(`The use case diagram couldn't be read: ${parsed.error}`);
  return { data: parsed.data, checks: [...parsed.warnings, ...usecaseChecks(parsed.data)] };
}

