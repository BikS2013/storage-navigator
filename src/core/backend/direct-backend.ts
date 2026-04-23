import type { DirectStorageEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';

export class DirectBackend implements IStorageBackend {
  constructor(_entry: DirectStorageEntry) {}
  async listContainers() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async createContainer() { throw new Error('NotImplemented: T8'); }
  async deleteContainer() { throw new Error('NotImplemented: T8'); }
  async listBlobs() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async readBlob() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async headBlob() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async uploadBlob() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async deleteBlob() { throw new Error('NotImplemented: T8'); }
  async renameBlob() { throw new Error('NotImplemented: T8'); }
  async deleteFolder() { throw new Error('NotImplemented: T8'); return 0; }
  async listShares() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async createShare() { throw new Error('NotImplemented: T8'); }
  async deleteShare() { throw new Error('NotImplemented: T8'); }
  async listDir() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async readFile() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async headFile() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async uploadFile() { throw new Error('NotImplemented: T8'); return undefined as never; }
  async deleteFile() { throw new Error('NotImplemented: T8'); }
  async renameFile() { throw new Error('NotImplemented: T8'); }
  async deleteFileFolder() { throw new Error('NotImplemented: T8'); return 0; }
}
