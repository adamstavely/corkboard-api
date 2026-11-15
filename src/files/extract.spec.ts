import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunks, extractText } from './extract';

const fixture = (name: string) => readFileSync(join(__dirname, '../../test/integration/fixtures', name));

describe("reading a file's text", () => {
  it('reads PDFs, Word documents and text, and nothing else', async () => {
    expect(await extractText('application/pdf', fixture('budget.pdf'))).toContain('forty thousand pounds');
    expect(await extractText('application/vnd.openxmlformats-officedocument.wordprocessingml.document', fixture('interviews.docx'))).toBe(
      'Research findings\n\nSeven of the ten people we interviewed said onboarding took longer than a week.',
    );
    expect(await extractText('text/markdown', Buffer.from('# Plan\r\n\r\n\r\n\r\nShip it  \n'))).toBe('# Plan\n\nShip it');
    expect(await extractText('image/png', Buffer.from('x'))).toBeNull();
    expect(await extractText('text/plain', Buffer.from('  \n '))).toBeNull();
  });

  it('cuts long text into overlapping pieces at natural breaks, each knowing where it starts', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something about the plan.`).join(' ');
    const pieces = chunks(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.text.length).toBeLessThanOrEqual(1500);
      expect(text.slice(p.start).trimStart().startsWith(p.text)).toBe(true);
    }
    // Every piece but the last ends at a sentence, and the next one starts before it ends.
    for (let i = 0; i < pieces.length - 1; i++) {
      expect(pieces[i].text.endsWith('.')).toBe(true);
      expect(pieces[i + 1].start).toBeLessThan(pieces[i].start + pieces[i].text.length);
    }
    expect(pieces.at(-1)!.text.endsWith('plan.')).toBe(true);
    expect(chunks('short')).toEqual([{ text: 'short', start: 0 }]);
  });
});
