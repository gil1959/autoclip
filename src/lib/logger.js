// src/lib/logger.js
// Winston-based structured logger. Outputs JSON in production, pretty in dev.

import { createLogger, format, transports } from 'winston';

const { combine, timestamp, json, colorize, printf, errors } = format;

const isDev = process.env.NODE_ENV !== 'production';

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    let line = `${timestamp} [${level}] ${message}`;
    if (stack) line += `\n${stack}`;
    if (Object.keys(meta).length) line += ` ${JSON.stringify(meta)}`;
    return line;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = createLogger({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  format: isDev ? devFormat : prodFormat,
  transports: [new transports.Console()],
});
