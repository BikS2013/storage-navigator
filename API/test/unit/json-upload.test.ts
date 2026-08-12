// Regression test for the global express.json() body parser consuming the
// request stream on PUT uploads.
//
// The blob/file PUT handlers stream `req` straight into Azure. When
// express.json() ran for `Content-Type: application/json` it drained that
// stream first, so the upload never received any bytes and the request hung
// until the client timed out. This broke `.json` uploads over an api backend
// (storage-nav writes `.repo-links.json` as application/json).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import type { BlobService } from '../../src/azure/blob-service.js';
import type { FileService } from '../../src/azure/file-service.js';
import { disabledModeConfig, stubFileService } from '../helpers/test-app.js';

/** Drains the incoming stream so the test can assert what the route received. */
function recordingBlobService() {
  const received: { path: string; bytes: number; body: string }[] = [];
  const svc = {
    uploadBlob: vi.fn(async (_a: string, _c: string, path: string, body: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);
      received.push({ path, bytes: buf.byteLength, body: buf.toString('utf-8') });
      return { etag: '"e"', lastModified: new Date().toISOString() };
    }),
    createContainer: vi.fn(async () => undefined),
  } as unknown as BlobService;
  return { svc, received };
}

async function appWith(blobService: BlobService, fileService: FileService = stubFileService) {
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: 'a1', subscriptionId: 's', resourceGroup: 'r', blobEndpoint: '', fileEndpoint: '' }] },
    allowed: [],
    refreshMin: 60,
  });
  await discovery.refresh();
  return buildApp({
    config: disabledModeConfig('Admin'),
    authOverride: anonymousPrincipalMiddleware('Admin'),
    discovery,
    blobService,
    fileService,
  });
}

describe('PUT upload body is not consumed by the JSON parser', () => {
  it('streams an application/json blob upload through to the service', async () => {
    const { svc, received } = recordingBlobService();
    const app = await appWith(svc);
    const payload = JSON.stringify({ version: 1, links: [] });

    const res = await request(app)
      .put('/storages/a1/containers/c1/blobs/.repo-links.json')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(201);
    expect(received).toHaveLength(1);
    expect(received[0]!.bytes).toBe(Buffer.byteLength(payload, 'utf-8'));
    expect(received[0]!.body).toBe(payload);
  });

  it('preserves multi-byte UTF-8 bodies byte-for-byte', async () => {
    const { svc, received } = recordingBlobService();
    const app = await appWith(svc);
    const payload = JSON.stringify({ prefix: 'καλημέρα' });

    const res = await request(app)
      .put('/storages/a1/containers/c1/blobs/greek.json')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(201);
    expect(received[0]!.body).toBe(payload);
    expect(received[0]!.bytes).toBe(Buffer.byteLength(payload, 'utf-8'));
  });

  it('still streams non-JSON uploads', async () => {
    const { svc, received } = recordingBlobService();
    const app = await appWith(svc);

    const res = await request(app)
      .put('/storages/a1/containers/c1/blobs/plain.txt')
      .set('Content-Type', 'text/plain')
      .send('hello');

    expect(res.status).toBe(201);
    expect(received[0]!.body).toBe('hello');
  });

  it('still parses JSON bodies on POST routes', async () => {
    const { svc } = recordingBlobService();
    const app = await appWith(svc);

    const res = await request(app)
      .post('/storages/a1/containers')
      .set('Content-Type', 'application/json')
      .send({ name: 'brand-new' });

    expect(res.status).toBe(201);
    expect(svc.createContainer).toHaveBeenCalledWith('a1', 'brand-new');
  });
});
