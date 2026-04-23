import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { stubBlobService, stubFileService } from '../helpers/test-app.js';

describe('openapi route', () => {
  it('serves /openapi.yaml', async () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    const discovery = new AccountDiscovery({ adapter: { list: async () => [] }, allowed: [], refreshMin: 60 });
    await discovery.refresh();
    const app = buildApp({
      config: cfg, discovery,
      blobService: stubBlobService,
      fileService: stubFileService,
    });
    const res = await request(app).get('/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('openapi: 3.1.0');
  });
});
