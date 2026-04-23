import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';

const stubDiscovery = new AccountDiscovery({
  adapter: { list: async () => [] },
  allowed: [],
  refreshMin: 60,
});
await stubDiscovery.refresh();

describe('GET /.well-known/storage-nav-config', () => {
  it('returns config when auth enabled', async () => {
    const cfg = loadConfig({
      AUTH_ENABLED: 'true',
      OIDC_ISSUER: 'https://my.nbg.gr/identity',
      OIDC_AUDIENCE: 'storage-nav-api',
      OIDC_CLIENT_ID: 'cid',
      OIDC_SCOPES: 'openid,role',
      ROLE_MAP: '{"Foo":"Reader"}',
    });
    const app = buildApp({ config: cfg, discovery: stubDiscovery });
    const res = await request(app).get('/.well-known/storage-nav-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authEnabled: true,
      issuer: 'https://my.nbg.gr/identity',
      clientId: 'cid',
      audience: 'storage-nav-api',
      scopes: ['openid', 'role'],
    });
  });

  it('returns minimal config when auth disabled', async () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    const app = buildApp({ config: cfg, discovery: stubDiscovery });
    const res = await request(app).get('/.well-known/storage-nav-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authEnabled: false });
  });
});
