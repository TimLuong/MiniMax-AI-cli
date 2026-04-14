// ---- OpenAI Chat Completions API types ----

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface OpenAIChatTool {
  type: 'function';
  function: OpenAIChatToolFunction;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: OpenAIChatTool[];
}

export interface OpenAIChatResponseMessage {
  role: 'assistant';
  content: string | null;
}

export interface OpenAIChatChoice {
  index: number;
  message: OpenAIChatResponseMessage;
  finish_reason: string;
}

export interface OpenAIChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage: OpenAIChatUsage;
}

// ---- OpenAI Streaming (SSE) types ----

export interface OpenAIStreamDelta {
  role?: string;
  content?: string;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: string | null;
}

export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}
