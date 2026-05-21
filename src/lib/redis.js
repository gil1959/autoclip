// src/lib/redis.js
// Shared IORedis connection used by BullMQ queues and workers.
// BullMQ requires separate connection instances per usage context
// (one for Queue, one for Worker) — this module exports a factory.

import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Creates a new IORedis connection configured for BullMQ.
 * BullMQ mandates maxRetriesPerRequest: null for blocking commands.
 *
 * @param {object} [overrides={}] - Additional IORedis options.
 * @returns {IORedis} A new redis connection instance.
 */
export function createRedisConnection(overrides = {}) {
  const connection = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,   // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      logger.warn(`Redis reconnect attempt ${times}, next in ${delay}ms`);
      return delay;
    },
    ...overrides,
  });

  connection.on('connect', () => logger.info('Redis connected'));
  connection.on('error', (err) => logger.error({ err }, 'Redis error'));

  return connection;
}
