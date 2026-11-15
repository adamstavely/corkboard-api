import * as Y from 'yjs';
import { boardText, fragmentText } from './board-text';

function element(name: string, children: (Y.XmlElement | Y.XmlText)[]): Y.XmlElement {
  const el = new Y.XmlElement(name);
  el.insert(0, children);
  return el;
}

function text(value: string, attrs?: Record<string, unknown>): Y.XmlText {
  const t = new Y.XmlText();
  t.insert(0, value, attrs);
  return t;
}

describe('boardText', () => {
  it("reads each note's text as lines, without formatting, skipping empty notes and other nodes", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const note = (id: string, blocks: Y.XmlElement[]) => {
      const node = new Y.Map<unknown>();
      const fragment = new Y.XmlFragment();
      node.set('kind', 'note');
      node.set('text', fragment);
      nodes.set(id, node);
      fragment.insert(0, blocks);
    };

    note('a', [
      element('heading', [text('Retro')]),
      element('paragraph', [text('Deploys are '), text('slow', { bold: true })]),
      element('bulletList', [
        element('listItem', [element('paragraph', [text('one')])]),
        element('listItem', [element('paragraph', [text('two')])]),
      ]),
    ]);
    note('b', [element('paragraph', [])]);
    const frame = new Y.Map<unknown>();
    frame.set('kind', 'frame');
    nodes.set('c', frame);

    expect(boardText(doc)).toEqual([{ id: 'a', text: 'Retro\nDeploys are slow\none\ntwo' }]);
  });

  it('reads maths as its LaTeX, inline and on its own line', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('t');
    const p = new Y.XmlElement('paragraph');
    const math = new Y.XmlElement('math');
    math.setAttribute('latex', '\\pi r^2');
    p.insert(0, [new Y.XmlText('Area '), math]);
    const block = new Y.XmlElement('mathBlock');
    block.setAttribute('latex', 'e=mc^2');
    fragment.insert(0, [p, block]);
    expect(fragmentText(fragment)).toBe('Area $\\pi r^2$\n$$e=mc^2$$');
  });
});
