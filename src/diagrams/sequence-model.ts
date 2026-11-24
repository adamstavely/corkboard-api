/**
 * A sequence diagram's model, as the board keeps it (corkboard-ui's diagrams/sequence.ts; keep the cleaning in step):
 * the Ultimate Diagram skill's sequence model. No imports, so anything can read a board's sequence diagrams.
 */

export const PARTICIPANT_KINDS = ['system', 'actor', 'ui', 'database', 'queue', 'external'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];
export const MESSAGE_KINDS = ['sync', 'reply', 'async'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const FRAME_KINDS = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group'] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

export interface SeqParticipant {
  id: string;
  name: string;
  kind?: ParticipantKind;
  color?: string;
}
export interface SeqMessage {
  id: string;
  from: string;
  to: string;
  label: string;
  detail?: string;
  kind?: MessageKind;
  activate?: false;
  until?: string;
}
export interface SeqFragment {
  id: string;
  kind: FrameKind;
  label: string;
  from: string;
  to: string;
  branches?: { at: string; label?: string }[];
  color?: string;
  collapsed?: boolean;
}
export interface SeqNote {
  id: string;
  text: string;
  over?: string | string[];
  after?: string;
  before?: string;
}
export interface SequenceModel {
  title?: string;
  participants: SeqParticipant[];
  messages: SeqMessage[];
  fragments: SeqFragment[];
  notes: SeqNote[];
  numbered?: boolean;
  showDetails?: boolean;
  rails?: boolean;
  lifespans?: boolean;
}

/** As corkboard-ui's SEQ_LIMITS. */
export const SEQ_LIMITS = { participants: 30, messages: 300, fragments: 80, notes: 100, text: 400 };
const str = (v: unknown, max = SEQ_LIMITS.text): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const idOf = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : null);
const slot = (v: unknown): string | undefined => (typeof v === 'string' && /^[1-6]$/.test(v) ? v : undefined);

/** A model as stored, anything malformed or dangling left out, within the limits (as corkboard-ui's cleanSequence). */
export function cleanSequence(raw: unknown): SequenceModel {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const seen = new Set<string>();
  const unique = (id: string | null): id is string => !!id && !seen.has(id) && !!seen.add(id);

  const participants: SeqParticipant[] = [];
  for (const p of list(r['participants'])) {
    const id = idOf(p['id']);
    if (!unique(id) || participants.length >= SEQ_LIMITS.participants) continue;
    const kind = PARTICIPANT_KINDS.includes(p['kind'] as ParticipantKind) ? (p['kind'] as ParticipantKind) : undefined;
    const color = slot(p['color']);
    participants.push({ id, name: str(p['name'], 80) || id, ...(kind && kind !== 'system' ? { kind } : {}), ...(color ? { color } : {}) });
  }
  const pids = new Set(participants.map((p) => p.id));

  const messages: SeqMessage[] = [];
  for (const m of list(r['messages'])) {
    const id = idOf(m['id']);
    const from = idOf(m['from']);
    const to = idOf(m['to']);
    if (!from || !to || !pids.has(from) || !pids.has(to) || !unique(id) || messages.length >= SEQ_LIMITS.messages) continue;
    const kind = MESSAGE_KINDS.includes(m['kind'] as MessageKind) ? (m['kind'] as MessageKind) : undefined;
    const detail = str(m['detail']);
    messages.push({
      id,
      from,
      to,
      label: str(m['label']),
      ...(detail ? { detail } : {}),
      ...(kind && kind !== 'sync' ? { kind } : {}),
      ...(m['activate'] === false ? { activate: false as const } : {}),
      ...(idOf(m['until']) ? { until: m['until'] as string } : {}),
    });
  }
  const at = new Map(messages.map((m, i) => [m.id, i]));
  for (const m of messages) if (m.until !== undefined && !at.has(m.until)) delete m.until;

  const fragments: SeqFragment[] = [];
  for (const f of list(r['fragments'])) {
    const id = idOf(f['id']);
    let from = idOf(f['from']);
    let to = idOf(f['to']);
    if (!from || !to || !at.has(from) || !at.has(to) || !unique(id) || fragments.length >= SEQ_LIMITS.fragments) continue;
    if (at.get(from)! > at.get(to)!) [from, to] = [to, from];
    const kind = FRAME_KINDS.includes(f['kind'] as FrameKind) ? (f['kind'] as FrameKind) : 'opt';
    const lo = at.get(from)!;
    const hi = at.get(to)!;
    const branches = list(f['branches'] ?? (f['elseAt'] !== undefined ? [{ at: f['elseAt'] }] : []))
      .map((b) => ({ at: idOf(b['at']), label: str(b['label'], 120) }))
      .filter((b): b is { at: string; label: string } => !!b.at && at.has(b.at) && at.get(b.at)! > lo && at.get(b.at)! <= hi)
      .map((b) => (b.label ? b : { at: b.at }));
    const color = slot(f['color']);
    fragments.push({
      id,
      kind,
      label: str(f['label'], 120),
      from,
      to,
      ...(branches.length && (kind === 'alt' || kind === 'par' || kind === 'critical') ? { branches } : {}),
      ...(color ? { color } : {}),
      ...(f['collapsed'] === true ? { collapsed: true } : {}),
    });
  }

  const notes: SeqNote[] = [];
  for (const n of list(r['notes'])) {
    const id = idOf(n['id']);
    if (!unique(id) || notes.length >= SEQ_LIMITS.notes) continue;
    const over = (Array.isArray(n['over']) ? n['over'] : [n['over']])
      .map(idOf)
      .filter((p): p is string => !!p && pids.has(p))
      .slice(0, 2);
    if (!over.length) continue;
    const after = idOf(n['after']);
    const before = idOf(n['before']);
    notes.push({
      id,
      text: str(n['text']),
      over: over.length === 1 ? over[0] : over,
      ...(after && at.has(after) ? { after } : before && at.has(before) ? { before } : {}),
    });
  }

  const title = str(r['title'], 120);
  return {
    ...(title ? { title } : {}),
    participants,
    messages,
    fragments,
    notes,
    ...(r['numbered'] === true ? { numbered: true } : {}),
    ...(r['showDetails'] === false ? { showDetails: false } : {}),
    ...(r['rails'] === true ? { rails: true } : {}),
    ...(r['lifespans'] === true ? { lifespans: true } : {}),
  };
}

/** A sequence diagram's words, for search: its title, participants and messages. */
export function sequenceWords(raw: unknown): string {
  const model = cleanSequence(raw);
  const name = new Map(model.participants.map((p) => [p.id, p.name]));
  return [model.title ?? '', ...model.participants.map((p) => p.name), ...model.messages.map((m) => `${name.get(m.from)} → ${name.get(m.to)}: ${m.label}`), ...model.notes.map((n) => n.text)]
    .filter(Boolean)
    .join('\n');
}
