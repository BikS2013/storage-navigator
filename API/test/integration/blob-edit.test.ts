import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { BlobService } from '../../src/azure/blob-service.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { disabledModeConfig, stubFileService } from '../helpers/test-app.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';

// PR #5 — text-file edit flow. Exercises the PUT contract used by the UI:
//   1. Read file, capture ETag.
//   2. PUT new body with If-Match: <etag> → 201 + new ETag.
//   3. Replay the same PUT with the stale ETag → 412 Precondition Failed.
//   4. Oversized payload → 413 Payload Too Large.

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

async function appFor(role: 'Reader' | 'Writer' | 'Admin', overrides?: Partial<Config>) {
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
    allowed: [], refreshMin: 60,
  });
  await discovery.refresh();
  const config: Config = { ...disabledModeConfig(role), ...overrides };
  return buildApp({
    config,
    authOverride: anonymousPrincipalMiddleware(role),
    discovery,
    blobService,
    fileService: stubFileService,
  });
}

describe('Blob PUT — edit flow (ETag / If-Match / size cap)', () => {
  it('read → edit → PUT with If-Match → re-read matches new body and ETag', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'edit-rt' });
    // NOTE on content-type: the API mounts express.json() globally, so a PUT
    // with Content-Type: application/json gets its body consumed by the
    // JSON parser before reaching the streaming upload handler. Use
    // text/plain (or any non-JSON CT) for these tests — that mirrors the
    // UI's edit flow, which sends bytes with the file's own content-type.
    let r = await request(app)
      .put(`/storages/${acc}/containers/edit-rt/blobs/config.txt`)
      .set('Content-Type', 'text/plain')
      .send('initial body');
    expect(r.status).toBe(201);
    const initialEtag = r.body.etag as string;
    expect(initialEtag).toBeTruthy();

    // Independent GET so we exercise the path the UI uses to capture the ETag.
    r = await request(app).get(`/storages/${acc}/containers/edit-rt/blobs/config.txt`);
    expect(r.status).toBe(200);
    expect(r.text).toBe('initial body');
    const readEtag = r.headers['etag'];
    expect(readEtag).toBeTruthy();

    // Edit: send a new body conditioned on the etag we just read.
    r = await request(app)
      .put(`/storages/${acc}/containers/edit-rt/blobs/config.txt`)
      .set('Content-Type', 'text/plain')
      .set('If-Match', readEtag)
      .send('edited body — saved through PUT');
    expect(r.status).toBe(201);
    const newEtag = r.body.etag as string;
    expect(newEtag).toBeTruthy();
    expect(newEtag).not.toBe(initialEtag);

    // Re-read and verify the new body landed.
    r = await request(app).get(`/storages/${acc}/containers/edit-rt/blobs/config.txt`);
    expect(r.status).toBe(200);
    expect(r.text).toBe('edited body — saved through PUT');
  });

  it('PUT with stale If-Match returns 412 Precondition Failed', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'edit-412' });
    let r = await request(app)
      .put(`/storages/${acc}/containers/edit-412/blobs/note.md`)
      .set('Content-Type', 'text/markdown')
      .send('# v1');
    expect(r.status).toBe(201);
    const staleEtag = r.headers['etag'] || (r.body.etag as string);
    expect(staleEtag).toBeTruthy();

    // Some other writer updates the file → ETag rotates.
    r = await request(app)
      .put(`/storages/${acc}/containers/edit-412/blobs/note.md`)
      .set('Content-Type', 'text/markdown')
      .send('# v2 (concurrent writer)');
    expect(r.status).toBe(201);

    // The original editor tries to commit with the now-stale ETag.
    r = await request(app)
      .put(`/storages/${acc}/containers/edit-412/blobs/note.md`)
      .set('Content-Type', 'text/markdown')
      .set('If-Match', staleEtag)
      .send('# v2 (my edit — should fail)');
    expect(r.status).toBe(412);
    expect(r.body?.error?.code).toBe('PRECONDITION_FAILED');

    // Confirm the concurrent writer's content is still in place.
    r = await request(app).get(`/storages/${acc}/containers/edit-412/blobs/note.md`);
    expect(r.text).toBe('# v2 (concurrent writer)');
  });

  it('PUT body larger than uploads.maxBytes returns 413 Payload Too Large', async () => {
    const app = await appFor('Writer', {
      uploads: { maxBytes: 64, streamBlockSizeMb: 8 },
    });
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'edit-413' });

    const oversized = 'x'.repeat(128);
    const r = await request(app)
      .put(`/storages/${acc}/containers/edit-413/blobs/big.txt`)
      .set('Content-Type', 'text/plain')
      .send(oversized);
    expect(r.status).toBe(413);
    expect(r.body?.error?.code).toBe('PAYLOAD_TOO_LARGE');

    // Right at the cap should still go through.
    const exact = 'y'.repeat(64);
    const ok = await request(app)
      .put(`/storages/${acc}/containers/edit-413/blobs/ok.txt`)
      .set('Content-Type', 'text/plain')
      .send(exact);
    expect(ok.status).toBe(201);
  });
});
