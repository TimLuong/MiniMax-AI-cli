export const REGIONS = {
  global: 'https://api.minimax.io',
  cn: 'https://api.minimaxi.com',
} as const;

export const DOCS_HOSTS = {
  global: 'https://platform.minimax.io',
  cn: 'https://platform.minimaxi.com',
} as const;

export type Region = keyof typeof REGIONS;

/**
 * AI provider backend.
 *
 * - minimax : MiniMax platform (default) – Anthropic Messages API format
 * - openai  : OpenAI or any OpenAI-compatible endpoint (Chat Completions format)
 * - azure   : Azure OpenAI Service (Chat Completions with deployment-scoped URLs)
 *
 * When not set explicitly, the provider is auto-detected from base_url.
 */
export type Provider = 'minimax' | 'openai' | 'azure';

export interface ConfigFile {
  api_key?: string;
  region?: Region;
  base_url?: string;
  provider?: Provider;
  azure_api_version?: string;
  output?: 'text' | 'json';
  timeout?: number;
  default_text_model?: string;
  default_speech_model?: string;
  default_video_model?: string;
  default_music_model?: string;
}

const VALID_REGIONS = new Set<string>(['global', 'cn']);
const VALID_OUTPUTS = new Set<string>(['text', 'json']);
const VALID_PROVIDERS = new Set<string>(['minimax', 'openai', 'azure']);

export function parseConfigFile(raw: unknown): ConfigFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: ConfigFile = {};

  if (typeof obj.api_key === 'string') out.api_key = obj.api_key;
  if (typeof obj.region === 'string' && VALID_REGIONS.has(obj.region)) out.region = obj.region as Region;
  if (typeof obj.base_url === 'string' && obj.base_url.startsWith('http')) out.base_url = obj.base_url;
  if (typeof obj.provider === 'string' && VALID_PROVIDERS.has(obj.provider)) out.provider = obj.provider as Provider;
  if (typeof obj.azure_api_version === 'string' && obj.azure_api_version.length > 0) out.azure_api_version = obj.azure_api_version;
  if (typeof obj.output === 'string' && VALID_OUTPUTS.has(obj.output)) out.output = obj.output as ConfigFile['output'];
  if (typeof obj.timeout === 'number' && obj.timeout > 0) out.timeout = obj.timeout;
  if (typeof obj.default_text_model === 'string' && obj.default_text_model.length > 0) out.default_text_model = obj.default_text_model;
  if (typeof obj.default_speech_model === 'string' && obj.default_speech_model.length > 0) out.default_speech_model = obj.default_speech_model;
  if (typeof obj.default_video_model === 'string' && obj.default_video_model.length > 0) out.default_video_model = obj.default_video_model;
  if (typeof obj.default_music_model === 'string' && obj.default_music_model.length > 0) out.default_music_model = obj.default_music_model;

  return out;
}

export interface Config {
  apiKey?: string;
  fileApiKey?: string;
  fileRegion?: Region;
  configPath?: string;
  region: Region;
  baseUrl: string;
  provider?: Provider;
  azureApiVersion?: string;
  output: 'text' | 'json';
  timeout: number;
  defaultTextModel?: string;
  defaultSpeechModel?: string;
  defaultVideoModel?: string;
  defaultMusicModel?: string;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
  yes: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
  async: boolean;
  needsRegionDetection?: boolean;
}
