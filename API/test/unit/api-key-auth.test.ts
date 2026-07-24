import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiKeyAuthMiddleware } from '../../src/auth/api-key-auth.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';
import type { AppRole } from '../../src/auth/role-mapper.js';

function buildApp(keyMap: Record<string, AppRole>, headerName = 'X-API-Key') {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(apiKeyAuthMiddleware(keyMap, headerName));
  app.get('/x', (req, res) =>
    res.json({
      hasPrincipal: !!req.principal,
      sub: req.principal?.sub ?? null,
      roles: req.principal ? [...req.principal.roles] : null,
    }),
  );
  app.use(errorMiddleware());
  return app;
}

describe('apiKeyAuthMiddleware', () => {
  it('passes through without a principal when keyMap is empty (disabled)', async () => {
    const r = await request(buildApp({})).get('/x').set('X-API-Key', 'anything');
    expect(r.status).toBe(200);
    expect(r.body.hasPrincipal).toBe(false);
  });

  it('falls through (no principal) when header absent, letting OIDC/anon run next', async () => {
    const r = await request(buildApp({ 'key-abc': 'Reader' })).get('/x');
    expect(r.status).toBe(200);
    expect(r.body.hasPrincipal).toBe(false);
  });

  it('sets principal with the mapped role when a valid key is presented', async () => {
    const r = await request(buildApp({ 'key-abc': 'Reader', 'key-xyz': 'Admin' }))
      .get('/x')
      .set('X-API-Key', 'key-xyz');
    expect(r.status).toBe(200);
    expect(r.body.hasPrincipal).toBe(true);
    expect(r.body.roles).toEqual(['Admin']);
  });

  it('rejects 401 when a key is presented but not in the map', async () => {
    const r = await request(buildApp({ 'key-abc': 'Reader' }))
      .get('/x')
      .set('X-API-Key', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('API_KEY_FAILED');
  });

  it('does not leak the key value in the principal sub', async () => {
    const r = await request(buildApp({ 'super-secret-key': 'Writer' }))
      .get('/x')
      .set('X-API-Key', 'super-secret-key');
    expect(r.body.sub).not.toContain('super-secret-key');
  });

  it('honours a configurable header name', async () => {
    const app = buildApp({ 'key-abc': 'Reader' }, 'X-Custom-Key');
    const ok = await request(app).get('/x').set('X-Custom-Key', 'key-abc');
    const wrongHeader = await request(app).get('/x').set('X-API-Key', 'key-abc');
    expect(ok.body.roles).toEqual(['Reader']);
    expect(wrongHeader.body.hasPrincipal).toBe(false);
  });
});
