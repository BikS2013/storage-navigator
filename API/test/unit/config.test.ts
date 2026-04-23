import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig — auth enabled', () => {
  const validEnv = {
    AUTH_ENABLED: 'true',
    OIDC_ISSUER: 'https://my.nbg.gr/identity',
    OIDC_AUDIENCE: 'storage-nav-api',
    OIDC_CLIENT_ID: 'cid',
    OIDC_SCOPES: 'openid,role,storage-nav-api',
    ROLE_MAP: '{"StorageReader":"Reader","StorageWriter":"Writer"}',
  };

  it('parses required vars', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.authEnabled).toBe(true);
    expect(cfg.port).toBe(3000);
    expect(cfg.oidc.mode).toBe('enabled');
    if (cfg.oidc.mode !== 'enabled') throw new Error('discriminator');
    expect(cfg.oidc.issuer).toBe('https://my.nbg.gr/identity');
    expect(cfg.oidc.audience).toBe('storage-nav-api');
    expect(cfg.oidc.scopes).toEqual(['openid', 'role', 'storage-nav-api']);
    expect(cfg.oidc.roleMap).toEqual({
      StorageReader: 'Reader',
      StorageWriter: 'Writer',
    });
  });

  it('throws on missing OIDC_ISSUER', () => {
    const env = { ...validEnv, OIDC_ISSUER: undefined };
    expect(() => loadConfig(env as any)).toThrow(/OIDC_ISSUER/);
  });

  it('throws on invalid ROLE_MAP value', () => {
    const env = { ...validEnv, ROLE_MAP: '{"X":"Bogus"}' };
    expect(() => loadConfig(env)).toThrow();
  });

  it('throws with friendly error when ROLE_MAP is malformed JSON', () => {
    const env = { ...validEnv, ROLE_MAP: 'not-json' };
    expect(() => loadConfig(env)).toThrow(/ROLE_MAP is not valid JSON/);
  });

  it('throws when OIDC_ISSUER is not a URL', () => {
    const env = { ...validEnv, OIDC_ISSUER: 'not-a-url' };
    expect(() => loadConfig(env)).toThrow();
  });

  it('honors PORT override', () => {
    const cfg = loadConfig({ ...validEnv, PORT: '4040' });
    expect(cfg.port).toBe(4040);
  });

  it('rejects negative PORT with named error', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '-1' }))
      .toThrow(/PORT must be a positive integer/);
  });

  it('accepts OIDC_CLOCK_TOLERANCE_SEC=0', () => {
    const cfg = loadConfig({ ...validEnv, OIDC_CLOCK_TOLERANCE_SEC: '0' });
    if (cfg.oidc.mode !== 'enabled') throw new Error('discriminator');
    expect(cfg.oidc.clockToleranceSec).toBe(0);
  });
});

describe('loadConfig — auth disabled', () => {
  it('parses ANON_ROLE', () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    expect(cfg.authEnabled).toBe(false);
    expect(cfg.oidc.mode).toBe('disabled');
    if (cfg.oidc.mode !== 'disabled') throw new Error('discriminator');
    expect(cfg.oidc.anonRole).toBe('Reader');
  });

  it('throws on missing ANON_ROLE when auth disabled', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'false' })).toThrow(/ANON_ROLE/);
  });

  it('throws on invalid ANON_ROLE', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'God' }))
      .toThrow();
  });

  it('throws when AUTH_ENABLED missing entirely', () => {
    expect(() => loadConfig({})).toThrow(/AUTH_ENABLED/);
  });

  it('rejects AUTH_ENABLED with a non-boolean value', () => {
    expect(() => loadConfig({ AUTH_ENABLED: '1' }))
      .toThrow(/AUTH_ENABLED must be 'true' or 'false'/);
    expect(() => loadConfig({ AUTH_ENABLED: 'yes', ANON_ROLE: 'Reader' }))
      .toThrow(/AUTH_ENABLED must be 'true' or 'false'/);
  });
});
