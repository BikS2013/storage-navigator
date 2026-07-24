import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';
import type { AppRole } from './role-mapper.js';

/**
 * API-key -> role gate. Runs before OIDC/anon. Behaviour:
 *   - keyMap empty            -> pass-through, no principal (gate disabled).
 *   - header absent           -> pass-through, no principal (OIDC/anon runs next).
 *   - header present + known  -> set principal with the mapped role.
 *   - header present + unknown -> 401 API_KEY_FAILED.
 *
 * The principal `sub` is a stable synthetic id (`apikey:<role>`), never the
 * key value, so keys cannot leak through logs that emit `principal.sub`.
 */
export function apiKeyAuthMiddleware(
  keyMap: Record<string, AppRole>,
  headerName: string,
): RequestHandler {
  const entries = Object.entries(keyMap);
  if (entries.length === 0) {
    return (_req, _res, next) => next();
  }
  const lookup = new Map<string, AppRole>(entries);
  return (req, _res, next) => {
    const got = req.header(headerName);
    if (!got) return next();
    const role = lookup.get(got);
    if (!role) {
      return next(new ApiError(401, 'API_KEY_FAILED', 'Invalid API key'));
    }
    req.principal = {
      sub: `apikey:${role}`,
      roles: new Set<AppRole>([role]),
      raw: { sub: `apikey:${role}` },
    };
    next();
  };
}
