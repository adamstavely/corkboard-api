import { openAICompatibleModel } from './adapters/openai-compatible';
import { MAX_TOOL_CALLS_PER_ANSWER, ModelError } from './adapters/types';
import { ModelJobs } from './model-jobs';

/** A request that waits until it's stopped. */
const hang = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true }));

describe('model requests', () => {
  it("lets a workspace run only so many at once, and frees a place when one ends", async () => {
    const jobs = new ModelJobs(2, 60_000);
    let finish!: () => void;
    const first = jobs.run('org', undefined, () => new Promise<void>((r) => (finish = r)));
    const second = jobs.run('org', undefined, () => new Promise<void>(() => undefined));
    await expect(jobs.run('org', undefined, () => Promise.resolve())).rejects.toThrow('already has 2 model requests running');
    // Another workspace isn't held up.
    await expect(jobs.run('other', undefined, () => Promise.resolve('ok'))).resolves.toBe('ok');
    finish();
    await first;
    expect(jobs.runningIn('org')).toBe(1);
    await expect(jobs.run('org', undefined, () => Promise.resolve('ok'))).resolves.toBe('ok');
    jobs.stopAll();
    void second;
  });

  it('stops a request at its deadline, and every request at shutdown', async () => {
    const jobs = new ModelJobs(4, 50);
    await expect(jobs.run('org', undefined, hang)).rejects.toThrow('took too long');
    expect(jobs.runningIn('org')).toBe(0);

    const slow = new ModelJobs(4, 60_000);
    const running = slow.run('org', undefined, hang);
    slow.stopAll();
    await expect(running).rejects.toThrow('restarting');
  });

  it("cancels a model call that doesn't answer in time, or that the request stops", async () => {
    const fetch = ((_url: string, init: RequestInit) => hang(init.signal!)) as unknown as typeof globalThis.fetch;
    const model = openAICompatibleModel({ model: 'm', baseUrl: 'http://model.test/v1', label: 'Slow', fetch, stepMs: 50 });
    const request = { system: 's', prompt: 'p', tools: [], execute: () => Promise.resolve(''), maxSteps: 2 };
    await expect(model.chat(request)).rejects.toThrow('Slow took too long to answer');

    const stop = new AbortController();
    const asked = model.chat({ ...request, signal: stop.signal });
    stop.abort(new ModelError('The server is restarting, so the request was stopped. Try again shortly.'));
    await expect(asked).rejects.toThrow('restarting');
  });

  it('refuses an answer asking for a runaway number of tool calls', async () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ANSWER + 1 }, (_, i) => ({ id: `c${i}`, type: 'function', function: { name: 'add_notes', arguments: '{}' } }));
    const fetch = (() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: calls } }] })))) as unknown as typeof globalThis.fetch;
    const executed: string[] = [];
    const model = openAICompatibleModel({ model: 'm', baseUrl: 'http://model.test/v1', label: 'Busy', fetch });
    await expect(model.chat({ system: 's', prompt: 'p', tools: [], execute: (n) => (executed.push(n), Promise.resolve('')), maxSteps: 2 })).rejects.toThrow('too much in one go');
    expect(executed).toEqual([]);
  });
});
