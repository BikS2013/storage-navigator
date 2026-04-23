import { createHash, randomBytes } from 'node:crypto';
import type { TokenSet } from './token-store.js';

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export type PkcePair = { codeVerifier: string; codeChallenge: string; codeChallengeMethod: 'S256' };

export function generatePkce(): PkcePair {
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function buildAuthorizeUrl(opts: {
  issuer: string; clientId: string; scopes: string[]; audience: string;
  redirectUri: string; codeChallenge: string; state: string;
}): URL {
  const u = new URL(`${opts.issuer.replace(/\/$/, '')}/connect/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('scope', opts.scopes.join(' '));
  u.searchParams.set('audience', opts.audience);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', opts.state);
  return u;
}

export async function exchangeCode(opts: {
  issuer: string; clientId: string;
  code: string; redirectUri: string; codeVerifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(`${opts.issuer.replace(/\/$/, '')}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope,
    idToken: tok.id_token,
  };
}

export async function deviceCodeFlow(opts: {
  issuer: string; clientId: string; scopes: string[]; audience: string;
  onUserCode?: (info: { userCode: string; verificationUri: string }) => void;
}): Promise<TokenSet> {
  const issuer = opts.issuer.replace(/\/$/, '');
  // 1. Request device code
  const dcRes = await fetch(`${issuer}/connect/deviceauthorization`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId, scope: opts.scopes.join(' '), audience: opts.audience,
    }),
  });
  if (!dcRes.ok) throw new Error(`Device authorization failed ${dcRes.status}: ${await dcRes.text()}`);
  const dc = await dcRes.json() as { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
  (opts.onUserCode ?? defaultUserCodeReporter)({ userCode: dc.user_code, verificationUri: dc.verification_uri });

  // 2. Poll
  const intervalMs = Math.max(dc.interval, 0) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (Date.now() < deadline) {
    if (intervalMs > 0) await sleep(intervalMs);
    const res = await fetch(`${issuer}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dc.device_code,
        client_id: opts.clientId,
      }),
    });
    if (res.ok) {
      const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
      return {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
        scope: tok.scope,
        idToken: tok.id_token,
      };
    }
    const err = await res.json().catch(() => ({})) as { error?: string };
    if (err.error === 'authorization_pending' || err.error === 'slow_down') continue;
    throw new Error(`Device code polling failed: ${err.error ?? `HTTP ${res.status}`}`);
  }
  throw new Error('Device code authorization timed out.');
}

function defaultUserCodeReporter(info: { userCode: string; verificationUri: string }): void {
  // eslint-disable-next-line no-console
  console.log(`\nVisit ${info.verificationUri} and enter code: ${info.userCode}\n`);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
