import { describe, it, expect, vi } from 'vitest';

// Mock BOTH client modules before importing DirectBackend.
// Vitest v4 requires `function` (or `class`) for constructor mocks — see
// https://vitest.dev/api/vi#vi-spyon. Arrow-function `mockImplementation`
// values are not new-callable.
vi.mock('../../src/core/blob-client.js', () => ({
  BlobClient: vi.fn().mockImplementation(function (this: object) {
    Object.assign(this, {
      listContainers: vi.fn().mockResolvedValue([{ name: 'c1' }, { name: 'c2' }]),
      listBlobs: vi.fn().mockResolvedValue([{ name: 'b1', isPrefix: false, size: 10 }]),
      viewBlob: vi.fn(),
      createContainer: vi.fn(),
    });
  }),
}));

vi.mock('../../src/core/file-share-client.js', () => ({
  FileShareClient: vi.fn().mockImplementation(function (this: object) {
    Object.assign(this, {
      listShares: vi.fn().mockResolvedValue({ items: [{ name: 's1' }], continuationToken: null }),
      listDir: vi.fn().mockResolvedValue({ items: [{ name: 'a.txt', isDirectory: false, size: 5 }], continuationToken: null }),
    });
  }),
}));

import { DirectBackend } from '../../src/core/backend/direct-backend.js';
import type { DirectStorageEntry } from '../../src/core/types.js';

const entry: DirectStorageEntry = {
  kind: 'direct', name: 'd', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01',
};

describe('DirectBackend', () => {
  it('listContainers proxies to BlobClient and returns Page shape', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listContainers();
    expect(r.items.map((c) => c.name)).toEqual(['c1', 'c2']);
    expect(r.continuationToken).toBeNull();
  });

  it('listShares proxies to FileShareClient', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listShares();
    expect(r.items.map((s) => s.name)).toEqual(['s1']);
  });

  it('listDir proxies to FileShareClient with share + path', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listDir('s1', 'sub');
    expect(r.items[0].name).toBe('a.txt');
  });
});
