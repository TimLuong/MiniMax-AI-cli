import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { speechEndpoint, openaiSpeechEndpoint, azureSpeechEndpoint } from '../../client/endpoints';
import { detectProvider } from '../../client/providers';
import { parseSSE } from '../../client/stream';
import { detectOutputFormat, formatOutput } from '../../output/formatter';
import { saveAudioOutput } from '../../output/audio';
import { readTextFromPathOrStdin } from '../../utils/fs';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { SpeechRequest, SpeechResponse } from '../../types/api';
import type { OpenAISpeechRequest } from '../../types/openai';
import { writeFileSync } from 'fs';

export default defineCommand({
  name: 'speech synthesize',
  description: 'Synchronous TTS, up to 10k chars (speech-2.8-hd / 2.6 / 02)',
  apiDocs: '/docs/api-reference/speech-t2a-http',
  usage: 'mmx speech synthesize --text <text> [--out <path>] [flags]',
  options: [
    { flag: '--model <model>',           description: 'Model ID (MiniMax: speech-2.8-hd | OpenAI: tts-1, tts-1-hd)' },
    { flag: '--text <text>',             description: 'Text to synthesize' },
    { flag: '--text-file <path>',        description: 'Read text from file (use - for stdin)' },
    { flag: '--voice <id>',              description: 'Voice ID (MiniMax: English_expressive_narrator | OpenAI: alloy, echo, fable, nova, onyx, shimmer)' },
    { flag: '--speed <n>',               description: 'Speech speed multiplier', type: 'number' },
    { flag: '--volume <n>',              description: 'Volume level', type: 'number' },
    { flag: '--pitch <n>',               description: 'Pitch adjustment', type: 'number' },
    { flag: '--format <fmt>',            description: 'Audio format (default: mp3)' },
    { flag: '--sample-rate <hz>',        description: 'Sample rate (default: 32000)', type: 'number' },
    { flag: '--bitrate <bps>',           description: 'Bitrate (default: 128000)', type: 'number' },
    { flag: '--channels <n>',            description: 'Audio channels (default: 1)', type: 'number' },
    { flag: '--language <code>',         description: 'Language boost' },
    { flag: '--subtitles',               description: 'Include subtitle timing data' },
    { flag: '--pronunciation <from/to>', description: 'Custom pronunciation (repeatable)', type: 'array' },
    { flag: '--out <path>',              description: 'Save audio to file (uses hex decoding)' },
    { flag: '--stream',                  description: 'Stream raw audio to stdout' },
  ],
  examples: [
    'mmx speech synthesize --text "Hello, world!"',
    'mmx speech synthesize --text "Hello, world!" --out hello.mp3',
    'echo "Breaking news." | mmx speech synthesize --text-file - --out news.mp3',
    'mmx speech synthesize --text "Stream" --stream | mpv --no-terminal -',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let text = (flags.text ?? (flags._positional as string[]|undefined)?.[0]) as string | undefined;

    if (flags.textFile) {
      text = readTextFromPathOrStdin(flags.textFile as string);
    }

    if (!text) {
      throw new CLIError(
        '--text or --text-file is required.',
        ExitCode.USAGE,
        'mmx speech synthesize --text "Hello" --out hello.mp3',
      );
    }

    const model = (flags.model as string)
      || config.defaultSpeechModel
      || 'speech-2.8-hd';
    const voice = (flags.voice as string) || 'English_expressive_narrator';
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const ext = (flags.format as string) || 'mp3';
    const outPath = (flags.out as string | undefined) ?? `speech_${ts}.${ext}`;
    const outFormat = 'hex';
    const format = detectOutputFormat(config.output);

    const body: SpeechRequest = {
      model,
      text,
      voice_setting: {
        voice_id: voice,
        speed: (flags.speed as number) ?? undefined,
        vol: (flags.volume as number) ?? undefined,
        pitch: (flags.pitch as number) ?? undefined,
      },
      audio_setting: {
        format: (flags.format as string) || 'mp3',
        sample_rate: (flags.sampleRate as number) ?? 32000,
        bitrate: (flags.bitrate as number) ?? 128000,
        channel: (flags.channels as number) ?? 1,
      },
      output_format: outFormat,
      stream: flags.stream === true,
    };

    if (flags.language) body.language_boost = flags.language as string;
    if (flags.subtitles) body.subtitle = true;

    if (flags.pronunciation) {
      body.pronunciation_dict = (flags.pronunciation as string[]).map(p => {
        const [from, to] = p.split('/');
        return { tone: to || from!, text: from! };
      });
    }

    const provider = config.provider ?? detectProvider(config.baseUrl);

    if (config.dryRun) {
      if (provider !== 'minimax') {
        const openAIBody: OpenAISpeechRequest = {
          model,
          input: text,
          voice: (voice as OpenAISpeechRequest['voice']) || 'alloy',
          response_format: ((flags.format as string) || 'mp3') as OpenAISpeechRequest['response_format'],
          speed: flags.speed as number | undefined,
        };
        console.log(formatOutput({ request: openAIBody }, format));
      } else {
        console.log(formatOutput({ request: body }, format));
      }
      return;
    }

    if (provider !== 'minimax') {
      // ---- OpenAI / Azure TTS path ----
      const openAIBody: OpenAISpeechRequest = {
        model: model === 'speech-2.8-hd' ? 'tts-1-hd' : model,
        input: text,
        voice: (voice as OpenAISpeechRequest['voice']) || 'alloy',
        response_format: ((flags.format as string) || 'mp3') as OpenAISpeechRequest['response_format'],
        speed: flags.speed as number | undefined,
      };

      let url: string;
      if (provider === 'azure') {
        const apiVersion = config.azureApiVersion ?? '2024-08-01-preview';
        url = azureSpeechEndpoint(config.baseUrl, openAIBody.model, apiVersion);
      } else {
        url = openaiSpeechEndpoint(config.baseUrl);
      }

      // OpenAI TTS returns raw binary audio, not JSON
      const res = await request(config, { url, method: 'POST', body: openAIBody, authStyle: 'x-api-key' });
      const audioBuffer = Buffer.from(await res.arrayBuffer());

      if (flags.stream) {
        process.stdout.write(audioBuffer);
        return;
      }

      const savedPath = outPath;
      writeFileSync(savedPath, audioBuffer);
      if (!config.quiet) process.stderr.write(`[Model: ${openAIBody.model}]\n`);

      if (config.quiet) {
        console.log(savedPath);
      } else {
        console.log(formatOutput({ saved: savedPath, size_bytes: audioBuffer.length }, format));
      }
      return;
    }

    // ---- MiniMax TTS path ----
    const url = speechEndpoint(config.baseUrl);

    if (flags.stream) {
      const res = await request(config, { url, method: 'POST', body, stream: true });
      for await (const event of parseSSE(res)) {
        if (!event.data || event.data === '[DONE]') break;
        const parsed = JSON.parse(event.data);
        const audioHex = parsed?.data?.audio;
        if (audioHex) {
          process.stdout.write(Buffer.from(audioHex, 'hex'));
        }
      }
      return;
    }

    const response = await requestJson<SpeechResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);
    saveAudioOutput(response, outPath, format, config.quiet);
  },
});
