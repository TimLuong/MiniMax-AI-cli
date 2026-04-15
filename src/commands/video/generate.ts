import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import {
  videoGenerateEndpoint, videoTaskEndpoint, fileRetrieveEndpoint,
  openaiSoraGenerateEndpoint, openaiSoraTaskEndpoint,
  azureSoraGenerateEndpoint, azureSoraTaskEndpoint,
} from '../../client/endpoints';
import { detectProvider } from '../../client/providers';
import { poll } from '../../polling/poll';
import { downloadFile, formatBytes } from '../../files/download';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { VideoRequest, VideoResponse, VideoTaskResponse, FileRetrieveResponse } from '../../types/api';
import type { OpenAISoraRequest, OpenAISoraResponse } from '../../types/openai';
import { readFileSync } from 'fs';
import { extname } from 'path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
};
import { isInteractive } from '../../utils/env';
import { promptText, failIfMissing } from '../../utils/prompt';

export default defineCommand({
  name: 'video generate',
  description: 'Generate a video (MiniMax: Hailuo-2.3 / I2V-01 / S2V-01 | OpenAI/Azure: Sora)',
  apiDocs: '/docs/api-reference/video-generation',
  usage: 'mmx video generate --prompt <text> [flags]',
  options: [
    { flag: '--model <model>', description: 'Model ID (MiniMax: MiniMax-Hailuo-2.3 | OpenAI/Azure: sora)' },
    { flag: '--prompt <text>', description: 'Video description', required: true },
    { flag: '--resolution <WxH>', description: 'Video resolution for Sora (e.g. 1280x720, 1920x1080, 720x1280)' },
    { flag: '--duration <seconds>', description: 'Duration in seconds for Sora (1–20, default: 5)', type: 'number' },
    { flag: '--first-frame <path-or-url>', description: 'First frame image. MiniMax only.' },
    { flag: '--last-frame <path-or-url>', description: 'Last frame image (SEF mode). MiniMax only.' },
    { flag: '--subject-image <path-or-url>', description: 'Subject reference image. MiniMax only.' },
    { flag: '--callback-url <url>', description: 'Webhook URL for completion notification. MiniMax only.' },
    { flag: '--download <path>', description: 'Save video to file on completion' },
    { flag: '--no-wait', description: 'Return task ID immediately without waiting' },
    { flag: '--async', description: 'Return task ID immediately (agent/CI mode, same as --no-wait but explicit)' },
    { flag: '--poll-interval <seconds>', description: 'Polling interval when waiting (default: 5)', type: 'number' },
  ],
  examples: [
    'mmx video generate --prompt "A man reads a book. Static shot."',
    'mmx video generate --prompt "Ocean waves at sunset." --download sunset.mp4',
    '# OpenAI Sora',
    'mmx video generate --model sora --prompt "A cat playing piano" --resolution 1280x720 --duration 5',
    '# Azure Sora',
    'mmx video generate --model sora --prompt "City timelapse" --resolution 1920x1080 --download city.mp4',
    '# MiniMax: SEF interpolation',
    'mmx video generate --prompt "Walk forward" --first-frame start.jpg --last-frame end.jpg',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = flags.prompt as string | undefined;

    if (!prompt) {
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const hint = await promptText({ message: 'Enter your video prompt:' });
        if (!hint) {
          process.stderr.write('Video generation cancelled.\n');
          process.exit(1);
        }
        prompt = hint;
      } else {
        failIfMissing('prompt', 'mmx video generate --prompt <text>');
      }
    }

    const format = detectOutputFormat(config.output);
    const provider = config.provider ?? detectProvider(config.baseUrl);
    const explicitModel = flags.model as string | undefined;

    if (provider !== 'minimax') {
      // ---- OpenAI / Azure Sora path ----
      const model = explicitModel || 'sora';
      const soraBody: OpenAISoraRequest = {
        model,
        prompt,
        resolution: (flags.resolution as string) || '1280x720',
        n_seconds: (flags.duration as number) || 5,
        n_variants: 1,
      };

      if (config.dryRun) {
        console.log(formatOutput({ request: soraBody }, format));
        return;
      }

      let generateUrl: string;
      const apiVersion = config.azureApiVersion ?? '2025-02-15-preview';
      if (provider === 'azure') {
        generateUrl = azureSoraGenerateEndpoint(config.baseUrl, model, apiVersion);
      } else {
        generateUrl = openaiSoraGenerateEndpoint(config.baseUrl);
      }

      const initial = await requestJson<OpenAISoraResponse>(config, {
        url: generateUrl,
        method: 'POST',
        body: soraBody,
        authStyle: 'x-api-key',
      });

      const taskId = initial.id;
      if (!config.quiet) process.stderr.write(`[Model: ${model}] Task: ${taskId}\n`);

      if (flags.noWait || config.async) {
        process.stdout.write(JSON.stringify({ taskId }));
        process.stdout.write('\n');
        return;
      }

      const pollInterval = (flags.pollInterval as number) ?? 5;
      const getTaskUrl = (id: string) =>
        provider === 'azure'
          ? azureSoraTaskEndpoint(config.baseUrl, model, id, apiVersion)
          : openaiSoraTaskEndpoint(config.baseUrl, id);

      const result = await poll<OpenAISoraResponse>(config, {
        url: getTaskUrl(taskId),
        intervalSec: pollInterval,
        timeoutSec: config.timeout,
        isComplete: (d) => (d as OpenAISoraResponse).status === 'completed',
        isFailed: (d) => (d as OpenAISoraResponse).status === 'failed',
        getStatus: (d) => (d as OpenAISoraResponse).status,
      });

      const videoUrl = result.generations?.[0]?.video?.url;
      if (!videoUrl) {
        throw new CLIError('Sora task completed but no video URL returned.', ExitCode.GENERAL);
      }

      if (flags.download) {
        const destPath = flags.download as string;
        const { size } = await downloadFile(videoUrl, destPath, { quiet: config.quiet });
        if (config.quiet) {
          console.log(destPath);
        } else {
          console.log(formatOutput({ task_id: taskId, status: 'completed', saved: destPath, size: formatBytes(size) }, format));
        }
        return;
      }

      const os = await import('os');
      const { join } = await import('path');
      const destDir = join(os.tmpdir(), 'mmx-video');
      const { existsSync, mkdirSync } = await import('fs');
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      const destPath = join(destDir, `${taskId}.mp4`);
      await downloadFile(videoUrl, destPath, { quiet: config.quiet });
      process.stdout.write(destPath);
      process.stdout.write('\n');
      return;
    }

    // ---- MiniMax video generation path ----
    // Validate mutually exclusive mode flags
    if (flags.lastFrame && flags.subjectImage) {
      throw new CLIError(
        '--last-frame and --subject-image cannot be used together (SEF and S2V are different modes).',
        ExitCode.USAGE,
        'mmx video generate --prompt <text> --first-frame <path> --last-frame <path>',
      );
    }

    // Determine model: explicit --model > auto-switch > config default > hardcoded
    let model: string;
    if (explicitModel) {
      model = explicitModel;
    } else if (flags.lastFrame) {
      model = 'MiniMax-Hailuo-02';
    } else if (flags.subjectImage) {
      model = 'S2V-01';
    } else {
      model = config.defaultVideoModel || 'MiniMax-Hailuo-2.3';
    }

    const body: VideoRequest = {
      model,
      prompt,
    };

    // First frame (I2V)
    if (flags.firstFrame) {
      const framePath = flags.firstFrame as string;
      if (framePath.startsWith('http')) {
        body.first_frame_image = framePath;
      } else {
        const imgData = readFileSync(framePath);
        const ext = extname(framePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'image/jpeg';
        body.first_frame_image = `data:${mime};base64,${imgData.toString('base64')}`;
      }
    }

    // Last frame (SEF mode)
    if (flags.lastFrame) {
      if (!flags.firstFrame) {
        throw new CLIError(
          '--last-frame requires --first-frame (SEF mode).',
          ExitCode.USAGE,
          'mmx video generate --prompt <text> --first-frame <path> --last-frame <path>',
        );
      }
      const framePath = flags.lastFrame as string;
      if (framePath.startsWith('http')) {
        body.last_frame_image = framePath;
      } else {
        const imgData = readFileSync(framePath);
        const ext = extname(framePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'image/jpeg';
        body.last_frame_image = `data:${mime};base64,${imgData.toString('base64')}`;
      }
    }

    // Subject reference (S2V mode)
    if (flags.subjectImage) {
      const imgPath = flags.subjectImage as string;
      let imageData: string;
      if (imgPath.startsWith('http')) {
        imageData = imgPath;
      } else {
        const imgData = readFileSync(imgPath);
        const ext = extname(imgPath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'image/jpeg';
        imageData = `data:${mime};base64,${imgData.toString('base64')}`;
      }
      body.subject_reference = [{ type: 'character', image: [imageData] }];
    }

    if (flags.callbackUrl) {
      body.callback_url = flags.callbackUrl as string;
    }

    if (config.dryRun) {
      console.log(formatOutput({ request: body }, format));
      return;
    }

    const url = videoGenerateEndpoint(config.baseUrl);
    const response = await requestJson<VideoResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    const taskId = response.task_id;

    if (!config.quiet) {
      process.stderr.write(`[Model: ${model}]\n`);
    }

    // --no-wait or --async: return task ID immediately
    if (flags.noWait || config.async) {
      process.stdout.write(JSON.stringify({ taskId }));
      process.stdout.write('\n');
      return;
    }

    // Default: poll until completion
    const pollInterval = (flags.pollInterval as number) ?? 5;
    const taskUrl = videoTaskEndpoint(config.baseUrl, taskId);

    const result = await poll<VideoTaskResponse>(config, {
      url: taskUrl,
      intervalSec: pollInterval,
      timeoutSec: config.timeout,
      isComplete: (d) => (d as VideoTaskResponse).status === 'Success',
      isFailed: (d) => (d as VideoTaskResponse).status === 'Failed',
      getStatus: (d) => (d as VideoTaskResponse).status,
    });

    if (!result.file_id) {
      throw new CLIError(
        'Task completed but no file_id returned.',
        ExitCode.GENERAL,
      );
    }

    // Resolve file_id to download URL
    const fileInfo = await requestJson<FileRetrieveResponse>(config, {
      url: fileRetrieveEndpoint(config.baseUrl, result.file_id),
    });
    const downloadUrl = fileInfo.file?.download_url;

    if (!downloadUrl) {
      throw new CLIError(
        'No download URL available for this file.',
        ExitCode.GENERAL,
      );
    }

    // --download: save to file
    if (flags.download) {
      const destPath = flags.download as string;
      const { size } = await downloadFile(downloadUrl, destPath, { quiet: config.quiet });

      if (config.quiet) {
        console.log(destPath);
      } else {
        console.log(formatOutput({
          task_id: taskId,
          status: 'Success',
          file_id: result.file_id,
          saved: destPath,
          size: formatBytes(size),
        }, format));
      }
      return;
    }

    // Default: auto-download to temp location and output local file path
    const os = await import('os');
    const { join } = await import('path');
    const destDir = join(os.tmpdir(), 'mmx-video');
    const { existsSync, mkdirSync } = await import('fs');
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, `${taskId}.mp4`);

    await downloadFile(downloadUrl, destPath, { quiet: config.quiet });

    process.stdout.write(destPath);
    process.stdout.write('\n');
  },
});
