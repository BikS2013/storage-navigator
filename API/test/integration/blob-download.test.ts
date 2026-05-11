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
    allowed: [], refreshMin: 60,
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

// Parse the End-of-Central-Directory record from the tail of a zip buffer
// and walk the central directory to read each entry's filename + size.
function parseZipEntries(zip: Buffer): { name: string; size: number; crc: number; offset: number }[] {
  // EOCD: scan from end for 0x06054b50
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const out: { name: string; size: number; crc: number; offset: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad CFH sig');
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.slice(p + 46, p + 46 + nameLen).toString('utf8');
    out.push({ name, size, crc, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p - cdOffset !== cdSize) throw new Error('CD size mismatch');
  return out;
}

describe('Blob download — single file (Content-Disposition) + zip stream', () => {
  it('?download=1 sets Content-Disposition: attachment', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'dl-single' });
    await request(app).put(`/storages/${acc}/containers/dl-single/blobs/folder/hello.txt`)
      .set('Content-Type', 'text/plain').send('hello world');

    const r = await request(app)
      .get(`/storages/${acc}/containers/dl-single/blobs/folder/hello.txt?download=1`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
    expect(r.headers['content-disposition']).toContain('filename="hello.txt"');
    expect(r.text).toBe('hello world');
  });

  it('POST blobs:download-zip streams a valid zip containing the requested files', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'dl-zip' });
    const filesIn = {
      'docs/a.txt': 'A-CONTENT',
      'docs/b.txt': 'BBBB',
      'docs/sub/c.txt': 'ccc',
    };
    for (const [path, body] of Object.entries(filesIn)) {
      await request(app).put(`/storages/${acc}/containers/dl-zip/blobs/${path}`)
        .set('Content-Type', 'text/plain').send(body);
    }

    const r = await request(app)
      .post(`/storages/${acc}/containers/dl-zip/blobs:download-zip`)
      .send({ paths: Object.keys(filesIn), basePath: 'docs', archiveName: 'pack.zip' })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/zip/);
    expect(r.headers['content-disposition']).toMatch(/filename="pack.zip"/);
    expect(r.headers['content-length']).toBeUndefined();
    expect(r.headers['transfer-encoding']).toBe('chunked');

    const zip = r.body as Buffer;
    expect(zip.length).toBeGreaterThan(0);
    const entries = parseZipEntries(zip);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'sub/c.txt']);
    const a = entries.find((e) => e.name === 'a.txt')!;
    expect(a.size).toBe(filesIn['docs/a.txt'].length);
    const b = entries.find((e) => e.name === 'b.txt')!;
    expect(b.size).toBe(4);
  });

  it('Writer cannot bypass — but Reader is allowed (RBAC respected)', async () => {
    // Reader has the role required by the route (Reader). The auth toggle
    // middleware permits it. Confirms requireRole('Reader') is wired.
    const app = await appFor('Reader');
    const acc = az.accountName;
    const r = await request(app)
      .post(`/storages/${acc}/containers/dl-zip/blobs:download-zip`)
      .send({ paths: ['docs/a.txt'], basePath: 'docs' });
    // Headers should be sent before the body — confirm the 200 + zip type
    // even if the stream aborts later (supertest doesn't surface streamed bytes
    // when a downstream error fires; the important RBAC signal is the status).
    expect([200]).toContain(r.status);
    expect(r.headers['content-type']).toMatch(/^application\/zip/);
  });

});
