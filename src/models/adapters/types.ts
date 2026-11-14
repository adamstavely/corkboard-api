/** A tool the model may call, described once for every API: a name, what it does, and a JSON Schema for its input. */
export interface ToolDef {
  name: string;
  description: string;
  /** A strict object schema: every property required, no others allowed. */
  parameters: Record<string, unknown>;
}

/** Runs one tool call and says what happened, as text the model reads next. */
export type ToolExecutor = (name: string, input: unknown) => Promise<string>;

export interface ChatRequest {
  system: string;
  prompt: string;
  tools: ToolDef[];
  execute: ToolExecutor;
  /** Most model turns before giving up, so a model that keeps calling tools can't run forever. */
  maxSteps: number;
  /** Pictures to show the model with the prompt (it must be able to see them). */
  images?: { mediaType: ImageType; data: string }[];
  /** Told the tokens each API call used, as it happens, so a run that fails partway still counts. */
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  /** Stops the request: each call in flight is cancelled, and no further step starts. */
  signal?: AbortSignal;
}

/** How long one call to a model's API may take. */
export const STEP_MS = 120_000;
/** Most tool calls one model answer may ask for; more is treated as a runaway answer. */
export const MAX_TOOL_CALLS_PER_ANSWER = 25;

/** A call's signal: the request's, and STEP_MS for this call alone. */
export function stepSignal(signal: AbortSignal | undefined, ms = STEP_MS): AbortSignal {
  const step = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, step]) : step;
}

/** Why a call was stopped, in words: the request's own reason (deadline, shutdown), or this call's time running out. */
export function stoppedError(signal: AbortSignal | undefined, label: string): ModelError {
  const reason: unknown = signal?.aborted ? signal.reason : undefined;
  if (reason instanceof ModelError) return reason;
  if (signal?.aborted) return new ModelError(`The request to ${label} was stopped.`);
  return new ModelError(`${label} took too long to answer. Try again, or a narrower request.`, 'unreachable');
}

/** The picture formats both APIs take. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ChatResult {
  /** What the model said at the end, for the person who asked. */
  text: string;
  toolCalls: number;
}

/** A model, whichever API it speaks: it answers a prompt, calling the tools it's given along the way. */
export interface ChatModel {
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** What kind of failure it was, so a connection test can say whether the key, the model or the address is at fault. */
export type ModelFailure = 'auth' | 'model' | 'unreachable' | 'other';

/** Something went wrong in a way the person who asked can act on; the message says what, plainly. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly failure: ModelFailure = 'other',
  ) {
    super(message);
  }
}
