import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { besideBoard } from '../apps/app-node';
import { topZ } from '../assist/board-edit';
import { nodesOf } from './flowchart';
import { sequenceEngine } from './vendor/sequence';
import { cleanSequence, type SequenceModel } from './sequence-model';

export * from './sequence-model';

/**
 * Editable sequence diagrams, as corkboard-ui keeps them (its diagrams/sequence.ts; keep the model's cleaning and the
 * item's size in step): one item of kind "sequence" holding the Ultimate Diagram skill's sequence model, laid out by
 * the skill's engine (vendor/), read from and written as Mermaid's sequenceDiagram.
 */

const TOKENS = { font: { metrics: { label: 7.4, title: 7.4, detail: 6.4, note: 6.2, type: 6.6, edgeLabel: 7, edgeWrap: 6.6 } } };

/** The engine's pixels to the board's, as for every editable diagram. */
const S = 1.25;
/** The skill's budget: more than this is a diagram to split. */
const BUDGET = { participants: 6, messages: 16, depth: 3, colours: 4 };

interface SeqEngine {
  layoutDiagram(data: unknown): void;
  fromMermaid(text: string): { data?: unknown; warnings?: string[]; infos?: string[] } | null;
  toMermaid(data: unknown): string;
}
let engine: SeqEngine | undefined;
const seq = (): SeqEngine => (engine ??= sequenceEngine(TOKENS) as SeqEngine);

/** Whether text is a Mermaid sequence diagram (front matter and comments allowed before it). */
export function isSequenceSource(text: string): boolean {
  const body = text.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  const first = body.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%'));
  return !!first && /^\s*sequenceDiagram\b/.test(first);
}

/** A sequence diagram read from Mermaid, with what to fix (from the reader and the skill's audit). */
export function readSequenceSource(text: string): { model: SequenceModel; checks: string[] } {
  const read = seq().fromMermaid(text);
  if (!read) throw new Error('The sequence diagram could not be read.');
  const model = cleanSequence(read.data ?? read);
  if (!model.participants.length) throw new Error('The sequence diagram has no participants: declare them with participant or actor lines.');
  if (!model.messages.length) throw new Error('The sequence diagram has no messages: write them as A->>B: label.');
  return { model, checks: [...(read.warnings ?? []), ...sequenceChecks(model)] };
}

/** The skill's audit, as far as it isn't the layout's job: the size budget, nesting, colours and loose ends. */
export function sequenceChecks(model: SequenceModel): string[] {
  const out: string[] = [];
  const name = new Map(model.participants.map((p) => [p.id, p.name]));
  if (model.participants.length > BUDGET.participants)
    out.push(`${model.participants.length} participants (keep to ${BUDGET.participants}): split the flow into diagrams, or fold the minor ones together.`);
  if (model.messages.length > BUDGET.messages) out.push(`${model.messages.length} messages (keep to ${BUDGET.messages}): split the flow, or fold a phase into a group frame.`);
  const used = new Set(model.messages.flatMap((m) => [m.from, m.to]));
  for (const p of model.participants) if (!used.has(p.id)) out.push(`"${p.name}" sends and receives nothing: remove it, or add its messages.`);
  for (const m of model.messages) if (!m.label.trim()) out.push(`The message from "${name.get(m.from)}" to "${name.get(m.to)}" has no label: say what is sent.`);
  for (const n of model.notes) if (!n.text.trim()) out.push(`Note ${n.id} has no text.`);
  // Frames nest at most three deep (coloured phases don't count).
  const order = new Map(model.messages.map((m, i) => [m.id, i]));
  const spans = model.fragments.filter((f) => f.kind !== 'group').map((f) => ({ id: f.id, a: order.get(f.from)!, b: order.get(f.to)! }));
  const depth = (s: { id: string; a: number; b: number }): number => 1 + Math.max(0, ...spans.filter((o) => o.id !== s.id && s.a <= o.a && o.b <= s.b && (o.a !== s.a || o.b !== s.b)).map(depth));
  const deepest = Math.max(0, ...spans.map(depth));
  if (deepest > BUDGET.depth) out.push(`Frames nest ${deepest} deep (keep to ${BUDGET.depth}): put a rare exit in a note, or split the flow.`);
  // A folded frame that half-overlaps another can't be hidden whole.
  for (const f of model.fragments.filter((x) => x.collapsed)) {
    const a = order.get(f.from)!;
    const b = order.get(f.to)!;
    const cut = model.fragments.find(
      (o) => o.id !== f.id && ((order.get(o.from)! < a && a <= order.get(o.to)! && order.get(o.to)! < b) || (a < order.get(o.from)! && order.get(o.from)! <= b && b < order.get(o.to)!)),
    );
    if (cut) out.push(`The folded frame "${f.label}" partly overlaps "${cut.label}": half a frame cannot be hidden.`);
  }
  const colours = new Set(model.participants.flatMap((p) => (p.color ? [p.color] : [])));
  if (colours.size > BUDGET.colours) out.push(`${colours.size} participant colours: colour should group participants (ours, a partner's, a third party's), at most ${BUDGET.colours}.`);
  return out;
}

/** A diagram written as Mermaid. */
export const modelMermaid = (model: SequenceModel): string => seq().toMermaid({ diagramType: 'sequence', ...structuredClone(model) });

/** The size of the item that shows a diagram, as corkboard-ui's sequenceSize. */
export function sequenceSize(model: SequenceModel): { w: number; h: number } {
  const data = { diagramType: 'sequence', ...structuredClone(model) } as { layout?: { width: number; height: number } };
  seq().layoutDiagram(data);
  return { w: Math.round(Math.max(1, data.layout?.width ?? 1) * S), h: Math.round(Math.max(1, data.layout?.height ?? 1) * S) };
}

/** Puts a sequence diagram beside what's on the board and returns its id. */
export function placeSequence(doc: Y.Doc, model: SequenceModel, author = 'assistant'): string {
  const id = randomUUID();
  const clean = cleanSequence(model);
  const { w, h } = sequenceSize(clean);
  const at = besideBoard(doc);
  const z = topZ(doc) + 1;
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    nodesOf(doc).set(id, node);
    node.set('kind', 'sequence');
    node.set('x', at.x);
    node.set('y', at.y);
    node.set('w', w);
    node.set('h', h);
    node.set('z', z);
    node.set('sequence', clean);
    node.set('author', author);
  });
  return id;
}

/** The ids of the board's sequence diagrams. */
export function sequencesOn(doc: Y.Doc): string[] {
  const ids: string[] = [];
  nodesOf(doc).forEach((node, id) => {
    if (node instanceof Y.Map && node.get('kind') === 'sequence') ids.push(id);
  });
  return ids;
}

/** A sequence diagram on the board, as its model. */
export function sequenceOf(doc: Y.Doc, id: string): SequenceModel | null {
  const node = nodesOf(doc).get(id);
  return node instanceof Y.Map && node.get('kind') === 'sequence' ? cleanSequence(node.get('sequence')) : null;
}

/** A sequence diagram on the board, written as Mermaid. */
export function sequenceMermaid(doc: Y.Doc, id: string): string | null {
  const model = sequenceOf(doc, id);
  return model ? modelMermaid(model) : null;
}

/** Rewrites a sequence diagram in place from a new model; its top-left corner stays, its size fits. */
export function rewriteSequence(doc: Y.Doc, id: string, model: SequenceModel): boolean {
  const node = nodesOf(doc).get(id);
  if (!(node instanceof Y.Map) || node.get('kind') !== 'sequence') return false;
  const clean = cleanSequence(model);
  const { w, h } = sequenceSize(clean);
  doc.transact(() => {
    node.set('sequence', clean);
    node.set('w', w);
    node.set('h', h);
  });
  return true;
}
