import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { BlobService } from '../../src/azure/blob-service.js';
import { FileService } from '../../src/azure/file-service.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { startMockIdp, type MockIdp } from '../helpers/mock-idp.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import type { Config } from '../../src/config.js';
import { buildJwksGetter } from '../../src/auth/jwks-cache.js';
import { oidcMiddleware } from '../../src/auth/oidc-middleware.js';

let az: AzuriteHandle;
let idp: MockIdp;

beforeAll(async () => {
  az = await startAzurite();
  idp = await startMockIdp();
}, 30_000);
afterAll(async () => { await az.shutdown(); await idp.close(); });

describe('E2E — auth on', () => {
  it('rejects without token, accepts Reader, forbids Writer ops', async () => {
    const cfg: Config = {
      port: 0, logLevel: 'silent', authEnabled: true,
      oidc: {
        mode: 'enabled',
        issuer: idp.issuer,
        audience: 'storage-nav-api',
        clientId: 'cid',
        scopes: ['openid','role'],
        jwksCacheMin: 1,
        clockToleranceSec: 5,
        roleClaim: 'role',
        roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
      },
      azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
      pagination: { defaultPageSize: 200, maxPageSize: 1000 },
      uploads: { maxBytes: null, streamBlockSizeMb: 4 },
      swaggerUiEnabled: false,
      corsOrigins: [],
    };
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    // Custom authOverride that points at the mock IdP's JWKS (use cooldownMs=0 for test)
    const jwks = buildJwksGetter(idp.jwksUri, 1, 0);
    const auth = oidcMiddleware({
      jwks, issuer: idp.issuer, audience: 'storage-nav-api',
      clockToleranceSec: 5, roleClaim: 'role',
      roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
    });
    const app = buildApp({ config: cfg, discovery, blobService, fileService, authOverride: auth });

    const acc = az.accountName;

    // No token → 401
    expect((await request(app).get('/storages')).status).toBe(401);

    // Reader token → list works, write blocked
    const reader = await idp.signToken({ sub: 'u1', role: 'StorageReader' }, { audience: 'storage-nav-api' });
    expect((await request(app).get('/storages').set('Authorization', `Bearer ${reader}`)).status).toBe(200);
    // Use a 3+ char container name (Azurite minimum)
    expect((await request(app).post(`/storages/${acc}/containers`).set('Authorization', `Bearer ${reader}`).send({ name: 'e2e-on' })).status).toBe(403);

    // Writer round-trip
    const writer = await idp.signToken({ sub: 'u2', role: 'StorageWriter' }, { audience: 'storage-nav-api' });
    expect((await request(app).post(`/storages/${acc}/containers`).set('Authorization', `Bearer ${writer}`).send({ name: 'e2e-on' })).status).toBe(201);
    expect((await request(app).put(`/storages/${acc}/containers/e2e-on/blobs/x.txt`).set('Authorization', `Bearer ${writer}`).set('Content-Type', 'text/plain').send('ok')).status).toBe(201);

    // Reader can read but not delete
    expect((await request(app).get(`/storages/${acc}/containers/e2e-on/blobs/x.txt`).set('Authorization', `Bearer ${reader}`)).status).toBe(200);
    expect((await request(app).delete(`/storages/${acc}/containers/e2e-on/blobs/x.txt`).set('Authorization', `Bearer ${reader}`)).status).toBe(403);
  });
});
