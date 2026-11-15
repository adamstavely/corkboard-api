import { createHash } from 'node:crypto';
import * as Y from 'yjs';

/**
 * What a participant from outside the team sees of a board: a copy of it, kept up to date by the server, with nobody's
 * identity in it but what they may see. A participant never gets the board's own document, which carries everyone's
 * ids and names (note authors, the userId keys of votes, reactions and poll answers, chat, the change history...).
 *
 * - Everyone's notes, frames and the rest, without who made them.
 * - Participants' notes say who wrote them as the board allows: by name, as "Participant 4", or (seeing only their own)
 *   not at all, since the others' aren't there.
 * - Votes, reactions and poll answers are keyed by stand-ins ("p4" for a participant, "t…" for the team) so they still
 *   add up; seeing only their own, a participant gets just theirs, and the rest only once the vote or poll is over.
 * - The timer, agenda, poll, planning poker, private mode and where the facilitator brings everyone; the facilitator's name, not id.
 * - Never chat, the change history, the summary, hidden writing or breakouts.
 */
export type Visibility = 'names' | 'anonymous' | 'own';

export interface Audience {
  userId: string;
  visibility: Visibility;
}

/** Someone who joined through the board's feedback link. */
export interface Participant {
  pseudonym: number;
  name: string;
}

/** What a participant's own things are keyed by, in their projection: they know their pseudonym. */
export const participantKey = (pseudonym: number) => `p${pseudonym}`;
const teamKey = (userId: string) => `t${createHash('sha256').update(userId).digest('hex').slice(0, 10)}`;

/** Fields that say who made something; none reach a projection. */
const IDENTITY = new Set(['author', 'authorName', 'createdBy', 'participant']);
/** The parts of the board copied as they are (none carry anyone's id). */
const AS_THEY_ARE = ['timer', 'agenda', 'poll', 'poker', 'privacy', 'spotlight'];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v: unknown) => (v instanceof Y.AbstractType ? (v.toJSON() as unknown) : v);

/** Makes `target` hold `wanted` (key to value), changing only what differs so clients redraw only that. */
function syncMap(target: Y.Map<unknown>, wanted: ReadonlyMap<string, unknown>): void {
  for (const key of [...target.keys()]) if (!wanted.has(key)) target.delete(key);
  for (const [key, value] of wanted) {
    const there = target.get(key);
    if (target.has(key) && same(plain(there), plain(value))) continue;
    target.set(key, value instanceof Y.AbstractType ? (value as Y.AbstractType<unknown> & { clone(): Y.AbstractType<unknown> }).clone() : value);
  }
}

/** Brings `target` up to date with what this participant may see of `board`. */
export function project(board: Y.Doc, target: Y.Doc, audience: Audience, participants: ReadonlyMap<string, Participant>): void {
  const me = participants.get(audience.userId);
  const keyOf = (userId: string) => {
    const p = participants.get(userId);
    return p ? participantKey(p.pseudonym) : teamKey(userId);
  };
  const mine = (userId: string) => userId === audience.userId;
  const own = audience.visibility === 'own';

  target.transact(() => {
    // ── What's on the board ──
    const nodes = board.getMap<Y.Map<unknown>>('nodes');
    const shown = new Map<string, Y.Map<unknown>>();
    const bylines = new Map<string, { byline: string; by: string }>();
    nodes.forEach((node, id) => {
      if (!(node instanceof Y.Map) || node.get('kind') === 'connector') return;
      const author = node.get('participant') === true && typeof node.get('author') === 'string' ? (node.get('author') as string) : null;
      if (author) {
        if (own && !mine(author)) return;
        const p = participants.get(author);
        const byline = mine(author) ? 'You' : audience.visibility === 'names' ? (p?.name ?? 'A participant') : p ? `Participant ${p.pseudonym}` : 'A participant';
        bylines.set(id, { byline, by: keyOf(author) });
      }
      shown.set(id, node);
    });
    // Arrows go only between things that are shown.
    nodes.forEach((node, id) => {
      if (node instanceof Y.Map && node.get('kind') === 'connector' && shown.has(String(node.get('from'))) && shown.has(String(node.get('to')))) shown.set(id, node);
    });

    const out = target.getMap<Y.Map<unknown>>('nodes');
    for (const id of [...out.keys()]) if (!shown.has(id)) out.delete(id);
    for (const [id, node] of shown) {
      let copy = out.get(id);
      if (!(copy instanceof Y.Map)) {
        copy = new Y.Map<unknown>();
        out.set(id, copy);
      }
      const fields = new Map<string, unknown>();
      node.forEach((value, key) => {
        if (!IDENTITY.has(key)) fields.set(key, value);
      });
      const line = bylines.get(id);
      if (line) {
        fields.set('byline', line.byline);
        fields.set('by', line.by);
      }
      syncMap(copy, fields);
    }

    // ── Facilitation ──
    for (const name of AS_THEY_ARE) {
      const from = board.getMap<unknown>(name);
      syncMap(target.getMap(name), new Map(from.entries()));
    }
    const facilitator = board.getMap<unknown>('facilitator');
    syncMap(
      target.getMap('facilitator'),
      new Map<string, unknown>([
        ['userId', facilitator.get('userId') ? 'host' : null],
        ['name', facilitator.get('name') ?? ''],
      ]),
    );

    // Votes and poll answers: everyone's under stand-ins; seeing only their own, theirs, and the rest once it's over.
    const keyed = (source: Y.Map<unknown>, over: boolean) => {
      const wanted = new Map<string, unknown>();
      let other = 0;
      source.forEach((value, userId) => {
        if (!own || mine(userId)) wanted.set(keyOf(userId), value);
        else if (over) wanted.set(`o${++other}`, value);
      });
      return wanted;
    };
    syncMap(target.getMap('votes'), keyed(board.getMap('votes'), board.getMap('voting').get('open') !== true));
    syncMap(target.getMap('voting'), new Map(board.getMap<unknown>('voting').entries()));
    syncMap(target.getMap('pollAnswers'), keyed(board.getMap('pollAnswers'), board.getMap('poll').get('open') !== true));
    // Planning poker: who has estimated (an empty value) until the reveal, then what.
    syncMap(target.getMap('pokerEstimates'), keyed(board.getMap('pokerEstimates'), board.getMap('poker').get('revealed') === true));

    // Reactions, on what's shown: everyone's under stand-ins, or only their own.
    const reactions = new Map<string, unknown>();
    board.getMap<Record<string, string[]>>('reactions').forEach((byEmoji, nodeId) => {
      if (!shown.has(nodeId)) return;
      const kept: Record<string, string[]> = {};
      for (const [emoji, who] of Object.entries(byEmoji ?? {})) {
        const ids = who.filter((u) => !own || mine(u)).map(keyOf);
        if (ids.length) kept[emoji] = ids;
      }
      if (Object.keys(kept).length) reactions.set(nodeId, kept);
    });
    syncMap(target.getMap('reactions'), reactions);

    // Who they are here, so their board can tell their own things apart.
    syncMap(
      target.getMap('you'),
      new Map<string, unknown>([
        ['key', me ? participantKey(me.pseudonym) : null],
        ['visibility', audience.visibility],
      ]),
    );
  });
}
