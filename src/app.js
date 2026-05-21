// src/app.js
// Express application entry point.

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { config }  from './config/index.js';
import { logger }  from './lib/logger.js';
import { prisma }  from './lib/prisma.js';

import authRoutes   from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import clipRoutes   from './routes/clips.js';
import postRoutes   from './routes/post.js';

const app = express();

// ── Security middleware ────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin:      config.frontendUrl,
  credentials: true,
}));

// ── Rate limiting ──────────────────────────────────────────────────────────

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please slow down.' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max:      20,
  message: { error: 'Upload limit reached. Try again in an hour.' },
});

const tiktokPostLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,  // 24 hours
  max:      50,
  message: { error: 'TikTok post limit reached for today.' },
});

app.use(generalLimiter);

// ── Body parsers ───────────────────────────────────────────────────────────

// Note: multipart/form-data (video uploads) is handled by multer in the route.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Health check ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────────────────────

app.use('/auth',       authRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/clips',  clipRoutes);
app.use('/api/post',   tiktokPostLimiter, postRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ───────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  // multer errors
  if (err.code && err.code.startsWith('LIMIT_')) {
    return res.status(400).json({ error: err.message });
  }

  res.status(err.status || 500).json({
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start server ───────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'AutoClipper API server started');
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed, database disconnected');
    process.exit(0);
  });

  // Force shutdown after 30 s if connections don't close
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
