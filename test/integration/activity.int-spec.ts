import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes, notesOf } from '../../src/assist/board-edit';
import { createTestApp, type TestApp } from './app';

const eventually = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('Timed out waiting');
};

describe('Activity, versions and notifications', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  async function people() {
    const server = t.app.getHttpServer();
    const adaToken = await t.token(randomUUID(), { name: 'Ada Lovelace' });
    const ada = { Authorization: `Bearer ${adaToken}` };
    const { body: me } = await request(server).get('/me').set(ada);
    const orgId = me.orgs[0].id as string;
    const graceSubject = randomUUID();
    const grace = { Authorization: `Bearer ${await t.token(graceSubject, { name: 'Grace Hopper' })}` };
    const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(ada).send({ email: `${graceSubject}@corkboard.test`, role: 'commenter' });
    await request(server).post(`/me/invites/${invite.id}/accept`).set(grace).expect(201);
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(ada).send({ title: 'Retro' });
    return { server, ada, adaToken, grace, orgId, board };
  }

  it("records what people do on a board, newest first", async () => {
    const { server, ada, grace, board } = await people();
    await request(server).patch(`/boards/${board.id}`).set(ada).send({ title: 'Sprint 12 retro' }).expect(200);
    await request(server).post(`/boards/${board.id}/comments`).set(grace).send({ nodeId: 'n1', body: 'Is this done?' }).expect(201);
    await request(server).put(`/boards/${board.id}/timer`).set(ada).send({ seconds: 300, label: 'Add notes' }).expect(204);

    const { body: events } = await request(server).get(`/boards/${board.id}/activity`).set(grace).expect(200);
    expect(events.map((e: { actor: string; action: string }) => `${e.actor} ${e.action}`)).toEqual([
      'Ada Lovelace started the timer',
      'Grace Hopper commented',
      'Ada Lovelace renamed the board',
      'Ada Lovelace created the board',
    ]);
    expect(events[2]).toMatchObject({ target: 'Sprint 12 retro', detail: 'Was "Retro"' });
    const since = events[1].at as number;
    const { body: newer } = await request(server).get(`/boards/${board.id}/activity`).query({ since }).set(ada).expect(200);
    expect(newer).toHaveLength(1);
  });

  it('saves versions and restores one for everyone, keeping what was there as a version too', async () => {
    const { server, ada, adaToken, grace, board } = await people();
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token: adaToken, document: doc, onSynced: (): void => resolve(p) });
    });
    addNotes(doc, [{ text: 'Keep me', color: 'yellow' }]);
    await new Promise((r) => setTimeout(r, 300));
    const { body: v1 } = await request(server).post(`/boards/${board.id}/versions`).set(ada).send({ label: 'Before cleanup' }).expect(201);
    await request(server).post(`/boards/${board.id}/versions`).set(grace).send({}).expect(403);

    // Anyone on the board can look at a version before it's restored.
    const saved = await request(server).get(`/boards/${board.id}/versions/${v1.id}`).set(grace).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    const preview = new Y.Doc();
    Y.applyUpdate(preview, new Uint8Array(saved.body as Buffer));
    expect(notesOf(preview).map((n) => n.text)).toEqual(['Keep me']);
    await request(server).get(`/boards/${board.id}/versions/${randomUUID()}`).set(grace).expect(404);

    doc.getMap('nodes').clear();
    addNotes(doc, [{ text: 'Replaced', color: 'pink' }]);
    await new Promise((r) => setTimeout(r, 300));
    await request(server).post(`/boards/${board.id}/versions/${v1.id}/restore`).set(ada).expect(204);
    await eventually(() => notesOf(doc).map((n) => n.text).join() === 'Keep me');

    const { body: versions } = await request(server).get(`/boards/${board.id}/versions`).set(grace).expect(200);
    expect(versions.map((v: { label: string }) => v.label).slice(0, 2)).toEqual(['Before restoring Before cleanup', 'Before cleanup']);
    expect(versions[1].by).toBe('Ada Lovelace');
    provider.destroy();
  });

  it('tells people when they are mentioned or replied to, and keeps track of what they have read', async () => {
    const { server, ada, grace, board } = await people();
    await request(server).post(`/boards/${board.id}/comments`).set(grace).send({ nodeId: 'n1', body: 'First thoughts' }).expect(201);
    await request(server).post(`/boards/${board.id}/comments`).set(ada).send({ nodeId: 'n1', body: 'Agreed, @Grace — can you take it?' }).expect(201);
    await request(server).post(`/boards/${board.id}/chat`).set(grace).send({ text: 'Thanks @ada lovelace', answer: false }).expect(201);

    const { body: graces } = await request(server).get('/me/notifications').set(grace).expect(200);
    expect(graces.map((n: { kind: string; actor: string; title: string }) => [n.kind, n.actor, n.title])).toEqual([
      ['mention', 'Ada Lovelace', 'mentioned you in a comment'],
      ['invite', 'Ada Lovelace', "invited you to Ada Lovelace's workspace"],
    ]);
    expect(graces[0]).toMatchObject({ context: 'Retro', link: `/boards/${board.id}`, read: false });
    const { body: adas } = await request(server).get('/me/notifications').set(ada).expect(200);
    expect(adas.map((n: { title: string }) => n.title)).toEqual(['mentioned you in the board chat']);

    await request(server).post('/me/notifications/read').set(grace).send({ all: true }).expect(204);
    expect((await request(server).get('/me/notifications').set(grace)).body[0].read).toBe(true);
  });

  it("stops telling someone about a board's comments once they can't open it", async () => {
    const { server, ada, grace, board } = await people();
    const { body: graceMe } = await request(server).get('/me').set(grace);
    await request(server).post(`/boards/${board.id}/comments`).set(grace).send({ nodeId: 'n', body: 'First' }).expect(201);
    await request(server).post(`/boards/${board.id}/comments`).set(ada).send({ nodeId: 'n', body: 'A reply Grace can see' }).expect(201);
    const replies = async () =>
      ((await request(server).get('/me/notifications').set(grace)).body as { kind: string; body: string }[]).filter((n) => n.kind === 'reply').map((n) => n.body);
    expect(await replies()).toEqual(['A reply Grace can see']);

    await request(server).put(`/boards/${board.id}/members/${graceMe.id}`).set(ada).send({ role: 'none' }).expect(200);
    await request(server).post(`/boards/${board.id}/comments`).set(ada).send({ nodeId: 'n', body: 'Private now' }).expect(201);
    // Nothing new reaches her, and what she had about the board is hidden while she can't open it.
    expect(await replies()).toEqual([]);
  });

  it('tells people over a live stream the moment they have something new, and only them', async () => {
    const { server, ada, grace, board } = await people();
    const base = t.collabUrl.replace('ws://', 'http://').replace('/collab', '');
    const listen = (auth: { Authorization: string }) => {
      const controller = new AbortController();
      const heard: string[] = [];
      const done = fetch(`${base}/me/notifications/stream`, { headers: auth, signal: controller.signal }).then(async (res) => {
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const reader = res.body!.getReader();
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) return;
          heard.push(...new TextDecoder().decode(value).split('\n').filter((l) => l.startsWith('event: ')));
        }
      }).catch(() => undefined);
      return { heard, stop: () => { controller.abort(); return done; } };
    };
    const graceHears = listen(grace);
    const adaHears = listen(ada);
    await new Promise((r) => setTimeout(r, 300));

    await request(server).post(`/boards/${board.id}/comments`).set(ada).send({ nodeId: 'n', body: 'Over to you @Grace' }).expect(201);
    for (let i = 0; i < 60 && !graceHears.heard.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(graceHears.heard).toEqual(['event: changed']);
    expect(adaHears.heard).toEqual([]);
    await Promise.all([graceHears.stop(), adaHears.stop()]);
  });
});
