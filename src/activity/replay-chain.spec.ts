import * as Y from 'yjs';
import { addNotes, notesOf } from '../assist/board-edit';
import { asSteps, KEYFRAME_EVERY, materialize, nextSnapshot, SESSION_GAP_MS, sessionStart, type ChainRow } from './replay-chain';

const textsOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return notesOf(doc)
    .map((n) => n.text)
    .sort();
};

/** A board edited one note at a time, its state kept after each as storeState would. */
function edited(times: number) {
  const doc = new Y.Doc();
  const rows: ChainRow[] = [];
  const states: Buffer[] = [];
  let latest: { vector: Buffer; depth: number } | undefined;
  for (let i = 0; i < times; i++) {
    addNotes(doc, [{ text: `Note ${i}`, color: 'yellow' }]);
    // Now and then one goes, so deletions replay too.
    if (i % 5 === 4) doc.getMap('nodes').delete([...doc.getMap('nodes').keys()][0]);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const snap = nextSnapshot(state, latest);
    rows.push({ id: `s${i}`, state: snap.state, depth: snap.depth });
    states.push(state);
    latest = snap;
  }
  return { rows, states };
}

describe('Replay snapshots', () => {
  it('keeps a whole state every so often and only what changed in between', () => {
    const { rows, states } = edited(KEYFRAME_EVERY + 5);
    expect(rows.map((r) => r.depth)).toEqual([...Array(KEYFRAME_EVERY).keys(), 0, 1, 2, 3, 4]);
    // What changed is much smaller than the whole board.
    expect(rows[KEYFRAME_EVERY - 1].state.length).toBeLessThan(states[KEYFRAME_EVERY - 1].length / 2);
  });

  it('builds each snapshot back exactly, and nothing from before the first whole state', () => {
    const { rows, states } = edited(KEYFRAME_EVERY + 5);
    const whole = materialize(rows);
    rows.forEach((r, i) => expect(textsOf(whole.get(r.id)!)).toEqual(textsOf(states[i])));
    const fromMiddle = materialize(rows.slice(3));
    expect(fromMiddle.has('s3')).toBe(false);
    expect(textsOf(fromMiddle.get(`s${KEYFRAME_EVERY + 2}`)!)).toEqual(textsOf(states[KEYFRAME_EVERY + 2]));
  });

  it('sends states as the first whole and each after it as what changed, which apply in order', () => {
    const { states } = edited(8);
    const steps = asSteps(states.map((s) => new Uint8Array(s)));
    const doc = new Y.Doc();
    steps.forEach((step, i) => {
      Y.applyUpdate(doc, step);
      expect(textsOf(Y.encodeStateAsUpdate(doc))).toEqual(textsOf(states[i]));
    });
    expect(steps[7].length).toBeLessThan(states[7].length);
  });
});

describe('When this session started', () => {
  const MIN = 60_000;

  it('is the start of the last stretch of editing', () => {
    const at = [0, 1, 2, 60, 61, 62].map((m) => m * MIN);
    expect(sessionStart(at, [])).toBe(60 * MIN);
    expect(sessionStart([5 * MIN], [])).toBe(5 * MIN);
    expect(sessionStart([], [])).toBeNull();
  });

  it('reaches back to when the agenda started, if it ran into that stretch', () => {
    const at = [0, 100, 101 + SESSION_GAP_MS / MIN + 1, 130].map((m) => m * MIN);
    const stretch = at[2];
    const events = [
      { at: 90 * MIN, action: 'moved the agenda on' },
      { at: 110 * MIN, action: 'moved the agenda on' },
    ];
    expect(sessionStart(at, events)).toBe(90 * MIN);
    // An agenda that ended long before doesn't count; a later run starts afresh.
    expect(sessionStart(at, [...events.slice(0, 1), { at: 92 * MIN, action: 'ended the agenda' }])).toBe(stretch);
    expect(sessionStart(at, [...events, { at: 115 * MIN, action: 'ended the agenda' }, { at: 125 * MIN, action: 'moved the agenda on' }])).toBe(stretch);
  });
});
