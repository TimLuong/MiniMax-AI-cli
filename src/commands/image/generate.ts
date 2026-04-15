import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import { imageEndpoint, openaiImageEndpoint, azureImageEndpoint } from '../../client/endpoints';
import { detectProvider } from '../../client/providers';
import { downloadFile } from '../../files/download';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { ImageRequest, ImageResponse } from '../../types/api';
import type { OpenAIImageRequest, OpenAIImageResponse } from '../../types/openai';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, extname } from 'path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
};
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';

export default defineCommand({
  name: 'image generate',
  description: 'Generate images (image-01 / image-01-live)',
  apiDocs: '/docs/api-reference/image-generation-t2i',
  usage: 'mmx image generate --prompt <text> [flags]',
  options: [
    { flag: '--prompt <text>', description: 'Image description', required: true },
    { flag: '--model <model>', description: 'Model ID (MiniMax: image-01 | OpenAI: dall-e-3, dall-e-2, gpt-image-1)' },
    { flag: '--aspect-ratio <ratio>', description: 'Aspect ratio (e.g. 16:9, 1:1). MiniMax only.' },
    { flag: '--size <size>', description: 'Image size (OpenAI: 1024x1024, 1792x1024, 1024x1792)' },
    { flag: '--quality <quality>', description: 'Image quality: standard | hd (dall-e-3 / gpt-image-1)' },
    { flag: '--style <style>', description: 'Image style: vivid | natural (dall-e-3 only)' },
    { flag: '--n <count>', description: 'Number of images to generate (default: 1; dall-e-3 max: 1)', type: 'number' },
    { flag: '--seed <n>', description: 'Random seed. MiniMax only.', type: 'number' },
    { flag: '--width <px>', description: 'Custom width in pixels. MiniMax image-01 only.', type: 'number' },
    { flag: '--height <px>', description: 'Custom height in pixels. MiniMax image-01 only.', type: 'number' },
    { flag: '--prompt-optimizer', description: 'Automatically optimize the prompt. MiniMax only.' },
    { flag: '--aigc-watermark', description: 'Embed AI-generated content watermark. MiniMax only.' },
    { flag: '--subject-ref <params>', description: 'Subject reference for character consistency. MiniMax only.' },
    { flag: '--out-dir <dir>', description: 'Download images to directory' },
    { flag: '--out-prefix <prefix>', description: 'Filename prefix (default: image)' },
  ],
  examples: [
    'mmx image generate --prompt "A cat in a spacesuit on Mars" --aspect-ratio 16:9',
    'mmx image generate --prompt "Logo design" --n 3 --out-dir ./generated/',
    '# OpenAI DALL-E 3',
    'mmx image generate --model dall-e-3 --prompt "A futuristic city" --size 1792x1024 --quality hd',
    '# Azure GPT Image',
    'mmx image generate --model gpt-image-1 --prompt "Product photo" --quality high --out-dir ./out/',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = (flags.prompt ?? (flags._positional as string[]|undefined)?.[0]) as string | undefined;

    if (!prompt) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const hint = await promptText({
          message: 'Enter your image prompt:',
        });
        if (!hint) {
          process.stderr.write('Image generation cancelled.\n');
          process.exit(1);
        }
        prompt = hint;
      } else {
        failIfMissing('prompt', 'mmx image generate --prompt <text>');
      }
    }

    // Validate width/height
    const width = flags.width as number | undefined;
    const height = flags.height as number | undefined;

    if (width !== undefined && height === undefined) {
      throw new CLIError('--width requires --height. Both must be specified together.', ExitCode.USAGE);
    }
    if (height !== undefined && width === undefined) {
      throw new CLIError('--height requires --width. Both must be specified together.', ExitCode.USAGE);
    }
    if (width !== undefined && height !== undefined) {
      const validateSize = (name: string, val: number) => {
        if (val < 512 || val > 2048) {
          throw new CLIError(`--${name} must be between 512 and 2048, got ${val}.`, ExitCode.USAGE);
        }
        if (val % 8 !== 0) {
          throw new CLIError(`--${name} must be a multiple of 8, got ${val}.`, ExitCode.USAGE);
        }
      };
      validateSize('width', width);
      validateSize('height', height);
    }

    const format = detectOutputFormat(config.output);
    const provider = config.provider ?? detectProvider(config.baseUrl);
    const explicitModel = flags.model as string | undefined;

    if (provider !== 'minimax') {
      // ---- OpenAI / Azure image generation (DALL-E 3, gpt-image-1) ----
      const model = explicitModel || 'dall-e-3';
      const openAIBody: OpenAIImageRequest = {
        model,
        prompt,
        n: (flags.n as number) ?? 1,
        size: (flags.size as string) || '1024x1024',
        response_format: 'url',
      };
      if (flags.quality) openAIBody.quality = flags.quality as string;
      if (flags.style) openAIBody.style = flags.style as string;

      if (config.dryRun) {
        console.log(formatOutput({ request: openAIBody }, format));
        return;
      }

      let url: string;
      if (provider === 'azure') {
        const apiVersion = config.azureApiVersion ?? '2024-02-01';
        url = azureImageEndpoint(config.baseUrl, model, apiVersion);
      } else {
        url = openaiImageEndpoint(config.baseUrl);
      }

      const response = await requestJson<OpenAIImageResponse>(config, {
        url,
        method: 'POST',
        body: openAIBody,
        authStyle: 'x-api-key',
      });

      if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);

      const outDir = (flags.outDir as string | undefined) ?? '.';
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const prefix = (flags.outPrefix as string) || 'image';
      const saved: string[] = [];

      for (let i = 0; i < response.data.length; i++) {
        const item = response.data[i]!;
        const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.png`;
        const destPath = join(outDir, filename);

        if (item.b64_json) {
          writeFileSync(destPath, Buffer.from(item.b64_json, 'base64'));
          saved.push(destPath);
        } else if (item.url) {
          await downloadFile(item.url, destPath, { quiet: config.quiet });
          saved.push(destPath);
        }
      }

      if (config.quiet) {
        console.log(saved.join('\n'));
      } else {
        console.log(formatOutput({ model, saved, count: saved.length }, format));
      }
      return;
    }

    // ---- MiniMax image generation ----
    const body: ImageRequest = {
      model: explicitModel || 'image-01',
      prompt,
      aspect_ratio: (width !== undefined && height !== undefined) ? undefined : ((flags.aspectRatio as string) || undefined),
      n: (flags.n as number) ?? 1,
      seed: flags.seed as number | undefined,
      width: width,
      height: height,
      prompt_optimizer: flags.promptOptimizer === true || undefined,
      aigc_watermark: flags.aigcWatermark === true || undefined,
    };

    if (flags.subjectRef) {
      const refStr = flags.subjectRef as string;
      const params = Object.fromEntries(
        refStr.split(',').map(p => {
        const eqIdx = p.indexOf('=');
        if (eqIdx === -1) return [p, ''];
        return [p.slice(0, eqIdx), p.slice(eqIdx + 1)];
      }),
      );

      const ref: { type: string; image_url?: string; image_file?: string } = {
        type: params.type || 'character',
      };

      if (params.image) {
        if (params.image.startsWith('http')) {
          ref.image_url = params.image;
        } else {
          const imgPath = resolve(params.image);
          const imgData = readFileSync(imgPath);
          const ext = extname(imgPath).toLowerCase();
          const mime = MIME_TYPES[ext] || 'image/jpeg';
          ref.image_file = `data:${mime};base64,${imgData.toString('base64')}`;
        }
      }

      body.subject_reference = [ref];
    }

    if (config.dryRun) {
      console.log(formatOutput({ request: body }, format));
      return;
    }

    const url = imageEndpoint(config.baseUrl);
    const response = await requestJson<ImageResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    const imageUrls = response.data.image_urls || [];

    if (!config.quiet) {
      process.stderr.write('[Model: image-01]\n');
    }

    const outDir = (flags.outDir as string | undefined) ?? '.';
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const prefix = (flags.outPrefix as string) || 'image';
    const saved: string[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const filename = `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`;
      const destPath = join(outDir, filename);
      await downloadFile(imageUrls[i]!, destPath, { quiet: config.quiet });
      saved.push(destPath);
    }

    if (config.quiet) {
      console.log(saved.join('\n'));
    } else {
      console.log(formatOutput({
        id: response.data.task_id,
        saved,
        success_count: response.data.success_count,
        failed_count: response.data.failed_count,
      }, format));
    }
  },
});
