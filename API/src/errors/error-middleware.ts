import type { ErrorRequestHandler } from 'express';
import { ApiError } from './api-error.js';
import { logger } from '../observability/logger.js';

export function errorMiddleware(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const correlationId = req.requestId ?? 'unknown';

    if (err instanceof ApiError) {
      logger.warn({ correlationId, code: err.code, status: err.status }, err.message);
      res.status(err.status).json({
        error: { code: err.code, message: err.message, correlationId },
      });
      return;
    }

    logger.error({ correlationId, err }, 'unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
        correlationId,
      },
    });
  };
}
