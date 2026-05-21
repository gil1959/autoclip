// src/lib/prisma.js
// Singleton Prisma client. Reuses the instance across hot-reloads in dev.

import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const globalForPrisma = globalThis;

if (!globalForPrisma.__prisma) {
  globalForPrisma.__prisma = new PrismaClient({
    log: [
      { level: 'query',  emit: 'event' },
      { level: 'error',  emit: 'event' },
      { level: 'warn',   emit: 'event' },
    ],
  });

  globalForPrisma.__prisma.$on('query', (e) => {
    if (process.env.NODE_ENV === 'development') {
      logger.debug({ duration: `${e.duration}ms`, query: e.query }, 'Prisma query');
    }
  });

  globalForPrisma.__prisma.$on('error', (e) => {
    logger.error({ message: e.message }, 'Prisma error');
  });

  globalForPrisma.__prisma.$on('warn', (e) => {
    logger.warn({ message: e.message }, 'Prisma warn');
  });
}

export const prisma = globalForPrisma.__prisma;
