// src/services/s3Service.js
// High-level helpers for uploading to and downloading from S3 / MinIO.

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { s3Client, S3_BUCKET } from '../lib/s3.js';
import { logger } from '../lib/logger.js';

/**
 * Upload a local file to S3 using multipart upload (handles large files).
 *
 * @param {string} localPath  - Absolute path to the local file.
 * @param {string} s3Key      - Destination key in S3 (e.g. "videos/jobId/raw.mp4").
 * @param {string} [mimeType] - Optional MIME type override.
 * @returns {Promise<string>}  Resolves with the s3Key on success.
 */
export async function uploadFileToS3(localPath, s3Key, mimeType) {
  const fileStream = createReadStream(localPath);
  const stat = await fs.stat(localPath);

  logger.info({ s3Key, bytes: stat.size }, 'Starting S3 upload');

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket:      S3_BUCKET,
      Key:         s3Key,
      Body:        fileStream,
      ContentType: mimeType || guessMimeType(localPath),
    },
    queueSize:    4,    // 4 parallel part uploads
    partSize:     10 * 1024 * 1024, // 10 MB parts
  });

  upload.on('httpUploadProgress', ({ loaded, total }) => {
    if (total) {
      logger.debug({ s3Key, pct: ((loaded / total) * 100).toFixed(1) }, 'Upload progress');
    }
  });

  await upload.done();
  logger.info({ s3Key }, 'S3 upload complete');
  return s3Key;
}

/**
 * Upload a Buffer or string body directly to S3.
 *
 * @param {Buffer|string} body
 * @param {string}        s3Key
 * @param {string}        [mimeType]
 * @returns {Promise<string>}
 */
export async function uploadBufferToS3(body, s3Key, mimeType = 'application/octet-stream') {
  await s3Client.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         s3Key,
    Body:        body,
    ContentType: mimeType,
  }));
  return s3Key;
}

/**
 * Download an S3 object to a local path.
 *
 * @param {string} s3Key      - The S3 object key.
 * @param {string} localPath  - Destination path on the local filesystem.
 * @returns {Promise<string>} Resolves with localPath.
 */
export async function downloadFileFromS3(s3Key, localPath) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  logger.info({ s3Key, localPath }, 'Downloading from S3');

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key:    s3Key,
  }));

  const writeStream = createWriteStream(localPath);
  await pipeline(response.Body, writeStream);

  logger.info({ s3Key, localPath }, 'S3 download complete');
  return localPath;
}

/**
 * Delete an object from S3.
 *
 * @param {string} s3Key
 * @returns {Promise<void>}
 */
export async function deleteFromS3(s3Key) {
  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key:    s3Key,
  }));
  logger.info({ s3Key }, 'S3 object deleted');
}

/**
 * Generate a pre-signed URL for temporary public access to an S3 object.
 *
 * @param {string} s3Key
 * @param {number} [expiresInSeconds=3600]
 * @returns {Promise<string>}
 */
export async function getPresignedUrl(s3Key, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Naively guess the MIME type from a file extension.
 * @param {string} filePath
 * @returns {string}
 */
function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp4':  'video/mp4',
    '.mov':  'video/quicktime',
    '.webm': 'video/webm',
    '.mp3':  'audio/mpeg',
    '.m4a':  'audio/mp4',
    '.ass':  'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}
