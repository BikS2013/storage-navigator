import type { RequestHandler } from 'express';
import type { AppRole } from './role-mapper.js';

export function anonymousPrincipalMiddleware(anonRole: AppRole): RequestHandler {
  return (req, _res, next) => {
    req.principal = {
      sub: 'anonymous',
      roles: new Set<AppRole>([anonRole]),
      raw: { sub: 'anonymous' },
    };
    next();
  };
}
