import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { timerOf } from '../../src/facilitation/facilitation-doc';
import { createTestApp, type TestApp } from './app';

const eventually = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error('Timed out waiting');
};

/** Connects a browser's copy of a board; reports whether the server is holding back its edits. */
function connect(t: TestApp, boardId: string, token: string, doc: Y.Doc) {
  let unsynced = 0;
  const provider = new HocuspocusProvider({ url: t.collabUrl, name: boardId, token, document: doc, onUnsyncedChanges: ({ number }) => (unsynced = number) });
  return { provider, unsynced: () => unsynced, synced: () => provider.isSynced };
}

/** A note written in the browser's copy, which the server should take. */
function addNote(doc: Y.Doc, id: string): void {
  const note = new Y.Map<unknown>();
  doc.getMap('nodes').set(id, note);
  note.set('kind', 'note');
  note.set('x', 0);
}

describe('A browser coming back to a board', () => {
  let t: TestApp;
  afterEach(async () => {
    await t?.app.close();
  });

  it('is taken back after the server changed its own parts of the board (the timer, twice), whether or not the API restarted', async () => {
    t = await createTestApp();
    const subject = randomUUID();
    const token = await t.token(subject);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    const { body: board } = await request(t.app.getHttpServer()).post(`/orgs/${me.body.orgs[0].id}/boards`).set(auth).send({ title: 'Retro' });

    const doc = new Y.Doc();
    let tab = connect(t, board.id, token, doc);
    await eventually(tab.synced);
    // Setting it again replaces (deletes) what the server wrote before; the browser's copy has those deletes.
    await request(t.app.getHttpServer()).put(`/boards/${board.id}/timer`).set(auth).send({ seconds: 300 }).expect(204);
    await request(t.app.getHttpServer()).put(`/boards/${board.id}/timer`).set(auth).send({ seconds: null }).expect(204);
    await eventually(() => timerOf(doc).endsAt === null && timerOf(doc).seconds === 0);

    // Reconnecting (a network blip, or opening the board again from this browser's copy).
    tab.provider.destroy();
    tab = connect(t, board.id, token, doc);
    await eventually(tab.synced);
    addNote(doc, 'n1');
    await eventually(() => tab.unsynced() === 0, 3000);

    // And across a restart.
    tab.provider.destroy();
    await t.app.close();
    t = await createTestApp();
    tab = connect(t, board.id, token, doc);
    await eventually(tab.synced);
    addNote(doc, 'n2');
    await eventually(() => tab.unsynced() === 0, 3000);
    tab.provider.destroy();
  });

  it("takes a browser's saved copy of the board, with its unsent edits, when the page opens again", async () => {
    t = await createTestApp();
    const subject = randomUUID();
    const token = await t.token(subject);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request(t.app.getHttpServer()).get('/me').set(auth).expect(200);
    const { body: board } = await request(t.app.getHttpServer()).post(`/orgs/${me.body.orgs[0].id}/boards`).set(auth).send({ title: 'Retro' });

    // A visit: the server runs the timer twice, and something is written while offline that never got sent.
    const first = new Y.Doc();
    const tab = connect(t, board.id, token, first);
    await eventually(tab.synced);
    await request(t.app.getHttpServer()).put(`/boards/${board.id}/timer`).set(auth).send({ seconds: 300 }).expect(204);
    await request(t.app.getHttpServer()).put(`/boards/${board.id}/timer`).set(auth).send({ seconds: null }).expect(204);
    await eventually(() => timerOf(first).endsAt === null && timerOf(first).seconds === 0);
    tab.provider.destroy();
    addNote(first, 'written-offline');
    const saved = Y.encodeStateAsUpdate(first);

    // The page opens again: the browser's saved copy loads first (as the app's IndexedDB copy does), then it connects
    // and sends the server what it hasn't got, along with everything it knows was deleted.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved, 'indexeddb');
    const again = connect(t, board.id, token, doc);
    await eventually(again.synced);

    // Anyone else opening the board sees the note written offline.
    const other = new Y.Doc();
    const look = connect(t, board.id, token, other);
    await eventually(() => look.synced() && other.getMap('nodes').has('written-offline'));
    look.provider.destroy();
    again.provider.destroy();
  });
});
