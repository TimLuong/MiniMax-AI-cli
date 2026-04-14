import type { ChatRequest, ChatResponse, ContentBlock } from '../types/api';
import type {
  OpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIChatResponse,
  OpenAIStreamChunk,
} from '../types/openai';

/**
 * Supported AI provider backends.
 *
 * - minimax  : MiniMax platform (Anthropic Messages API format)
 * - openai   : OpenAI (Chat Completions API) or any OpenAI-compatible proxy
 * - azure    : Azure OpenAI Service (Chat Completions API with deployment URLs)
 */
export type Provider = 'minimax' | 'openai' | 'azure';

/**
 * Infer the provider from the base URL when not explicitly configured.
 * Explicit config always wins; this is only the fallback auto-detection.
 */
export function detectProvider(baseUrl: string): Provider {
  if (baseUrl.includes('.openai.azure.com')) return 'azure';
  if (baseUrl.includes('openai.com')) return 'openai';
  return 'minimax';
}

// ---- Request / response adapters ----

/**
 * Convert a MiniMax/Anthropic Messages API request into an OpenAI
 * Chat Completions request.  Works for both openai and azure providers.
 */
export function toOpenAIRequest(req: ChatRequest): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = [];

  // The Anthropic format carries `system` as a top-level field; OpenAI
  // represents it as a system message at the beginning of the array.
  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  for (const m of req.messages) {
    const content =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
            .map(b => b.text)
            .join('');
    messages.push({ role: m.role, content });
  }

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    stream: req.stream,
  };

  if (req.max_tokens !== undefined) out.max_tokens = req.max_tokens;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;

  // Map Anthropic tool format to OpenAI function-calling format
  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  return out;
}

/**
 * Convert an OpenAI Chat Completions response into the Anthropic Messages
 * response shape used by the rest of this CLI.
 */
export function fromOpenAIResponse(res: OpenAIChatResponse): ChatResponse {
  const choice = res.choices[0];
  return {
    id: res.id,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: choice?.message.content ?? '' }],
    model: res.model,
    stop_reason: choice?.finish_reason ?? 'stop',
    usage: {
      input_tokens: res.usage.prompt_tokens,
      output_tokens: res.usage.completion_tokens,
    },
  };
}

/**
 * Extract the text delta from an OpenAI streaming chunk.
 * Returns null when the chunk carries no new text (e.g. role-only first chunk
 * or the finish chunk).
 */
export function extractOpenAIStreamDelta(chunk: OpenAIStreamChunk): string | null {
  const content = chunk.choices[0]?.delta?.content;
  return content != null ? content : null;
}
