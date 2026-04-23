import { describe, it, expect } from 'vitest';
import { makeBackend } from '../../src/core/backend/factory.js';
import type { StorageEntry } from '../../src/core/types.js';

describe('makeBackend', () => {
  it('throws helpful error for unknown kind', () => {
    expect(() => makeBackend({ kind: 'wat' } as never as StorageEntry))
      .toThrow(/Unknown StorageEntry kind/);
  });

  it('returns an object exposing IStorageBackend method names for direct kind', () => {
    const b = makeBackend({
      kind: 'direct', name: 'd', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01',
    });
    expect(typeof b.listContainers).toBe('function');
    expect(typeof b.listShares).toBe('function');
  });

  it('returns an object exposing IStorageBackend method names for api kind', () => {
    const b = makeBackend({
      kind: 'api', name: 'x', baseUrl: 'https://x.example.com', authEnabled: false, addedAt: '2025-01-01',
    }, 'someacct');
    expect(typeof b.listContainers).toBe('function');
    expect(typeof b.listShares).toBe('function');
  });
});
