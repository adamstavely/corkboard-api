import { HocuspocusProvider } from '@hocuspocus/provider';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { createTestApp } from './app';

describe('Shutting down', () => {
  it('finishes with notification streams and board connections open, rather than waiting on them', async () => {
    const t = await createTestApp();
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const orgId = (await request(server).get('/me').set(auth)).body.orgs[0].id as string;
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Open' }).expect(201);

    // A browser tab: its notification stream, and the board open live.
    const { port } = server.address() as AddressInfo;
    const stream = await new Promise<http.IncomingMessage>((resolve) => http.get({ port, host: '127.0.0.1', path: '/me/notifications/stream', headers: auth }, resolve));
    expect(stream.statusCode).toBe(200);
    const ended = new Promise<void>((resolve) => stream.on('close', () => resolve()));
    stream.resume();
    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    // A change just before shutdown, inside the 2 seconds before its save would run on its own.
    doc.getMap('tasks').set('last', { id: 'last', key: 'T-1', title: 'Made at the last moment', status: 'todo', labels: [] });
    for (let i = 0; i < 40 && provider.hasUnsyncedChanges; i++) await new Promise((r) => setTimeout(r, 25));

    const closed = t.app.close().then(() => 'closed');
    const timedOut = new Promise((r) => setTimeout(() => r('timed out'), 10_000));
    expect(await Promise.race([closed, timedOut])).toBe('closed');
    await ended;
    provider.destroy();

    // Saved on the way down: the next instance has it.
    const next = await createTestApp();
    const { body } = await request(next.app.getHttpServer()).get(`/boards/${board.id}/document`).set(auth).expect(200);
    const saved = new Y.Doc();
    Y.applyUpdate(saved, Buffer.from(body.state as string, 'base64'));
    expect((saved.getMap('tasks').get('last') as { title: string }).title).toBe('Made at the last moment');
    await next.app.close();
  });
});
