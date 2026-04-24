import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';

/**
 * Perimeter "API key" gate. When `allowedValues` is empty, the middleware is
 * a pass-through (gate disabled). Otherwise every request must carry the
 * configured header with a value that exactly matches one of the allowed
 * values; mismatches and missing headers return 401 STATIC_AUTH_FAILED.
 *
 * Header name comparison uses Express's case-insensitive `req.header(...)`.
 */
export function staticAuthMiddleware(
  allowedValues: string[],
  headerName: string,
): RequestHandler {
  if (allowedValues.length === 0) {
    return (_req, _res, next) => next();
  }
  const set = new Set(allowedValues);
  return (req, _res, next) => {
    const got = req.header(headerName);
    if (!got || !set.has(got)) {
      return next(new ApiError(401, 'STATIC_AUTH_FAILED', 'Missing or invalid static auth header'));
    }
    next();
  };
}
