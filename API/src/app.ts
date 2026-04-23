import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { logger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/request-id.js';
import { errorMiddleware } from './errors/error-middleware.js';
import { healthRouter, type ReadinessChecks } from './routes/health.js';
import { wellKnownRouter } from './routes/well-known.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
};

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware());

  // Per-request structured logger that emits the spec Section 9 fields:
  // {ts, level, reqId, route, method, statusCode, durationMs, ...}.
  // principalSub, accountName, container, share, path are added downstream
  // (auth middleware in T9, route handlers in T13+).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) =>
        `${req.method} ${(req as express.Request).originalUrl} ${res.statusCode}`,
      customErrorMessage: (req, res) =>
        `${req.method} ${(req as express.Request).originalUrl} ${res.statusCode}`,
    })
  );

  app.use(wellKnownRouter(opts.config));
  app.use(healthRouter(opts.readinessChecks));

  app.use(errorMiddleware());
  return app;
}
