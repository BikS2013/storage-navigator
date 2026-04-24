import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshTokens, _resetInflight } from '../../src/core/backend/auth/token-refresh.js';
import type { TokenSet } from '../../src/core/backend/auth/token-store.js';

// refreshTokens persists to disk via TokenStore. Point it at a tmp dir so the
// test never touches the developer's real ~/.storage-navigator/.
let tmp: string;
beforeEach(() => {
  vi.restoreAllMocks();
  _resetInflight();
  tmp = mkdtempSync(join(tmpdir(), 'sn-tref-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});
afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe('refreshTokens', () => {
  it('exchanges refresh_token for new access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: 'openid',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const old: TokenSet = { accessToken: 'a1', refreshToken: 'r1', expiresAt: 0 };
    const fresh = await refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old);
    expect(fresh.accessToken).toBe('a2');
    expect(fresh.refreshToken).toBe('r2');
  });

  it('dedups concurrent refreshes', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'a', refresh_token: 'r', expires_in: 60,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const old: TokenSet = { accessToken: 'a1', refreshToken: 'r1', expiresAt: 0 };
    const [r1, r2] = await Promise.all([
      refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old),
      refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });
});
