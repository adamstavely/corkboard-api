import type { ChatModel, ChatRequest, ChatResult } from './types';
import { ModelError, type ModelFailure } from './types';

/** The parts of a Chat Completions response this reads. */
interface Completion {
  choices?: {
    finish_reason?: string;
    message?: {
      role: 'assistant';
      content?: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    };
  }[];
}

type Message =
  | { role: 'system' | 'user'; content: string }
  | NonNullable<NonNullable<Completion['choices']>[number]['message']>
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAICompatibleOptions {
  model: string;
  /** The API's base URL, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  apiKey?: string | null;
  label: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Any server that speaks OpenAI's Chat Completions API with function calling: OpenAI, Azure OpenAI, Gemini's OpenAI
 * endpoint, OpenRouter, vLLM, Ollama, LM Studio. Workspaces use it only with models that call tools.
 */
export function openAICompatibleModel({ model, baseUrl, apiKey, label, fetch = globalThis.fetch }: OpenAICompatibleOptions): ChatModel {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async chat({ system, prompt, tools, execute, maxSteps }: ChatRequest): Promise<ChatResult> {
      const messages: Message[] = [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ];
      const toolParams = tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters, strict: true },
      }));
      let toolCalls = 0;

      for (let step = 0; step < maxSteps; step++) {
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify({ model, messages, ...(toolParams.length ? { tools: toolParams, tool_choice: 'auto' } : {}) }),
          });
        } catch {
          throw new ModelError(`Couldn't reach ${label} at ${baseUrl}. Check its address and that it's running.`, 'unreachable');
        }
        if (!res.ok) throw new ModelError(...(await failure(res, label)));

        const choice = ((await res.json()) as Completion).choices?.[0];
        if (choice?.finish_reason === 'length') {
          throw new ModelError(`${label}'s answer was cut off before it finished. Try a narrower request.`);
        }
        if (choice?.finish_reason === 'content_filter') {
          throw new ModelError(`${label} declined this request. Try putting it another way.`);
        }
        const message = choice?.message;
        if (!message) throw new ModelError(`${label} sent back an empty answer. Try again.`);
        messages.push(message);

        const calls = message.tool_calls ?? [];
        if (calls.length === 0) return { text: (message.content ?? '').trim(), toolCalls };

        for (const call of calls) {
          toolCalls++;
          let content: string;
          try {
            content = await execute(call.function.name, JSON.parse(call.function.arguments || '{}'));
          } catch (err) {
            content = `Error: ${String((err as Error).message ?? err)}`;
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content });
        }
      }
      throw new ModelError(`${label} kept working without finishing. Try a narrower request.`);
    },
  };
}

async function failure(res: Response, label: string): Promise<[string, ModelFailure]> {
  if (res.status === 401 || res.status === 403) return [`${label} refused the API key. An admin can update it under AI models.`, 'auth'];
  if (res.status === 404) return [`${label}'s model or address wasn't found. Check them under AI models.`, 'model'];
  if (res.status === 429) return [`${label} is rate-limiting requests. Try again in a minute.`, 'other'];
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  return [`${label} returned an error (${res.status})${detail ? `: ${detail}` : ''}`, 'other'];
}
