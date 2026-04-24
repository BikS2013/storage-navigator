import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { staticAuthMiddleware } from '../../src/auth/static-auth.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

function buildApp(values: string[], headerName = 'X-Storage-Nav-Auth') {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(staticAuthMiddleware(values, headerName));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware());
  return app;
}

describe('staticAuthMiddleware', () => {
  it('passes through when allowedValues is empty (gate disabled)', async () => {
    const r = await request(buildApp([])).get('/x');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('rejects 401 STATIC_AUTH_FAILED when header missing', async () => {
    const r = await request(buildApp(['secret'])).get('/x');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('STATIC_AUTH_FAILED');
  });

  it('rejects 401 when header value wrong', async () => {
    const r = await request(buildApp(['secret']))
      .get('/x').set('X-Storage-Nav-Auth', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('STATIC_AUTH_FAILED');
  });

  it('accepts when header value matches', async () => {
    const r = await request(buildApp(['secret']))
      .get('/x').set('X-Storage-Nav-Auth', 'secret');
    expect(r.status).toBe(200);
  });

  it('accepts any value in the comma-separated list (rotation)', async () => {
    const app = buildApp(['new', 'old']);
    const a = await request(app).get('/x').set('X-Storage-Nav-Auth', 'new');
    const b = await request(app).get('/x').set('X-Storage-Nav-Auth', 'old');
    const c = await request(app).get('/x').set('X-Storage-Nav-Auth', 'other');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(401);
  });

  it('honours configurable header name', async () => {
    const app = buildApp(['secret'], 'X-Api-Key');
    const ok = await request(app).get('/x').set('X-Api-Key', 'secret');
    const wrongHeader = await request(app).get('/x').set('X-Storage-Nav-Auth', 'secret');
    expect(ok.status).toBe(200);
    expect(wrongHeader.status).toBe(401);
  });
});
