// src/workers/captionWorker.js
// BullMQ worker — Workflow B: ASS Subtitle Generation & Burn-in.
//
// Run as a standalone process:
//   node src/workers/captionWorker.js
//
// It:
//   1. Reads the clip record + word_level_transcript from PostgreSQL.
//   2. Generates an .ass subtitle file in a tmp directory.
//   3. Downloads the raw clip from S3.
//   4. Burns in the .ass subtitles via FFmpeg.
//   5. Uploads the final captioned clip to S3.
//   6. Updates the Clip record to READY.
//   7. Cleans up all local tmp files.

import 'dotenv/config';
import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';

import { config }                from '../config/index.js';
import { createRedisConnection } from '../lib/redis.js';
import { QUEUE_NAMES }           from '../lib/queue.js';
import { prisma }                from '../lib/prisma.js';
import { logger }                from '../lib/logger.js';
import { downloadFileFromS3, uploadFileToS3 } from '../services/s3Service.js';
import { burnAssSubtitles }      from '../utils/ffmpegUtils.js';
import { generateAssFile }       from '../utils/assGenerator.js';

const TMP_DIR = config.ffmpeg.tmpDir;

/**
 * Process a single caption burn-in job.
 *
 * @param {import('bullmq').Job} job
 *   Job data: { clipId: string }
 */
async function processCaptionJob(job) {
  const { clipId } = job.data;
  const jobTmpDir  = path.join(TMP_DIR, 'caption', clipId);

  logger.info({ clipId, bullJobId: job.id }, 'Caption job started');

  await prisma.clip.update({
    where: { id: clipId },
    data:  { status: 'CAPTIONING' },
  });

  await fs.mkdir(jobTmpDir, { recursive: true });

  const rawVideoPath   = path.join(jobTmpDir, 'raw.mp4');
  const assPath        = path.join(jobTmpDir, 'captions.ass');
  const captionedPath  = path.join(jobTmpDir, 'captioned.mp4');

  try {
    // ── 1. Fetch clip record ──────────────────────────────────────────────
    await job.updateProgress(5);
    const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });

    if (!clip.rawVideoKey) {
      throw new Error(`Clip ${clipId} has no rawVideoKey — cannot add captions`);
    }

    const transcript = clip.transcriptJson;
    if (!Array.isArray(transcript) || transcript.length === 0) {
      throw new Error(`Clip ${clipId} has empty or invalid transcriptJson`);
    }

    // ── 2. Generate ASS subtitle file ─────────────────────────────────────
    await job.updateProgress(10);
    logger.info({ clipId }, 'Generating ASS subtitle file');

    const assContent = generateAssFile(transcript, { maxWordsPerPhrase: 4 });
    await fs.writeFile(assPath, assContent, 'utf-8');

    // ── 3. Download raw clip from S3 ──────────────────────────────────────
    await job.updateProgress(20);
    await downloadFileFromS3(clip.rawVideoKey, rawVideoPath);

    // ── 4. Burn subtitles into the video ──────────────────────────────────
    await job.updateProgress(35);
    logger.info({ clipId, assPath }, 'Burning ASS subtitles via FFmpeg');
    await burnAssSubtitles(rawVideoPath, assPath, captionedPath);

    // ── 5. Upload captioned video to S3 ───────────────────────────────────
    await job.updateProgress(80);
    const finalS3Key = clip.rawVideoKey.replace('/raw.mp4', '/captioned.mp4');
    await uploadFileToS3(captionedPath, finalS3Key, 'video/mp4');

    // ── 6. Update Clip record ─────────────────────────────────────────────
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        status:       'READY',
        finalVideoKey: finalS3Key,
      },
    });

    await job.updateProgress(100);
    logger.info({ clipId, finalS3Key }, 'Caption job completed');

  } catch (err) {
    logger.error({ err, clipId }, 'Caption job failed');

    await prisma.clip.update({
      where: { id: clipId },
      data:  { status: 'RAW' },   // Roll back so user can retry
    }).catch((dbErr) => logger.error({ dbErr }, 'Failed to roll back clip status'));

    throw err;

  } finally {
    try {
      await fs.rm(jobTmpDir, { recursive: true, force: true });
      logger.debug({ jobTmpDir }, 'Tmp directory cleaned up');
    } catch (cleanupErr) {
      logger.warn({ err: cleanupErr.message }, 'Caption tmp cleanup failed');
    }
  }
}

// ── Worker instantiation ───────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAMES.CAPTION_BURN_IN,
  processCaptionJob,
  {
    connection:   createRedisConnection(),
    concurrency:  config.worker.captionConcurrency,
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 2 * 60 * 1000,
  },
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, clipId: job.data.clipId }, 'Caption BullMQ job completed');
});

worker.on('failed', (job, err) => {
  logger.error({
    jobId:   job?.id,
    clipId:  job?.data?.clipId,
    attempt: job?.attemptsMade,
    err:     err.message,
  }, 'Caption BullMQ job failed');
});

worker.on('error', (err) => logger.error({ err }, 'Caption worker error'));

process.on('SIGTERM', async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

logger.info({
  queue:       QUEUE_NAMES.CAPTION_BURN_IN,
  concurrency: config.worker.captionConcurrency,
}, 'Caption worker started');
