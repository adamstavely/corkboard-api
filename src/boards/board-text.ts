import * as Y from 'yjs';

/** What search sees of one note. */
export interface NoteText {
  id: string;
  text: string;
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'mathBlock']);

/** Plain text of a Tiptap fragment: formatting dropped, one line per block. */
export function fragmentText(fragment: Y.XmlFragment | Y.XmlElement): string {
  const lines: string[] = [];
  let line = '';
  const walk = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert: unknown }[]) if (typeof op.insert === 'string') line += op.insert;
      return;
    }
    // Maths keeps its LaTeX in an attribute: $…$ inline, $$…$$ on its own line.
    if (node instanceof Y.XmlElement && (node.nodeName === 'math' || node.nodeName === 'mathBlock')) {
      const latex = String(node.getAttribute('latex') ?? '');
      line += node.nodeName === 'math' ? `$${latex}$` : `$$${latex}$$`;
    }
    const block = node instanceof Y.XmlElement && BLOCKS.has(node.nodeName);
    for (const child of node.toArray()) walk(child as Y.XmlElement | Y.XmlText);
    if (block && line.trim()) {
      lines.push(line.trim());
      line = '';
    }
  };
  walk(fragment);
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

/**
 * The text of every note, frame title, mini-app title and diagram on a board, read from its Yjs document. The UI's BoardDoc keeps nodes in the
 * `nodes` map, each note's rich text under `text` and each frame's title under `title`.
 */
export function boardText(doc: Y.Doc): NoteText[] {
  const notes: NoteText[] = [];
  doc.getMap<Y.Map<unknown>>('nodes').forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const title = node.get('title');
    if (node.get('kind') === 'frame' && typeof title === 'string' && title.trim()) notes.push({ id, text: title.trim() });
    // A mini-app's title and a diagram's text are found by search too.
    if (node.get('kind') === 'app' && typeof title === 'string' && title.trim()) notes.push({ id, text: title.trim() });
    const source = node.get('source');
    if (node.get('kind') === 'diagram' && typeof source === 'string' && source.trim()) notes.push({ id, text: source.trim().slice(0, 4000) });
    if (node.get('kind') !== 'note') return;
    const fragment = node.get('text');
    const text = fragment instanceof Y.XmlFragment ? fragmentText(fragment) : '';
    if (text) notes.push({ id, text });
  });
  return notes;
}
