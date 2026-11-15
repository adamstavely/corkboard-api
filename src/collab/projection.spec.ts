import * as Y from 'yjs';
import { project, type Participant, type Visibility } from './projection';

const ADA = 'aaaaaaaa-0000-0000-0000-000000000001'; // the team
const OLA = 'bbbbbbbb-0000-0000-0000-000000000002'; // participant 1
const KAI = 'cccccccc-0000-0000-0000-000000000003'; // participant 2
const participants = new Map<string, Participant>([
  [OLA, { pseudonym: 1, name: 'Ola Nordmann' }],
  [KAI, { pseudonym: 2, name: 'Kai Rivers' }],
]);

function note(doc: Y.Doc, id: string, text: string, fields: Record<string, unknown>): void {
  const node = new Y.Map<unknown>();
  doc.getMap('nodes').set(id, node);
  node.set('kind', 'note');
  node.set('x', 0);
  for (const [k, v] of Object.entries(fields)) node.set(k, v);
  const fragment = new Y.XmlFragment();
  node.set('text', fragment);
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  fragment.insert(0, [p]);
}

function board(): Y.Doc {
  const doc = new Y.Doc();
  note(doc, 'team', 'Hero image', { createdBy: { id: ADA, name: 'Ada Lovelace' } });
  note(doc, 'ola', 'Too busy', { participant: true, author: OLA, authorName: 'Ola Nordmann' });
  note(doc, 'kai', 'Love it', { participant: true, author: KAI, authorName: 'Kai Rivers' });
  const arrow = new Y.Map<unknown>();
  doc.getMap('nodes').set('a1', arrow);
  arrow.set('kind', 'connector');
  arrow.set('from', 'team');
  arrow.set('to', 'kai');
  doc.getMap('voting').set('open', true);
  doc.getMap('votes').set(OLA, ['team']);
  doc.getMap('votes').set(KAI, ['team', 'kai']);
  doc.getMap('votes').set(ADA, ['ola']);
  doc.getMap('reactions').set('team', { '👍': [OLA, KAI, ADA] });
  doc.getMap('facilitator').set('userId', ADA);
  doc.getMap('facilitator').set('name', 'Ada Lovelace');
  doc.getMap('timer').set('label', 'Feedback');
  doc.getArray('chat').push([{ authorId: ADA, name: 'Ada Lovelace', text: 'Hi' }]);
  doc.getArray('ledger').push([{ forName: 'Ada Lovelace' }]);
  return doc;
}

const seen = (doc: Y.Doc) =>
  JSON.stringify(
    Object.fromEntries(['nodes', 'votes', 'voting', 'reactions', 'facilitator', 'timer', 'pollAnswers', 'you'].map((m) => [m, doc.getMap(m).toJSON()])),
  ) + JSON.stringify(doc.getArray('chat').toJSON()) + JSON.stringify(doc.getArray('ledger').toJSON());

function asOla(visibility: Visibility, from = board()) {
  const view = new Y.Doc();
  project(from, view, { userId: OLA, visibility }, participants);
  return { from, view, nodes: view.getMap<Y.Map<unknown>>('nodes') };
}

describe('what a participant sees of a board', () => {
  it.each(['names', 'anonymous', 'own'] as const)('never carries anyone’s ids, the team’s names, chat or history (%s)', (visibility) => {
    const { view } = asOla(visibility);
    const all = seen(view);
    for (const id of [ADA, OLA, KAI]) expect(all).not.toContain(id);
    // Nothing on the board says which of the team made it.
    expect(JSON.stringify(view.getMap('nodes').toJSON())).not.toContain('Ada Lovelace');
    expect(view.getArray('chat').length).toBe(0);
    expect(view.getArray('ledger').length).toBe(0);
    // The host is named; their id isn't.
    expect(view.getMap('facilitator').toJSON()).toEqual({ userId: 'host', name: 'Ada Lovelace' });
    expect(view.getMap('timer').get('label')).toBe('Feedback');
    expect(view.getMap('you').toJSON()).toEqual({ key: 'p1', visibility });
  });

  it('names other participants when the board shows names', () => {
    const { nodes } = asOla('names');
    expect(nodes.get('kai')!.toJSON()).toMatchObject({ byline: 'Kai Rivers', by: 'p2' });
    expect(nodes.get('ola')!.get('byline')).toBe('You');
    expect(nodes.get('team')!.get('byline')).toBeUndefined();
    expect(JSON.stringify((nodes.get('kai')!.get('text') as Y.XmlFragment).toJSON())).toContain('Love it');
  });

  it('calls other participants by pseudonym when names are hidden, and keeps their votes apart', () => {
    const { view, nodes } = asOla('anonymous');
    expect(nodes.get('kai')!.toJSON()).toMatchObject({ byline: 'Participant 2', by: 'p2' });
    expect(JSON.stringify(view.getMap('nodes').toJSON())).not.toContain('Kai Rivers');
    const votes = view.getMap('votes').toJSON() as Record<string, string[]>;
    expect(votes['p1']).toEqual(['team']);
    expect(votes['p2']).toEqual(['team', 'kai']);
    expect(Object.keys(votes)).toHaveLength(3);
    expect((view.getMap('reactions').get('team') as Record<string, string[]>)['👍']).toHaveLength(3);
  });

  it('shows only their own feedback, and others’ votes only once voting is over', () => {
    const { from, view, nodes } = asOla('own');
    expect([...nodes.keys()].sort()).toEqual(['ola', 'team']);
    // The arrow to Kai's note goes with it.
    expect(nodes.has('a1')).toBe(false);
    expect(view.getMap('votes').toJSON()).toEqual({ p1: ['team'] });
    expect((view.getMap('reactions').get('team') as Record<string, string[]>)['👍']).toEqual(['p1']);

    from.getMap('voting').set('open', false);
    project(from, view, { userId: OLA, visibility: 'own' }, participants);
    const votes = view.getMap('votes').toJSON() as Record<string, string[]>;
    expect(votes['p1']).toEqual(['team']);
    expect(Object.keys(votes)).toHaveLength(3);
    expect(JSON.stringify(votes)).not.toContain(KAI);
  });

  it('follows the board, changing only what changed', () => {
    const { from, view, nodes } = asOla('anonymous');
    const changes: string[] = [];
    nodes.observeDeep((events) => events.forEach((e) => changes.push(String(e.path.join('.') || 'nodes'))));
    project(from, view, { userId: OLA, visibility: 'anonymous' }, participants);
    expect(changes).toEqual([]);

    from.getMap<Y.Map<unknown>>('nodes').get('team')!.set('x', 40);
    ((from.getMap<Y.Map<unknown>>('nodes').get('kai')!.get('text') as Y.XmlFragment).get(0) as Y.XmlElement).insert(1, [new Y.XmlText('!')]);
    from.getMap('nodes').delete('ola');
    project(from, view, { userId: OLA, visibility: 'anonymous' }, participants);
    expect(nodes.get('team')!.get('x')).toBe(40);
    expect(JSON.stringify((nodes.get('kai')!.get('text') as Y.XmlFragment).toJSON())).toContain('!');
    expect(nodes.has('ola')).toBe(false);
  });
});
