import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { BlobService } from '../../src/azure/blob-service.js';
import { FileService } from '../../src/azure/file-service.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { disabledModeConfig } from '../helpers/test-app.js';

let az: AzuriteHandle;
beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

function wire(apiKeys: Record<string, 'Reader' | 'Writer' | 'Admin'>) {
  const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
  const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
  const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
    allowed: [], refreshMin: 60,
  });
  const config = { ...disabledModeConfig('Reader'), apiKeys: { map: apiKeys, headerName: 'X-API-Key' } };
  return { discovery, config, blobService, fileService };
}

describe('E2E — API-key auth', () => {
  it('Reader key: list works, container create forbidden', async () => {
    const { discovery, config, blobService, fileService } = wire({ 'reader-key': 'Reader', 'admin-key': 'Admin' });
    await discovery.refresh();
    const app = buildApp({ config, discovery, blobService, fileService });
    const acc = az.accountName;
    expect((await request(app).get('/storages').set('X-API-Key', 'reader-key')).status).toBe(200);
    expect((await request(app).post(`/storages/${acc}/containers`).set('X-API-Key', 'reader-key').send({ name: 'e2e-key-r' })).status).toBe(403);
  });

  it('Admin key: full access', async () => {
    const { discovery, config, blobService, fileService } = wire({ 'admin-key': 'Admin' });
    await discovery.refresh();
    const app = buildApp({ config, discovery, blobService, fileService });
    const acc = az.accountName;
    expect((await request(app).post(`/storages/${acc}/containers`).set('X-API-Key', 'admin-key').send({ name: 'e2e-key-a' })).status).toBe(201);
    expect((await request(app).delete(`/storages/${acc}/containers/e2e-key-a`).set('X-API-Key', 'admin-key')).status).toBe(204);
  });

  it('unknown key: rejected 401 API_KEY_FAILED', async () => {
    const { discovery, config, blobService, fileService } = wire({ 'admin-key': 'Admin' });
    await discovery.refresh();
    const app = buildApp({ config, discovery, blobService, fileService });
    const r = await request(app).get('/storages').set('X-API-Key', 'bogus');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('API_KEY_FAILED');
  });

  it('no key falls through to anon (disabled auth = Reader)', async () => {
    const { discovery, config, blobService, fileService } = wire({ 'admin-key': 'Admin' });
    await discovery.refresh();
    const app = buildApp({ config, discovery, blobService, fileService });
    // anon disabled-mode role from disabledModeConfig('Reader') applies
    expect((await request(app).get('/storages')).status).toBe(200);
  });
});
