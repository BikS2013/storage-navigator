import { describe, it, expect, vi } from 'vitest';
import { FileService } from '../../src/azure/file-service.js';

vi.mock('@azure/storage-file-share', () => {
  const fileClient = {
    create: vi.fn().mockResolvedValue({}),
    uploadStream: vi.fn().mockResolvedValue({}),
    getProperties: vi.fn().mockResolvedValue({ etag: 'e', lastModified: new Date(), contentLength: 3, contentType: 'text/plain' }),
    deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
    rename: vi.fn().mockResolvedValue({}),
    download: vi.fn().mockResolvedValue({ readableStreamBody: null, contentLength: 3, contentType: 'text/plain' }),
  };
  const dirClient = {
    getFileClient: vi.fn(() => fileClient),
    createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
    listFilesAndDirectories: vi.fn(() => ({
      byPage: () => ({
        next: async () => ({ done: false, value: { segment: { fileItems: [{ name: 'a.txt', properties: { contentLength: 1 } }], directoryItems: [] }, continuationToken: null } }),
      }),
    })),
  };
  const shareClient = {
    getDirectoryClient: vi.fn(() => dirClient),
    createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
    deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
  };
  const svcClient = {
    getShareClient: vi.fn(() => shareClient),
    listShares: vi.fn(() => ({
      byPage: () => ({
        next: async () => ({ done: false, value: { shareItems: [{ name: 's1', properties: { quota: 5 } }], continuationToken: null } }),
      }),
    })),
  };
  return { ShareServiceClient: vi.fn(function () { return svcClient; }), ShareClient: vi.fn(), ShareDirectoryClient: vi.fn() };
});

describe('FileService — mocked SDK', () => {
  const svc = new FileService({} as never, () => 'https://fake');

  it('lists shares', async () => {
    const r = await svc.listShares('acct', { pageSize: 10 });
    expect(r.items.map((s) => s.name)).toEqual(['s1']);
  });

  it('creates a share', async () => {
    await expect(svc.createShare('acct', 's2', 5)).resolves.toBeUndefined();
  });

  it('lists dir', async () => {
    const r = await svc.listDir('acct', 's1', 'p', { pageSize: 10 });
    expect(r.items[0]).toEqual({ name: 'a.txt', isDirectory: false, size: 1 });
  });

  it('headFile returns metadata', async () => {
    const m = await svc.headFile('acct', 's1', 'p/a.txt');
    expect(m.contentType).toBe('text/plain');
    expect(m.contentLength).toBe(3);
  });
});
