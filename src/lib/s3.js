// src/lib/s3.js
// AWS S3 / MinIO client singleton.

import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

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
