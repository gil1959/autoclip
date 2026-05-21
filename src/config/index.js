// src/config/index.js
// Centralised, validated configuration object.
// All modules import from here — never directly from process.env.

import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key, fallback = '') {
  return process.env[key] ?? fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),

  database: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    model: optional('GEMINI_MODEL', 'gemini-1.5-pro'),
  },

  tiktok: {
    clientKey: required('TIKTOK_CLIENT_KEY'),
    clientSecret: required('TIKTOK_CLIENT_SECRET'),
    redirectUri: required('TIKTOK_REDIRECT_URI'),
  },

  storage: {
    endpoint: optional('STORAGE_ENDPOINT', ''),        // empty = real AWS
    forcePathStyle: optional('STORAGE_FORCE_PATH_STYLE', 'false') === 'true',
    accessKeyId: required('AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    region: optional('AWS_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET_NAME'),
  },

  ffmpeg: {
    path: optional('FFMPEG_PATH', ''),                 // empty = use PATH
    tmpDir: optional('WORKER_TMP_DIR', '/tmp/autoclipper'),
  },

  auth: {
    jwtSecret: required('JWT_SECRET'),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),
    sessionSecret: required('SESSION_SECRET'),
  },

  worker: {
    videoConcurrency: parseInt(optional('VIDEO_WORKER_CONCURRENCY', '2'), 10),
    captionConcurrency: parseInt(optional('CAPTION_WORKER_CONCURRENCY', '4'), 10),
  },
};
