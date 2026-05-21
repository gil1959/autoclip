// src/workers/videoWorker.js
// BullMQ worker — Workflow A: Ingestion & Gemini AI Clipping.
//
// This module is designed to run as a standalone process:
//   node src/workers/videoWorker.js
//
// It:
//   1. Downloads the source video from S3 to a local tmp directory.
//   2. Probes the video for duration.
//   3. Extracts a lightweight .mp3 audio track (faster Gemini processing).
//   4. Sends the audio to Gemini 1.5 Pro via the File API.
//   5. Parses the structured JSON response (clips with word-level transcripts).
//   6. Cuts each clip from the source video and crops it to 9:16.
//   7. Uploads each clip to S3.
//   8. Saves Clip records to PostgreSQL.
//   9. Cleans up all local tmp files.

import 'dotenv/config';
import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { config }                from '../config/index.js';
import { createRedisConnection } from '../lib/redis.js';
import { QUEUE_NAMES }           from '../lib/queue.js';
import { prisma }                from '../lib/prisma.js';
import { logger }                from '../lib/logger.js';
import { downloadFileFromS3, uploadFileToS3 } from '../services/s3Service.js';
import { analyseVideoForClips }  from '../services/geminiService.js';
import {
  extractAudioAsMp3,
  cutAndCropVertical,
  getVideoDuration,
} from '../utils/ffmpegUtils.js';

// ── Constants ──────────────────────────────────────────────────────────────

const TMP_DIR = config.ffmpeg.tmpDir;

// Files larger than this threshold will be sent to Gemini as audio-only.
// Gemini's File API accepts up to 2 GB, but audio is ~10× smaller.
const AUDIO_ONLY_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200 MB

// ── Job processor ─────────────────────────────────────────────────────────

/**
 * Process a single video-processing job.
 *
 * @param {import('bullmq').Job} job - BullMQ job with data: { videoJobId, s3Key }
 */
async function processVideoJob(job) {
  const { videoJobId, s3Key } = job.data;
  const jobTmpDir = path.join(TMP_DIR, videoJobId);

  logger.info({ videoJobId, s3Key, bullJobId: job.id }, 'Video job started');

  // ── 0. Update job status to PROCESSING ─────────────────────────────────
  await prisma.videoJob.update({
    where: { id: videoJobId },
    data:  { status: 'PROCESSING', bullJobId: String(job.id) },
  });

  await fs.mkdir(jobTmpDir, { recursive: true });

  const sourceVideoPath = path.join(jobTmpDir, 'source.mp4');
  const audioPath       = path.join(jobTmpDir, 'audio.mp3');

  try {
    // ── 1. Download source video from S3 ─────────────────────────────────
    await job.updateProgress(5);
    await downloadFileFromS3(s3Key, sourceVideoPath);

    // ── 2. Probe video for metadata ───────────────────────────────────────
    await job.updateProgress(10);
    const duration = await getVideoDuration(sourceVideoPath);
    const stat = await fs.stat(sourceVideoPath);

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data:  { durationSeconds: duration, fileSizeBytes: BigInt(stat.size) },
    });

    logger.info({ videoJobId, duration, bytes: stat.size }, 'Video probed');

    // ── 3. Decide whether to send video or audio-only to Gemini ──────────
    await job.updateProgress(15);
    let geminiFilePath = sourceVideoPath;
    let geminiMimeType = 'video/mp4';

    if (stat.size > AUDIO_ONLY_THRESHOLD_BYTES) {
      logger.info({ videoJobId }, 'File is large — extracting audio for Gemini');
      await extractAudioAsMp3(sourceVideoPath, audioPath);
      geminiFilePath = audioPath;
      geminiMimeType = 'audio/mpeg';
    }

    // ── 4. Analyse with Gemini 1.5 Pro ────────────────────────────────────
    await job.updateProgress(20);
    logger.info({ videoJobId, geminiMimeType }, 'Sending to Gemini for analysis');

    const clipSuggestions = await analyseVideoForClips(geminiFilePath, geminiMimeType);

    logger.info({ videoJobId, count: clipSuggestions.length }, 'Gemini returned clip suggestions');
    await job.updateProgress(60);

    // ── 5. Cut, crop, upload each clip ────────────────────────────────────
    const progressPerClip = 30 / clipSuggestions.length;

    for (let i = 0; i < clipSuggestions.length; i++) {
      const suggestion = clipSuggestions[i];
      const clipId     = uuidv4();
      const clipPath   = path.join(jobTmpDir, `clip_${i}.mp4`);
      const s3ClipKey  = `clips/${videoJobId}/${clipId}/raw.mp4`;

      logger.info({
        videoJobId,
        clipIndex: i,
        start: suggestion.start_time,
        end:   suggestion.end_time,
        title: suggestion.title,
      }, 'Cutting clip');

      // Cut the segment from the source video and crop to 9:16
      await cutAndCropVertical(
        sourceVideoPath,
        suggestion.start_time,
        suggestion.end_time,
        clipPath,
      );

      // Upload the raw clip to S3
      await uploadFileToS3(clipPath, s3ClipKey, 'video/mp4');

      // Persist the Clip record with AI metadata
      await prisma.clip.create({
        data: {
          id:             clipId,
          jobId:          videoJobId,
          status:         'RAW',
          startTime:      suggestion.start_time,
          endTime:        suggestion.end_time,
          title:          suggestion.title,
          transcriptJson: suggestion.word_level_transcript,
          rawVideoKey:    s3ClipKey,
        },
      });

      logger.info({ clipId, s3ClipKey }, 'Clip saved');
      await job.updateProgress(60 + Math.round((i + 1) * progressPerClip));
    }

    // ── 6. Mark job as COMPLETED ──────────────────────────────────────────
    await prisma.videoJob.update({
      where: { id: videoJobId },
      data:  { status: 'COMPLETED' },
    });

    await job.updateProgress(100);
    logger.info({ videoJobId }, 'Video job completed successfully');

  } catch (err) {
    // ── Error path: persist failure details ───────────────────────────────
    logger.error({ err, videoJobId }, 'Video job failed');

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: {
        status:       'FAILED',
        errorMessage: err.message,
        errorStack:   err.stack,
      },
    }).catch((dbErr) => logger.error({ dbErr }, 'Failed to update job failure status'));

    // Re-throw so BullMQ records the failure and applies retry backoff
    throw err;

  } finally {
    // ── Cleanup: always remove local tmp files ────────────────────────────
    try {
      await fs.rm(jobTmpDir, { recursive: true, force: true });
      logger.debug({ jobTmpDir }, 'Tmp directory cleaned up');
    } catch (cleanupErr) {
      logger.warn({ err: cleanupErr.message, jobTmpDir }, 'Tmp cleanup failed');
    }
  }
}

// ── Worker instantiation ───────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAMES.VIDEO_PROCESSING,
  processVideoJob,
  {
    connection:  createRedisConnection(),
    concurrency: config.worker.videoConcurrency,
    // Lock duration: 30 min — long enough to finish FFmpeg + Gemini upload
    lockDuration: 30 * 60 * 1000,
    // Renew lock every 5 minutes while processing
    lockRenewTime: 5 * 60 * 1000,
  },
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, videoJobId: job.data.videoJobId }, 'BullMQ job completed');
});

worker.on('failed', (job, err) => {
  logger.error({
    jobId:      job?.id,
    videoJobId: job?.data?.videoJobId,
    attempt:    job?.attemptsMade,
    err:        err.message,
  }, 'BullMQ job failed');
});

worker.on('error', (err) => {
  logger.error({ err: err.message }, 'Worker connection error');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing video worker gracefully');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing video worker gracefully');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

logger.info({
  queue:       QUEUE_NAMES.VIDEO_PROCESSING,
  concurrency: config.worker.videoConcurrency,
}, 'Video worker started');
