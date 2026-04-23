import type { StorageEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';
import { DirectBackend } from './direct-backend.js';
import { ApiBackend } from './api-backend.js';

export function makeBackend(entry: StorageEntry, accountName?: string): IStorageBackend {
  if (entry.kind === 'direct') return new DirectBackend(entry);
  if (entry.kind === 'api') {
    if (!accountName) throw new Error('makeBackend(api): accountName is required');
    return new ApiBackend(entry, accountName);
  }
  throw new Error(`Unknown StorageEntry kind: ${(entry as { kind?: string }).kind ?? 'undefined'}`);
}
