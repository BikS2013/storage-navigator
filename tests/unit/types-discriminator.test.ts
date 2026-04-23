import { describe, it, expect } from 'vitest';
import type { StorageEntry, DirectStorageEntry, ApiBackendEntry } from '../../src/core/types.js';

describe('StorageEntry discriminator', () => {
  it('narrows to direct via kind', () => {
    const e: StorageEntry = {
      kind: 'direct',
      name: 'x',
      accountName: 'acct',
      accountKey: 'k',
      addedAt: new Date().toISOString(),
    };
    if (e.kind !== 'direct') throw new Error('discriminator');
    const d: DirectStorageEntry = e;
    expect(d.accountName).toBe('acct');
  });

  it('narrows to api via kind', () => {
    const e: StorageEntry = {
      kind: 'api',
      name: 'y',
      baseUrl: 'https://x.example.com',
      authEnabled: false,
      addedAt: new Date().toISOString(),
    };
    if (e.kind !== 'api') throw new Error('discriminator');
    const a: ApiBackendEntry = e;
    expect(a.baseUrl).toBe('https://x.example.com');
  });
});
