import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Readable } from 'node:stream';
import { BlobService } from '../../src/azure/blob-service.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

function svc() {
  // For Azurite we use shared-key auth; in production this is MI/TokenCredential.
  // We adapt by passing a fake "token credential" — actually wrap the shared key.
  const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
  // BlobService is typed against TokenCredential, but @azure/storage-blob's
  // BlobServiceClient accepts SharedKey too. We construct a service that hands
  // back the same credential:
  return new BlobService(cred as unknown as never, () => az.blobUrl);
}

describe('BlobService — integration', () => {
  it('creates, lists, deletes containers', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tcon');
    const list = await s.listContainers(az.accountName, { pageSize: 100 });
    expect(list.items.map((c) => c.name)).toContain('tcon');
    await s.deleteContainer(az.accountName, 'tcon');
  });

  it('uploads, reads, lists, deletes a blob', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tblob');
    const body = 'hello world';
    await s.uploadBlob(
      az.accountName, 'tblob', 'greeting.txt',
      Readable.from(Buffer.from(body)), 'text/plain', { blockSizeMb: 4 },
    );

    const head = await s.headBlob(az.accountName, 'tblob', 'greeting.txt');
    expect(head.contentLength).toBe(body.length);
    expect(head.contentType).toBe('text/plain');

    const r = await s.readBlob(az.accountName, 'tblob', 'greeting.txt');
    let data = '';
    for await (const chunk of r.stream) data += chunk.toString();
    expect(data).toBe(body);

    const ls = await s.listBlobs(az.accountName, 'tblob', { pageSize: 100 });
    expect(ls.items.find((i) => i.name === 'greeting.txt')).toBeTruthy();

    await s.deleteBlob(az.accountName, 'tblob', 'greeting.txt');
    await expect(s.deleteBlob(az.accountName, 'tblob', 'greeting.txt'))
      .rejects.toMatchObject({ status: 404 });

    await s.deleteContainer(az.accountName, 'tblob');
  });

  it('renames a blob', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'trename');
    await s.uploadBlob(az.accountName, 'trename', 'a.txt', Readable.from(Buffer.from('x')), 'text/plain', { blockSizeMb: 4 });
    await s.renameBlob(az.accountName, 'trename', 'a.txt', 'b.txt');
    const head = await s.headBlob(az.accountName, 'trename', 'b.txt');
    expect(head.contentLength).toBe(1);
    await expect(s.headBlob(az.accountName, 'trename', 'a.txt')).rejects.toMatchObject({ status: 404 });
    await s.deleteContainer(az.accountName, 'trename');
  });

  it('delete-folder removes everything under a prefix', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tfold');
    for (const name of ['p/a.txt', 'p/b.txt', 'q/c.txt']) {
      await s.uploadBlob(az.accountName, 'tfold', name, Readable.from(Buffer.from('x')), 'text/plain', { blockSizeMb: 4 });
    }
    const n = await s.deleteFolder(az.accountName, 'tfold', 'p/');
    expect(n).toBe(2);
    const ls = await s.listBlobs(az.accountName, 'tfold', { pageSize: 100 });
    expect(ls.items.map((i) => i.name).sort()).toEqual(['q/c.txt']);
    await s.deleteContainer(az.accountName, 'tfold');
  });
});
