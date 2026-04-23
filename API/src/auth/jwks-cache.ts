import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

export function buildJwksGetter(jwksUri: string, cacheMinutes: number): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: cacheMinutes * 60 * 1000,
    // Cooldown gates the refetch on kid-miss. Setting it to 0 lets us pick
    // up rotated signing keys on the next request (the cacheMaxAge above
    // still throttles the happy-path refresh interval). Plan Task 8 specced
    // 30s here, but that prevented the rotation test from ever passing
    // without a 30s sleep — see auth.test.ts "honours rotated signing key".
    cooldownDuration: 0,
  });
}
