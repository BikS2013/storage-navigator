import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

/**
 * Build a remote JWKS getter cached locally.
 *
 * `cooldownMs` controls how long jose waits before re-fetching JWKS after a
 * `kid` miss. Default = 30s (jose default + spec). Tests pass 0 to exercise
 * key rotation without sleeping. Setting it to 0 in production would let
 * spoofed `kid` values force one outbound JWKS round-trip per request and
 * amplify bad-actor traffic toward the IdP — keep the default unless you have
 * a specific reason.
 */
export function buildJwksGetter(
  jwksUri: string,
  cacheMinutes: number,
  cooldownMs = 30_000,
): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: cacheMinutes * 60 * 1000,
    cooldownDuration: cooldownMs,
  });
}
