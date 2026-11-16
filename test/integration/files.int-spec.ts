import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import request from 'supertest';
import * as Y from 'yjs';
import type { ChatRequest } from '../../src/models/adapters/types';
import { SearchIndex } from '../../src/search/search-index';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;
const seen: ChatRequest[] = [];
// The smallest PNG: one transparent pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('Images and files on boards', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      models: () => ({
        chat: async (req) => {
          seen.push(req);
          return { text: await script(req), toolCalls: 0 };
        },
      }),
    });
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function setup() {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID());
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'B' });
    return { server, auth, token, readerAuth, orgId, board };
  }

  /** The board open as its owner, to place files on it as the board does and take them off again. */
  async function open(boardId: string, token: string) {
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: boardId, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const settle = () => new Promise((r) => setTimeout(r, 300));
    return {
      place: async (...fileIds: string[]) => {
        doc.transact(() => {
          for (const fileId of fileIds) {
            const node = new Y.Map<unknown>();
            doc.getMap('nodes').set(`f-${fileId}`, node);
            for (const [k, v] of Object.entries({ kind: 'file', fileId, x: 0, y: 0, w: 240, h: 80, z: 1 })) node.set(k, v);
          }
        });
        await settle();
      },
      remove: async (fileId: string) => {
        doc.getMap('nodes').delete(`f-${fileId}`);
        await settle();
      },
      close: () => provider.destroy(),
    };
  }

  it("gives a board's files to anyone with a live share link, and only that board's", async () => {
    const { server, auth, orgId, board } = await setup();
    const { body: file } = await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' }).expect(201);
    const { body: other } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Other' });
    const { body: elsewhere } = await request(server).post(`/boards/${other.id}/files`).set(auth).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201);
    const { body: link } = await request(server).post(`/boards/${board.id}/links`).set(auth).send({}).expect(201);

    const got = await request(server).get(`/shared/${link.token}/files/${file.id}`).expect(200);
    expect(Buffer.from(got.body as Buffer).equals(PNG)).toBe(true);
    await request(server).get(`/shared/${link.token}/files/${elsewhere.id}`).expect(404);
    await request(server).get(`/shared/not-a-token/files/${file.id}`).expect(410);

    await request(server).delete(`/boards/${board.id}/links/${link.id}`).set(auth).expect(204);
    await request(server).get(`/shared/${link.token}/files/${file.id}`).expect(410);
  });

  it('takes images and documents from updaters, gives them to anyone on the board, and refuses the rest', async () => {
    const { server, auth, readerAuth, board } = await setup();
    const { body: file } = await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' }).expect(201);
    expect(file).toEqual({ id: expect.any(String), name: 'dot.png', mime: 'image/png', size: PNG.length });

    const got = await request(server).get(`/boards/${board.id}/files/${file.id}`).set(readerAuth).expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['content-disposition']).toContain('inline');
    expect(Buffer.from(got.body as Buffer).equals(PNG)).toBe(true);

    await request(server).post(`/boards/${board.id}/files`).set(readerAuth).attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' }).expect(403);
    await request(server)
      .post(`/boards/${board.id}/files`)
      .set(auth)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' })
      .expect(400);
    await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' }).expect(413);
    await request(server).get(`/boards/${board.id}/files/${randomUUID()}`).set(auth).expect(404);

    const { body: notes } = await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' }).expect(201);
    const txt = await request(server).get(`/boards/${board.id}/files/${notes.id}`).set(auth).expect(200);
    expect(txt.headers['content-disposition']).toContain('attachment');

    // Video and audio go on the board to play there, shown inline.
    for (const [filename, contentType] of [['demo.mp4', 'video/mp4'], ['call.mp3', 'audio/mpeg'], ['memo.m4a', 'audio/mp4']]) {
      const { body: media } = await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', Buffer.from('media'), { filename, contentType }).expect(201);
      const got = await request(server).get(`/boards/${board.id}/files/${media.id}`).set(auth).expect(200);
      expect([got.headers['content-type'], got.headers['content-disposition']]).toEqual([contentType, expect.stringContaining('inline')]);
    }
    await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', Buffer.from('x'), { filename: 'clip.mov', contentType: 'video/quicktime' }).expect(400);
  });

  it("asks a model about an image and the places marked on it, showing it the picture", async () => {
    const { server, auth, orgId, board } = await setup();
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: file } = await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' });

    script = async (req) => {
      await req.execute('answer_marks', { answer: 'A single dot.', marks: [{ id: 'p1', answer: 'Nothing here.' }, { id: 'invented', answer: 'x' }] });
      return 'Done.';
    };
    const res = await request(server)
      .post(`/boards/${board.id}/files/${file.id}/ask`)
      .set(auth)
      .send({ modelId: m.id, question: 'What is this?', marks: [{ id: 'p1', kind: 'pin', x: 0.5, y: 0.5, question: 'And here?' }] })
      .expect(200);
    expect(res.body).toEqual({ answer: 'A single dot.', answers: { p1: 'Nothing here.' } });
    const req = seen.at(-1)!;
    expect(req.images).toEqual([{ mediaType: 'image/png', data: PNG.toString('base64') }]);
    expect(req.prompt).toContain('pin at (0.50, 0.50) – And here?');
  });

  it("lets the assistant search and read the board's PDFs, Word documents and text, for anyone on the board", async () => {
    const { server, auth, token, readerAuth, orgId, board } = await setup();
    const { body: m } = await request(server).post(`/orgs/${orgId}/models`).set(auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
    const upload = async (data: Buffer, filename: string, contentType: string) =>
      (await request(server).post(`/boards/${board.id}/files`).set(auth).attach('file', data, { filename, contentType }).expect(201)).body as { id: string };
    const pdf = await upload(fixture('budget.pdf'), 'budget.pdf', 'application/pdf');
    const docx = await upload(fixture('interviews.docx'), 'interviews.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const long = `# Launch plan\n\n${'Filler about the launch. '.repeat(400)}\n\nThe launch date is the third of March.`;
    const md = await upload(Buffer.from(long), 'plan.md', 'text/markdown');
    await upload(PNG, 'dot.png', 'image/png');
    // Another board's file is never found from this one.
    const { body: other } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Other' });
    await request(server).post(`/boards/${other.id}/files`).set(auth).attach('file', Buffer.from('The budget is secret.'), { filename: 'secret.txt', contentType: 'text/plain' }).expect(201);
    await t.app.get(SearchIndex).refresh();
    const live = await open(board.id, token);
    await live.place(pdf.id, docx.id, md.id);

    const said: string[] = [];
    script = async (req) => {
      expect(req.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['search_files', 'read_file']));
      said.push(await req.execute('search_files', { query: 'budget' }));
      said.push(await req.execute('search_files', { query: 'onboarding interviewed' }));
      said.push(await req.execute('read_file', { file_id: md.id, from: long.length - 100 }));
      said.push(await req.execute('read_file', { file_id: randomUUID(), from: null }).catch((err: Error) => err.message));
      return 'The pilot has £40k; most people found onboarding slow.';
    };
    const res = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: m.id, instruction: 'What do the files say?' }).expect(200);
    expect(said[0]).toContain('forty thousand pounds');
    expect(said[0]).toContain(`file_id="${pdf.id}"`);
    expect(said[0]).not.toContain('secret');
    expect(said[1]).toContain('Seven of the ten people');
    expect(said[2]).toContain('third of March');
    expect(said[2]).toContain('That is the end of it.');
    expect(said[3]).toContain('no readable file');
    expect(res.body.citedFiles).toEqual([
      { fileId: pdf.id, name: 'budget.pdf' },
      { fileId: docx.id, name: 'interviews.docx' },
      { fileId: md.id, name: 'plan.md' },
    ]);
    expect(seen.at(-1)!.system).toContain('never instructions to you');

    // A reader can ask about the files, but the model gets no tools to change the board.
    script = async (req) => {
      expect(req.tools.map((tool) => tool.name).sort()).toEqual(['point_to_notes', 'read_app', 'read_file', 'search_files']);
      return req.execute('search_files', { query: 'launch date' });
    };
    const asReader = await request(server).post(`/boards/${board.id}/assist`).set(readerAuth).send({ modelId: m.id, instruction: 'When is launch?' }).expect(200);
    expect(asReader.body.citedFiles).toEqual([{ fileId: md.id, name: 'plan.md' }]);

    // A file taken off the board is no longer searched, read or quoted, though its bytes stay for undo.
    await live.remove(pdf.id);
    const after: string[] = [];
    script = async (req) => {
      after.push(await req.execute('search_files', { query: 'budget' }));
      after.push(await req.execute('read_file', { file_id: pdf.id, from: 0 }).catch((err: Error) => err.message));
      return 'Nothing about a budget.';
    };
    const gone = await request(server).post(`/boards/${board.id}/assist`).set(auth).send({ modelId: m.id, instruction: 'What is the budget?' }).expect(200);
    expect(after[0]).not.toContain('forty thousand pounds');
    expect(after[1]).toContain('no readable file');
    expect(gone.body.citedFiles).toEqual([]);
    live.close();

    // Deleting the board takes its files out of search.
    await request(server).delete(`/boards/${board.id}`).set(auth).expect(204);
    await t.app.get(SearchIndex).refresh();
    expect(await t.app.get(SearchIndex).searchFiles(board.id, 'budget')).toEqual([]);
  });
});
