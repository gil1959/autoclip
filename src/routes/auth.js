// src/routes/auth.js
// TikTok OAuth routes — Workflow C (steps 1 & 2).

import { Router } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  buildTikTokAuthUrl,
  exchangeCodeForTokens,
  saveTikTokCredentials,
} from '../services/tiktokService.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

// In-memory state store for CSRF protection.
// In production, use Redis or a signed cookie instead.
const pendingOAuthStates = new Map();   // state => { userId, expiresAt }

/**
 * GET /auth/tiktok
 * Redirects the authenticated user to TikTok's authorisation page.
 * Expects a valid app JWT in the Authorization header to identify the user.
 */
router.get('/tiktok', requireAppAuth, (req, res) => {
  // Generate a random state for CSRF protection
  const state = randomBytes(24).toString('hex');

  pendingOAuthStates.set(state, {
    userId:    req.user.id,
    expiresAt: Date.now() + 10 * 60 * 1000,  // 10 min window
  });

  const authUrl = buildTikTokAuthUrl(state);
  logger.info({ userId: req.user.id, state }, 'Redirecting to TikTok OAuth');

  res.redirect(authUrl);
});

/**
 * GET /auth/tiktok/callback
 * TikTok redirects here after the user grants or denies permission.
 * Exchanges the code for tokens and saves them to the database.
 */
router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // ── Handle user denial ────────────────────────────────────────────────
  if (error) {
    logger.warn({ error, error_description }, 'TikTok OAuth denied by user');
    return res.redirect(
      `${config.frontendUrl}/settings?tiktok=denied&reason=${encodeURIComponent(error_description || error)}`,
    );
  }

  // ── Validate state (CSRF) ─────────────────────────────────────────────
  const pending = pendingOAuthStates.get(state);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingOAuthStates.delete(state);
    logger.warn({ state }, 'Invalid or expired OAuth state');
    return res.status(400).json({ error: 'Invalid or expired OAuth state parameter' });
  }

  const { userId } = pending;
  pendingOAuthStates.delete(state);

  try {
    // ── Exchange code for tokens ──────────────────────────────────────────
    const tokens = await exchangeCodeForTokens(code);

    // ── Persist credentials ───────────────────────────────────────────────
    await saveTikTokCredentials(userId, tokens);

    logger.info({ userId }, 'TikTok credentials saved successfully');

    // Redirect back to the frontend settings page with success indicator
    res.redirect(`${config.frontendUrl}/settings?tiktok=connected`);
  } catch (err) {
    logger.error({ err, userId }, 'TikTok callback error');
    res.redirect(
      `${config.frontendUrl}/settings?tiktok=error&reason=${encodeURIComponent(err.message)}`,
    );
  }
});

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Simple JWT auth middleware for the app's own tokens.
 * Sets req.user = { id, email } on success.
 */
function requireAppAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export default router;
