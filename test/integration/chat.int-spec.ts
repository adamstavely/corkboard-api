import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import { chatOf, MODEL_AUTHOR } from '../../src/chat/chat-doc';
import { ModelError, type ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

/** What the scripted model does with each request; tests set it. */
let script: (req: ChatRequest) => Promise<string>;
const seen: ChatRequest[] = [];

const eventually = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('Timed out waiting');
};

describe('Board chat', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

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
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  async function person(name?: string) {
    const subject = randomUUID();
    const token = await t.token(subject, { name });
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    return { token, auth, id: me.body.id as string, email: `${subject}@corkboard.test`, orgId: me.body.orgs[0].id as string };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  async function joined(owner: Person, role: string, name?: string): Promise<Person> {
    const server = t.app.getHttpServer();
    const p = await person(name);
    const { body: invite } = await request(server).post(`/orgs/${owner.orgId}/invites`).set(owner.auth).send({ email: p.email, role });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(p.auth).expect(201);
    return p;
  }

  function open(boardId: string, who: Person, heard: string[] = []): Promise<{ doc: Y.Doc; heard: string[] }> {
    const doc = new Y.Doc();
    return new Promise((resolve) => {
      providers.push(
        new HocuspocusProvider({
          url: t.collabUrl,
          name: boardId,
          token: who.token,
          document: doc,
          onSynced: () => resolve({ doc, heard }),
          onStateless: ({ payload }) => heard.push(payload),
        }),
      );
    });
  }

  it('shares messages live, and the model answers a mention as the person who asked', async () => {
    const server = t.app.getHttpServer();
    const ada = await person('Ada');
    const grace = await joined(ada, 'commenter', 'Grace');
    const { body: m } = await request(server).post(`/orgs/${ada.orgId}/models`).set(ada.auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'Retro' });
    const adas = await open(board.id, ada);
    const [slow] = addNotes(adas.doc, [{ text: 'Deploys are slow', color: 'yellow' }]);

    // People talk; nobody asked the model, so it stays quiet.
    await request(server).post(`/boards/${board.id}/chat`).set(ada.auth).send({ text: 'Morning!', answer: false }).expect(201);
    const graces = await open(board.id, grace);
    expect(chatOf(graces.doc).map((c) => [c.name, c.text])).toEqual([['Ada', 'Morning!']]);

    // Grace, a commenter, asks the model; it can point at notes but not change the board for her.
    script = async (req) => {
      await req.execute('point_to_notes', { note_ids: [slow] });
      return 'Slow deploys are the main theme.';
    };
    await request(server)
      .post(`/boards/${board.id}/chat`)
      .set(grace.auth)
      .send({ text: '@Claude what stands out?', answer: true, modelId: m.id, noteIds: [slow] })
      .expect(201);
    await eventually(() => chatOf(adas.doc).length === 3);

    const answer = chatOf(adas.doc)[2];
    expect(answer).toMatchObject({ authorId: MODEL_AUTHOR, name: 'Claude', replyTo: grace.id, text: 'Slow deploys are the main theme.', cited: [slow], asked: [slow] });
    expect(seen.at(-1)!.tools.map((tool) => tool.name)).toEqual(['point_to_notes']);
    // The model saw the chat so far, with names, and who's asking now.
    expect(seen.at(-1)!.prompt).toContain('Person: Ada: Morning!');
    expect(seen.at(-1)!.prompt).toContain('Grace: @Claude what stands out?');
    // Everyone on the board heard it start and finish answering.
    await eventually(() => adas.heard.length === 2);
    expect(adas.heard.map((h) => JSON.parse(h))).toEqual([
      { type: 'answering', personId: grace.id, on: true },
      { type: 'answering', personId: grace.id, on: false },
    ]);
  });

  it("says in the chat when the model can't answer, and keeps readers and strangers out", async () => {
    const server = t.app.getHttpServer();
    const ada = await person('Ada');
    const reader = await joined(ada, 'reader');
    const stranger = await person();
    const { body: m } = await request(server).post(`/orgs/${ada.orgId}/models`).set(ada.auth).send({ label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${ada.orgId}/boards`).set(ada.auth).send({ title: 'B' });
    const adas = await open(board.id, ada);

    script = () => Promise.reject(new ModelError("Claude didn't accept the API key.", 'auth'));
    await request(server).post(`/boards/${board.id}/chat`).set(ada.auth).send({ text: '@Claude hi', answer: true, modelId: m.id }).expect(201);
    await eventually(() => chatOf(adas.doc).length === 2);
    expect(chatOf(adas.doc)[1]).toMatchObject({ authorId: MODEL_AUTHOR, failed: true, text: "I couldn't answer: Claude didn't accept the API key." });

    await request(server).post(`/boards/${board.id}/chat`).set(reader.auth).send({ text: 'hi', answer: false }).expect(403);
    await request(server).post(`/boards/${board.id}/chat`).set(stranger.auth).send({ text: 'hi', answer: false }).expect(404);
    await request(server).post(`/boards/${board.id}/chat`).set(ada.auth).send({ text: '@Claude hi', answer: true }).expect(400);
    await request(server).post(`/boards/${board.id}/chat`).set(ada.auth).send({ text: '  ', answer: false }).expect(400);
  });
});
