import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

describe('azurite smoke', () => {
  it('can create and list a container', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const svc = new BlobServiceClient(az.blobUrl, cred);
    await svc.getContainerClient('smoke').createIfNotExists();
    const names: string[] = [];
    for await (const c of svc.listContainers()) names.push(c.name);
    expect(names).toContain('smoke');
  });
});
