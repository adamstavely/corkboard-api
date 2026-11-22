import { HocuspocusProvider } from '@hocuspocus/provider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, frameGroups, framesOf, notesOf } from '../../src/assist/board-edit';
import { validTasks } from '../../src/assist/tasks-doc';
import { DB, type Db } from '../../src/db/db.module';
import { accessTokens } from '../../src/db/schema';
import { SearchIndex } from '../../src/search/search-index';
import type { Suggestion } from '../../src/suggestions/suggestions-doc';
import { createTestApp, type TestApp } from './app';

type Auth = { Authorization: string };

describe('Agents: access tokens, the agent API and MCP', () => {
  let t: TestApp;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => providers.splice(0).forEach((p) => p.destroy()));
  afterAll(async () => {
    await t.app.close();
  });

  const settle = () => new Promise((r) => setTimeout(r, 300));
  const bearer = (token: string): Auth => ({ Authorization: `Bearer ${token}` });

  /** An owner with a board open live, and a reader in their workspace. */
  async function setup(title = 'Retro') {
    const server = t.app.getHttpServer();
    const subject = randomUUID();
    const session = await t.token(subject, { name: 'Ada' });
    const auth = bearer(session);
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const reader = randomUUID();
    const readerAuth = bearer(await t.token(reader, { name: 'Rhea' }));
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(auth).send({ email: `${reader}@corkboard.test`, role: 'reader' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(readerAuth).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title });
    const doc = new Y.Doc();
    await new Promise<void>((resolve) => {
      providers.push(new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: session, document: doc, onSynced: () => resolve() }));
    });
    return { server, auth, readerAuth, orgId, board, doc };
  }

  const makeToken = async (auth: Auth, body: Record<string, unknown>) => {
    const res = await request(t.app.getHttpServer()).post('/me/tokens').set(auth).send(body).expect(201);
    return res.body as { id: string; token: string; prefix: string; name: string };
  };

  it('makes tokens shown once, lists and revokes them, and keeps them to the agent API', async () => {
    const { server, auth, board } = await setup();
    const made = await makeToken(auth, { name: 'Cursor', scopes: ['boards:read'], expiresInDays: 30 });
    expect(made.token).toMatch(/^cbp_[A-Za-z0-9_-]{43}$/);
    expect(made.token.startsWith(made.prefix)).toBe(true);
    const agent = bearer(made.token);

    const { body: list } = await request(server).get('/me/tokens').set(auth).expect(200);
    expect(list).toEqual([expect.objectContaining({ id: made.id, name: 'Cursor', prefix: made.prefix, scopes: ['boards:read'], lastUsedAt: null, expiresAt: expect.any(Number) })]);
    expect(list[0].token).toBeUndefined();
    // Only its hash is kept.
    const [row] = await t.app.get<Db>(DB).select().from(accessTokens).where(eq(accessTokens.id, made.id));
    expect(JSON.stringify(row)).not.toContain(made.token);

    await request(server).post('/me/tokens').set(auth).send({ name: 'x', scopes: ['boards:write'] }).expect(400);
    await request(server).post('/me/tokens').set(auth).send({ name: 'x', scopes: [] }).expect(400);

    // A token can't make, see or revoke tokens, or use the rest of the API.
    const refused = await request(server).post('/me/tokens').set(agent).send({ name: 'Child', scopes: ['boards:read'] }).expect(403);
    expect(refused.body.message).toContain('only work on the agent API');
    await request(server).get('/me/tokens').set(agent).expect(403);
    await request(server).delete(`/me/tokens/${made.id}`).set(agent).expect(403);
    await request(server).get('/me').set(agent).expect(403);
    await request(server).get(`/boards/${board.id}`).set(agent).expect(403);
    // And the agent API takes only tokens.
    await request(server).get('/v1/boards').expect(401);
    await request(server).get('/v1/boards').set(auth).expect(401);

    await request(server).get('/v1/boards').set(agent).expect(200);
    const { body: used } = await request(server).get('/me/tokens').set(auth).expect(200);
    expect(used[0].lastUsedAt).toEqual(expect.any(Number));

    // Someone else can't revoke it.
    const other = bearer(await t.token(randomUUID()));
    await request(server).delete(`/me/tokens/${made.id}`).set(other).expect(404);
    await request(server).delete(`/me/tokens/${made.id}`).set(auth).expect(204);
    expect((await request(server).get('/v1/boards').set(agent).expect(401)).body.message).toContain('revoked');
    expect((await request(server).get('/me/tokens').set(auth).expect(200)).body).toEqual([]);

    // An expired token stops working.
    const old = await makeToken(auth, { name: 'Old', scopes: ['boards:read'] });
    await t.app.get<Db>(DB).update(accessTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(accessTokens.id, old.id));
    await request(server).get('/v1/boards').set(bearer(old.token)).expect(401);
    await request(server).get('/v1/boards').set(bearer('cbp_nothing')).expect(401);
  });

  it('lists, reads and searches boards, and proposes changes that wait as a suggestion until accepted', async () => {
    const word = `wombat${Date.now()}`;
    const { server, auth, board, doc } = await setup(`${word} retro`);
    const [slow, flaky, loose] = addNotes(doc, [
      { text: 'Slow deploys', color: 'yellow' },
      { text: 'Flaky tests', color: 'pink' },
      { text: 'Lunch was good', color: 'green' },
    ]);
    const { frameIds } = frameGroups(doc, [{ title: 'Pain', noteIds: [slow, flaky] }]);
    const painId = frameIds[0];
    await settle();

    const { token } = await makeToken(auth, { name: 'Cursor', scopes: ['boards:read', 'boards:propose'] });
    const agent = bearer(token);

    const { body: boards } = await request(server).get('/v1/boards').set(agent).expect(200);
    expect(boards).toEqual([expect.objectContaining({ id: board.id, title: `${word} retro`, role: 'owner' })]);

    const { body: outline } = await request(server).get(`/v1/boards/${board.id}`).set(agent).expect(200);
    expect(outline).toMatchObject({ id: board.id, role: 'owner', canPropose: true, pendingSuggestions: 0, truncated: false, tasks: [] });
    expect(outline.frames).toEqual([{ id: painId, title: 'Pain', notes: expect.arrayContaining([expect.objectContaining({ id: slow, text: 'Slow deploys' }), expect.objectContaining({ id: flaky })]) }]);
    expect(outline.notes).toEqual([expect.objectContaining({ id: loose, text: 'Lunch was good', color: 'green' })]);

    await t.app.get(SearchIndex).refresh();
    const { body: hits } = await request(server).get('/v1/search').query({ q: word }).set(agent).expect(200);
    expect(hits.map((h: { boardId: string }) => h.boardId)).toEqual([board.id]);
    await request(server).get('/v1/search').set(agent).expect(400);

    const proposal = await request(server)
      .post(`/v1/boards/${board.id}/proposals`)
      .set(agent)
      .send({
        summary: 'Sort the retro',
        notes: [{ text: 'Cache the build', color: 'blue' }, { text: 'Quarantine flaky tests', frameId: painId }],
        frames: [{ title: 'Good', noteIds: [loose], notes: [{ text: 'Pairing' }] }],
        tasks: [{ title: 'Set up a build cache', owner: 'Ada', due: '2026-12-01', priority: 3, noteId: slow }],
        diagram: 'flowchart TD\n  A[Build] --> B[Deploy]',
      })
      .expect(201);
    expect(proposal.body).toEqual({ suggestionId: expect.any(String), action: expect.stringMatching(/^Would make 1 frame/) });
    expect(proposal.body.action).toContain('draw 1 diagram');
    await settle();

    // Nothing has changed yet: the suggestion waits, named for the agent and its owner.
    expect(notesOf(doc)).toHaveLength(3);
    expect(validTasks(doc)).toEqual([]);
    const suggestion = doc.getMap<Suggestion>('suggestions').get(proposal.body.suggestionId)!;
    expect(suggestion).toMatchObject({ model: 'Cursor', agent: true, forName: 'Ada', asked: 'Sort the retro' });
    expect(suggestion.added.filter((n) => n.attrs['kind'] === 'note').map((n) => n.text).sort()).toEqual(['Cache the build', 'Pairing', 'Quarantine flaky tests']);

    await request(server).post(`/boards/${board.id}/suggestions/${suggestion.id}/accept`).set(auth).expect(204);
    await settle();
    expect(notesOf(doc).map((n) => n.text).sort()).toEqual(['Cache the build', 'Flaky tests', 'Lunch was good', 'Pairing', 'Quarantine flaky tests', 'Slow deploys']);
    const byText = new Map(notesOf(doc).map((n) => [n.text, n]));
    expect(byText.get('Quarantine flaky tests')!.frame).toBe('Pain');
    expect(byText.get('Pairing')!.frame).toBe('Good');
    expect(byText.get('Lunch was good')!.frame).toBe('Good');
    expect(framesOf(doc).map((f) => f.title).sort()).toEqual(['Good', 'Pain']);
    expect(validTasks(doc)).toEqual([expect.objectContaining({ title: 'Set up a build cache', priority: 3, due: '2026-12-01', noteId: slow, assignee: expect.any(String) })]);
    expect([...doc.getMap<Y.Map<unknown>>('nodes').values()].filter((n) => n.get('kind') === 'diagram')).toHaveLength(1);

    const { body: events } = await request(server).get(`/boards/${board.id}/activity`).set(auth).expect(200);
    expect(events.map((e: { actor: string; action: string }) => `${e.actor} ${e.action}`)).toEqual(
      expect.arrayContaining(['Ada via Cursor read the board', 'Ada via Cursor proposed a change', 'Ada accepted a suggestion from']),
    );
    expect(events.find((e: { action: string }) => e.action === 'accepted a suggestion from').target).toBe('Cursor for Ada');

    // Problems come back in words.
    const bad = await request(server).post(`/v1/boards/${board.id}/proposals`).set(agent).send({ notes: [{ text: 'x', frameId: 'nope' }] }).expect(400);
    expect(bad.body.message).toContain("There's no frame");
    await request(server).post(`/v1/boards/${board.id}/proposals`).set(agent).send({}).expect(400);
    await request(server).post(`/v1/boards/${board.id}/proposals`).set(agent).send({ diagram: 'pie title x' }).expect(400);
    await request(server).post(`/v1/boards/${randomUUID()}/proposals`).set(agent).send({ notes: [{ text: 'x' }] }).expect(404);
  });

  it("holds tokens to their scopes and their owner's role", async () => {
    const { server, auth, readerAuth, board, doc } = await setup();
    const [note] = addNotes(doc, [{ text: 'Hello', color: 'yellow' }]);
    await settle();

    const readOnly = bearer((await makeToken(auth, { name: 'Reader bot', scopes: ['boards:read'] })).token);
    const refused = await request(server).post(`/v1/boards/${board.id}/proposals`).set(readOnly).send({ notes: [{ text: 'x' }] }).expect(403);
    expect(refused.body.message).toContain('needs the boards:propose scope');
    await request(server).post(`/v1/boards/${board.id}/comments`).set(readOnly).send({ itemId: note, body: 'Hi' }).expect(403);

    const proposeOnly = bearer((await makeToken(auth, { name: 'Writer', scopes: ['boards:propose'] })).token);
    await request(server).get(`/v1/boards/${board.id}`).set(proposeOnly).expect(403);

    // A reader's token reads, but can't propose or comment, whatever its scopes.
    const readers = bearer((await makeToken(readerAuth, { name: 'Claude', scopes: ['boards:read', 'boards:propose', 'comments:write'] })).token);
    await request(server).get(`/v1/boards/${board.id}`).set(readers).expect(200);
    const asReader = await request(server).post(`/v1/boards/${board.id}/proposals`).set(readers).send({ notes: [{ text: 'x' }] }).expect(403);
    expect(asReader.body.message).toBe('Rhea is a reader on this board, so Claude can read it but not propose changes. An owner can make them an updater.');
    await request(server).post(`/v1/boards/${board.id}/comments`).set(readers).send({ itemId: note, body: 'Hi' }).expect(403);
    await settle();
    expect(doc.getMap('suggestions').size).toBe(0);

    // Comments, as their owner via the agent.
    const commenter = bearer((await makeToken(auth, { name: 'Cursor', scopes: ['comments:write'] })).token);
    await request(server).post(`/v1/boards/${board.id}/comments`).set(commenter).send({ itemId: 'nope', body: 'Hi' }).expect(404);
    const { body: made } = await request(server).post(`/v1/boards/${board.id}/comments`).set(commenter).send({ itemId: note, body: 'Is this still true?' }).expect(201);
    const { body: threads } = await request(server).get(`/boards/${board.id}/comments`).set(auth).expect(200);
    expect(threads).toEqual([expect.objectContaining({ id: made.threadId, nodeId: note, comments: [expect.objectContaining({ id: made.commentId, body: 'Is this still true?', via: 'Cursor', author: expect.objectContaining({ name: 'Ada' }) })] })]);
    const { body: events } = await request(server).get(`/boards/${board.id}/activity`).set(auth).expect(200);
    expect(events[0]).toMatchObject({ actor: 'Ada via Cursor', action: 'commented' });
  });

  it('serves the same tools over MCP, held to the same token', async () => {
    const { server, auth, board, doc } = await setup('MCP board');
    const [note] = addNotes(doc, [{ text: 'Ship it', color: 'yellow' }]);
    await settle();
    const { token } = await makeToken(auth, { name: 'Claude Code', scopes: ['boards:read', 'boards:propose'] });
    const url = new URL(t.collabUrl.replace('ws://', 'http://').replace('/collab', '/mcp'));

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: bearer(token) } }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(['add_comment', 'list_boards', 'propose_changes', 'read_board', 'search_boards']);
      expect(tools.find((tool) => tool.name === 'propose_changes')!.inputSchema.properties).toHaveProperty('frames');

      const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);
      const listed = JSON.parse(text(await client.callTool({ name: 'list_boards', arguments: {} })));
      expect(listed.map((b: { id: string }) => b.id)).toContain(board.id);
      const outline = JSON.parse(text(await client.callTool({ name: 'read_board', arguments: { board_id: board.id } })));
      expect(outline.notes).toEqual([expect.objectContaining({ id: note, text: 'Ship it' })]);

      const proposed = await client.callTool({ name: 'propose_changes', arguments: { board_id: board.id, summary: 'Group it', frames: [{ title: 'Now', note_ids: [note] }] } });
      expect(proposed.isError).toBeFalsy();
      const { suggestionId } = JSON.parse(text(proposed));
      await settle();
      expect(doc.getMap<Suggestion>('suggestions').get(suggestionId)).toMatchObject({ model: 'Claude Code', agent: true, action: 'Would make 1 frame and move 1 note into it.' });

      // Refusals are tool errors, in words.
      const noScope = await client.callTool({ name: 'add_comment', arguments: { board_id: board.id, item_id: note, body: 'Hi' } });
      expect(noScope.isError).toBe(true);
      expect(text(noScope)).toContain('needs the comments:write scope');
      const missing = await client.callTool({ name: 'read_board', arguments: { board_id: randomUUID() } });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toBe('Board not found');
    } finally {
      await client.close();
    }

    // Raw JSON-RPC, as any client sends it; without a token, or with a revoked one, it's refused.
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const accept = { Accept: 'application/json, text/event-stream' };
    const raw = await request(server).post('/mcp').set(accept).set(bearer(token)).send(call).expect(200);
    expect(raw.body.result.tools).toHaveLength(5);
    await request(server).post('/mcp').set(accept).send(call).expect(401);
    await request(server).post('/mcp').set(accept).set(auth).send(call).expect(401);
    await request(server).get('/mcp').set(bearer(token)).expect(405);
  });
});
