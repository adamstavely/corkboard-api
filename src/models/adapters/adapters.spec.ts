import type Anthropic from '@anthropic-ai/sdk';
import { allowedBaseUrl } from '../chat-models';
import { anthropicModel } from './anthropic';
import { openAICompatibleModel } from './openai-compatible';
import { ModelError, type ChatRequest } from './types';

const TOOL = { name: 'add_notes', description: 'Adds notes', parameters: { type: 'object', properties: {}, additionalProperties: false } };

function request(execute = jest.fn(() => Promise.resolve('Added 1 note'))): ChatRequest & { execute: jest.Mock } {
  return { system: 'sys', prompt: 'Add a note', tools: [TOOL], execute, maxSteps: 4 };
}

describe('Anthropic adapter', () => {
  function fake(...responses: Partial<Anthropic.Beta.BetaMessage>[]) {
    const create = jest.fn();
    for (const r of responses) create.mockResolvedValueOnce(r);
    return { create, client: { beta: { messages: { create } } } as unknown as Pick<Anthropic, 'beta'> };
  }

  it('runs tool calls until the model answers, sending the results back', async () => {
    const { create, client } = fake(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'add_notes', input: { notes: [] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added a note.' } as Anthropic.Beta.BetaTextBlock] },
    );
    const req = request();
    const result = await anthropicModel({ model: 'claude-opus-5-5', apiKey: 'k', label: 'Claude', client }).chat(req);

    expect(result).toEqual({ text: 'Added a note.', toolCalls: 1 });
    expect(req.execute).toHaveBeenCalledWith('add_notes', { notes: [] });
    const second = create.mock.calls[1][0];
    expect(second.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Added 1 note' }] });
    // Strict tools, no forced choice, and refusal fallbacks on a model that takes them.
    expect(second.tools[0]).toMatchObject({ name: 'add_notes', strict: true });
    expect(second.tool_choice).toBeUndefined();
    expect(second).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  });

  it('shows the model pictures before the prompt', async () => {
    const { create, client } = fake({ stop_reason: 'end_turn', content: [] });
    await anthropicModel({ model: 'm', apiKey: 'k', label: 'C', client }).chat({ ...request(), images: [{ mediaType: 'image/png', data: 'iVBOR' }] });
    expect(create.mock.calls[0][0].messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      { type: 'text', text: 'Add a note' },
    ]);
  });

  it('sends no fallbacks to other models or through a proxy', async () => {
    for (const opts of [{ model: 'claude-haiku-5-5' }, { model: 'claude-opus-5-5', baseUrl: 'https://proxy.test' }]) {
      const { create, client } = fake({ stop_reason: 'end_turn', content: [] });
      await anthropicModel({ apiKey: 'k', label: 'C', client, ...opts }).chat(request());
      expect(create.mock.calls[0][0].fallbacks).toBeUndefined();
    }
  });

  it('reports a tool failure to the model as an error result', async () => {
    const { create, client } = fake(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'add_notes', input: {} }] },
      { stop_reason: 'end_turn', content: [] },
    );
    await anthropicModel({ model: 'm', apiKey: 'k', label: 'C', client }).chat(request(jest.fn(() => Promise.reject(new Error('No notes')))));
    expect(create.mock.calls[1][0].messages.at(-1).content[0]).toMatchObject({ content: 'No notes', is_error: true });
  });

  it('turns refusals, cut-off answers and endless loops into plain errors', async () => {
    const model = (r: Partial<Anthropic.Beta.BetaMessage>) => anthropicModel({ model: 'm', apiKey: 'k', label: 'Claude', client: fake(r, r, r, r).client });
    await expect(model({ stop_reason: 'refusal', content: [] }).chat(request())).rejects.toThrow('Claude declined');
    await expect(model({ stop_reason: 'max_tokens', content: [] }).chat(request())).rejects.toThrow('cut off');
    const looping = { stop_reason: 'tool_use' as const, content: [{ type: 'tool_use', id: 't', name: 'add_notes', input: {} } as Anthropic.Beta.BetaToolUseBlock] };
    await expect(model(looping).chat(request())).rejects.toBeInstanceOf(ModelError);
  });
});

describe('OpenAI-compatible adapter', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('runs function calls until the model answers', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        ok({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_notes', arguments: '{"notes":[]}' } }] } }] }),
      )
      .mockResolvedValueOnce(ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: ' Done. ' } }] }));
    const req = request();
    const result = await openAICompatibleModel({ model: 'llama3.3', baseUrl: 'http://localhost:11434/v1/', apiKey: null, label: 'Llama', fetch }).chat(req);

    expect(result).toEqual({ text: 'Done.', toolCalls: 1 });
    expect(req.execute).toHaveBeenCalledWith('add_notes', { notes: [] });
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined();
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.tool_choice).toBe('auto');
    expect(body.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'Added 1 note' });
  });

  it('sends pictures as data URLs after the prompt', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'A cat.' } }] }));
    await openAICompatibleModel({ model: 'm', baseUrl: 'https://x.test/v1', apiKey: 'k', label: 'GPT', fetch }).chat({ ...request(), images: [{ mediaType: 'image/jpeg', data: '/9j/' }] });
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Add a note' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } },
      ],
    });
  });

  it('says plainly what went wrong', async () => {
    const model = (res: Response | Error) =>
      openAICompatibleModel({ model: 'm', baseUrl: 'https://x.test/v1', apiKey: 'k', label: 'GPT', fetch: jest.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res))) });
    await expect(model(new Response('', { status: 401 })).chat(request())).rejects.toThrow('refused the API key');
    await expect(model(new Response('', { status: 429 })).chat(request())).rejects.toThrow('rate-limiting');
    await expect(model(new Error('ECONNREFUSED')).chat(request())).rejects.toThrow("Couldn't reach GPT");
    await expect(model(ok({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'x' } }] })).chat(request())).rejects.toThrow('cut off');
  });
});

describe('allowedBaseUrl', () => {
  it('allows ordinary and local servers, not cloud metadata', () => {
    expect(allowedBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(allowedBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(allowedBaseUrl('http://169.254.169.254/latest')).toBe(false);
    expect(allowedBaseUrl('http://metadata.google.internal/')).toBe(false);
    expect(allowedBaseUrl('file:///etc/passwd')).toBe(false);
  });
});
