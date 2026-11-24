import type * as Y from 'yjs';
import { flowchartsOn, partsOf, readFlowchartTree, rewriteFlowchartTree, type ChildData, type FlowData, type FlowEdge, type FlowLane, type FlowNode } from './flowchart';

/**
 * BPMN 2.0 processes, read from and written as BPMN XML, drawn as flowcharts of a kind of their own (the diagram's part
 * type is "bpmn"): pools and lanes as lanes, events as circles, activities as rounded boxes, gateways as diamonds, each
 * with its marker, data objects and stores, annotations as remarks, message flows dashed, and sub-processes opened on
 * their own. The flowchart engine lays them out. The reader and writer are kept the same as corkboard-ui's diagrams/bpmn.ts.
 */

// ---------------------------------------------------------------------------------------------------------------
// A small XML reader: elements, attributes and text. No DOCTYPE (so no entities of the file's own), no scripts.

export interface XmlEl {
  /** The name without its namespace prefix. */
  name: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  text: string;
}

/** At most this much XML is read. */
export const MAX_BPMN_CHARS = 400_000;

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
const local = (name: string) => name.slice(name.indexOf(':') + 1);

/** XML read into elements; or why it can't be. */
export function parseXml(text: string): XmlEl | { error: string } {
  if (text.length > MAX_BPMN_CHARS) return { error: 'The BPMN file is too big to read.' };
  if (/<!DOCTYPE/i.test(text)) return { error: 'BPMN with a DOCTYPE is not read.' };
  const root: XmlEl = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = tag.exec(text))) {
    if (m.index !== at) return { error: 'The XML is not well formed.' };
    at = tag.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length < 2 || top.name !== local(m[2])) return { error: `The XML closes ${local(m[2])} where ${top.name} is open.` };
      stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3]);
      const el: XmlEl = { name: local(m[3]), attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
      if (stack.length > 64) return { error: 'The XML nests too deep.' };
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (at !== text.length) return { error: 'The XML is not well formed.' };
  if (stack.length !== 1) return { error: `The XML leaves ${stack[stack.length - 1].name} open.` };
  const el = root.children[0];
  return el ? el : { error: 'The XML has nothing in it.' };
}

const kids = (el: XmlEl, ...names: string[]) => el.children.filter((c) => names.includes(c.name));
const first = (el: XmlEl, name: string) => el.children.find((c) => c.name === name);

// ---------------------------------------------------------------------------------------------------------------
// BPMN to the flowchart model

/** Whether text is BPMN 2.0 XML. */
export const isBpmnText = (text: string): boolean => /<([\w-]+:)?definitions\b[^>]*>/.test(text) && /<([\w-]+:)?(process|collaboration)\b/.test(text);

const TASKS: Record<string, string | undefined> = {
  task: undefined,
  userTask: 'user',
  serviceTask: 'service',
  scriptTask: 'script',
  sendTask: 'send',
  receiveTask: 'receive',
  manualTask: 'manual',
  businessRuleTask: 'rule',
  callActivity: undefined,
};
const GATEWAYS: Record<string, string> = {
  exclusiveGateway: 'exclusive',
  parallelGateway: 'parallel',
  inclusiveGateway: 'inclusive',
  eventBasedGateway: 'event',
  complexGateway: 'complex',
};
const EVENTS = ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent'];
const TRIGGERS: Record<string, string> = {
  messageEventDefinition: 'message',
  timerEventDefinition: 'timer',
  signalEventDefinition: 'signal',
  errorEventDefinition: 'error',
  conditionalEventDefinition: 'conditional',
  terminateEventDefinition: 'terminate',
  escalationEventDefinition: 'signal',
};
const STEPS = [...EVENTS, ...Object.keys(TASKS), ...Object.keys(GATEWAYS), 'subProcess', 'dataObjectReference', 'dataStoreReference'];

/** A BPMN process read as a flowchart's model: its steps, flows, lanes (pools named in), annotations and sub-processes. */
export function parseBpmn(xml: string): { data: FlowData; warnings: string[] } | { error: string } {
  const doc = parseXml(xml);
  if ('error' in doc) return doc;
  if (doc.name !== 'definitions') return { error: 'BPMN starts with a definitions element.' };
  const warnings: string[] = [];
  const processes = kids(doc, 'process');
  if (!processes.length) return { error: 'The BPMN has no process.' };
  const collaboration = first(doc, 'collaboration');
  const pools = collaboration ? kids(collaboration, 'participant') : [];
  const poolOf = new Map(pools.flatMap((p) => (p.attrs['processRef'] ? [[p.attrs['processRef'], p] as const] : [])));
  const manyPools = processes.length > 1 || pools.length > 1;

  const lanes: FlowLane[] = [];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const notes: NonNullable<FlowData['notes']> = [];
  const children: Record<string, ChildData> = {};
  const known = new Set<string>();

  /** The steps and flows of a process or sub-process, into the lists given. */
  const readFlow = (scope: XmlEl, into: { nodes: FlowNode[]; edges: FlowEdge[]; notes: NonNullable<FlowData['notes']> }, laneOf: Map<string, string>, pool: string | undefined, depth: number) => {
    for (const el of scope.children) {
      const id = el.attrs['id'];
      if (!STEPS.includes(el.name) || !id) continue;
      if (known.has(id)) {
        warnings.push(`${id} appears twice: the second is left out.`);
        continue;
      }
      known.add(id);
      const label = (el.attrs['name'] ?? '').trim().slice(0, 200);
      const trigger = el.children.map((c) => TRIGGERS[c.name]).find(Boolean);
      const extra: Record<string, string> = { bpmn: el.name };
      if (pool) extra['pool'] = pool;
      let type = 'task';
      if (el.name === 'startEvent') type = 'start';
      else if (el.name === 'endEvent') type = 'end';
      else if (EVENTS.includes(el.name)) type = 'event';
      else if (el.name in GATEWAYS) {
        type = 'decision';
        extra['marker'] = GATEWAYS[el.name];
      } else if (el.name === 'subProcess') type = 'subprocess';
      else if (el.name === 'dataObjectReference') type = 'data';
      else if (el.name === 'dataStoreReference') type = 'store';
      else if (TASKS[el.name]) extra['marker'] = TASKS[el.name]!;
      if (trigger) extra['marker'] = trigger;
      if (el.name === 'boundaryEvent' && el.attrs['attachedToRef']) {
        warnings.push(`The boundary event ${label || id} is drawn as its own step after ${el.attrs['attachedToRef']}.`);
        into.edges.push({ id: `${id}__attached`, from: el.attrs['attachedToRef'], to: id });
      }
      const lane = laneOf.get(id);
      into.nodes.push({ id, ...(lane ? { laneId: lane } : {}), type, label, extra });
      if (el.name === 'subProcess') {
        if (depth > 8) {
          warnings.push(`The sub-process ${label || id} nests too deep: its inside is left out.`);
          continue;
        }
        const inside = {
          nodes: [] as FlowNode[],
          edges: [] as FlowEdge[],
          notes: [] as NonNullable<FlowData['notes']>,
        };
        readFlow(el, inside, new Map(), pool, depth + 1);
        if (inside.nodes.length)
          children[id] = {
            name: label || id,
            nodes: inside.nodes,
            edges: inside.edges,
            ...(inside.notes.length ? { notes: inside.notes } : {}),
          };
        else into.nodes[into.nodes.length - 1].type = 'task';
      }
    }
    for (const el of kids(scope, 'sequenceFlow')) {
      const { id, sourceRef, targetRef } = el.attrs;
      if (!id || !sourceRef || !targetRef) continue;
      const label = (el.attrs['name'] ?? '').trim().slice(0, 200);
      into.edges.push({ id, from: sourceRef, to: targetRef, ...(label ? { label } : {}) });
    }
    // Data written and read by an activity: an arrow from the activity to the data, or from the data to it.
    for (const task of scope.children) {
      for (const out of kids(task, 'dataOutputAssociation')) {
        const to = first(out, 'targetRef')?.text.trim();
        if (task.attrs['id'] && to)
          into.edges.push({
            id: out.attrs['id'] ?? `${task.attrs['id']}__${to}`,
            from: task.attrs['id'],
            to,
          });
      }
      for (const input of kids(task, 'dataInputAssociation')) {
        const from = first(input, 'sourceRef')?.text.trim();
        if (task.attrs['id'] && from)
          into.edges.push({
            id: input.attrs['id'] ?? `${from}__${task.attrs['id']}`,
            from,
            to: task.attrs['id'],
          });
      }
    }
    // Annotations, joined to what they're about.
    const about = new Map<string, string[]>();
    for (const a of kids(scope, 'association')) {
      const { sourceRef, targetRef } = a.attrs;
      if (sourceRef && targetRef) about.set(targetRef, [...(about.get(targetRef) ?? []), sourceRef]);
      if (sourceRef && targetRef) about.set(sourceRef, [...(about.get(sourceRef) ?? []), targetRef]);
    }
    for (const t of kids(scope, 'textAnnotation')) {
      const text = (first(t, 'text')?.text ?? '').trim().slice(0, 1000);
      const id = t.attrs['id'];
      if (!id || !text) continue;
      into.notes.push({ id, text, nodes: about.get(id) ?? [] });
    }
  };

  for (const [i, process] of processes.entries()) {
    const pid = process.attrs['id'] ?? `process${i + 1}`;
    const pool = poolOf.get(pid);
    const poolName = (pool?.attrs['name'] ?? process.attrs['name'] ?? '').trim();
    const laneOf = new Map<string, string>();
    const flat: XmlEl[] = [];
    const walkLanes = (set: XmlEl | undefined) => {
      for (const lane of set ? kids(set, 'lane') : []) {
        const inner = first(lane, 'childLaneSet');
        if (inner && kids(inner, 'lane').length) walkLanes(inner);
        else flat.push(lane);
      }
    };
    walkLanes(first(process, 'laneSet'));
    for (const lane of flat) {
      const id = manyPools ? `${pid}__${lane.attrs['id']}` : lane.attrs['id'];
      const name = (lane.attrs['name'] ?? '').trim() || 'Lane';
      lanes.push({ id, name: manyPools && poolName ? `${poolName} · ${name}` : name });
      for (const ref of kids(lane, 'flowNodeRef')) laneOf.set(ref.text.trim(), id);
    }
    if (!flat.length && manyPools) {
      const id = `${pid}__pool`;
      lanes.push({ id, name: poolName || pid });
      for (const el of process.children) if (el.attrs['id']) laneOf.set(el.attrs['id'], id);
    }
    readFlow(process, { nodes, edges, notes }, laneOf, manyPools ? pid : undefined, 0);
  }
  if (collaboration) {
    for (const f of kids(collaboration, 'messageFlow')) {
      const { id, sourceRef, targetRef } = f.attrs;
      if (!id || !sourceRef || !targetRef) continue;
      if (!known.has(sourceRef) || !known.has(targetRef)) {
        warnings.push(`The message flow ${f.attrs['name'] || id} runs to a whole pool: drawn only between steps, so it's left out.`);
        continue;
      }
      const label = (f.attrs['name'] ?? '').trim().slice(0, 200);
      edges.push({
        id,
        from: sourceRef,
        to: targetRef,
        ...(label ? { label } : {}),
        message: true,
      });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const dangling = edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
  if (dangling.length) warnings.push(`${dangling.length} flow${dangling.length === 1 ? '' : 's'} into or out of a sub-process's inside: left out.`);
  if (!nodes.length) return { error: 'The BPMN process has no steps.' };
  const title = (doc.attrs['name'] ?? (manyPools ? '' : (pools[0]?.attrs['name'] ?? processes[0].attrs['name'] ?? ''))).trim();
  return {
    data: {
      diagramType: 'flowchart',
      ...(title ? { title } : {}),
      direction: 'LR',
      ...(lanes.length ? {} : { swimlanes: false }),
      lanes: lanes.length ? lanes : [{ id: 'lane-main', name: 'Process' }],
      nodes,
      edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
      ...(notes.length ? { notes: notes.map((n) => ({ ...n, nodes: n.nodes.filter((x) => ids.has(x)) })) } : {}),
      ...(Object.keys(children).length ? { children } : {}),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The flowchart model to BPMN

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A lane's own id, without the pool it's in. */
const laneLocal = (id: string) => (id.includes('__') ? id.slice(id.indexOf('__') + 2) : id);
const xmlId = (s: string) => (/^[A-Za-z_][\w.-]*$/.test(s) ? s : `id_${s.replace(/[^\w.-]/g, '_')}`);
const TRIGGER_EL: Record<string, string> = {
  message: 'messageEventDefinition',
  timer: 'timerEventDefinition',
  signal: 'signalEventDefinition',
  error: 'errorEventDefinition',
  conditional: 'conditionalEventDefinition',
  terminate: 'terminateEventDefinition',
};
const TASK_EL: Record<string, string> = {
  user: 'userTask',
  service: 'serviceTask',
  script: 'scriptTask',
  send: 'sendTask',
  receive: 'receiveTask',
  manual: 'manualTask',
  rule: 'businessRuleTask',
};
const GATEWAY_EL: Record<string, string> = {
  exclusive: 'exclusiveGateway',
  parallel: 'parallelGateway',
  inclusive: 'inclusiveGateway',
  event: 'eventBasedGateway',
  complex: 'complexGateway',
};

/** A step's BPMN element, from what it records or else from its kind and marker. */
function elementOf(n: FlowNode): string {
  const recorded = typeof n.extra?.['bpmn'] === 'string' ? n.extra['bpmn'] : '';
  const marker = typeof n.extra?.['marker'] === 'string' ? n.extra['marker'] : '';
  if (n.type === 'start') return 'startEvent';
  if (n.type === 'end') return 'endEvent';
  if (n.type === 'event') return recorded === 'intermediateThrowEvent' ? recorded : 'intermediateCatchEvent';
  if (n.type === 'decision') return GATEWAY_EL[marker] ?? 'exclusiveGateway';
  if (n.type === 'subprocess') return 'subProcess';
  if (n.type === 'data') return 'dataObjectReference';
  if (n.type === 'store') return 'dataStoreReference';
  if (recorded === 'callActivity') return recorded;
  return TASK_EL[marker] ?? 'task';
}

/** Where things are on the board, for the diagram part of the file: steps by key, lanes as `lane:<key>`. */
export type BpmnBoxes = ReadonlyMap<string, { x: number; y: number; w: number; h: number }>;

/** A process's model written as BPMN 2.0 XML, with its layout (diagram interchange) when the boxes are given. */
export function bpmnText(data: FlowData, boxes?: BpmnBoxes): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(
    `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions" targetNamespace="https://corkboard.app/bpmn"${data.title ? ` name="${esc(data.title)}"` : ''}>`,
  );
  const children = (data.children ?? {}) as Record<string, ChildData>;
  const named = data.swimlanes !== false;
  // Pools: lanes whose ids say which pool they're in (pool__lane); otherwise one process.
  const poolKey = (laneId: string | undefined) => (laneId && laneId.includes('__') ? laneId.slice(0, laneId.indexOf('__')) : 'process');
  const poolIds = [...new Set(data.lanes.map((l) => poolKey(l.id)))];
  const pools = poolIds.length > 1 || poolIds[0] !== 'process' ? poolIds : ['process'];
  const message = data.edges.filter((e) => e.message);
  const sequence = data.edges.filter((e) => !e.message);
  const poolNameOf = (pid: string) => {
    const lane = data.lanes.find((l) => poolKey(l.id) === pid);
    return lane?.name.includes(' · ') ? lane.name.slice(0, lane.name.indexOf(' · ')) : (lane?.name ?? data.title ?? 'Process');
  };
  if (pools.length > 1 || message.length) {
    out.push('  <bpmn:collaboration id="collaboration">');
    for (const pid of pools) out.push(`    <bpmn:participant id="${xmlId(`${pid}_pool`)}" name="${esc(poolNameOf(pid))}" processRef="${xmlId(pid)}" />`);
    for (const e of message) out.push(`    <bpmn:messageFlow id="${xmlId(e.id)}"${e.label ? ` name="${esc(e.label)}"` : ''} sourceRef="${xmlId(e.from)}" targetRef="${xmlId(e.to)}" />`);
    out.push('  </bpmn:collaboration>');
  }
  const flowOf = (nodes: FlowNode[], edges: FlowEdge[], notes: FlowData['notes'], indent: string) => {
    const ids = new Set(nodes.map((n) => n.id));
    const dataIds = new Set(nodes.filter((n) => n.type === 'data' || n.type === 'store').map((n) => n.id));
    for (const n of nodes) {
      const el = elementOf(n);
      const name = n.label ? ` name="${esc(n.label.replace(/\n/g, ' '))}"` : '';
      const trigger = TRIGGER_EL[String(n.extra?.['marker'] ?? '')];
      const ins = edges.filter((e) => e.to === n.id && ids.has(e.from) && !dataIds.has(e.from) && !dataIds.has(n.id));
      const outs = edges.filter((e) => e.from === n.id && ids.has(e.to) && !dataIds.has(e.to) && !dataIds.has(n.id));
      const writes = edges.filter((e) => e.from === n.id && dataIds.has(e.to));
      const reads = edges.filter((e) => e.to === n.id && dataIds.has(e.from));
      const body: string[] = [
        ...ins.map((e) => `${indent}  <bpmn:incoming>${xmlId(e.id)}</bpmn:incoming>`),
        ...outs.map((e) => `${indent}  <bpmn:outgoing>${xmlId(e.id)}</bpmn:outgoing>`),
        ...reads.map((e) => `${indent}  <bpmn:dataInputAssociation id="${xmlId(e.id)}"><bpmn:sourceRef>${xmlId(e.from)}</bpmn:sourceRef></bpmn:dataInputAssociation>`),
        ...writes.map((e) => `${indent}  <bpmn:dataOutputAssociation id="${xmlId(e.id)}"><bpmn:targetRef>${xmlId(e.to)}</bpmn:targetRef></bpmn:dataOutputAssociation>`),
        ...(trigger && el.endsWith('Event') ? [`${indent}  <bpmn:${trigger} />`] : []),
      ];
      if (el === 'dataObjectReference') out.push(`${indent}<bpmn:dataObject id="${xmlId(`${n.id}_object`)}" />`);
      if (el === 'subProcess' && children[n.id]) {
        out.push(`${indent}<bpmn:subProcess id="${xmlId(n.id)}"${name}>`, ...body);
        const c = children[n.id];
        flowOf(c.nodes, c.edges, c.notes, `${indent}  `);
        out.push(`${indent}</bpmn:subProcess>`);
      } else if (body.length)
        out.push(`${indent}<bpmn:${el} id="${xmlId(n.id)}"${name}${el === 'dataObjectReference' ? ` dataObjectRef="${xmlId(`${n.id}_object`)}"` : ''}>`, ...body, `${indent}</bpmn:${el}>`);
      else out.push(`${indent}<bpmn:${el} id="${xmlId(n.id)}"${name}${el === 'dataObjectReference' ? ` dataObjectRef="${xmlId(`${n.id}_object`)}"` : ''} />`);
    }
    for (const e of edges)
      if (ids.has(e.from) && ids.has(e.to) && !dataIds.has(e.from) && !dataIds.has(e.to))
        out.push(`${indent}<bpmn:sequenceFlow id="${xmlId(e.id)}"${e.label ? ` name="${esc(e.label)}"` : ''} sourceRef="${xmlId(e.from)}" targetRef="${xmlId(e.to)}" />`);
    for (const note of notes ?? []) {
      out.push(`${indent}<bpmn:textAnnotation id="${xmlId(note.id)}"><bpmn:text>${esc(note.text)}</bpmn:text></bpmn:textAnnotation>`);
      for (const at of note.nodes) if (ids.has(at)) out.push(`${indent}<bpmn:association id="${xmlId(`${note.id}_${at}`)}" sourceRef="${xmlId(at)}" targetRef="${xmlId(note.id)}" />`);
    }
  };
  for (const pid of pools) {
    const own = (n: FlowNode) => pools.length === 1 || poolKey(n.laneId) === pid;
    const nodes = data.nodes.filter(own);
    const ids = new Set(nodes.map((n) => n.id));
    const lanes = data.lanes.filter((l) => poolKey(l.id) === pid || pools.length === 1);
    out.push(`  <bpmn:process id="${xmlId(pid)}" isExecutable="false">`);
    if (named && lanes.length && !(lanes.length === 1 && lanes[0].id.endsWith('__pool'))) {
      out.push(`    <bpmn:laneSet id="${xmlId(`${pid}_lanes`)}">`);
      for (const lane of lanes) {
        const name = lane.name.includes(' · ') ? lane.name.slice(lane.name.indexOf(' · ') + 3) : lane.name;
        out.push(`      <bpmn:lane id="${xmlId(laneLocal(lane.id))}" name="${esc(name)}">`);
        for (const n of nodes) if (n.laneId === lane.id) out.push(`        <bpmn:flowNodeRef>${xmlId(n.id)}</bpmn:flowNodeRef>`);
        out.push('      </bpmn:lane>');
      }
      out.push('    </bpmn:laneSet>');
    }
    flowOf(
      nodes,
      data.edges.filter((e) => !e.message && ids.has(e.from) && ids.has(e.to)),
      data.notes?.filter((n) => n.nodes.some((x) => ids.has(x))),
      '    ',
    );
    out.push('  </bpmn:process>');
  }
  if (boxes) {
    const centre = (b: { x: number; y: number; w: number; h: number }) => ({
      x: Math.round(b.x + b.w / 2),
      y: Math.round(b.y + b.h / 2),
    });
    out.push('  <bpmndi:BPMNDiagram id="diagram">', `    <bpmndi:BPMNPlane id="plane" bpmnElement="${pools.length > 1 || message.length ? 'collaboration' : xmlId(pools[0])}">`);
    const shape = (id: string, b: { x: number; y: number; w: number; h: number }) =>
      out.push(
        `      <bpmndi:BPMNShape id="${xmlId(`${id}_di`)}" bpmnElement="${xmlId(id)}"><dc:Bounds x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" /></bpmndi:BPMNShape>`,
      );
    for (const lane of data.lanes) {
      const b = boxes.get(`lane:${lane.id}`);
      if (b && named) shape(laneLocal(lane.id), b);
    }
    for (const n of data.nodes) {
      const b = boxes.get(n.id);
      if (b) shape(n.id, b);
    }
    for (const e of [...sequence, ...message]) {
      const a = boxes.get(e.from);
      const b = boxes.get(e.to);
      if (!a || !b) continue;
      const p = centre(a);
      const q = centre(b);
      out.push(`      <bpmndi:BPMNEdge id="${xmlId(`${e.id}_di`)}" bpmnElement="${xmlId(e.id)}"><di:waypoint x="${p.x}" y="${p.y}" /><di:waypoint x="${q.x}" y="${q.y}" /></bpmndi:BPMNEdge>`);
    }
    out.push('    </bpmndi:BPMNPlane>', '  </bpmndi:BPMNDiagram>');
  }
  out.push('</bpmn:definitions>');
  return `${out.join('\n')}\n`;
}

/** What a new process starts as: an order handled by sales and the warehouse, with a payment check. */
export const BPMN_STARTER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="definitions" targetNamespace="https://corkboard.app/bpmn" name="Order handling">
  <bpmn:process id="order" isExecutable="false">
    <bpmn:laneSet id="lanes">
      <bpmn:lane id="sales" name="Sales">
        <bpmn:flowNodeRef>received</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>check</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>paid</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>remind</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="warehouse" name="Warehouse">
        <bpmn:flowNodeRef>pack</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>ship</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>done</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="received" name="Order received"><bpmn:messageEventDefinition /></bpmn:startEvent>
    <bpmn:userTask id="check" name="Check payment" />
    <bpmn:exclusiveGateway id="paid" name="Paid?" />
    <bpmn:intermediateCatchEvent id="remind" name="Wait 3 days"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:manualTask id="pack" name="Pack order" />
    <bpmn:serviceTask id="ship" name="Book courier" />
    <bpmn:endEvent id="done" name="Order shipped" />
    <bpmn:sequenceFlow id="f1" sourceRef="received" targetRef="check" />
    <bpmn:sequenceFlow id="f2" sourceRef="check" targetRef="paid" />
    <bpmn:sequenceFlow id="f3" name="Yes" sourceRef="paid" targetRef="pack" />
    <bpmn:sequenceFlow id="f4" name="No" sourceRef="paid" targetRef="remind" />
    <bpmn:sequenceFlow id="f5" sourceRef="remind" targetRef="check" />
    <bpmn:sequenceFlow id="f6" sourceRef="pack" targetRef="ship" />
    <bpmn:sequenceFlow id="f7" sourceRef="ship" targetRef="done" />
  </bpmn:process>
</bpmn:definitions>
`;

// ---------------------------------------------------------------------------------------------------------------
// On the board, and what to fix

/** At most this many steps on one level of a process before it should be split into sub-processes. */
const STEP_BUDGET = 25;

/**
 * What to fix in a process, level by level (the process, then each sub-process's inside): a start and an end, every
 * step reached and going somewhere, every way out of a deciding gateway labelled, gateways that split or merge,
 * message flows only between pools, short activity names, and a size people can read.
 */
export function bpmnChecks(data: FlowData): string[] {
  const out: string[] = [];
  const levels: { name: string; nodes: FlowNode[]; edges: FlowEdge[] }[] = [
    { name: 'The process', nodes: data.nodes, edges: data.edges },
    ...Object.entries((data.children ?? {}) as Record<string, ChildData>).map(([id, c]) => ({ name: `Inside ${c.name || id}`, nodes: c.nodes, edges: c.edges })),
  ];
  for (const level of levels) {
    const flow = level.nodes.filter((n) => n.type !== 'data' && n.type !== 'store');
    const ids = new Set(flow.map((n) => n.id));
    const name = (n: FlowNode) => n.label || n.id;
    const seq = level.edges.filter((e) => !e.message && ids.has(e.from) && ids.has(e.to));
    if (!flow.some((n) => n.type === 'start')) out.push(`${level.name} has no start event.`);
    if (!flow.some((n) => n.type === 'end')) out.push(`${level.name} has no end event.`);
    for (const n of flow) {
      const ins = seq.filter((e) => e.to === n.id);
      const outs = seq.filter((e) => e.from === n.id);
      const boundary = n.extra?.['bpmn'] === 'boundaryEvent';
      if (n.type !== 'start' && !boundary && !ins.length && !level.edges.some((e) => e.message && e.to === n.id)) out.push(`"${name(n)}" is never reached: add a sequence flow into it.`);
      if (n.type !== 'end' && !outs.length && !level.edges.some((e) => e.message && e.from === n.id))
        out.push(`"${name(n)}" goes nowhere: add a sequence flow out of it, or end the flow with an end event.`);
      if (n.type === 'decision') {
        const kind = String(n.extra?.['marker'] ?? 'exclusive');
        if (ins.length <= 1 && outs.length <= 1) out.push(`The gateway "${name(n)}" neither splits nor merges: remove it.`);
        if (outs.length > 1 && (kind === 'exclusive' || kind === 'inclusive') && outs.some((e) => !e.label?.trim())) out.push(`Label each way out of the gateway "${name(n)}" with its condition.`);
      }
      if ((n.type === 'task' || n.type === 'subprocess') && n.label.trim().split(/\s+/).length > 6)
        out.push(`"${name(n).slice(0, 40)}" is long for an activity: a verb and an object, at most 5 words.`);
    }
    const poolOf = (id: string) => String(level.nodes.find((n) => n.id === id)?.extra?.['pool'] ?? '');
    for (const e of level.edges) if (e.message && poolOf(e.from) && poolOf(e.from) === poolOf(e.to)) out.push(`The message flow ${e.label || e.id} stays inside one pool: use a sequence flow there.`);
    if (flow.length > STEP_BUDGET) out.push(`${level.name} has ${flow.length} steps (keep to ${STEP_BUDGET}): fold parts into sub-processes.`);
  }
  return out;
}

/** BPMN read for the assistant, with what to fix; throws when it can't be read. */
export function readBpmnSource(text: string): { data: FlowData; checks: string[] } {
  const parsed = parseBpmn(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return { data: parsed.data, checks: [...parsed.warnings, ...bpmnChecks(parsed.data)] };
}

/** The board's BPMN processes: their outer frames' ids (only the processes themselves, not sub-processes, when asked). */
export const bpmnsOn = (doc: Y.Doc, topOnly = false): string[] => flowchartsOn(doc, topOnly, 'bpmn');

/** A process on the board written as BPMN 2.0 XML, with where its steps and lanes are from the diagram's corner. */
export function bpmnBoard(doc: Y.Doc, diagramId: string): string | null {
  const data = bpmnsOn(doc).includes(diagramId) ? readFlowchartTree(doc, diagramId) : null;
  if (!data) return null;
  const frame = doc.getMap<Y.Map<unknown>>('nodes').get(diagramId)!;
  const ox = Number(frame.get('x')) || 0;
  const oy = Number(frame.get('y')) || 0;
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const p of partsOf(doc, diagramId)) {
    const box = { x: p.x - ox, y: p.y - oy, w: Number(p.node.get('w')) || 0, h: Number(p.node.get('h')) || 0 };
    if (p.part.role === 'step') boxes.set(p.part.key, box);
    if (p.part.role === 'lane') boxes.set(`lane:${p.part.key}`, box);
  }
  return bpmnText(data, boxes);
}

/** Rewrites a process on the board, sub-processes included, from a new model. */
export const rewriteBpmn = (doc: Y.Doc, diagramId: string, data: FlowData, author = 'assistant'): void => rewriteFlowchartTree(doc, diagramId, data, author);
