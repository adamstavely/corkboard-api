import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { newNote, paragraphs, topZ, type NoteColor } from '../assist/board-edit';
import { fragmentText } from '../boards/board-text';
import { applyLayout, entityColumns, MAX_ARROW_LABEL, partOf, TEXT_SIZES, type Layout, type Part, type ShapeKind } from '../boards/layout';
import { flowchartEngine } from './vendor/flowchart';

/**
 * Editable swimlane flowcharts, as corkboard-ui draws them (its diagrams/flowchart.ts and flow-board.ts; keep the
 * geometry in step): the Ultimate Diagram skill's reader and layout engine (vendor/) turn Mermaid into lanes and steps
 * with positions, which become board things tagged with their part in the diagram.
 */

const TOKENS = {
  font: {
    metrics: {
      label: 7.4,
      title: 7.4,
      detail: 6.4,
      note: 6.2,
      type: 6.6,
      edgeLabel: 7,
      edgeWrap: 6.6,
    },
  },
};

export interface FlowLane {
  id: string;
  name: string;
  height?: number;
}
export interface FlowNode {
  id: string;
  laneId?: string;
  type: string;
  label: string;
  /** What a BPMN step is beyond its engine type (its element and marker), kept in its part. */
  extra?: Record<string, string | string[] | boolean>;
  x?: number;
  y?: number;
}
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  feedback?: boolean;
  /** A BPMN message flow (between pools): dashed. */
  message?: boolean;
}
export interface FlowNote {
  id: string;
  text: string;
  nodes: string[];
}
export interface FlowData {
  diagramType?: string;
  title?: string;
  direction?: 'LR' | 'TB';
  swimlanes?: boolean;
  lanes: FlowLane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  notes?: FlowNote[];
  children?: Record<string, unknown>;
}
interface FlowEngine {
  layoutDiagram(data: FlowData): void;
  LE: { NODE_W: number; NODE_H: number; DEC_H: number; START_X: number };
  fromMermaid(text: string): {
    data: FlowData;
    infos: string[];
    warnings: string[];
  };
  toMermaid(data: FlowData, opts?: object): string;
}

let engine: FlowEngine | undefined;
const flowEngine = (): FlowEngine => (engine ??= flowchartEngine(TOKENS) as FlowEngine);

/** A step's kind and the board shape that draws it. */
export const FLOW_SHAPES: Record<string, ShapeKind> = {
  start: 'pill',
  end: 'pill',
  task: 'rect',
  decision: 'diamond',
  io: 'parallelogram',
  document: 'document',
  database: 'cylinder',
  delay: 'delay',
  subprocess: 'subprocess',
  connector: 'ellipse',
};
const FLOW_SCALE = 1.25;
const LANE_TITLE = 48;
const PAD = 24;
const DIAGRAM_TITLE = 56;
const DOT = 40;
const NOTE = { w: 220, h: 140, gap: 24 };
const LANE_COLOURS: NoteColor[] = ['blue', 'green', 'yellow', 'purple', 'pink', 'gray'];

const isDot = (n: FlowNode) => n.type === 'connector' || ((n.type === 'start' || n.type === 'end') && !n.label.trim());

function stepBox(n: FlowNode, tb: boolean, LE: FlowEngine['LE']): { x: number; y: number; w: number; h: number } {
  const along = LE.NODE_W;
  const across = n.type === 'decision' ? LE.DEC_H : LE.NODE_H;
  const x = n.x ?? 0;
  const y = n.y ?? 0;
  const slot = tb ? { x: y, y: x, w: across, h: along } : { x, y, w: along, h: across };
  if (isDot(n))
    return {
      x: slot.x + (slot.w - DOT) / 2,
      y: slot.y + (slot.h - DOT) / 2,
      w: DOT,
      h: DOT,
    };
  // A state machine's fork or join: a bar across the flow.
  if (n.type === 'fork' || n.type === 'join') return tb ? { x: slot.x, y: slot.y + (slot.h - BAR) / 2, w: slot.w, h: BAR } : { x: slot.x + (slot.w - BAR) / 2, y: slot.y, w: BAR, h: slot.h };
  return slot;
}
/** How thick a fork or join bar is (the skill's pixels). */
const BAR = 10;
/** A flowchart, or a state machine drawn as one (corkboard-ui's diagrams/state.ts). */
export type FlowKind = 'flowchart' | 'state' | 'bpmn';
/** In a BPMN process: events are circles, activities rounded boxes, gateways diamonds, data documents and stores. */
const BPMN_SHAPES: Record<string, ShapeKind> = { start: 'ellipse', end: 'ellipse', event: 'ellipse', task: 'rounded', subprocess: 'subprocess', decision: 'diamond', data: 'document', store: 'cylinder' };
const BPMN_COLOURS: Partial<Record<string, NoteColor>> = { start: 'green', end: 'pink', event: 'yellow' };
/** In a state machine, states are rounded boxes, and forks and joins bars. */
const STATE_SHAPES: Record<string, ShapeKind> = { task: 'rounded', subprocess: 'rounded', fork: 'rect', join: 'rect' };
/** A diagram's kind, from its outer frame. */
const kindOf = (doc: Y.Doc, diagramId: string): FlowKind => {
  const type = partOf(nodesOf(doc).get(diagramId)?.get('part'))?.type;
  return type === 'state' || type === 'bpmn' ? type : 'flowchart';
};

/** Whether Mermaid text is a flowchart (its first line, after any front matter, is `flowchart` or `graph`). */
export function isFlowchartSource(source: string): boolean {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));
  let i = 0;
  if (lines[0] === '---') {
    i = lines.indexOf('---', 1) + 1;
    if (i === 0) return false;
  }
  return /^(flowchart|graph)\b/i.test(lines[i] ?? '');
}

/** Whether a flowchart shows pictures (img:) or links (click) on its steps, which only its drawing can show. */
export const hasPicturesOrLinks = (source: string): boolean => /^\s*click\s/m.test(source) || /@\{[^}]*\bimg\s*:/.test(source);

/** Mermaid read as a flowchart's model, with the reader's warnings; or why it can't be read. */
export function parseFlowchart(source: string): { data: FlowData; warnings: string[] } | { error: string } {
  try {
    const { data, warnings } = flowEngine().fromMermaid(source);
    if (!data.nodes.length) return { error: 'The flowchart has no steps.' };
    return {
      data,
      warnings: warnings.map((w) => w.replace(/^\[WARN\]\s*/, '')),
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'The flowchart could not be read.',
    };
  }
}

/**
 * A flowchart's model laid out as board things, from the layout's top-left: the diagram's frame, a frame per lane,
 * a shape per step, a note per remark, right-angled arrows between steps and dotted lines to remarks.
 */
export function layoutFlow(data: FlowData, type: FlowKind = 'flowchart'): Layout {
  const eng = flowEngine();
  const named = data.swimlanes !== false && data.lanes.length > 0;
  eng.layoutDiagram(data);
  const tb = data.direction === 'TB';
  const s = FLOW_SCALE;
  const lanes = data.lanes ?? [];
  const laneTitle = named ? LANE_TITLE : 0;
  const across = new Map<string, number>();
  let offset = 0;
  for (const lane of lanes) {
    across.set(lane.id, offset);
    offset += (lane.height ?? 192) * s + (tb ? 0 : laneTitle);
  }
  const lanesAcross = offset;
  const boxes = new Map(data.nodes.map((n) => [n.id, stepBox(n, tb, eng.LE)]));
  const along = Math.max(...data.nodes.map((n) => (tb ? boxes.get(n.id)!.y + boxes.get(n.id)!.h : boxes.get(n.id)!.x + boxes.get(n.id)!.w))) + eng.LE.START_X;
  const lanesAlong = along * s + (tb ? laneTitle : 0);
  const origin = { x: PAD, y: DIAGRAM_TITLE };
  const lanesBox = tb ? { w: lanesAcross, h: lanesAlong } : { w: lanesAlong, h: lanesAcross };
  const frames: NonNullable<Layout['frames']> = [];
  const shapes: NonNullable<Layout['shapes']> = [];
  const notes: NonNullable<Layout['notes']> = [];
  const arrows: NonNullable<Layout['arrows']> = [];
  const diagram = {
    w: Math.round(lanesBox.w + PAD * 2),
    h: Math.round(DIAGRAM_TITLE + lanesBox.h + PAD),
  };
  frames.push({
    key: 'diagram',
    title: data.title?.trim() || (type === 'state' ? 'State machine' : type === 'bpmn' ? 'Process' : 'Flowchart'),
    x: 0,
    y: 0,
    ...diagram,
    look: 'outline',
    part: {
      role: 'diagram',
      key: 'diagram',
      type,
      dir: tb ? 'TB' : 'LR',
    },
  });
  const colourOf = new Map<string, NoteColor>();
  lanes.forEach((lane, i) => {
    const colour = LANE_COLOURS[i % LANE_COLOURS.length];
    colourOf.set(lane.id, colour);
    if (!named) return;
    const at = across.get(lane.id)!;
    const band = Math.round((lane.height ?? 192) * s + (tb ? 0 : laneTitle));
    const box = tb ? { x: origin.x + at, y: origin.y, w: band, h: Math.round(lanesAlong) } : { x: origin.x, y: origin.y + at, w: Math.round(lanesAlong), h: band };
    frames.push({
      key: `lane:${lane.id}`,
      title: lane.name.slice(0, 200),
      ...box,
      x: Math.round(box.x),
      y: Math.round(box.y),
      look: 'lane',
      fill: colour,
      part: { role: 'lane', key: lane.id },
    });
  });
  for (const n of data.nodes) {
    const b = boxes.get(n.id)!;
    const lane = across.get(n.laneId ?? '') ?? 0;
    const x = tb ? origin.x + lane + b.x * s : origin.x + b.x * s;
    const y = tb ? origin.y + laneTitle + b.y * s : origin.y + lane + laneTitle + b.y * s;
    shapes.push({
      key: n.id,
      shape: (type === 'state' ? STATE_SHAPES[n.type] : type === 'bpmn' ? BPMN_SHAPES[n.type] : undefined) ?? FLOW_SHAPES[n.type] ?? 'rect',
      color: n.type === 'connector' || n.type === 'fork' || n.type === 'join' || n.type === 'data' || n.type === 'store' ? 'gray' : ((type === 'bpmn' ? BPMN_COLOURS[n.type] : undefined) ?? colourOf.get(n.laneId ?? '') ?? 'blue'),
      ...(type === 'bpmn' && typeof n.extra?.['marker'] === 'string' ? { icon: `bpmn-${n.extra['marker']}` } : {}),
      label: n.label.slice(0, 2000),
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(b.w * s),
      h: Math.round(b.h * s),
      part: { role: 'step', key: n.id, type: n.type, ...(named && n.laneId ? { lane: n.laneId } : {}), ...(n.extra && Object.keys(n.extra).length ? { extra: n.extra } : {}) },
    });
  }
  for (const e of data.edges) {
    if (!boxes.has(e.from) || !boxes.has(e.to) || e.from === e.to) continue;
    arrows.push({
      from: e.from,
      to: e.to,
      route: 'elbow',
      ...(e.label ? { label: e.label.slice(0, MAX_ARROW_LABEL) } : {}),
      ...(e.feedback ? { weight: 4 } : {}),
      ...(e.message ? { dash: 'dashed' as const } : {}),
    });
  }
  let nextX = 0;
  const stepX = (id: string) => shapes.find((sh) => sh.key === id)?.x ?? 0;
  const remarks = [...(data.notes ?? [])].filter((n) => n.nodes.some((id) => boxes.has(id))).sort((a, b) => stepX(a.nodes[0]) - stepX(b.nodes[0]));
  for (const note of remarks) {
    const x = Math.max(nextX, stepX(note.nodes[0]));
    nextX = x + NOTE.w + NOTE.gap;
    const key = `note:${note.id}`;
    notes.push({
      key,
      text: note.text.slice(0, 2000),
      color: 'yellow',
      x,
      y: diagram.h + NOTE.gap * 2,
      w: NOTE.w,
      h: NOTE.h,
      part: { role: 'note', key: note.id },
    });
    for (const id of note.nodes)
      if (boxes.has(id))
        arrows.push({
          from: key,
          to: id,
          route: 'straight',
          dash: 'dotted',
          start: 'none',
          end: 'none',
          weight: 1,
        });
  }
  return { frames, shapes, notes, arrows };
}

// ── On the board ────────────────────────────────────────────────────────────

export type Placed = {
  id: string;
  node: Y.Map<unknown>;
  part: Part;
  x: number;
  y: number;
  w: number;
  h: number;
};
export const nodesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes');
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Everything on the board that's part of a diagram, by its diagram. */
export function partsOf(doc: Y.Doc, diagramId: string): Placed[] {
  const found: Placed[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const part = partOf(node.get('part'));
    if (part?.of === diagramId)
      found.push({
        id,
        node,
        part,
        x: num(node.get('x')),
        y: num(node.get('y')),
        w: num(node.get('w')),
        h: num(node.get('h')),
      });
  });
  return found;
}

/** The flowcharts on the board: their outer frames' ids. Only the top ones (not sub-processes) when asked. */
export function flowchartsOn(doc: Y.Doc, topOnly = false, kind: FlowKind = 'flowchart'): string[] {
  const ids: string[] = [];
  nodesOf(doc).forEach((node, id) => {
    const part = node instanceof Y.Map ? partOf(node.get('part')) : null;
    if (!part || part.role !== 'diagram' || part.of !== id || part.type !== kind || node.get('kind') !== 'frame') return;
    if (topOnly && part.parent && nodesOf(doc).has(part.parent)) return;
    ids.push(id);
  });
  return ids;
}

/** A sub-process as the skill's reader and writer keep it. */
export interface ChildData {
  name: string;
  laneOrder?: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  notes?: FlowNote[];
}

/** One sub-process of a flowchart's model as a flowchart of its own (as corkboard-ui's childFlow). */
export function childFlow(data: FlowData, slug: string): FlowData | null {
  const child = (data.children as Record<string, ChildData> | undefined)?.[slug];
  if (!child) return null;
  const byId = new Map(data.lanes.map((l) => [l.id, l]));
  const order = [...(child.laneOrder ?? []), ...child.nodes.map((n) => n.laneId ?? '')].filter((id, i, a) => byId.has(id) && a.indexOf(id) === i);
  return {
    diagramType: 'flowchart',
    title: child.name,
    ...(data.direction ? { direction: data.direction } : {}),
    ...(order.length ? {} : { swimlanes: false }),
    lanes: order.length ? order.map((id) => ({ id, name: byId.get(id)!.name })) : [{ id: 'lane-main', name: 'Process' }],
    nodes: child.nodes,
    edges: child.edges,
    ...(child.notes?.length ? { notes: child.notes } : {}),
  };
}

/** A flowchart's model without its sub-processes, keeping only the lanes its own steps use (or that none of them use). */
export function mainFlow(data: FlowData): FlowData {
  if (!data.children || !Object.keys(data.children).length) return data;
  const own = new Set(data.nodes.map((n) => n.laneId));
  const theirs = new Set(Object.values(data.children as Record<string, ChildData>).flatMap((c) => [...(c.laneOrder ?? []), ...c.nodes.map((n) => n.laneId ?? '')]));
  const rest = { ...data };
  delete rest.children;
  return { ...rest, lanes: data.lanes.filter((l) => own.has(l.id) || !theirs.has(l.id)) };
}

/** A flowchart with its sub-processes, at any depth, as the skill's writer takes it (as corkboard-ui's readFlowchartTree). */
export function readFlowchartTree(doc: Y.Doc, diagramId: string): FlowData | null {
  const data = readFlowchart(doc, diagramId);
  if (!data) return null;
  const children: Record<string, ChildData> = {};
  const lanes = new Map(data.lanes.map((l) => [l.id, l]));
  const seen = new Set([diagramId]);
  const walk = (id: string) => {
    for (const p of partsOf(doc, id)) {
      const sub = p.part.role === 'step' ? p.part.sub : undefined;
      if (!sub || seen.has(sub)) continue;
      const child = readFlowchart(doc, sub);
      if (!child) continue;
      seen.add(sub);
      const own = child.swimlanes === false ? [] : child.lanes;
      for (const l of own) if (!lanes.has(l.id)) lanes.set(l.id, l);
      children[p.part.key] = {
        name: child.title ?? p.part.key,
        laneOrder: own.map((l) => l.id),
        nodes: own.length ? child.nodes : child.nodes.map(({ laneId: _l, ...n }) => n),
        edges: child.edges,
        ...(child.notes ? { notes: child.notes } : {}),
      };
      walk(sub);
    }
  };
  walk(diagramId);
  return Object.keys(children).length ? { ...data, lanes: [...lanes.values()], children } : data;
}

/** The sub-process flowcharts of a flowchart, by the key of the step each belongs to. */
function subprocesses(doc: Y.Doc, diagramId: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const p of partsOf(doc, diagramId)) if (p.part.role === 'step' && p.part.sub && readFlowchart(doc, p.part.sub)) found.set(p.part.key, p.part.sub);
  return found;
}

/** The bottom of a flowchart and the sub-processes under it, for placing another below. */
function familyBottom(doc: Y.Doc, diagramId: string): { x: number; y: number } {
  const frame = nodesOf(doc).get(diagramId)!;
  let bottom = num(frame.get('y')) + num(frame.get('h'));
  nodesOf(doc).forEach((node) => {
    const part = node instanceof Y.Map ? partOf(node.get('part')) : null;
    if (part && (part.of === diagramId || part.parent === diagramId)) bottom = Math.max(bottom, num(node.get('y')) + num(node.get('h')));
  });
  return { x: num(frame.get('x')), y: bottom + 120 };
}

/**
 * Places a flowchart's sub-processes (its model's children) under it, each a flowchart of its own linked both ways to
 * the step it belongs to, found by key in the flowchart or a sub-process placed before it. Returns their ids.
 */
export function placeSubprocesses(doc: Y.Doc, diagramId: string, data: FlowData, author = 'assistant'): string[] {
  const placed: string[] = [];
  const family = [diagramId];
  for (const slug of Object.keys(data.children ?? {})) {
    const flow = childFlow(data, slug);
    if (!flow?.nodes.length) continue;
    const owner = family.flatMap((f) => partsOf(doc, f)).find((p) => p.part.role === 'step' && p.part.key === slug);
    const at = familyBottom(doc, diagramId);
    const id = applyLayout(doc, layoutFlow(flow, kindOf(doc, diagramId)), at, author).get('diagram');
    if (!id) continue;
    doc.transact(() => {
      const frame = nodesOf(doc).get(id)!;
      frame.set('part', { ...partOf(frame.get('part'))!, parent: owner?.part.of ?? diagramId });
      if (owner) owner.node.set('part', { ...owner.part, sub: id });
    });
    family.push(id);
    placed.push(id);
  }
  return placed;
}

/**
 * Rewrites a flowchart and its sub-processes from a model with children: each sub-process whose step is still there is
 * rewritten in place, new ones are placed under it, and those whose step went are removed with everything in them.
 */
export function rewriteFlowchartTree(doc: Y.Doc, diagramId: string, data: FlowData, author = 'assistant'): void {
  const before = subprocesses(doc, diagramId);
  rewriteFlowchart(doc, diagramId, mainFlow(data), author);
  const slugs = Object.keys(data.children ?? {});
  const fresh: FlowData = { ...data, children: {} };
  for (const slug of slugs) {
    const flow = childFlow(data, slug);
    const sub = before.get(slug);
    if (sub && flow?.nodes.length && readFlowchart(doc, sub)) rewriteFlowchart(doc, sub, flow, author);
    else (fresh.children as Record<string, unknown>)[slug] = (data.children as Record<string, unknown>)[slug];
  }
  if (Object.keys(fresh.children!).length) placeSubprocesses(doc, diagramId, fresh, author);
  const gone = [...before].filter(([slug]) => !slugs.includes(slug)).map(([, id]) => id);
  if (gone.length)
    doc.transact(() => {
      for (const id of gone) {
        const ids = new Set([id, ...partsOf(doc, id).map((p) => p.id)]);
        nodesOf(doc).forEach((node, nid) => {
          if (node instanceof Y.Map && node.get('kind') === 'connector' && (ids.has(node.get('from') as string) || ids.has(node.get('to') as string))) ids.add(nid);
        });
        for (const nid of ids) nodesOf(doc).delete(nid);
      }
    });
}

const centreIn = (b: { x: number; y: number; w: number; h: number }, f: { x: number; y: number; w: number; h: number }) => {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
};

/** A flowchart on the board read back as its model (as corkboard-ui's readFlowchart does). */
export function readFlowchart(doc: Y.Doc, diagramId: string): FlowData | null {
  const frame = nodesOf(doc).get(diagramId);
  const own = frame instanceof Y.Map ? partOf(frame.get('part')) : null;
  if (!frame || own?.role !== 'diagram' || own.of !== diagramId || (own.type !== 'flowchart' && own.type !== 'state' && own.type !== 'bpmn')) return null;
  const tb = own.dir === 'TB';
  const parts = partsOf(doc, diagramId);
  const lanes = parts.filter((p) => p.part.role === 'lane' && p.node.get('kind') === 'frame').sort((a, b) => (tb ? a.x - b.x : a.y - b.y));
  const steps = parts
    .filter((p) => p.part.role === 'step' && p.node.get('kind') === 'shape')
    .sort((a, b) => (tb ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y) || a.part.key.localeCompare(b.part.key));
  const keyOf = new Map(steps.map((s) => [s.id, s.part.key]));
  const rank = new Map(steps.map((s, i) => [s.id, i]));
  const main = { id: 'lane-main', name: 'Process' };
  const connectors: {
    id: string;
    from: string;
    to: string;
    label: string;
    weight: number;
    dash: string;
  }[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || node.get('kind') !== 'connector') return;
    const from = node.get('from');
    const to = node.get('to');
    const label = node.get('label');
    if (typeof from === 'string' && typeof to === 'string')
      connectors.push({
        id,
        from,
        to,
        label: typeof label === 'string' ? label : '',
        weight: num(node.get('weight')),
        dash: str(node.get('dash')),
      });
  });
  const remarks = parts.filter((p) => p.part.role === 'note' && p.node.get('kind') === 'note').sort((a, b) => a.part.key.localeCompare(b.part.key));
  const notes = remarks.map((r) => {
    const text = r.node.get('text');
    return {
      id: r.part.key,
      text: text instanceof Y.XmlFragment ? fragmentText(text) : '',
      nodes: connectors.filter((c) => c.from === r.id && keyOf.has(c.to)).map((c) => keyOf.get(c.to)!),
    };
  });
  const title = frame.get('title');
  return {
    diagramType: 'flowchart',
    title: typeof title === 'string' ? title : '',
    direction: tb ? 'TB' : 'LR',
    ...(lanes.length ? {} : { swimlanes: false }),
    lanes: lanes.length ? lanes.map((l) => ({ id: l.part.key, name: str(l.node.get('title')) })) : [main],
    nodes: steps.map((s) => ({
      id: s.part.key,
      laneId: (lanes.find((l) => centreIn(s, l)) ?? lanes[0])?.part.key ?? main.id,
      type: s.part.type ?? 'task',
      label: str(s.node.get('label')),
      ...(s.part.extra ? { extra: s.part.extra } : {}),
    })),
    edges: connectors
      .filter((c) => keyOf.has(c.from) && keyOf.has(c.to))
      .sort((a, b) => rank.get(a.from)! - rank.get(b.from)! || rank.get(a.to)! - rank.get(b.to)!)
      .map((c) => ({
        id: c.id,
        from: keyOf.get(c.from)!,
        to: keyOf.get(c.to)!,
        label: c.label,
        ...(c.weight >= 4 ? { feedback: true } : {}),
        ...(c.dash === 'dashed' ? { message: true } : {}),
      })),
    ...(notes.length ? { notes } : {}),
  };
}

/** A flowchart on the board written as Mermaid, its sub-processes as sub_ blocks. */
export function flowchartMermaid(doc: Y.Doc, diagramId: string): string | null {
  const data = readFlowchartTree(doc, diagramId);
  return data ? flowEngine().toMermaid(data, {}) : null;
}

/**
 * Rewrites a flowchart on the board from new Mermaid, where it is: steps, lanes and remarks whose ids are kept stay the
 * same board things (with their comments and votes), taking their new words, kinds and places; new ones are added and
 * ones no longer written are removed, with their arrows. The arrows between steps and to remarks are drawn afresh.
 */
export function rewriteFlowchart(doc: Y.Doc, diagramId: string, data: FlowData, author = 'assistant'): void {
  rewriteLayout(doc, diagramId, layoutFlow(data, kindOf(doc, diagramId)), author);
}

/** A part's key in its diagram's layout: lanes, groups and remarks are prefixed, the diagram is 'diagram'. */
const layoutKey = (p: Part) =>
  p.role === 'diagram' ? 'diagram' : p.role === 'lane' ? `lane:${p.key}` : p.role === 'group' ? `group:${p.key}` : p.role === 'note' ? `note:${p.key}` : p.key;

/**
 * Rewrites an editable diagram on the board from a fresh layout of it, where it is: things kept by key stay the same
 * board things (with their comments and votes), new ones are added, dropped ones go with their arrows, and the arrows
 * inside the diagram are redrawn. Any kind of diagram: its layout's keys follow layoutKey.
 */
export function rewriteLayout(doc: Y.Doc, diagramId: string, layout: Layout, author = 'assistant'): void {
  const frame = nodesOf(doc).get(diagramId)!;
  const origin = { x: num(frame.get('x')), y: num(frame.get('y')) };
  const existing = new Map<string, Placed>();
  for (const p of partsOf(doc, diagramId)) existing.set(layoutKey(p.part), p);
  doc.transact(() => {
    let z = topZ(doc);
    const ids = new Map<string, string>();
    const wanted = new Set<string>();
    const place = (node: Y.Map<unknown>, b: { x: number; y: number; w?: number; h?: number }) => {
      node.set('x', Math.round(origin.x + b.x));
      node.set('y', Math.round(origin.y + b.y));
      if (b.w && b.h) {
        node.set('w', Math.round(b.w));
        node.set('h', Math.round(b.h));
      }
    };
    const make = (kind: string, key: string, part: Omit<Part, 'of'>, set: (n: Y.Map<unknown>) => void) => {
      // A step that opens a sub-process keeps that link.
      const sub = existing.get(key)?.part.sub;
      if (sub) part = { ...part, sub };
      const old = existing.get(key);
      const id = old && old.node.get('kind') === kind ? old.id : randomUUID();
      const node = old && old.node.get('kind') === kind ? old.node : new Y.Map<unknown>();
      if (!old || old.id !== id) {
        node.set('kind', kind);
        node.set('z', ++z);
        node.set('author', author);
        nodesOf(doc).set(id, node);
      }
      set(node);
      node.set('part', { ...part, of: diagramId });
      ids.set(key, id);
      wanted.add(id);
      return node;
    };
    for (const f of layout.frames ?? []) {
      if (f.part?.role === 'diagram') {
        frame.set('title', f.title);
        const was = partOf(frame.get('part'));
        frame.set('part', { ...f.part, of: diagramId, ...(was?.auto === false ? { auto: false } : {}), ...(was?.parent ? { parent: was.parent } : {}) });
        frame.set('w', f.w);
        frame.set('h', f.h);
        ids.set('diagram', diagramId);
        wanted.add(diagramId);
        continue;
      }
      make('frame', f.key!, f.part!, (n) => {
        n.set('title', f.title);
        n.set('look', f.look ?? 'lane');
        if (f.fill) n.set('fill', f.fill);
        place(n, f);
      });
    }
    for (const e of layout.entities ?? []) {
      make('entity', e.key!, e.part!, (n) => {
        n.set('name', e.name.slice(0, 80));
        n.set('columns', entityColumns(e.columns));
        if (!n.has('color')) n.set('color', e.color ?? 'blue');
        place(n, e);
      });
    }
    for (const t of layout.texts ?? []) {
      if (!t.key || !t.part) continue;
      make('text', t.key, t.part, (n) => {
        n.set('text', t.text);
        n.set('size', t.size ?? 'md');
        place(n, { x: t.x, y: t.y, w: t.w ?? 240, h: TEXT_SIZES[t.size ?? 'md'] * 1.6 });
      });
    }
    for (const s of layout.shapes ?? []) {
      make('shape', s.key!, s.part!, (n) => {
        n.set('shape', s.shape);
        if (!n.has('color')) n.set('color', s.color ?? 'blue');
        n.set('label', s.label ?? '');
        if (s.icon) n.set('icon', s.icon);
        else if (n.has('icon') && s.part?.type && ['start', 'end', 'event', 'task', 'decision'].includes(s.part.type) && String(n.get('icon')).startsWith('bpmn-')) n.delete('icon');
        place(n, s);
      });
    }
    for (const note of layout.notes ?? []) {
      const old = existing.get(note.key!);
      if (old && old.node.get('kind') === 'note') {
        const text = old.node.get('text');
        if (text instanceof Y.XmlFragment && fragmentText(text) !== note.text) {
          text.delete(0, text.length);
          text.insert(0, paragraphs(note.text));
        }
        place(old.node, note);
        old.node.set('part', { ...note.part!, of: diagramId });
        ids.set(note.key!, old.id);
        wanted.add(old.id);
      } else {
        const id = newNote(
          doc,
          { text: note.text, color: note.color ?? 'yellow' },
          {
            x: Math.round(origin.x + note.x),
            y: Math.round(origin.y + note.y),
          },
          ++z,
          author,
        );
        const node = nodesOf(doc).get(id)!;
        if (note.w && note.h) {
          node.set('w', note.w);
          node.set('h', note.h);
        }
        node.set('part', { ...note.part!, of: diagramId });
        ids.set(note.key!, id);
        wanted.add(id);
      }
    }
    // What the new text no longer has goes, with every arrow to or from it; the arrows inside the diagram are redrawn.
    const inside = new Set([...existing.values()].map((p) => p.id));
    const gone = [...inside].filter((id) => !wanted.has(id));
    const redraw: string[] = [];
    nodesOf(doc).forEach((node, id) => {
      if (!(node instanceof Y.Map) || node.get('kind') !== 'connector') return;
      const from = node.get('from') as string;
      const to = node.get('to') as string;
      if (gone.includes(from) || gone.includes(to) || (inside.has(from) && inside.has(to))) redraw.push(id);
    });
    for (const id of [...gone, ...redraw]) nodesOf(doc).delete(id);
    for (const a of layout.arrows ?? []) {
      const from = ids.get(a.from);
      const to = ids.get(a.to);
      if (!from || !to) continue;
      const node = new Y.Map<unknown>();
      node.set('kind', 'connector');
      node.set('from', from);
      node.set('to', to);
      node.set('route', a.route ?? 'elbow');
      node.set('dash', a.dash ?? 'solid');
      node.set('weight', a.weight ?? 2);
      node.set('start', a.start ?? 'none');
      node.set('end', a.end ?? 'arrow');
      if (a.label) node.set('label', a.label);
      nodesOf(doc).set(randomUUID(), node);
    }
  });
}
