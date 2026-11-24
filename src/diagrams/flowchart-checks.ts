import { parseFlowchart, type FlowData } from './flowchart';

/**
 * What's wrong with a flowchart as written, for the assistant to fix: the Ultimate Diagram skill's flowchart checks and
 * the checkable parts of its writing rules (references/types/flowchart.md, scripts/layout_engine.py FlowchartAudit).
 * Each line names the step, arrow or lane and says how to fix it. An empty list is a clean flowchart.
 */
export const FLOW_LIMITS = { steps: 30, lanes: 6, stepWords: 5, laneWords: 4, noteChars: 140 };

const KINDS = new Set(['start', 'end', 'task', 'decision', 'io', 'document', 'database', 'delay', 'subprocess', 'connector']);
const OUTCOMES = new Set(['yes', 'no', 'true', 'false', 'y', 'n']);
const GENERIC_LANES = new Set(['process', 'steps', 'other', 'misc', 'general', 'tasks']);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const plain = (s: string) => s.trim().replace(/[?.!]+$/, '').toLowerCase();

export function flowchartChecks(data: FlowData): string[] {
  const out: string[] = [];
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const name = (id: string) => `"${byId.get(id)?.label || id}"`;
  const outOf = (id: string) => data.edges.filter((e) => e.from === id);
  const into = (id: string) => data.edges.filter((e) => e.to === id);
  const counted = data.nodes.filter((n) => n.type !== 'start' && n.type !== 'end' && n.type !== 'connector');

  // Size: a flow this big wants splitting into sub-processes by business meaning.
  if (counted.length > FLOW_LIMITS.steps) out.push(`The flow has ${counted.length} steps (at most ${FLOW_LIMITS.steps}): split a block that ends in a business outcome into its own flowchart and keep a sub-process step for it.`);
  if (data.swimlanes !== false && data.lanes.length > FLOW_LIMITS.lanes) out.push(`The flow has ${data.lanes.length} lanes (at most ${FLOW_LIMITS.lanes}): show a system that only stores data as a database step, or split the flow.`);

  // Lanes are actors, briefly named.
  if (data.swimlanes !== false) {
    for (const lane of data.lanes) {
      if (GENERIC_LANES.has(plain(lane.name))) out.push(`Lane "${lane.name}" is not an actor: name who does the work (a role, team or system), or write no subgraph for a one-actor flow.`);
      if (words(lane.name) > FLOW_LIMITS.laneWords) out.push(`Lane "${lane.name}" has ${words(lane.name)} words (at most ${FLOW_LIMITS.laneWords}).`);
    }
  }

  // Steps: known kinds, short and distinct labels.
  const seen = new Map<string, string>();
  for (const n of data.nodes) {
    if (!KINDS.has(n.type)) out.push(`Step ${name(n.id)} is a kind the board doesn't draw (${n.type}); use a task, decision, start/end pill, data, document, database, delay or sub-process.`);
    if (n.type === 'connector') out.push(`Step ${n.id} is a connector: draw the arrow it stands for instead.`);
    if (n.type !== 'connector' && words(n.label) > FLOW_LIMITS.stepWords) out.push(`Step ${name(n.id)} has ${words(n.label)} words (at most ${FLOW_LIMITS.stepWords}): keep the verb and object, and put the detail in a note.`);
    const key = plain(n.label);
    if (key && seen.has(key)) out.push(`Steps ${n.id} and ${seen.get(key)} are both ${name(n.id)}: loop back to one with an arrow instead of repeating it.`);
    else if (key) seen.set(key, n.id);
  }

  // Decisions ask a question and label every branch.
  for (const n of data.nodes.filter((d) => d.type === 'decision')) {
    if (!n.label.trim().endsWith('?')) out.push(`Decision ${name(n.id)} should end with "?".`);
    const branches = outOf(n.id);
    if (branches.length < 2) out.push(`Decision ${name(n.id)} has ${branches.length} way out: give it a branch for each answer (Yes and No).`);
    const unlabelled = branches.filter((e) => !e.label?.trim());
    if (unlabelled.length) out.push(`Decision ${name(n.id)} has ${unlabelled.length} unlabelled branch${unlabelled.length === 1 ? '' : 'es'} (to ${unlabelled.map((e) => name(e.to)).join(', ')}): label each one with its answer.`);
  }
  // Yes/No belongs to decisions.
  const stray = data.edges.filter((e) => OUTCOMES.has(plain(e.label ?? '')) && byId.get(e.from) && byId.get(e.from)!.type !== 'decision');
  for (const e of stray.slice(0, 5)) out.push(`The arrow ${name(e.from)} → ${name(e.to)} says "${e.label}" but leaves a ${byId.get(e.from)!.type}: clear the label, or make ${name(e.from)} a decision.`);

  // A way in and a way out.
  const starts = data.nodes.filter((n) => n.type === 'start' || (n.type === 'end' && outOf(n.id).length > 0));
  const ends = data.nodes.filter((n) => (n.type === 'end' || n.type === 'start') && outOf(n.id).length === 0);
  if (!starts.length) out.push('The flow has no start: open it with a pill naming the trigger, as start(["Order Received"]).');
  if (!ends.length) out.push('The flow has no end: finish each path in a pill naming its outcome, as done(["Order Shipped"]).');
  for (const n of data.nodes) {
    if (n.type === 'start' || n.type === 'end' || n.type === 'connector') continue;
    if (!into(n.id).length && !outOf(n.id).length) out.push(`Step ${name(n.id)} isn't joined to anything: add the arrows into and out of it, or remove it.`);
    else if (!outOf(n.id).length) out.push(`Step ${name(n.id)} leads nowhere: add the arrow to what comes next, or end the path in an end pill.`);
  }

  // Remarks explain steps, briefly, without repeating them.
  for (const note of data.notes ?? []) {
    if (!note.text.trim()) out.push(`Note ${note.id} has no text: remove it.`);
    if (!note.nodes.length) out.push(`Note ${note.id} is joined to no step: join it with -.- to the steps it explains.`);
    if (note.text.length > FLOW_LIMITS.noteChars) out.push(`Note ${note.id} is ${note.text.length} characters (at most ${FLOW_LIMITS.noteChars}): keep the facts a reader needs.`);
    if (note.nodes.some((id) => byId.get(id) && plain(byId.get(id)!.label) === plain(note.text))) out.push(`Note ${note.id} repeats its step's label: remove it, or say what the label can't.`);
  }
  return out;
}

/** Mermaid read as a flowchart and checked; throws (for the model to see) when it can't be read at all. */
export function readFlowchartSource(source: string): { data: FlowData; checks: string[] } {
  const parsed = parseFlowchart(source);
  if ('error' in parsed) throw new Error(`The flowchart couldn't be read: ${parsed.error}`);
  return { data: parsed.data, checks: [...parsed.warnings, ...flowchartChecks(parsed.data)] };
}

/** The checks, as a line for the model's tool result: what to fix, and how. */
export function checkNote(checks: string[]): string {
  if (!checks.length) return '';
  const shown = checks.slice(0, 12);
  const more = checks.length - shown.length;
  return ` It needs fixing; rewrite it with change_diagram (same id), keeping the step ids you mean to keep:\n${shown.map((c) => `- ${c}`).join('\n')}${more ? `\n- …and ${more} more` : ''}`;
}
