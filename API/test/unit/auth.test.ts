import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { startMockIdp, type MockIdp } from '../helpers/mock-idp.js';
import { buildJwksGetter } from '../../src/auth/jwks-cache.js';
import { oidcMiddleware } from '../../src/auth/oidc-middleware.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { requireRole } from '../../src/rbac/enforce.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

let idp: MockIdp;

beforeAll(async () => { idp = await startMockIdp(); });
afterAll(async () => { await idp.close(); });

function buildAuthenticatedApp() {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(
    oidcMiddleware({
      jwks: buildJwksGetter(idp.jwksUri, 10),
      issuer: idp.issuer,
      audience: 'storage-nav-api',
      clockToleranceSec: 5,
      roleClaim: 'role',
      roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
    })
  );
  app.get('/r', requireRole('Reader'), (req, res) => res.json({ sub: req.principal!.sub }));
  app.get('/w', requireRole('Writer'), (_req, res) => res.json({ ok: true }));
  app.get('/a', requireRole('Admin'), (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware());
  return app;
}

describe('OIDC middleware + RBAC', () => {
  let app: express.Express;
  beforeAll(() => { app = buildAuthenticatedApp(); });

  it('401 when missing token', async () => {
    const res = await request(app).get('/r');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 when wrong audience', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'other-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('401 when expired', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api', expiresInSec: -10 }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('200 when Reader role mapped from claim', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe('alice');
  });

  it('403 when Reader hits Writer-only route', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/w').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin satisfies any required role', async () => {
    const token = await idp.signToken(
      { sub: 'admin', role: ['StorageAdmin'] },
      { audience: 'storage-nav-api' }
    );
    const reader = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    const writer = await request(app).get('/w').set('Authorization', `Bearer ${token}`);
    const admin = await request(app).get('/a').set('Authorization', `Bearer ${token}`);
    expect(reader.status).toBe(200);
    expect(writer.status).toBe(200);
    expect(admin.status).toBe(200);
  });

  it('honours rotated signing key on next request after JWKS cache cooldown', async () => {
    await idp.rotate();
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('anonymousPrincipalMiddleware', () => {
  it('grants the configured anon role', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware('Reader'));
    app.get('/r', requireRole('Reader'), (_req, res) => res.json({ ok: true }));
    app.get('/w', requireRole('Writer'), (_req, res) => res.json({ ok: true }));
    app.use(errorMiddleware());
    const r = await request(app).get('/r');
    const w = await request(app).get('/w');
    expect(r.status).toBe(200);
    expect(w.status).toBe(403);
  });
});
