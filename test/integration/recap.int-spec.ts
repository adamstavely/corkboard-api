import { HocuspocusProvider } from '@hocuspocus/provider';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as Y from 'yjs';
import { addNotes } from '../../src/assist/board-edit';
import { chatOf } from '../../src/chat/chat-doc';
import type { ChatRequest } from '../../src/models/adapters/types';
import { createTestApp, type TestApp } from './app';

let script: (req: ChatRequest) => Promise<string>;

describe('Session recap', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ models: () => ({ chat: async (req) => ({ text: await script(req), toolCalls: 0 }) }) });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('posts the decisions, owners and open questions to the chat, citing only real notes', async () => {
    const server = t.app.getHttpServer();
    const token = await t.token(randomUUID(), { name: 'Ada' });
    const auth = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(auth);
    const orgId = me.orgs[0].id as string;
    const m = await t.model(orgId, auth, { label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(auth).send({ title: 'Sprint 12 retro' });

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [blueGreen, grace] = addNotes(doc, [
      { text: 'Decision: blue-green deploys', color: 'yellow' },
      { text: 'Grace sets up the second environment by Friday', color: 'green' },
    ]);
    await new Promise((r) => setTimeout(r, 300));

    script = async (req) => {
      expect(req.prompt).toContain('Sprint 12 retro');
      await req.execute('write_recap', {
        title: 'Sprint 12 retro',
        decisions: [{ text: 'Move to blue-green deploys', note_ids: [blueGreen, 'invented'] }],
        actions: [{ text: 'Set up the second environment', owner: 'Grace', due: 'Friday', note_ids: [grace] }, { text: '  ', note_ids: [] }],
        questions: ['Who pays for the second environment?'],
      });
      return 'Done.';
    };
    const { body: recap } = await request(server).post(`/boards/${board.id}/recap`).set(auth).send({ modelId: m.id }).expect(200);
    expect(recap).toMatchObject({
      title: 'Sprint 12 retro',
      decisions: [{ text: 'Move to blue-green deploys', sources: [blueGreen] }],
      actions: [{ text: 'Set up the second environment', owner: 'Grace', due: 'Friday', sources: [grace] }],
      questions: ['Who pays for the second environment?'],
      model: 'Claude',
      by: 'Ada',
    });

    for (let i = 0; i < 60 && !chatOf(doc).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [posted] = chatOf(doc);
    expect(posted).toMatchObject({ authorId: 'model', name: 'Claude', text: 'Recap: Sprint 12 retro (1 decision, 1 action, 1 open question)' });
    expect(posted.recap?.actions[0].owner).toBe('Grace');

    // A model that only talks, without writing the recap, is a failure, and nothing is posted.
    script = () => Promise.resolve('Here is a recap in words.');
    await request(server).post(`/boards/${board.id}/recap`).set(auth).send({ modelId: m.id }).expect(502);
    expect(chatOf(doc)).toHaveLength(1);
    provider.destroy();
  });

  it("adds the session's results, counted from the board, without who gave which or unrevealed hidden notes", async () => {
    const server = t.app.getHttpServer();
    const adaSubject = randomUUID();
    const token = await t.token(adaSubject, { name: 'Ada' });
    const ada = { Authorization: `Bearer ${token}` };
    const { body: me } = await request(server).get('/me').set(ada);
    const orgId = me.orgs[0].id as string;
    const join = async (name: string) => {
      const subject = randomUUID();
      const auth = { Authorization: `Bearer ${await t.token(subject, { name })}` };
      const { body: invite } = await request(server).post(`/orgs/${orgId}/invites`).set(ada).send({ email: `${subject}@corkboard.test`, role: 'commenter' });
      await request(server).post(`/me/invites/${invite.id}/accept`).set(auth).expect(201);
      return { auth, id: ((await request(server).get('/me').set(auth)).body as { id: string }).id };
    };
    const grace = await join('Grace Hopper');
    const linus = await join('Linus Torvalds');
    const m = await t.model(orgId, ada, { label: 'Claude', kind: 'anthropic', model: 'claude-opus-5-5', apiKey: 'k' });
    const { body: board } = await request(server).post(`/orgs/${orgId}/boards`).set(ada).send({ title: 'Planning' });
    const at = (path: string) => `/boards/${board.id}${path}`;

    const doc = new Y.Doc();
    const provider = await new Promise<HocuspocusProvider>((resolve) => {
      const p: HocuspocusProvider = new HocuspocusProvider({ url: t.collabUrl, name: board.id, token, document: doc, onSynced: (): void => resolve(p) });
    });
    const [onboarding, billing] = addNotes(doc, [
      { text: 'Onboarding', color: 'yellow' },
      { text: 'Billing', color: 'green' },
    ]);
    await new Promise((r) => setTimeout(r, 300));

    // A private, facilitated session: a vote step, a poll, planning poker, and a hidden writing round still running.
    await request(server).put(at('/privacy')).set(ada).send({ on: true }).expect(204);
    await request(server)
      .put(at('/agenda'))
      .set(ada)
      .send({ steps: [{ title: 'Which theme first?', seconds: 0, activity: { kind: 'vote', votesEach: 2 } }, { title: 'Wrap up', seconds: 0 }] })
      .expect(204);
    await request(server).post(at('/agenda/go')).set(ada).send({ step: 0 }).expect(204);
    for (const [who, note] of [
      [grace.auth, onboarding],
      [grace.auth, onboarding],
      [linus.auth, billing],
      [linus.auth, onboarding],
    ] as const)
      await request(server).post(at('/votes')).set(who).send({ noteId: note, add: true }).expect(204);
    await request(server).post(at('/agenda/go')).set(ada).send({ step: 1 }).expect(204);
    await request(server).post(at('/poll')).set(ada).send({ question: 'Ship on Friday?', kind: 'choice', options: ['Yes', 'No'] }).expect(204);
    await request(server).post(at('/poll/answers')).set(grace.auth).send({ answer: 0 }).expect(204);
    await request(server).post(at('/poll/answers')).set(linus.auth).send({ answer: 1 }).expect(204);
    await request(server).post(at('/poker')).set(ada).send({ deck: 'fibonacci', title: 'Onboarding revamp' }).expect(204);
    await request(server).post(at('/poker/estimates')).set(grace.auth).send({ value: '5' }).expect(204);
    await request(server).post(at('/poker/estimates')).set(linus.auth).send({ value: '8' }).expect(204);
    await request(server).put(at('/poker/reveal')).set(ada).expect(204);
    await request(server).post(at('/agenda/go')).set(ada).send({ step: null }).expect(204);
    await request(server).post(at('/writing')).set(ada).send({ anonymous: true }).expect(204);
    await request(server).post(at('/writing/drafts')).set(grace.auth).send({ text: 'Secret worry about the launch' }).expect(201);

    let prompt = '';
    script = async (req) => {
      prompt = req.prompt;
      await req.execute('write_recap', { title: 'Planning', decisions: [{ text: 'Onboarding goes first', note_ids: [onboarding] }], actions: [], questions: [] });
      return 'Done.';
    };
    const { body: recap } = await request(server).post(at('/recap')).set(ada).send({ modelId: m.id }).expect(200);
    expect(recap.results).toEqual([
      { kind: 'agenda', title: 'Steps run', items: [{ label: 'Which theme first?' }, { label: 'Wrap up' }] },
      { kind: 'vote', title: 'Which theme first?', items: [{ label: 'Onboarding', count: 3 }, { label: 'Billing', count: 1 }] },
      { kind: 'poll', title: 'Ship on Friday?', open: true, items: [{ label: 'Yes', count: 1 }, { label: 'No', count: 1 }] },
      { kind: 'estimate', title: 'Onboarding revamp', items: [{ label: '5', count: 1 }, { label: '8', count: 1 }] },
    ]);
    // The model sees the counts, to know what was chosen, and nothing of who gave which or of notes still hidden.
    expect(prompt).toContain('Vote: Which theme first? — Onboarding 3, Billing 1');
    expect(prompt).toContain('Estimate: Onboarding revamp — 5 1, 8 1');
    for (const secret of ['Grace', 'Linus', grace.id, linus.id, 'Secret worry']) expect(prompt).not.toContain(secret);
    expect(JSON.stringify(recap)).not.toMatch(new RegExp(`Grace|Linus|${grace.id}|${linus.id}|Secret worry`));

    for (let i = 0; i < 60 && !chatOf(doc).length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(chatOf(doc)[0]).toMatchObject({ text: 'Recap: Planning (1 decision, 0 actions, 0 open questions, 4 results)' });
    expect(chatOf(doc)[0].recap?.results).toHaveLength(4);
    provider.destroy();
  });
});
