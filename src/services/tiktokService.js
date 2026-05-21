// src/services/tiktokService.js
// TikTok Login Kit (OAuth 2.0) + Content Posting API integration.
//
// References:
//   - Auth: https://developers.tiktok.com/doc/login-kit-web
//   - Post: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

import { createReadStream } from 'fs';
import { stat as fsStat } from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from '../config/index.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { downloadFileFromS3 } from './s3Service.js';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';

// ── OAuth Constants ────────────────────────────────────────────────────────

const TIKTOK_OAUTH_URL   = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL   = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const TIKTOK_POST_URL    = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_POST_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

// Scopes required for reading user info + posting videos
const SCOPES = [
  'user.info.basic',
  'video.publish',
  'video.upload',
].join(',');

// ── OAuth helpers ──────────────────────────────────────────────────────────

/**
 * Build the TikTok authorisation redirect URL with PKCE.
 * The `state` parameter must be verified in the callback to prevent CSRF.
 *
 * @param {string} state - A random, unguessable string stored in the user's session.
 * @param {string} codeChallenge - The PKCE code challenge.
 * @returns {string} The full redirect URL.
 */
export function buildTikTokAuthUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    client_key:    config.tiktok.clientKey,
    scope:         SCOPES,
    response_type: 'code',
    redirect_uri:  config.tiktok.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${TIKTOK_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorisation code for an access_token + refresh_token using PKCE.
 *
 * @param {string} code - The `code` query param from TikTok's callback.
 * @param {string} codeVerifier - The PKCE code verifier.
 * @returns {Promise<{
 *   open_id: string,
 *   access_token: string,
 *   refresh_token: string,
 *   expires_in: number,
 *   scope: string,
 * }>}
 */
export async function exchangeCodeForTokens(code, codeVerifier) {
  const body = new URLSearchParams({
    client_key:    config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  config.tiktok.redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `TikTok token exchange failed: ${data.error_description || data.message || response.statusText}`,
    );
  }

  logger.info({ open_id: data.open_id }, 'TikTok token exchange successful');
  return data;
}

/**
 * Refresh an expired access token using the stored refresh_token.
 *
 * @param {string} refreshToken
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_in: number }>}
 */
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_key:    config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      `TikTok token refresh failed: ${data.error_description || data.message || response.statusText}`,
    );
  }

  return data;
}

/**
 * Persist (upsert) TikTok credentials for a user.
 *
 * @param {string} userId
 * @param {{ open_id, access_token, refresh_token, expires_in, scope }} tokens
 * @returns {Promise<import('@prisma/client').TikTokCredential>}
 */
export async function saveTikTokCredentials(userId, tokens) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  return prisma.tikTokCredential.upsert({
    where:  { userId },
    create: {
      userId,
      openId:        tokens.open_id,
      accessToken:   tokens.access_token,
      refreshToken:  tokens.refresh_token,
      tokenExpiresAt: expiresAt,
      scope:         tokens.scope || '',
    },
    update: {
      openId:        tokens.open_id,
      accessToken:   tokens.access_token,
      refreshToken:  tokens.refresh_token,
      tokenExpiresAt: expiresAt,
      scope:         tokens.scope || '',
    },
  });
}

/**
 * Retrieve a valid access token for the user, refreshing if needed.
 *
 * @param {string} userId
 * @returns {Promise<string>} A valid access_token.
 */
export async function getValidAccessToken(userId) {
  const cred = await prisma.tikTokCredential.findUniqueOrThrow({ where: { userId } });

  const bufferMs = 5 * 60 * 1000; // Refresh 5 minutes before expiry
  if (cred.tokenExpiresAt.getTime() - Date.now() < bufferMs) {
    logger.info({ userId }, 'TikTok access token expired — refreshing');
    const fresh = await refreshAccessToken(cred.refreshToken);

    await saveTikTokCredentials(userId, {
      open_id:       cred.openId,
      access_token:  fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_in:    fresh.expires_in,
      scope:         cred.scope,
    });

    return fresh.access_token;
  }

  return cred.accessToken;
}

// ── Content Posting API ────────────────────────────────────────────────────

/**
 * Post a video clip to TikTok using the Direct Post API (PULL mode).
 *
 * The Direct Post API (v2) works in two modes:
 *  - PULL_FROM_URL: TikTok fetches the video from a public URL.
 *  - FILE_UPLOAD:   Client uploads the video in chunks directly to TikTok's CDN.
 *
 * We use FILE_UPLOAD (PULL is simpler but requires a public URL).
 * Flow:
 *   1. POST /post/publish/video/init/  → get publish_id + upload_url
 *   2. PUT the video bytes to upload_url
 *   3. Poll /post/publish/status/fetch/ until PUBLISH_COMPLETE
 *
 * @param {string} userId  - AutoClipper user ID (to fetch their TikTok token).
 * @param {string} clipId  - Clip record ID.
 * @param {object} options - Post options.
 * @param {string} options.title         - Video caption / title.
 * @param {string[]} [options.hashtags]  - Optional hashtags (without #).
 * @param {string} [options.privacyLevel] - "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY"
 * @returns {Promise<{ publishId: string }>}
 */
export async function postClipToTikTok(userId, clipId, options = {}) {
  const { title, hashtags = [], privacyLevel = 'PUBLIC_TO_EVERYONE' } = options;

  // ── Fetch credentials and clip data ─────────────────────────────────────
  const accessToken = await getValidAccessToken(userId);
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });

  const s3Key = clip.finalVideoKey || clip.rawVideoKey;
  if (!s3Key) throw new Error(`Clip ${clipId} has no video ready to post`);

  // ── Download the clip to a local tmp file ────────────────────────────────
  const tmpPath = path.join(os.tmpdir(), `tiktok-upload-${uuidv4()}.mp4`);
  try {
    await downloadFileFromS3(s3Key, tmpPath);

    const { size: fileSizeBytes } = await fsStat(tmpPath);

    // ── Step 1: Initialise the post (Direct Post API) ───────────────────
    const caption = [title, ...hashtags.map((h) => `#${h}`)].join(' ');

    const initPayload = {
      post_info: {
        title:             caption.slice(0, 2200),  // TikTok limit
        privacy_level:     privacyLevel,
        disable_duet:      false,
        disable_comment:   false,
        disable_stitch:    false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source:          'FILE_UPLOAD',
        video_size:      fileSizeBytes,
        chunk_size:      fileSizeBytes,  // Single-chunk upload (≤ 64 MB)
        total_chunk_count: 1,
      },
    };

    logger.info({ clipId, caption }, 'Initialising TikTok post');

    const initResponse = await fetch(TIKTOK_POST_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json; charset=UTF-8',
      },
      body: JSON.stringify(initPayload),
    });

    const initData = await initResponse.json();

    if (initData.error?.code !== 'ok') {
      throw new Error(
        `TikTok post init failed: ${initData.error?.message || JSON.stringify(initData)}`,
      );
    }

    const { publish_id, upload_url } = initData.data;
    logger.info({ publish_id, upload_url }, 'TikTok post initialised');

    // ── Step 2: Upload the video file to TikTok's CDN ────────────────────
    logger.info({ clipId, fileSizeBytes }, 'Uploading video to TikTok CDN');

    const videoStream = createReadStream(tmpPath);

    const uploadResponse = await fetch(upload_url, {
      method:  'PUT',
      headers: {
        'Content-Type':   'video/mp4',
        'Content-Length': String(fileSizeBytes),
        'Content-Range':  `bytes 0-${fileSizeBytes - 1}/${fileSizeBytes}`,
      },
      body:    videoStream,
      // node-fetch requires explicit duplex option for streaming bodies
      duplex:  'half',
    });

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text();
      throw new Error(`TikTok CDN upload failed (${uploadResponse.status}): ${text}`);
    }

    logger.info({ publish_id }, 'Video uploaded to TikTok CDN');

    // ── Step 3: Poll for publish completion ──────────────────────────────
    const finalStatus = await pollPublishStatus(accessToken, publish_id);
    logger.info({ publish_id, finalStatus }, 'TikTok publish status');

    // ── Step 4: Update clip record ────────────────────────────────────────
    await prisma.clip.update({
      where: { id: clipId },
      data: {
        tiktokPostId: publish_id,
        postedAt:     new Date(),
        status:       'POSTED',
      },
    });

    return { publishId: publish_id };

  } finally {
    // Clean up tmp file
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

/**
 * Poll the TikTok publish status endpoint until the video is published or fails.
 *
 * @param {string} accessToken
 * @param {string} publishId
 * @param {number} [maxAttempts=24]  - Max polls (24 × 5s = 2 min)
 * @returns {Promise<string>}        - Final status string
 */
async function pollPublishStatus(accessToken, publishId, maxAttempts = 24) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((res) => setTimeout(res, 5000));

    const response = await fetch(TIKTOK_POST_STATUS_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const data = await response.json();

    if (data.error?.code !== 'ok') {
      throw new Error(`TikTok status poll failed: ${data.error?.message}`);
    }

    const status = data.data?.status;
    logger.debug({ publishId, status, attempt }, 'TikTok publish status poll');

    if (status === 'PUBLISH_COMPLETE') return status;
    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed for publish_id ${publishId}: ${JSON.stringify(data.data)}`);
    }
  }

  throw new Error(`Timed out waiting for TikTok publish status on ${publishId}`);
}
