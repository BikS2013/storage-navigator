import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sharesRouter } from '../../src/routes/shares.js';
import { filesRouter } from '../../src/routes/files.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';
import { disabledModeConfig } from '../helpers/test-app.js';

function buildAppWith(role: 'Reader' | 'Writer' | 'Admin') {
  const cfg = disabledModeConfig(role);
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: 'a1', subscriptionId: 's', resourceGroup: 'r', blobEndpoint: '', fileEndpoint: '' }] },
    allowed: [], refreshMin: 60,
  });
  return discovery.refresh().then(() => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware(role));
    const fileSvc = {
      listShares: vi.fn().mockResolvedValue({ items: [{ name: 's1' }], continuationToken: null }),
      createShare: vi.fn().mockResolvedValue(undefined),
      deleteShare: vi.fn().mockResolvedValue(undefined),
      listDir: vi.fn().mockResolvedValue({ items: [], continuationToken: null }),
      readFile: vi.fn(), headFile: vi.fn(), uploadFile: vi.fn(), deleteFile: vi.fn(), renameFile: vi.fn(), deleteFolder: vi.fn().mockResolvedValue(0),
    } as never;
    app.use(sharesRouter(fileSvc, discovery, cfg));
    app.use(filesRouter(fileSvc, discovery, cfg));
    app.use(errorMiddleware());
    return app;
  });
}

describe('Share + file routes RBAC', () => {
  it('Reader can list shares, cannot create', async () => {
    const app = await buildAppWith('Reader');
    expect((await request(app).get('/storages/a1/shares')).status).toBe(200);
    expect((await request(app).post('/storages/a1/shares').send({ name: 's2' })).status).toBe(403);
  });

  it('Writer can create, cannot delete share', async () => {
    const app = await buildAppWith('Writer');
    expect((await request(app).post('/storages/a1/shares').send({ name: 's2' })).status).toBe(201);
    expect((await request(app).delete('/storages/a1/shares/s1')).status).toBe(403);
  });

  it('Admin can delete', async () => {
    const app = await buildAppWith('Admin');
    expect((await request(app).delete('/storages/a1/shares/s1')).status).toBe(204);
  });

  it('delete-folder requires confirm', async () => {
    const app = await buildAppWith('Admin');
    expect((await request(app).delete('/storages/a1/shares/s1/files?path=x/')).status).toBe(400);
    expect((await request(app).delete('/storages/a1/shares/s1/files?path=x/&confirm=true')).status).toBe(200);
  });
});
