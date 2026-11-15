import mammoth from 'mammoth';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';

/** The most text kept from one file: enough for a long report, not a library. */
export const MAX_TEXT = 2_000_000;
const CHUNK = 1500;
const OVERLAP = 200;

/** What the assistant can read: PDFs, Word documents and plain text. Images, sheets and slides aren't read. */
export const READABLE = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/csv']);

/** A file's text, or null when it isn't a kind that's read (or holds none, like a scanned PDF). */
export async function extractText(mime: string, data: Buffer): Promise<string | null> {
  let text: string;
  if (mime === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text: pages } = await pdfText(pdf, { mergePages: false });
    text = pages.join('\n\n');
  } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else if (mime.startsWith('text/')) {
    text = data.toString('utf8');
  } else {
    return null;
  }
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

/**
 * The text in overlapping pieces of about 1,500 characters, broken at a paragraph, sentence or space where one is
 * near, so search finds a passage and the assistant reads it whole.
 */
export function chunks(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + CHUNK);
    if (end < text.length) {
      const window = text.slice(at + CHUNK / 2, end);
      // The best break there is: a paragraph, then a sentence, a line, a space.
      for (const brk of ['\n\n', '. ', '\n', ' ']) {
        const cut = window.lastIndexOf(brk);
        if (cut > 0) {
          end = at + CHUNK / 2 + cut + (brk === '. ' ? 1 : 0);
          break;
        }
      }
    }
    const piece = text.slice(at, end).trim();
    if (piece) out.push({ text: piece, start: at });
    if (end >= text.length) break;
    at = Math.max(end - OVERLAP, at + 1);
  }
  return out;
}
