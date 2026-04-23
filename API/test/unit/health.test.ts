import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { stubBlobService, stubFileService } from '../helpers/test-app.js';

const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
const stubDiscovery = new AccountDiscovery({
  adapter: { list: async () => [] },
  allowed: [],
  refreshMin: 60,
});
await stubDiscovery.refresh();

describe('health endpoints', () => {
  it('GET /healthz returns 200', async () => {
    const app = buildApp({ config: cfg, discovery: stubDiscovery, blobService: stubBlobService, fileService: stubFileService });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 when all readiness checks pass', async () => {
    const app = buildApp({
      config: cfg,
      discovery: stubDiscovery,
      blobService: stubBlobService,
      fileService: stubFileService,
      readinessChecks: {
        jwks: async () => true,
        arm: async () => true,
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /readyz returns 503 when a check fails', async () => {
    const app = buildApp({
      config: cfg,
      discovery: stubDiscovery,
      blobService: stubBlobService,
      fileService: stubFileService,
      readinessChecks: {
        jwks: async () => true,
        arm: async () => false,
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: { jwks: true, arm: false },
    });
  });

  it('GET /readyz reports false for a check that throws', async () => {
    const app = buildApp({
      config: cfg,
      discovery: stubDiscovery,
      blobService: stubBlobService,
      fileService: stubFileService,
      readinessChecks: {
        arm: async () => {
          throw new Error('arm probe boom');
        },
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.checks.arm).toBe(false);
  });
});
