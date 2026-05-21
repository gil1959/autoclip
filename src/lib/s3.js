// src/lib/s3.js
// AWS S3 / MinIO client singleton.

import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const clientOptions = {
  region: config.storage.region,
  credentials: {
    accessKeyId:     config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
};

// When STORAGE_ENDPOINT is set, we're talking to MinIO or a compatible store
if (config.storage.endpoint) {
  clientOptions.endpoint          = config.storage.endpoint;
  clientOptions.forcePathStyle    = config.storage.forcePathStyle;
}

export const s3Client = new S3Client(clientOptions);
export const S3_BUCKET = config.storage.bucket;

/**
 * Ensures the configured bucket exists. Creates it if it doesn't.
 */
export async function ensureBucketExists() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    logger.info({ bucket: S3_BUCKET }, 'S3/MinIO bucket verified');
  } catch (err) {
    const isNotFound = err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404;
    if (isNotFound) {
      logger.info({ bucket: S3_BUCKET }, 'S3/MinIO bucket not found, creating...');
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
        logger.info({ bucket: S3_BUCKET }, 'S3/MinIO bucket created successfully');
      } catch (createErr) {
        logger.error({ err: createErr, bucket: S3_BUCKET }, 'Failed to create S3/MinIO bucket');
      }
    } else {
      logger.warn({ err: err.message, bucket: S3_BUCKET }, 'HeadBucket check warning (non-fatal)');
    }
  }
}

