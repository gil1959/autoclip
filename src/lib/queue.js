// src/lib/queue.js
// BullMQ Queue definitions. Import these to enqueue jobs.
// Workers create their own connections; never share a connection between
// Queue and Worker instances.

import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';

export const QUEUE_NAMES = {
  VIDEO_PROCESSING: 'video-processing',
  CAPTION_BURN_IN:  'caption-burn-in',
};

// Each Queue gets its own dedicated connection
export const videoProcessingQueue = new Queue(QUEUE_NAMES.VIDEO_PROCESSING, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,        // 5 s, 25 s, 125 s
    },
    removeOnComplete: { count: 100 },
    removeOnFail:    { count: 200 },
  },
});

export const captionBurnInQueue = new Queue(QUEUE_NAMES.CAPTION_BURN_IN, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail:    { count: 200 },
  },
});
