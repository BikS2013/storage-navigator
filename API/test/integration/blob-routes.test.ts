import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { BlobService } from '../../src/azure/blob-service.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { buildApp } from '../../src/app.js';
import { disabledModeConfig, stubFileService } from '../helpers/test-app.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

async function appFor(role: 'Reader' | 'Writer' | 'Admin') {
  const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
  const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
  const discovery = new AccountDiscovery({
    adapter: {
      list: async () => [{
        name: az.accountName,
        subscriptionId: 's',
        resourceGroup: 'r',
        blobEndpoint: az.blobUrl,
        fileEndpoint: az.blobUrl,
      }],
    },
    allowed: [],
    refreshMin: 60,
  });
  await discovery.refresh();
  return buildApp({
    config: disabledModeConfig(role),
    authOverride: anonymousPrincipalMiddleware(role),
    discovery,
    blobService,
    fileService: stubFileService,
  });
}

describe('Blob routes — RBAC + happy path', () => {
  it('Reader can list, cannot upload', async () => {
    const app = await appFor('Reader');
    const list = await request(app).get(`/storages/${az.accountName}/containers`);
    expect(list.status).toBe(200);
    const upload = await request(app)
      .put(`/storages/${az.accountName}/containers/x/blobs/y.txt`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(upload.status).toBe(403);
  });

  it('Writer round-trip: create container, upload, read, head, delete', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    let r = await request(app).post(`/storages/${acc}/containers`).send({ name: 'rt-blobs' });
    expect(r.status).toBe(201);
    r = await request(app).put(`/storages/${acc}/containers/rt-blobs/blobs/hello.txt`)
      .set('Content-Type', 'text/plain').send('hello');
    expect(r.status).toBe(201);
    r = await request(app).head(`/storages/${acc}/containers/rt-blobs/blobs/hello.txt`);
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe('5');
    r = await request(app).get(`/storages/${acc}/containers/rt-blobs/blobs/hello.txt`);
    expect(r.status).toBe(200);
    expect(r.text).toBe('hello');
    r = await request(app).delete(`/storages/${acc}/containers/rt-blobs/blobs/hello.txt`);
    expect(r.status).toBe(204);
  });

  it('Admin delete-folder requires confirm', async () => {
    const app = await appFor('Admin');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'df-folder' });
    await request(app).put(`/storages/${acc}/containers/df-folder/blobs/p/a.txt`).set('Content-Type', 'text/plain').send('x');
    await request(app).put(`/storages/${acc}/containers/df-folder/blobs/p/b.txt`).set('Content-Type', 'text/plain').send('x');

    let r = await request(app).delete(`/storages/${acc}/containers/df-folder/blobs?prefix=p/`);
    expect(r.status).toBe(400);
    r = await request(app).delete(`/storages/${acc}/containers/df-folder/blobs?prefix=p/&confirm=true`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(2);
  });
});
