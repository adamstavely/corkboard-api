import type { ModelProvider } from '../db/schema';
import { anthropicModel } from './adapters/anthropic';
import { openAICompatibleModel } from './adapters/openai-compatible';
import type { ChatModel } from './adapters/types';

/** Turns a stored connection (with its key opened) into a model to call. Tests swap in their own. */
export type ChatModelFactory = (provider: ModelProvider, apiKey: string | null) => ChatModel;

export const CHAT_MODELS = Symbol('CHAT_MODELS');

export const chatModelFor: ChatModelFactory = (provider, apiKey) =>
  provider.kind === 'anthropic'
    ? anthropicModel({ model: provider.model, apiKey: apiKey ?? '', baseUrl: provider.baseUrl, label: provider.label })
    : openAICompatibleModel({ model: provider.model, baseUrl: provider.baseUrl!, apiKey, label: provider.label });

/** Hosts a connection must never point at: cloud metadata services, reachable from inside most clouds. */
const BLOCKED = /^(169\.254\.\d+\.\d+|\[?fd00:ec2::254\]?|metadata\.google\.internal|metadata)$/i;

/** Whether a base URL may be called from the API's network. */
export function allowedBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !BLOCKED.test(url.hostname);
  } catch {
    return false;
  }
}
