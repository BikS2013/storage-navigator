import express, { type Express, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { logger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/request-id.js';
import { errorMiddleware } from './errors/error-middleware.js';
import { healthRouter, type ReadinessChecks } from './routes/health.js';
import { wellKnownRouter } from './routes/well-known.js';
import { openapiRouter } from './routes/openapi.js';
import { buildJwksGetter } from './auth/jwks-cache.js';
import { oidcMiddleware } from './auth/oidc-middleware.js';
import { anonymousPrincipalMiddleware } from './auth/auth-toggle.js';
import { staticAuthMiddleware } from './auth/static-auth.js';
import type { AppRole } from './auth/role-mapper.js';
import type { AccountDiscovery } from './azure/account-discovery.js';
import type { BlobService } from './azure/blob-service.js';
import type { FileService } from './azure/file-service.js';
import { storagesRouter } from './routes/storages.js';
import { containersRouter } from './routes/containers.js';
import { blobsRouter } from './routes/blobs.js';
import { sharesRouter } from './routes/shares.js';
import { filesRouter } from './routes/files.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
  /**
   * When set, used in place of building authentication from config.
   * Test-only.
   */
  authOverride?: RequestHandler;
  discovery: AccountDiscovery;
  blobService: BlobService;
  fileService: FileService;
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
  app.use(openapiRouter(opts.config));
  app.use(healthRouter(opts.readinessChecks));

  const staticAuthCfg = opts.config.staticAuth ?? { values: [], headerName: 'X-Storage-Nav-Auth' };
  app.use(staticAuthMiddleware(staticAuthCfg.values, staticAuthCfg.headerName));

  const auth = opts.authOverride ?? buildAuthMiddleware(opts.config);
  app.use(auth);

  app.use(storagesRouter(opts.discovery));
  app.use(containersRouter(opts.blobService, opts.discovery, opts.config));
  app.use(blobsRouter(opts.blobService, opts.discovery, opts.config));
  app.use(sharesRouter(opts.fileService, opts.discovery, opts.config));
  app.use(filesRouter(opts.fileService, opts.discovery, opts.config));

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
