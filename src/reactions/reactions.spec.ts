import * as Y from 'yjs';
import { react } from './reactions';

describe('reactions', () => {
  it('keeps who reacted with what, once each, and tidies up when the last one is taken back', () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', new Y.Map());
    expect(react(doc, 'missing', '👍', 'ada', true)).toBe(false);
    react(doc, 'n1', '👍', 'ada', true);
    react(doc, 'n1', '👍', 'ada', true);
    react(doc, 'n1', '👍', 'grace', true);
    react(doc, 'n1', '🎉', 'ada', true);
    expect(doc.getMap('reactions').get('n1')).toEqual({ '👍': ['ada', 'grace'], '🎉': ['ada'] });
    react(doc, 'n1', '👍', 'ada', false);
    react(doc, 'n1', '👍', 'grace', false);
    react(doc, 'n1', '🎉', 'ada', false);
    expect(doc.getMap('reactions').has('n1')).toBe(false);
  });
});
