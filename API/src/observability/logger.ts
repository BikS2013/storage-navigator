import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'storage-navigator-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
