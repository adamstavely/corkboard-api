import type * as Y from 'yjs';
import { flowchartsOn, readFlowchartTree, rewriteFlowchartTree, type ChildData, type FlowData, type FlowEdge, type FlowLane, type FlowNode } from './flowchart';

/**
 * State machines, from Mermaid's stateDiagram-v2, drawn as flowcharts of a kind of their own (the diagram's part type
 * is "state"): states are rounded steps, [*] a dot where the machine starts and another where it ends, choices
 * diamonds, forks and joins bars, composite states sub-processes opened on their own, and a composite's concurrent
 * regions lanes inside it. The flowchart engine lays them out. The reader and writer are kept the same as corkboard-ui's
 * diagrams/state.ts.
 */

/** A pseudo-state's kind, as a step's type: the flowchart engine takes start, end, decision and task as it knows them. */
export const STATE_STEPS = ['start', 'end', 'task', 'decision', 'fork', 'join', 'subprocess'] as const;

interface Scope {
  /** The composite state this is the inside of; null for the machine itself. */
  id: string | null;
  regions: {
    nodes: string[];
    edges: FlowEdge[];
    start?: string;
    end?: string;
    direction?: 'LR' | 'TB';
  }[];
}
interface State {
  id: string;
  label: string;
  type: 'task' | 'decision' | 'fork' | 'join' | 'subprocess' | 'start' | 'end';
  scope: string | null;
  region: number;
}

const ID = /^[A-Za-z_][\w.-]*$/;
const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

/** Whether text is a Mermaid state diagram (front matter and comments allowed before it). */
export function isStateText(text: string): boolean {
  const body = text.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  const first = body.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%'));
  return !!first && /^\s*stateDiagram(-v2)?\b/.test(first);
}

/**
 * A state diagram read as a flowchart's model: the machine's states and transitions, each composite state's inside as
 * a sub-process under the composite's id (its regions as lanes), and notes as remarks. What can't be kept is said.
 */
export function parseState(text: string): { data: FlowData; warnings: string[] } | { error: string } {
  const warnings: string[] = [];
  const front = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(text);
  const title = front ? /^title:\s*(.+)$/m.exec(front[1])?.[1].trim() : undefined;
  const lines = text
    .slice(front ? front[0].length : 0)
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim());
  const header = lines.findIndex((l) => l);
  if (header < 0 || !/^stateDiagram(-v2)?$/.test(lines[header])) return { error: 'A state diagram starts with stateDiagram-v2.' };

  const states = new Map<string, State>();
  const scopes = new Map<string | null, Scope>([[null, { id: null, regions: [{ nodes: [], edges: [] }] }]]);
  const notes: { id: string; text: string; state: string }[] = [];
  const stack: (string | null)[] = [null];
  let direction: 'LR' | 'TB' = 'TB';
  let nextId = 1;
  const here = () => scopes.get(stack[stack.length - 1])!;
  const region = () => here().regions[here().regions.length - 1];
  const regionIndex = () => here().regions.length - 1;

  /** A state, made in the current scope the first time it's named. */
  const state = (id: string, label?: string, type: State['type'] = 'task'): State => {
    let s = states.get(id);
    if (!s) {
      s = { id, label: label ?? id, type, scope: stack[stack.length - 1], region: regionIndex() };
      states.set(id, s);
      region().nodes.push(id);
    } else {
      if (label !== undefined) s.label = label;
      if (type !== 'task') s.type = type;
    }
    return s;
  };
  /** The current region's start or end dot. */
  const dot = (end: boolean): string => {
    const r = region();
    const key = end ? 'end' : 'start';
    if (!r[key]) {
      const id = `${key}_${nextId++}`;
      r[key] = id;
      states.set(id, {
        id,
        label: '',
        type: key,
        scope: stack[stack.length - 1],
        region: regionIndex(),
      });
      r.nodes.push(id);
    }
    return r[key];
  };

  let noteOpen: { state: string; lines: string[] } | null = null;
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i];
    if (noteOpen) {
      if (/^end\s+note$/.test(line)) {
        notes.push({
          id: `n${notes.length + 1}`,
          text: noteOpen.lines.join('\n').trim(),
          state: noteOpen.state,
        });
        noteOpen = null;
      } else noteOpen.lines.push(line);
      continue;
    }
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(LR|RL|TB|TD|BT)$/i.exec(line))) {
      const dir = /^(LR|RL)$/i.test(m[1]) ? 'LR' : 'TB';
      if (stack.length === 1) direction = dir;
      else region().direction = dir;
    } else if (line === '}') {
      if (stack.length > 1) stack.pop();
      else warnings.push('A "}" closes nothing: left out.');
    } else if (line === '--') {
      if (stack.length > 1) here().regions.push({ nodes: [], edges: [] });
      else warnings.push('"--" splits a composite state into regions: the machine itself has none.');
    } else if ((m = /^state\s+(?:"([^"]*)"\s+as\s+)?([A-Za-z_][\w.-]*)(?:\s+<<(choice|fork|join)>>)?\s*(\{)?$/.exec(line))) {
      const [, label, id, pseudo, open] = m;
      if (open) {
        state(id, label, 'subprocess');
        if (!scopes.has(id)) scopes.set(id, { id, regions: [{ nodes: [], edges: [] }] });
        stack.push(id);
      } else state(id, label, pseudo === 'choice' ? 'decision' : pseudo === 'fork' ? 'fork' : pseudo === 'join' ? 'join' : 'task');
    } else if ((m = /^state\s+([A-Za-z_][\w.-]*)\s+as\s+"([^"]*)"$/.exec(line))) {
      state(m[1], m[2]);
    } else if ((m = /^note\s+(?:left|right)\s+of\s+([A-Za-z_][\w.-]*)\s*(?::\s*(.*))?$/.exec(line))) {
      state(m[1]);
      if (m[2] !== undefined) notes.push({ id: `n${notes.length + 1}`, text: m[2].trim(), state: m[1] });
      else noteOpen = { state: m[1], lines: [] };
    } else if ((m = /^(\[\*\]|[A-Za-z_][\w.-]*)\s*-->\s*(\[\*\]|[A-Za-z_][\w.-]*)\s*(?::\s*(.*))?$/.exec(line))) {
      const from = m[1] === '[*]' ? dot(false) : state(m[1]).id;
      const to = m[2] === '[*]' ? dot(true) : state(m[2]).id;
      region().edges.push({
        id: `t${nextId++}`,
        from,
        to,
        ...(m[3]?.trim() ? { label: m[3].trim().slice(0, 200) } : {}),
      });
    } else if ((m = /^([A-Za-z_][\w.-]*)\s*:\s*(.+)$/.exec(line))) {
      const s = state(m[1]);
      s.label = s.label === s.id ? unquote(m[2]) : `${s.label}\n${unquote(m[2])}`;
    } else if (ID.test(line)) {
      state(line);
    } else if (/^(classDef|class|style|click|accTitle|accDescr)\b/.test(line) || line.includes(':::')) {
      // Styling: the board draws states in its own colours.
    } else {
      warnings.push(`Line ${i + 1} wasn't understood and is left out: ${line.slice(0, 60)}`);
    }
  }
  if (noteOpen) warnings.push('A note has no "end note": left out.');
  if (![...states.values()].some((s) => s.type !== 'start' && s.type !== 'end')) return { error: 'The state diagram has no states.' };

  // Transitions that cross into or out of a composite state are drawn to the composite, at the level both ends share.
  const chain = (id: string): string[] => {
    const out: string[] = [];
    for (let s: string | null = id; s !== null; s = states.get(s)?.scope ?? null) out.push(s);
    return out;
  };
  for (const [scopeId, scope] of scopes) {
    for (const r of scope.regions) {
      for (const e of r.edges) {
        const a = chain(e.from);
        const b = chain(e.to);
        if (states.get(e.from)!.scope === scopeId && states.get(e.to)!.scope === scopeId) continue;
        // Where the transition is drawn: the deepest scope that holds both ends.
        const shared = [...a.map((x) => states.get(x)?.scope ?? null)].find((sc) => b.some((y) => (states.get(y)?.scope ?? null) === sc)) ?? null;
        const lift = (c: string[]): string => c.find((x) => states.get(x)!.scope === shared) ?? c[0];
        const from = lift(a);
        const to = lift(b);
        warnings.push(`The transition ${e.from} → ${e.to} crosses a composite state's edge: drawn from ${from} to ${to}.`);
        e.from = from;
        e.to = to;
        if (shared !== scopeId) {
          r.edges = r.edges.filter((x) => x !== e);
          const into = scopes.get(shared)!;
          into.regions[states.get(from)!.region]?.edges.push(e);
        }
      }
    }
  }

  const nodeOf = (id: string, lane?: string): FlowNode => {
    const s = states.get(id)!;
    return { id, ...(lane ? { laneId: lane } : {}), type: s.type, label: s.label };
  };
  const notesIn = (ids: Set<string>) => notes.filter((n) => ids.has(n.state)).map((n) => ({ id: n.id, text: n.text.slice(0, 1000), nodes: [n.state] }));
  const root = scopes.get(null)!.regions[0];
  const lanes: FlowLane[] = [{ id: 'lane-main', name: 'Process' }];
  const children: Record<string, ChildData> = {};
  for (const [scopeId, scope] of scopes) {
    if (scopeId === null) continue;
    const many = scope.regions.length > 1;
    const regionLanes = scope.regions.map((_, i) => ({
      id: `${scopeId}__region${i + 1}`,
      name: `Region ${i + 1}`,
    }));
    if (many) lanes.push(...regionLanes);
    const nodes = scope.regions.flatMap((r, i) => r.nodes.map((id) => nodeOf(id, many ? regionLanes[i].id : undefined)));
    if (!nodes.length) continue;
    children[scopeId] = {
      name: states.get(scopeId)!.label,
      ...(many ? { laneOrder: regionLanes.map((l) => l.id) } : {}),
      nodes,
      edges: scope.regions.flatMap((r) => r.edges),
      ...(notesIn(new Set(nodes.map((n) => n.id))).length ? { notes: notesIn(new Set(nodes.map((n) => n.id))) } : {}),
    };
  }
  // A composite with nothing inside is an ordinary state.
  for (const s of states.values()) if (s.type === 'subprocess' && !children[s.id]) s.type = 'task';
  const rootNodes = root.nodes.map((id) => nodeOf(id));
  const rootNotes = notesIn(new Set(root.nodes));
  return {
    data: {
      diagramType: 'flowchart',
      ...(title ? { title } : {}),
      direction,
      swimlanes: false,
      lanes,
      nodes: rootNodes,
      edges: root.edges,
      ...(rootNotes.length ? { notes: rootNotes } : {}),
      ...(Object.keys(children).length ? { children } : {}),
    },
    warnings,
  };
}

const quote = (s: string) => s.replace(/"/g, "'").replace(/\n/g, ' ');

/** A state machine's model written as Mermaid stateDiagram-v2. */
export function stateText(data: FlowData): string {
  const out: string[] = [];
  if (data.title) out.push('---', `title: ${data.title.replace(/\n/g, ' ')}`, '---');
  out.push('stateDiagram-v2', `  direction ${data.direction === 'LR' ? 'LR' : 'TB'}`);
  const children = (data.children ?? {}) as Record<string, ChildData>;
  const write = (nodes: FlowNode[], edges: FlowEdge[], notes: FlowData['notes'], indent: string, seen: Set<string>): void => {
    const starts = new Set(nodes.filter((n) => n.type === 'start').map((n) => n.id));
    const ends = new Set(nodes.filter((n) => n.type === 'end').map((n) => n.id));
    for (const n of nodes) {
      if (starts.has(n.id) || ends.has(n.id)) continue;
      const pseudo = n.type === 'decision' ? 'choice' : n.type === 'fork' || n.type === 'join' ? n.type : null;
      if (pseudo) out.push(`${indent}state ${n.id} <<${pseudo}>>`);
      else if (n.type === 'subprocess' && children[n.id] && !seen.has(n.id)) {
        seen.add(n.id);
        const child = children[n.id];
        out.push(`${indent}state ${n.label && n.label !== n.id ? `"${quote(n.label)}" as ` : ''}${n.id} {`);
        const regions = child.laneOrder?.length ? child.laneOrder : [undefined];
        regions.forEach((lane, i) => {
          if (i) out.push(`${indent}  --`);
          const own = child.nodes.filter((c) => lane === undefined || c.laneId === lane);
          const ids = new Set(own.map((c) => c.id));
          write(
            own,
            child.edges.filter((e) => ids.has(e.from)),
            child.notes?.filter((x) => x.nodes.some((id) => ids.has(id))),
            `${indent}  `,
            seen,
          );
        });
        out.push(`${indent}}`);
      } else if (n.label && n.label !== n.id) out.push(`${indent}state "${quote(n.label)}" as ${n.id}`);
      else out.push(`${indent}${n.id}`);
    }
    for (const e of edges) {
      const from = starts.has(e.from) ? '[*]' : e.from;
      const to = ends.has(e.to) ? '[*]' : e.to;
      out.push(`${indent}${from} --> ${to}${e.label ? ` : ${e.label.replace(/\n/g, ' ')}` : ''}`);
    }
    for (const note of notes ?? []) {
      const at = note.nodes.find((id) => !starts.has(id) && !ends.has(id));
      if (!at) continue;
      if (note.text.includes('\n')) out.push(`${indent}note right of ${at}`, ...note.text.split('\n').map((l) => `${indent}  ${l}`), `${indent}end note`);
      else out.push(`${indent}note right of ${at} : ${note.text}`);
    }
  };
  write(data.nodes, data.edges, data.notes, '  ', new Set());
  return `${out.join('\n')}\n`;
}

/** What a new state machine starts as: an order, from placed to delivered or cancelled. */
export const STATE_STARTER = `---
title: Order
---
stateDiagram-v2
  direction LR
  [*] --> Placed
  Placed --> Paid : payment received
  Placed --> Cancelled : customer cancels
  state paid_check <<choice>>
  Paid --> paid_check
  paid_check --> Shipped : [in stock]
  paid_check --> Backordered : [out of stock]
  Backordered --> Shipped : stock arrives
  Shipped --> Delivered : signed for
  Delivered --> [*]
  Cancelled --> [*]
  note right of Backordered : The customer is told the new date
`;

/** At most this many states on one level of a machine before it should be split (or nested in composites). */
const STATE_BUDGET = 15;

/**
 * What to fix in a state machine, level by level (the machine, then each composite state's inside): a start, every
 * state reachable from it, a way out of every state that isn't an end, guards on every way out of a choice, forks that
 * split and joins that merge, short transition labels, and a size people can read.
 */
export function stateChecks(data: FlowData): string[] {
  const out: string[] = [];
  const levels: { name: string; nodes: FlowNode[]; edges: FlowEdge[] }[] = [
    { name: 'The machine', nodes: data.nodes, edges: data.edges },
    ...Object.entries((data.children ?? {}) as Record<string, ChildData>).map(([id, c]) => ({ name: `Inside ${c.name || id}`, nodes: c.nodes, edges: c.edges })),
  ];
  for (const level of levels) {
    const ids = new Set(level.nodes.map((n) => n.id));
    const label = (id: string) => level.nodes.find((n) => n.id === id)?.label || id;
    const outs = (id: string) => level.edges.filter((e) => e.from === id && ids.has(e.to));
    const ins = (id: string) => level.edges.filter((e) => e.to === id && ids.has(e.from));
    const starts = level.nodes.filter((n) => n.type === 'start');
    const states = level.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
    if (!starts.length) out.push(`${level.name} has no start: add [*] --> the first state.`);
    // Reachable from a start (each region of a composite has its own).
    const seen = new Set(starts.map((n) => n.id));
    const todo = [...seen];
    while (todo.length) for (const e of outs(todo.pop()!)) if (!seen.has(e.to)) todo.push((seen.add(e.to), e.to));
    if (starts.length) for (const s of states) if (!seen.has(s.id)) out.push(`"${label(s.id)}" can't be reached from the start: add a transition into it, or remove it.`);
    for (const s of states) {
      const away = outs(s.id);
      if (!away.length && s.type !== 'subprocess') out.push(`"${label(s.id)}" has no way out: add a transition from it, or one to [*] if the machine ends there.`);
      if (s.type === 'decision') {
        if (away.length < 2) out.push(`The choice "${label(s.id)}" has ${away.length} way${away.length === 1 ? '' : 's'} out: a choice has two or more.`);
        if (away.some((e) => !e.label?.trim())) out.push(`Label each way out of the choice "${label(s.id)}" with its guard, as [condition].`);
      }
      if (s.type === 'fork' && away.length < 2) out.push(`The fork "${label(s.id)}" splits into ${away.length}: a fork starts two or more states at once.`);
      if (s.type === 'join' && ins(s.id).length < 2) out.push(`The join "${label(s.id)}" waits for ${ins(s.id).length}: a join brings two or more together.`);
    }
    for (const e of level.edges) if ((e.label ?? '').length > 60) out.push(`The transition label "${e.label!.slice(0, 30)}…" is long: keep to event [guard] / action, under 60 characters.`);
    if (states.length > STATE_BUDGET) out.push(`${level.name} has ${states.length} states (keep to ${STATE_BUDGET}): group related ones into composite states.`);
  }
  return out;
}

/** A state diagram read for the assistant, with what to fix; throws when it can't be read. */
export function readStateSource(text: string): { data: FlowData; checks: string[] } {
  const parsed = parseState(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return { data: parsed.data, checks: [...parsed.warnings, ...stateChecks(parsed.data)] };
}

/** The board's state machines: their outer frames' ids (only the machines themselves, not composites' insides, when asked). */
export const statesOn = (doc: Y.Doc, topOnly = false): string[] => flowchartsOn(doc, topOnly, 'state');

/** A state machine on the board written as Mermaid stateDiagram-v2. */
export function stateMermaid(doc: Y.Doc, diagramId: string): string | null {
  const data = statesOn(doc).includes(diagramId) ? readFlowchartTree(doc, diagramId) : null;
  return data ? stateText(data) : null;
}

/** Rewrites a state machine on the board, composites included, from a new model. */
export const rewriteState = (doc: Y.Doc, diagramId: string, data: FlowData, author = 'assistant'): void => rewriteFlowchartTree(doc, diagramId, data, author);
