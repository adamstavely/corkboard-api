import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, framesOf, inFrame, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from '../integration/app';
import { png } from './png';

/**
 * Saved questions for a real model, run through the app's own prompts, tools and endpoints, each graded by checks on
 * what it did to the board. Run on demand, never in CI:
 *
 *   EVAL_API_KEY=… npm run eval                          # Claude (claude-opus-5-5 unless EVAL_MODEL says)
 *   EVAL_KIND=openai EVAL_BASE_URL=… EVAL_MODEL=… EVAL_API_KEY=… npm run eval
 *
 * Each case makes a few model calls, so a run costs real money: about the price of a dozen short conversations.
 */
const key = process.env.EVAL_API_KEY;
const kind = (process.env.EVAL_KIND ?? 'anthropic') as 'anthropic' | 'openai';
const modelName = process.env.EVAL_MODEL ?? (kind === 'anthropic' ? 'claude-opus-5-5' : '');
const run = key && modelName ? describe : describe.skip;

run(`Model evals (${kind}: ${modelName || 'no model'})`, () => {
  let t: TestApp;
  let auth: { Authorization: string };
  let token: string;
  let orgId: string;
  let modelId: string;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    token = await t.token(randomUUID(), { name: 'Ada' });
    auth = { Authorization: `Bearer ${token}` };
    const server = t.app.getHttpServer();
    orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id;
    const connection = { label: 'Eval', kind, model: modelName, apiKey: key, ...(process.env.EVAL_BASE_URL ? { baseUrl: process.env.EVAL_BASE_URL } : {}) };
    modelId = (await request(server).post(`/orgs/${orgId}/models`).set(auth).send(connection).expect(201)).body.id;
  });
  afterAll(async () => {
    providers.forEach((p) => p.destroy());
    await t?.app.close();
  });

  /** A new board with these notes on it, open live so the test sees what the model does. */
  async function board(texts: string[]): Promise<{ id: string; doc: Y.Doc; ids: string[] }> {
    const server = t.app.getHttpServer();
    const { body } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Eval' }).expect(201);
    const doc = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: body.id, token, document: doc, onSynced: () => resolve() }));
    });
    const ids = addNotes(doc, texts.map((text) => ({ text, color: 'yellow' as const })));
    await settle(() => true, 500);
    return { id: body.id, doc, ids };
  }

  /** Waits for the live document to catch up with the server. */
  async function settle(done: () => boolean, ms = 3000): Promise<void> {
    for (const end = Date.now() + ms; Date.now() < end && !done(); ) await new Promise((r) => setTimeout(r, 100));
  }

  const ask = (boardId: string, instruction: string) =>
    request(t.app.getHttpServer()).post(`/boards/${boardId}/assist`).set(auth).send({ modelId, instruction }).expect(200);

  const frameOf = (doc: Y.Doc, noteId: string) => {
    const note = notesOf(doc).find((n) => n.id === noteId);
    return note?.frame;
  };

  it('groups a retro into themes, every note in one, each theme together', async () => {
    const themes = {
      deploys: ['Deploys take over an hour', 'The release pipeline fails at random', 'Rollbacks are manual and scary'],
      testing: ['Flaky end-to-end tests', 'No tests for the billing code', 'Test data is out of date'],
      meetings: ['Too many meetings on Tuesdays', 'Standup runs 30 minutes', 'Planning has no agenda'],
    };
    const b = await board(Object.values(themes).flat());
    await ask(b.id, 'Group these retro notes into themes.');
    await settle(() => framesOf(b.doc).length >= 3);

    expect(framesOf(b.doc).length).toBeGreaterThanOrEqual(2);
    expect(b.ids.every((id) => frameOf(b.doc, id))).toBe(true);
    // Each theme's three notes (in the order written) should share a frame; allow one theme to be split.
    const together = Object.keys(themes).filter((_, i) => new Set(b.ids.slice(i * 3, i * 3 + 3).map((id) => frameOf(b.doc, id))).size === 1);
    expect(together.length).toBeGreaterThanOrEqual(2);
  });

  it('writes action items with owners into an "Action items" frame', async () => {
    const b = await board([
      'Decision: Grace will speed up the build cache',
      'Ada offered to fix the flaky login test',
      'Linus to write the on-call runbook',
      'Lunch was good',
    ]);
    await ask(b.id, 'Write action items for the decisions on this board, each with its owner.');
    await settle(() => framesOf(b.doc).some((f) => /action items?/i.test(f.title)));

    const frame = framesOf(b.doc).find((f) => /action items?/i.test(f.title));
    expect(frame).toBeDefined();
    const items = notesOf(b.doc).filter((n) => !b.ids.includes(n.id) && n.frame === frame!.title);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.length).toBeLessThanOrEqual(5);
    const owners = items.map((n) => n.text.split('\n')[0].toLowerCase());
    for (const name of ['grace', 'ada']) expect(owners.some((o) => o.includes(name))).toBe(true);
  });

  it('turns a plan into a timeline with a column per period', async () => {
    const b = await board(['Write the launch blog post', 'Beta with 10 customers', 'Fix the top beta bugs', 'Public launch', 'Pricing page']);
    await ask(b.id, 'Make this into a three-week launch timeline, one column per week.');
    await settle(() => framesOf(b.doc).length >= 4);

    const frames = framesOf(b.doc);
    const outer = frames.find((f) => frames.filter((c) => c.id !== f.id && inFrame(c, f)).length >= 3);
    expect(outer).toBeDefined();
    expect(b.ids.filter((id) => frameOf(b.doc, id)).length).toBeGreaterThanOrEqual(4);
  });

  it('answers a question by pointing at the right notes, changing nothing', async () => {
    const b = await board(['Flaky end-to-end tests', 'The office coffee is bad', 'No tests for the billing code', 'Parking is full by 9']);
    const before = JSON.stringify(notesOf(b.doc));
    const { body } = await ask(b.id, 'Which notes are about testing? Point to them, and change nothing.');

    expect(body.reply.length).toBeGreaterThan(0);
    expect(new Set(body.citedNoteIds)).toEqual(new Set([b.ids[0], b.ids[2]]));
    expect(body.notesAdded + body.notesChanged + body.framesAdded + body.notesMoved).toBe(0);
    expect(JSON.stringify(notesOf(b.doc))).toBe(before);
  });

  it('scores every note for value and effort, in range', async () => {
    const b = await board(['Rewrite the whole app in a new language', 'Fix a typo on the pricing page', 'Add single sign-on for enterprise customers']);
    await ask(b.id, 'Score each note for value and effort (0 to 10) for the prioritisation matrix.');
    await settle(() => notesOf(b.doc).every((n) => n.value !== undefined));

    const notes = notesOf(b.doc);
    for (const n of notes) {
      expect(n.value).toBeGreaterThanOrEqual(0);
      expect(n.value).toBeLessThanOrEqual(10);
      expect(n.effort).toBeGreaterThanOrEqual(0);
      expect(n.effort).toBeLessThanOrEqual(10);
    }
    const [rewrite, typo] = b.ids.map((id) => notes.find((n) => n.id === id)!);
    expect(rewrite.effort!).toBeGreaterThan(typo.effort!);
  });

  it('summarises the board, citing notes that exist', async () => {
    const b = await board(['Deploys take over an hour', 'Rollbacks are manual', 'Decision: move to blue-green deploys', 'Grace owns the deploy work']);
    const { body } = await request(t.app.getHttpServer()).post(`/boards/${b.id}/summary`).set(auth).send({ modelId, length: 'short' }).expect(200);

    expect(body.tldr.length).toBeGreaterThan(10);
    expect(body.points.length).toBeGreaterThan(0);
    const cited = body.points.flatMap((p: { sources: string[] }) => p.sources);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((id: string) => b.ids.includes(id))).toBe(true);
    expect(body.tldr.toLowerCase()).toMatch(/deploy/);
  });

  it('answers about an image and the places marked on it', async () => {
    const server = t.app.getHttpServer();
    const b = await board([]);
    // Red on the left half, blue on the right.
    const image = png(200, 100, (x) => (x < 100 ? [220, 30, 30] : [30, 60, 220]));
    const { body: file } = await request(server).post(`/boards/${b.id}/files`).set(auth).attach('file', image, { filename: 'halves.png', contentType: 'image/png' }).expect(201);
    const { body } = await request(server)
      .post(`/boards/${b.id}/files/${file.id}/ask`)
      .set(auth)
      .send({ modelId, question: 'What colour is each marked place?', marks: [{ id: 'left', kind: 'pin', x: 0.25, y: 0.5 }, { id: 'right', kind: 'pin', x: 0.75, y: 0.5 }] })
      .expect(200);

    expect(body.answers.left?.toLowerCase()).toMatch(/red/);
    expect(body.answers.right?.toLowerCase()).toMatch(/blue/);
  });
});
