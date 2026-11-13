import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { SearchIndex } from '../../src/search/search-index';
import { createTestApp, type TestApp } from './app';

/** Waits for a condition that arrives asynchronously (a sync, a save), up to a few seconds. */
async function eventually<T>(read: () => T | Promise<T>, timeoutMs = 8000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > until) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A note the way the UI's BoardDoc writes one, with a paragraph of text. */
function addNote(doc: Y.Doc, text: string): string {
  const id = randomUUID();
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set('kind', 'note');
    node.set('x', 0);
    node.set('y', 0);
    const fragment = new Y.XmlFragment();
    node.set('text', fragment);
    doc.getMap('nodes').set(id, node);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    fragment.insert(0, [p]);
  });
  return id;
}

describe('Real-time collaboration', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  /** Opens a board the way the UI does; resolves once synced, rejects if the server turns the connection away. */
  function connect(boardId: string, token: string, document = new Y.Doc()): Promise<HocuspocusProvider> {
    return new Promise((resolve, reject) => {
      const provider: HocuspocusProvider = new HocuspocusProvider({
        url: t.collabUrl,
        name: boardId,
        token,
        document,
        // Node 22 has a WebSocket client built in, so the provider needs no polyfill.
        onSynced: (): void => resolve(provider),
        onAuthenticationFailed: ({ reason }) => {
          provider.destroy();
          reject(new Error(reason));
        },
      });
      providers.push(provider);
    });
  }

  async function newBoard(subject: string): Promise<{ id: string; orgId: string; auth: { Authorization: string } }> {
    const auth = { Authorization: `Bearer ${await t.token(subject)}` };
    const server = t.app.getHttpServer();
    const me = await request(server).get('/me').set(auth).expect(200);
    const orgId = me.body.orgs[0].id;
    const { body } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Retro' }).expect(201);
    return { id: body.id, orgId, auth };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    providers.splice(0).forEach((p) => p.destroy());
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('shares changes between everyone on a board, then saves and indexes them', async () => {
    const subject = randomUUID();
    const board = await newBoard(subject);
    const token = await t.token(subject);

    const a = await connect(board.id, token);
    const b = await connect(board.id, token);
    const id = addNote(a.document, 'Deploys are slow on Fridays');
    await eventually(() => b.document.getMap('nodes').has(id));

    a.destroy();
    b.destroy();
    // The last one out saves the board.
    const saved = await eventually(async () => {
      const res = await request(t.app.getHttpServer()).get(`/boards/${board.id}/document`).set(board.auth);
      return res.body.state ? res.body.state : undefined;
    });
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Buffer.from(saved as string, 'base64'));
    expect(copy.getMap('nodes').has(id)).toBe(true);

    await t.app.get(SearchIndex).refresh();
    const hits = await request(t.app.getHttpServer())
      .get(`/orgs/${board.orgId}/search`)
      .query({ q: 'deploys' })
      .set(board.auth)
      .expect(200);
    expect(hits.body).toEqual([
      expect.objectContaining({ boardId: board.id, title: 'Retro', snippets: ['<mark>Deploys</mark> are slow on Fridays'] }),
    ]);
  });

  it('picks up where the saved document left off', async () => {
    const subject = randomUUID();
    const board = await newBoard(subject);
    const first = await connect(board.id, await t.token(subject));
    const id = addNote(first.document, 'Keep this');
    first.destroy();
    await eventually(async () => (await request(t.app.getHttpServer()).get(`/boards/${board.id}/document`).set(board.auth)).body.state);

    const again = await connect(board.id, await t.token(subject));
    expect(again.document.getMap('nodes').has(id)).toBe(true);
  });

  it('turns away people without access', async () => {
    const owner = randomUUID();
    const board = await newBoard(owner);
    const stranger = randomUUID();
    await request(t.app.getHttpServer()).get('/me').set('Authorization', `Bearer ${await t.token(stranger)}`);

    await expect(connect(board.id, await t.token(stranger))).rejects.toThrow();
    await expect(connect(board.id, randomUUID())).rejects.toThrow();
    await expect(connect('not-a-board', await t.token(owner))).rejects.toThrow();
  });

  it('disconnects everyone from a board when it is deleted', async () => {
    const subject = randomUUID();
    const board = await newBoard(subject);
    const provider = await connect(board.id, await t.token(subject));
    const closed = new Promise<void>((resolve) => provider.on('close', () => resolve()));

    await request(t.app.getHttpServer()).delete(`/boards/${board.id}`).set(board.auth).expect(204);
    await closed;
  });
});
