import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePkce, buildAuthorizeUrl, deviceCodeFlow, exchangeCode } from '../../src/core/backend/auth/oidc-client.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('oidc-client primitives', () => {
  it('generatePkce produces base64url verifier + S256 challenge', () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePkce();
    expect(codeChallengeMethod).toBe('S256');
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('buildAuthorizeUrl includes all required params', () => {
    const u = buildAuthorizeUrl({
      issuer: 'https://idp.example.com',
      clientId: 'cid',
      scopes: ['openid','role'],
      audience: 'aud',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'cc',
      state: 'st',
    });
    expect(u.toString()).toContain('https://idp.example.com/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234/cb');
    expect(u.searchParams.get('code_challenge')).toBe('cc');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid role');
    expect(u.searchParams.get('audience')).toBe('aud');
  });
});

describe('deviceCodeFlow', () => {
  it('happy path: device_code → poll → token', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/connect/deviceauthorization')) {
        return new Response(JSON.stringify({
          device_code: 'dc', user_code: 'UC', verification_uri: 'https://idp.example/device', interval: 0, expires_in: 300,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/connect/token')) {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const tokens = await deviceCodeFlow({
      issuer: 'https://idp.example.com', clientId: 'cid', scopes: ['openid','role'], audience: 'aud',
      onUserCode: () => undefined,  // suppress stdout for tests
    });
    expect(tokens.accessToken).toBe('a');
    expect(tokens.refreshToken).toBe('r');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});
