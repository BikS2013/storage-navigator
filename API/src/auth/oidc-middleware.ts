import type { RequestHandler } from 'express';
import { jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { ApiError } from '../errors/api-error.js';
import { mapRoles, type AppRole } from './role-mapper.js';

export type Principal = {
  sub: string;
  roles: Set<AppRole>;
  raw: JWTPayload;
};

export type OidcMiddlewareOptions = {
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  clockToleranceSec: number;
  roleClaim: string;
  roleMap: Record<string, AppRole>;
};

export function oidcMiddleware(opts: OidcMiddlewareOptions): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return next(ApiError.unauthenticated('Missing Bearer token'));
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const { payload } = await jwtVerify(token, opts.jwks, {
        issuer: opts.issuer,
        audience: opts.audience,
        clockTolerance: opts.clockToleranceSec,
        algorithms: ['RS256'],
      });
      const sub = typeof payload.sub === 'string' ? payload.sub : 'unknown';
      const roles = mapRoles(payload[opts.roleClaim], opts.roleMap);
      req.principal = { sub, roles, raw: payload };
      next();
    } catch (err) {
      next(ApiError.unauthenticated((err as Error).message));
    }
  };
}
