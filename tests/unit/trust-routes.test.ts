import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-trust-rt-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

async function buildApp() {
  const { CredentialStore } = await import('../../src/core/credential-store.js');
  const store = new CredentialStore();
  store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
  const { registerSiteRoutes } = await import('../../src/electron/site-routes.js');
  const app = express();
  app.use(express.json());
  registerSiteRoutes(app);
  return app;
}

describe('GET/PUT /api/trust', () => {
  it('GET returns trusted=false by default for an unknown container', async () => {
    const app = await buildApp();
    const r = await request(app).get('/api/trust/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ trusted: false });
  });

  it('PUT { trusted: true } persists; subsequent GET sees true', async () => {
    const app = await buildApp();
    const put = await request(app).put('/api/trust/s1/c1').send({ trusted: true });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ trusted: true });
    const get = await request(app).get('/api/trust/s1/c1');
    expect(get.body.trusted).toBe(true);
  });

  it('PUT validates the body', async () => {
    const app = await buildApp();
    const r = await request(app).put('/api/trust/s1/c1').send({ trusted: 'yes' });
    expect(r.status).toBe(400);
  });

  it('PUT 404s on unknown storage', async () => {
    const app = await buildApp();
    const r = await request(app).put('/api/trust/nope/c1').send({ trusted: true });
    expect(r.status).toBe(404);
  });

  it('share endpoint is independent from container endpoint', async () => {
    const app = await buildApp();
    await request(app).put('/api/trust/s1/shared-name').send({ trusted: true });
    const container = await request(app).get('/api/trust/s1/shared-name');
    expect(container.body.trusted).toBe(true);
    const share = await request(app).get('/api/trust-file/s1/shared-name');
    expect(share.body.trusted).toBe(false);
  });
});
