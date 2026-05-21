// src/routes/upload.js
// Video upload endpoint — Workflow A (step 1).
//
// POST /api/upload
//   - Accepts a multipart/form-data video file.
//   - Streams it directly to S3 using multer-s3.
//   - Creates a VideoJob record in the database.
//   - Enqueues a video-processing job in BullMQ.
//   - Returns the job ID to the client for status polling.

import { Router } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { s3Client, S3_BUCKET } from '../lib/s3.js';
import { prisma } from '../lib/prisma.js';
import { videoProcessingQueue } from '../lib/queue.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ── Allowed MIME types ─────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
]);

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ── multer-s3 storage engine ───────────────────────────────────────────────

const upload = multer({
  storage: multerS3({
    s3:     s3Client,
    bucket: S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      // Ensure req.user is set (requireAuth middleware runs before multer)
      const jobId  = uuidv4();
      req.videoJobId = jobId;   // Stash it for use after upload
      const ext = file.originalname.split('.').pop().toLowerCase();
      cb(null, `videos/${jobId}/source.${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported MIME type: ${file.mimetype}`));
    }
  },
});

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Body: multipart/form-data with field "video"
 */
router.post('/', requireAuth, upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const s3Key  = file.key;
    const jobId  = req.videoJobId;
    const userId = req.user.id;

    logger.info({ userId, jobId, s3Key, size: file.size }, 'Video uploaded to S3');

    // ── Create VideoJob record ────────────────────────────────────────────
    const videoJob = await prisma.videoJob.create({
      data: {
        id:               jobId,
        userId,
        status:           'PENDING',
        originalVideoKey: s3Key,
        originalFilename: file.originalname,
        fileSizeBytes:    BigInt(file.size),
      },
    });

    // ── Enqueue processing job ────────────────────────────────────────────
    const bullJob = await videoProcessingQueue.add(
      'process-video',
      { videoJobId: jobId, s3Key },
      { jobId: jobId },  // Use our DB ID as the BullMQ job ID for easy lookup
    );

    logger.info({ jobId, bullJobId: bullJob.id }, 'Video job enqueued');

    res.status(202).json({
      success:    true,
      videoJobId: videoJob.id,
      status:     videoJob.status,
      message:    'Video uploaded successfully and queued for processing.',
    });

  } catch (err) {
    logger.error({ err }, 'Upload route error');
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

// ── GET /api/upload/status/:jobId — poll job progress ─────────────────────

router.get('/status/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await prisma.videoJob.findUnique({
      where:   { id: req.params.jobId },
      include: { clips: { select: { id: true, title: true, status: true } } },
    });

    if (!job || job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Also fetch BullMQ progress if available
    let bullProgress = null;
    if (job.bullJobId) {
      try {
        const bullJob = await videoProcessingQueue.getJob(job.bullJobId);
        if (bullJob) bullProgress = await bullJob.progress;
      } catch {
        // Non-critical
      }
    }

    res.json({ ...job, bullProgress });
  } catch (err) {
    logger.error({ err }, 'Status route error');
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
