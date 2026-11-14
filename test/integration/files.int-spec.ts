import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ChatRequest } from '../../src/models/adapters/types';
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
    const auth = { Authorization: `Bearer ${await t.token(randomUUID())}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = { Authorization: `Bearer ${await t.token(reader)}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'B' });
    return { server, auth, readerAuth, orgId, board };
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
});
