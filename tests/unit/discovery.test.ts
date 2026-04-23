import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDiscovery } from '../../src/core/backend/auth/discovery.js';

const ok = (body: object) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeEach(() => { vi.restoreAllMocks(); });

describe('fetchDiscovery', () => {
  it('returns enabled config when the API reports auth on', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({
      authEnabled: true,
      issuer: 'https://my.nbg.gr/identity',
      clientId: 'cid',
      audience: 'aud',
      scopes: ['openid','role'],
    })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.authEnabled).toBe(true);
    if (!d.authEnabled) throw new Error('discriminator');
    expect(d.issuer).toBe('https://my.nbg.gr/identity');
    expect(d.scopes).toEqual(['openid','role']);
  });

  it('returns disabled config', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ authEnabled: false })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.authEnabled).toBe(false);
  });

  it('throws on missing required fields when authEnabled', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ authEnabled: true })));
    await expect(fetchDiscovery('https://x.example.com')).rejects.toThrow(/missing/);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))));
    await expect(fetchDiscovery('https://x.example.com')).rejects.toThrow(/503/);
  });
});
