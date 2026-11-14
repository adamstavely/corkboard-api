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
