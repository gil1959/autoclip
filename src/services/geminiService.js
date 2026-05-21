// src/services/geminiService.js
// Wrapper around Google Generative AI SDK + File API for video analysis.
//
// Flow:
//   1. Upload the audio/video file to Google AI File API (temporary storage).
//   2. Poll until the file state becomes ACTIVE (processing is async on Google's side).
//   3. Send a structured Gemini 1.5 Pro prompt referencing the uploaded file.
//   4. Parse the JSON response into validated clip suggestions.
//   5. Delete the file from Google AI Storage to avoid quota accumulation.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { promises as fs } from 'fs';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const genAI       = new GoogleGenerativeAI(config.gemini.apiKey);
const fileManager = new GoogleAIFileManager(config.gemini.apiKey);

/**
 * @typedef {Object} WordTimestamp
 * @property {string} word  - The word text.
 * @property {number} start - Start time in seconds.
 * @property {number} end   - End time in seconds.
 */

/**
 * @typedef {Object} ClipSuggestion
 * @property {number}          start_time           - Clip start in seconds.
 * @property {number}          end_time             - Clip end in seconds.
 * @property {string}          title                - AI-generated clip title.
 * @property {WordTimestamp[]} word_level_transcript - Word-level timestamps.
 */

/**
 * Poll until a Google AI file reaches ACTIVE state (up to `maxWaitMs`).
 *
 * @param {string} fileName  - The Google AI file name (e.g. "files/abc123").
 * @param {number} maxWaitMs - Maximum wait in ms (default 10 minutes).
 * @returns {Promise<void>}
 */
async function waitForFileActive(fileName, maxWaitMs = 10 * 60 * 1000) {
  const pollInterval = 5000; // 5 s
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const fileInfo = await fileManager.getFile(fileName);
    logger.debug({ fileName, state: fileInfo.state }, 'Polling Google AI file state');

    if (fileInfo.state === FileState.ACTIVE) return;
    if (fileInfo.state === FileState.FAILED) {
      throw new Error(`Google AI file processing failed for ${fileName}`);
    }

    await new Promise((res) => setTimeout(res, pollInterval));
  }

  throw new Error(`Timeout waiting for Google AI file ${fileName} to become ACTIVE`);
}

/**
 * Analyse a video or audio file with Gemini 1.5 Pro and return structured
 * clip suggestions with word-level transcripts.
 *
 * @param {string} localFilePath - Absolute path to the local video/audio file.
 * @param {string} mimeType      - MIME type of the file (e.g. "video/mp4", "audio/mpeg").
 * @returns {Promise<ClipSuggestion[]>}
 */
export async function analyseVideoForClips(localFilePath, mimeType) {
  let uploadedFileName = null;

  try {
    // ── Step 1: Upload file to Google AI File API ──────────────────────────
    logger.info({ localFilePath, mimeType }, 'Uploading file to Google AI');

    const uploadResponse = await fileManager.uploadFile(localFilePath, {
      mimeType,
      displayName: `autoclipper-${Date.now()}`,
    });

    uploadedFileName = uploadResponse.file.name;
    logger.info({ fileName: uploadedFileName }, 'File uploaded to Google AI');

    // ── Step 2: Wait for Google to finish processing the file ──────────────
    await waitForFileActive(uploadedFileName);

    // ── Step 3: Build the Gemini prompt ────────────────────────────────────
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,   // Low temp for consistent, structured output
      },
    });

    const systemPrompt = `You are an expert social media video editor specialising in viral short-form content.
Your task is to analyse the provided video/audio and identify the 3 best segments to clip for TikTok.

Selection criteria for a viral clip:
- Starts with a strong hook (surprising fact, question, emotional moment, or bold statement).
- Duration between 15 and 60 seconds.
- Self-contained — understandable without context from the rest of the video.
- High energy or emotionally engaging moment.

You MUST return a JSON array of exactly 3 objects. Each object must conform to this schema:
{
  "start_time": <number — start of the clip in seconds, float precision>,
  "end_time":   <number — end of the clip in seconds, float precision>,
  "title":      <string — an engaging, clickbait-style title for this clip (max 60 chars)>,
  "word_level_transcript": [
    { "word": <string>, "start": <float seconds>, "end": <float seconds> }
  ]
}

Do NOT include any additional text, markdown, or explanation. Return only the raw JSON array.`;

    const result = await model.generateContent([
      {
        fileData: {
          mimeType,
          fileUri: uploadResponse.file.uri,
        },
      },
      { text: systemPrompt },
    ]);

    const rawJson = result.response.text();
    logger.debug({ rawJson: rawJson.slice(0, 500) }, 'Gemini raw response');

    // ── Step 4: Parse and validate ─────────────────────────────────────────
    const clips = parseAndValidateClips(rawJson);
    logger.info({ count: clips.length }, 'Gemini clip analysis complete');

    return clips;
  } finally {
    // ── Step 5: Always clean up the uploaded file ──────────────────────────
    if (uploadedFileName) {
      try {
        await fileManager.deleteFile(uploadedFileName);
        logger.info({ fileName: uploadedFileName }, 'Google AI file deleted');
      } catch (cleanupErr) {
        logger.warn({ err: cleanupErr.message, uploadedFileName }, 'Failed to delete Google AI file');
      }
    }
  }
}

/**
 * Parse the JSON string returned by Gemini and validate its structure.
 * Throws if parsing fails or the schema is invalid.
 *
 * @param {string} rawJson
 * @returns {ClipSuggestion[]}
 */
function parseAndValidateClips(rawJson) {
  let parsed;
  try {
    // Gemini occasionally wraps JSON in markdown code fences — strip them
    const clean = rawJson
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/,           '')
      .trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    throw new Error(`Gemini returned invalid JSON: ${err.message}\nRaw: ${rawJson.slice(0, 300)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response is not a JSON array');
  }

  return parsed.map((clip, idx) => {
    const prefix = `clips[${idx}]`;
    assertNumber(clip.start_time, `${prefix}.start_time`);
    assertNumber(clip.end_time,   `${prefix}.end_time`);
    assertString(clip.title,      `${prefix}.title`);

    if (!Array.isArray(clip.word_level_transcript)) {
      throw new Error(`${prefix}.word_level_transcript must be an array`);
    }

    clip.word_level_transcript.forEach((w, wi) => {
      assertString(w.word,  `${prefix}.word_level_transcript[${wi}].word`);
      assertNumber(w.start, `${prefix}.word_level_transcript[${wi}].start`);
      assertNumber(w.end,   `${prefix}.word_level_transcript[${wi}].end`);
    });

    if (clip.end_time <= clip.start_time) {
      throw new Error(`${prefix}: end_time (${clip.end_time}) must be > start_time (${clip.start_time})`);
    }

    return {
      start_time:            Number(clip.start_time),
      end_time:              Number(clip.end_time),
      title:                 String(clip.title).slice(0, 150),
      word_level_transcript: clip.word_level_transcript,
    };
  });
}

function assertNumber(val, label) {
  if (typeof val !== 'number' || isNaN(val)) {
    throw new Error(`${label} must be a number, got: ${JSON.stringify(val)}`);
  }
}

function assertString(val, label) {
  if (typeof val !== 'string' || val.trim() === '') {
    throw new Error(`${label} must be a non-empty string, got: ${JSON.stringify(val)}`);
  }
}
