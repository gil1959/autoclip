// src/routes/clips.js
// Clip management routes — list clips, trigger caption burn-in.

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { captionBurnInQueue } from '../lib/queue.js';
import { getPresignedUrl } from '../services/s3Service.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/clips?jobId=xxx
 * List all clips for a given VideoJob.
 */
router.get('/', async (req, res) => {
  try {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId query param required' });

    // Verify the job belongs to the requesting user
    const job = await prisma.videoJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const clips = await prisma.clip.findMany({
      where:   { jobId },
      orderBy: { startTime: 'asc' },
    });

    // Attach short-lived pre-signed URLs for media playback
    const clipsWithUrls = await Promise.all(
      clips.map(async (clip) => {
        const urls = {};
        if (clip.rawVideoKey) {
          urls.rawVideoUrl = await getPresignedUrl(clip.rawVideoKey, 3600);
        }
        if (clip.finalVideoKey) {
          urls.finalVideoUrl = await getPresignedUrl(clip.finalVideoKey, 3600);
        }
        return { ...clip, ...urls };
      }),
    );

    res.json({ clips: clipsWithUrls });
  } catch (err) {
    logger.error({ err }, 'List clips error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/clips/:clipId
 * Get a single clip with pre-signed playback URLs.
 */
router.get('/:clipId', async (req, res) => {
  try {
    const clip = await prisma.clip.findUnique({
      where:   { id: req.params.clipId },
      include: { job: { select: { userId: true } } },
    });

    if (!clip || clip.job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const urls = {};
    if (clip.rawVideoKey)   urls.rawVideoUrl   = await getPresignedUrl(clip.rawVideoKey, 3600);
    if (clip.finalVideoKey) urls.finalVideoUrl = await getPresignedUrl(clip.finalVideoKey, 3600);

    res.json({ clip: { ...clip, ...urls } });
  } catch (err) {
    logger.error({ err }, 'Get clip error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/clips/:clipId/caption
 * Enqueue a caption burn-in job for this clip (Workflow B).
 */
router.post('/:clipId/caption', async (req, res) => {
  try {
    const clip = await prisma.clip.findUnique({
      where:   { id: req.params.clipId },
      include: { job: { select: { userId: true } } },
    });

    if (!clip || clip.job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    if (clip.status === 'CAPTIONING') {
      return res.status(409).json({ error: 'Caption job already running for this clip' });
    }

    if (!clip.rawVideoKey) {
      return res.status(400).json({ error: 'Raw video not available — wait for processing to complete' });
    }

    const transcriptJson = clip.transcriptJson;
    if (!Array.isArray(transcriptJson) || transcriptJson.length === 0) {
      return res.status(400).json({ error: 'No transcript available for this clip' });
    }

    // Enqueue the caption job
    const bullJob = await captionBurnInQueue.add(
      'burn-captions',
      { clipId: clip.id },
    );

    logger.info({ clipId: clip.id, bullJobId: bullJob.id }, 'Caption job enqueued');

    res.status(202).json({
      success: true,
      clipId:  clip.id,
      message: 'Caption burn-in job queued. Poll GET /api/clips/:id for status.',
    });
  } catch (err) {
    logger.error({ err }, 'Caption enqueue error');
    res.status(500).json({ error: err.message });
  }
});

// ── Middleware ─────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export default router;
