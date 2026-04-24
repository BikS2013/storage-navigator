import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { BlobService } from '../../src/azure/blob-service.js';
import { FileService } from '../../src/azure/file-service.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { disabledModeConfig } from '../helpers/test-app.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';

let az: AzuriteHandle;
beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

describe('E2E — auth off', () => {
  it('Reader anon: list works, PUT forbidden', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = buildApp({
      config: disabledModeConfig('Reader'),
      authOverride: anonymousPrincipalMiddleware('Reader'),
      discovery, blobService, fileService,
    });
    expect((await request(app).get('/storages')).status).toBe(200);
    // Container name 3+ chars (Azurite minimum)
    expect((await request(app).put(`/storages/${az.accountName}/containers/e2e-off/blobs/y.txt`).set('Content-Type', 'text/plain').send('z')).status).toBe(403);
  });

  it('Admin anon: full access', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = buildApp({
      config: disabledModeConfig('Admin'),
      authOverride: anonymousPrincipalMiddleware('Admin'),
      discovery, blobService, fileService,
    });
    const acc = az.accountName;
    expect((await request(app).post(`/storages/${acc}/containers`).send({ name: 'e2e-anon' })).status).toBe(201);
    expect((await request(app).delete(`/storages/${acc}/containers/e2e-anon`)).status).toBe(204);
  });
});
