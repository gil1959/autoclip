// src/routes/post.js
// TikTok posting route — Workflow C (step 3).
//
// POST /api/post/tiktok
//   - Validates ownership and clip readiness.
//   - Calls tiktokService.postClipToTikTok which:
//       1. Fetches (and refreshes if needed) the TikTok access token.
//       2. Downloads the clip from S3.
//       3. Initialises a TikTok Direct Post.
//       4. Uploads the video to TikTok's CDN.
//       5. Polls for publish completion.
//       6. Updates the Clip record.

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { postClipToTikTok } from '../services/tiktokService.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * POST /api/post/tiktok
 * Body (JSON):
 *   {
 *     clipId:       string    (required)
 *     title:        string    (required, max 2200 chars)
 *     hashtags:     string[]  (optional)
 *     privacyLevel: string    (optional, default "PUBLIC_TO_EVERYONE")
 *   }
 */
router.post('/tiktok', requireAuth, async (req, res) => {
  const { clipId, title, hashtags = [], privacyLevel } = req.body;

  if (!clipId || !title) {
    return res.status(400).json({ error: '`clipId` and `title` are required' });
  }

  try {
    // ── Verify clip ownership ─────────────────────────────────────────────
    const clip = await prisma.clip.findUnique({
      where:   { id: clipId },
      include: { job: { select: { userId: true } } },
    });

    if (!clip || clip.job.userId !== req.user.id) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    // ── Verify TikTok credentials exist ──────────────────────────────────
    const cred = await prisma.tikTokCredential.findUnique({
      where: { userId: req.user.id },
    });

    if (!cred) {
      return res.status(403).json({
        error: 'TikTok account not connected. Visit /auth/tiktok to connect.',
      });
    }

    // ── Verify video is available ─────────────────────────────────────────
    if (!clip.rawVideoKey && !clip.finalVideoKey) {
      return res.status(400).json({
        error: 'Clip has no video file. Wait for processing to complete.',
      });
    }

    // ── Post to TikTok ────────────────────────────────────────────────────
    logger.info({ clipId, userId: req.user.id, title }, 'Posting clip to TikTok');

    const result = await postClipToTikTok(req.user.id, clipId, {
      title,
      hashtags,
      privacyLevel,
    });

    res.json({
      success:   true,
      publishId: result.publishId,
      message:   'Video posted to TikTok successfully.',
    });

  } catch (err) {
    logger.error({ err, clipId }, 'TikTok post error');
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
