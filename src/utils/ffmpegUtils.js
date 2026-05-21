// src/utils/ffmpegUtils.js
// Low-level FFmpeg helper functions using fluent-ffmpeg.
// Every function returns a Promise that resolves with the output path.

import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

// Honour the configured FFmpeg binary path
if (config.ffmpeg.path) {
  ffmpeg.setFfmpegPath(config.ffmpeg.path);
}

/**
 * Wrap fluent-ffmpeg's event-based API into a Promise.
 *
 * @param {FfmpegCommand} cmd
 * @returns {Promise<void>}
 */
function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    cmd
      .on('start', (cmdLine) => logger.debug({ cmdLine }, 'FFmpeg start'))
      .on('progress', ({ percent, timemark }) =>
        logger.debug({ percent: percent?.toFixed(1), timemark }, 'FFmpeg progress'),
      )
      .on('end', () => resolve())
      .on('error', (err, stdout, stderr) => {
        logger.error({ err: err.message, stderr }, 'FFmpeg error');
        reject(new Error(`FFmpeg failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Probe a video file and return its metadata.
 *
 * @param {string} inputPath - Absolute path to the video file.
 * @returns {Promise<ffmpeg.FfprobeData>}
 */
export function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      resolve(metadata);
    });
  });
}

/**
 * Extract audio from a video file as a lightweight .mp3.
 * This reduces the file size dramatically before sending to Gemini.
 *
 * @param {string} inputPath  - Absolute path to the source video.
 * @param {string} outputPath - Absolute path for the .mp3 output.
 * @returns {Promise<string>} Resolves with outputPath.
 */
export async function extractAudioAsMp3(inputPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const cmd = ffmpeg(inputPath)
    .noVideo()
    .audioCodec('libmp3lame')
    .audioBitrate('128k')
    .audioChannels(1)         // Mono — sufficient for speech transcription
    .audioFrequency(16000)    // 16 kHz — Whisper/Gemini optimum
    .output(outputPath);

  await runFfmpeg(cmd);
  return outputPath;
}

/**
 * Cut a segment from a source video and re-encode it as a vertical (9:16)
 * crop suitable for TikTok / Reels.
 *
 * Crop filter explanation:
 *   crop=ih*9/16:ih   →  width = height × (9/16), height = full height
 *   (centred horizontally by default)
 *
 * Uses libx264 + aac for broad compatibility.
 *
 * @param {string} inputPath    - Absolute path to the source video.
 * @param {number} startTime    - Clip start in seconds.
 * @param {number} endTime      - Clip end in seconds.
 * @param {string} outputPath   - Absolute path for the output clip.
 * @returns {Promise<string>} Resolves with outputPath.
 */
export async function cutAndCropVertical(inputPath, startTime, endTime, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const duration = endTime - startTime;
  if (duration <= 0) throw new Error('endTime must be greater than startTime');

  const cmd = ffmpeg(inputPath)
    .seekInput(startTime)          // -ss before -i for fast seek
    .duration(duration)
    .videoFilter('crop=ih*9/16:ih') // Centre-crop to 9:16
    .videoCodec('libx264')
    .videoBitrate('4000k')
    .audioCodec('aac')
    .audioBitrate('192k')
    .outputOptions([
      '-preset fast',
      '-crf 22',
      '-pix_fmt yuv420p',
      '-movflags +faststart',       // Web-optimised MP4 atom placement
    ])
    .output(outputPath);

  await runFfmpeg(cmd);
  return outputPath;
}

/**
 * Burn an ASS subtitle file into a video using the libass filter.
 *
 * The input video is re-encoded so the subtitles are permanently embedded.
 *
 * @param {string} inputPath    - Absolute path to the source clip (no captions).
 * @param {string} assPath      - Absolute path to the .ass subtitle file.
 * @param {string} outputPath   - Absolute path for the output clip with captions.
 * @returns {Promise<string>} Resolves with outputPath.
 */
export async function burnAssSubtitles(inputPath, assPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // On Windows, backslashes in the filter string must be escaped.
  // Using forward slashes is safest cross-platform.
  const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const cmd = ffmpeg(inputPath)
    .videoFilter(`ass='${escapedAssPath}'`)
    .videoCodec('libx264')
    .videoBitrate('4000k')
    .audioCodec('copy')           // Audio is already encoded — just stream-copy
    .outputOptions([
      '-preset fast',
      '-crf 22',
      '-pix_fmt yuv420p',
      '-movflags +faststart',
    ])
    .output(outputPath);

  await runFfmpeg(cmd);
  return outputPath;
}

/**
 * Get the duration of a video in seconds via ffprobe.
 *
 * @param {string} inputPath
 * @returns {Promise<number>}
 */
export async function getVideoDuration(inputPath) {
  const metadata = await probeVideo(inputPath);
  const duration = metadata.format?.duration;
  if (typeof duration !== 'number') {
    throw new Error('Could not determine video duration from ffprobe');
  }
  return duration;
}
