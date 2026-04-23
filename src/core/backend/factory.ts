import type { StorageEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';
import { DirectBackend } from './direct-backend.js';
import { ApiBackend } from './api-backend.js';

export function makeBackend(entry: StorageEntry): IStorageBackend {
  if (entry.kind === 'direct') return new DirectBackend(entry);
  if (entry.kind === 'api') return new ApiBackend(entry);
  throw new Error(`Unknown StorageEntry kind: ${(entry as { kind?: string }).kind ?? 'undefined'}`);
}
