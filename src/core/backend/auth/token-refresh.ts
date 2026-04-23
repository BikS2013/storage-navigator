import type { TokenSet } from './token-store.js';
import { TokenStore } from './token-store.js';

const inflight = new Map<string, Promise<TokenSet>>();

export function _resetInflight(): void { inflight.clear(); }

export async function refreshTokens(
  apiName: string,
  oidc: { issuer: string; clientId: string },
  old: TokenSet,
): Promise<TokenSet> {
  const existing = inflight.get(apiName);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`${oidc.issuer.replace(/\/$/, '')}/connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: old.refreshToken,
          client_id: oidc.clientId,
        }),
      });
      if (!res.ok) throw new Error(`Refresh failed ${res.status}: ${await res.text()}`);
      const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
      const fresh: TokenSet = {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? old.refreshToken,
        expiresAt: Date.now() + tok.expires_in * 1000,
        scope: tok.scope ?? old.scope,
        idToken: tok.id_token ?? old.idToken,
      };
      await new TokenStore().save(apiName, fresh);
      return fresh;
    } finally {
      inflight.delete(apiName);
    }
  })();

  inflight.set(apiName, promise);
  return promise;
}
