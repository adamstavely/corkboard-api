import Anthropic from '@anthropic-ai/sdk';
import type { ChatModel, ChatRequest, ChatResult } from './types';
import { ModelError, type ModelFailure } from './types';

/**
 * Models that take server-side refusal fallbacks on the Claude API: a declined request is retried on a model chosen by
 * the decline's category, inside the same call. Other models (and other endpoints) run without them.
 */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export interface AnthropicOptions {
  model: string;
  apiKey: string;
  /** Unset for the Claude API itself. */
  baseUrl?: string | null;
  label: string;
  /** For tests. */
  client?: Pick<Anthropic, 'beta'>;
}

/**
 * Claude through the Messages API. Tool calls aren't forced (current models reject a forced tool_choice): the tools are
 * strict, so their inputs always fit the schema, and the system prompt says when to use them.
 */
export function anthropicModel({ model, apiKey, baseUrl, label, client }: AnthropicOptions): ChatModel {
  const api = client ?? new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  const fallbacks = !baseUrl && FALLBACK_MODELS.has(model);

  return {
    async chat({ system, prompt, tools, execute, maxSteps, images = [] }: ChatRequest): Promise<ChatResult> {
      const content: Anthropic.Beta.BetaMessageParam['content'] = images.length
        ? [
            ...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } })),
            { type: 'text' as const, text: prompt },
          ]
        : prompt;
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
      const toolParams: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
        strict: true,
      }));
      let toolCalls = 0;

      for (let step = 0; step < maxSteps; step++) {
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await api.beta.messages.create({
            model,
            max_tokens: 16000,
            system,
            messages: [...messages],
            ...(toolParams.length ? { tools: toolParams } : {}),
            ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          });
        } catch (err) {
          throw new ModelError(...failure(err, label));
        }

        if (response.stop_reason === 'refusal') {
          throw new ModelError(`${label} declined this request. Try putting it another way.`);
        }
        if (response.stop_reason === 'max_tokens') {
          throw new ModelError(`${label}'s answer was cut off before it finished. Try a narrower request.`);
        }
        // Thinking and any fallback blocks go back unchanged, so the next turn continues where this one left off.
        messages.push({ role: 'assistant', content: response.content });

        const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (response.stop_reason === 'pause_turn') continue;
        if (calls.length === 0) return { text: textOf(response), toolCalls };

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          toolCalls++;
          try {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: await execute(call.name, call.input) });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: String((err as Error).message ?? err), is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      throw new ModelError(`${label} kept working without finishing. Try a narrower request.`);
    },
  };
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** What went wrong calling the API, in words an admin can act on, and what kind of failure it was. */
function failure(err: unknown, label: string): [string, ModelFailure] {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return [`${label} refused the API key. An admin can update it under AI models.`, 'auth'];
  }
  if (err instanceof Anthropic.NotFoundError) return [`${label}'s model wasn't found. Check the model id under AI models.`, 'model'];
  if (err instanceof Anthropic.RateLimitError) return [`${label} is rate-limiting requests. Try again in a minute.`, 'other'];
  if (err instanceof Anthropic.BadRequestError) return [`${label} rejected the request: ${err.message}`, 'other'];
  if (err instanceof Anthropic.APIConnectionError) return [`Couldn't reach ${label}. Check its address and that it's running.`, 'unreachable'];
  if (err instanceof Anthropic.APIError) return [`${label} returned an error (${err.status ?? 'unknown'}). Try again.`, 'other'];
  return [`Something went wrong calling ${label}.`, 'other'];
}
