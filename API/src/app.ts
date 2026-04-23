import express, { type Express, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { logger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/request-id.js';
import { errorMiddleware } from './errors/error-middleware.js';
import { healthRouter, type ReadinessChecks } from './routes/health.js';
import { wellKnownRouter } from './routes/well-known.js';
import { buildJwksGetter } from './auth/jwks-cache.js';
import { oidcMiddleware } from './auth/oidc-middleware.js';
import { anonymousPrincipalMiddleware } from './auth/auth-toggle.js';
import type { AppRole } from './auth/role-mapper.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
  /**
   * When set, used in place of building authentication from config.
   * Test-only.
   */
  authOverride?: RequestHandler;
};

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware());

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

  const auth = opts.authOverride ?? buildAuthMiddleware(opts.config);
  app.use(auth);

  // Authenticated routers will be mounted in later tasks.

  app.use(errorMiddleware());
  return app;
}

function buildAuthMiddleware(config: Config): RequestHandler {
  if (config.oidc.mode === 'enabled') {
    const jwksUri = `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration/jwks`;
    const jwks = buildJwksGetter(jwksUri, config.oidc.jwksCacheMin);
    return oidcMiddleware({
      jwks,
      issuer: config.oidc.issuer,
      audience: config.oidc.audience,
      clockToleranceSec: config.oidc.clockToleranceSec,
      roleClaim: config.oidc.roleClaim,
      roleMap: config.oidc.roleMap as Record<string, AppRole>,
    });
  }
  return anonymousPrincipalMiddleware(config.oidc.anonRole);
}
