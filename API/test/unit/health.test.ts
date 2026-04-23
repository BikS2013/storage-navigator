import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });

describe('health endpoints', () => {
  it('GET /healthz returns 200', async () => {
    const app = buildApp({ config: cfg });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 when all readiness checks pass', async () => {
    const app = buildApp({
      config: cfg,
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
      readinessChecks: {
        jwks: async () => true,
        arm: async () => false,
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.checks.arm).toBe(false);
  });
});
