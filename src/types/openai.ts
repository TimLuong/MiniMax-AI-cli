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

// ---- OpenAI Speech / TTS ----

export interface OpenAISpeechRequest {
  /** Model ID: "tts-1" or "tts-1-hd" */
  model: string;
  /** Text to convert to speech */
  input: string;
  /** Voice to use */
  voice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer';
  /** Audio format (default: mp3) */
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  /** Speed multiplier 0.25–4.0 (default: 1.0) */
  speed?: number;
}

// ---- OpenAI Images (DALL-E 3 / gpt-image-1) ----

export interface OpenAIImageRequest {
  model: string;
  prompt: string;
  /** Number of images (dall-e-3: max 1) */
  n?: number;
  /** Image size */
  size?: string;
  /** Quality: standard | hd (dall-e-3) */
  quality?: string;
  /** Style: vivid | natural (dall-e-3) */
  style?: string;
  /** Response format (dall-e-3): url | b64_json */
  response_format?: 'url' | 'b64_json';
}

export interface OpenAIImageData {
  url?: string;
  b64_json?: string;
  /** Revised prompt used for the image (dall-e-3 only) */
  revised_prompt?: string;
}

export interface OpenAIImageResponse {
  created: number;
  data: OpenAIImageData[];
}

// ---- OpenAI Video (Sora) ----

export interface OpenAISoraRequest {
  model: string;
  prompt: string;
  /** Resolution e.g. "1280x720" */
  resolution?: string;
  /** Duration in seconds (1–20) */
  n_seconds?: number;
  /** Number of variants (default: 1) */
  n_variants?: number;
}

export interface OpenAISoraGeneration {
  id: string;
  video: {
    url: string;
    expires_at: string;
  };
}

export type OpenAISoraStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface OpenAISoraResponse {
  id: string;
  status: OpenAISoraStatus;
  generations?: OpenAISoraGeneration[];
  error?: { message: string };
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
