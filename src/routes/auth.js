// src/routes/auth.js
// TikTok OAuth routes — Workflow C (steps 1 & 2).

import { Router } from 'express';
import crypto, { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  buildTikTokAuthUrl,
  exchangeCodeForTokens,
  saveTikTokCredentials,
} from '../services/tiktokService.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Helper to hash passwords using PBKDF2
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Helper to verify passwords
function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(':')) return false;
  const [salt, hash] = storedPasswordHash.split(':');
  const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === checkHash;
}

/**
 * POST /auth/register
 * Register a new local user.
 */
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
      },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );

    logger.info({ userId: user.id, email: user.email }, 'User registered successfully');
    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    logger.error({ err }, 'Registration error');
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * POST /auth/login
 * Authenticate local user and return JWT.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );

    logger.info({ userId: user.id }, 'User logged in successfully');
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Internal server error during login' });
  }
});


// In-memory state store for CSRF protection.
// In production, use Redis or a signed cookie instead.
const pendingOAuthStates = new Map();   // state => { userId, codeVerifier, expiresAt }

/**
 * GET /auth/tiktok
 * Redirects the authenticated user to TikTok's authorisation page.
 * Expects a valid app JWT in the Authorization header to identify the user.
 */
router.get('/tiktok', requireAppAuth, (req, res) => {
  // Generate a random state for CSRF protection
  const state = randomBytes(24).toString('hex');

  // Generate PKCE code verifier and challenge (required by TikTok Login Kit v2)
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  pendingOAuthStates.set(state, {
    userId:    req.user.id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,  // 10 min window
  });

  const authUrl = buildTikTokAuthUrl(state, codeChallenge);
  logger.info({ userId: req.user.id, state }, 'Redirecting to TikTok OAuth with PKCE');

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

  const { userId, codeVerifier } = pending;
  pendingOAuthStates.delete(state);

  try {
    // ── Exchange code for tokens ──────────────────────────────────────────
    const tokens = await exchangeCodeForTokens(code, codeVerifier);

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
  let token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header or token query parameter' });
  }

  try {
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export default router;
