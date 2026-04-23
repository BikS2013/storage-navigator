import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';
import { impliesRole, type AppRole } from '../auth/role-mapper.js';

export function requireRole(role: AppRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) return next(ApiError.unauthenticated());
    if (!impliesRole(req.principal.roles, role)) return next(ApiError.forbidden());
    next();
  };
}
