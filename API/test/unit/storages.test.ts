import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { storagesRouter } from '../../src/routes/storages.js';
import { AccountDiscovery, type DiscoveredAccount } from '../../src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

const fixture: DiscoveredAccount[] = [
  { name: 'acct1', subscriptionId: 's1', resourceGroup: 'rg', blobEndpoint: 'https://acct1.blob.core.windows.net', fileEndpoint: 'https://acct1.file.core.windows.net' },
  { name: 'acct2', subscriptionId: 's1', resourceGroup: 'rg', blobEndpoint: 'https://acct2.blob.core.windows.net', fileEndpoint: 'https://acct2.file.core.windows.net' },
];

describe('GET /storages', () => {
  it('returns discovered accounts as Reader', async () => {
    const discovery = new AccountDiscovery({
      adapter: { list: async () => fixture },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = express();
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware('Reader'));
    app.use(storagesRouter(discovery));
    app.use(errorMiddleware());

    const res = await request(app).get('/storages');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { name: 'acct1', blobEndpoint: 'https://acct1.blob.core.windows.net', fileEndpoint: 'https://acct1.file.core.windows.net' },
        { name: 'acct2', blobEndpoint: 'https://acct2.blob.core.windows.net', fileEndpoint: 'https://acct2.file.core.windows.net' },
      ],
      continuationToken: null,
    });
  });
});
