import type { ApiBackendEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';

export class ApiBackend implements IStorageBackend {
  constructor(_entry: ApiBackendEntry) {}
  async listContainers() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async createContainer() { throw new Error('NotImplemented: T13'); }
  async deleteContainer() { throw new Error('NotImplemented: T13'); }
  async listBlobs() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async readBlob() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async headBlob() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async uploadBlob() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async deleteBlob() { throw new Error('NotImplemented: T13'); }
  async renameBlob() { throw new Error('NotImplemented: T13'); }
  async deleteFolder() { throw new Error('NotImplemented: T13'); return 0; }
  async listShares() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async createShare() { throw new Error('NotImplemented: T13'); }
  async deleteShare() { throw new Error('NotImplemented: T13'); }
  async listDir() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async readFile() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async headFile() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async uploadFile() { throw new Error('NotImplemented: T13'); return undefined as never; }
  async deleteFile() { throw new Error('NotImplemented: T13'); }
  async renameFile() { throw new Error('NotImplemented: T13'); }
  async deleteFileFolder() { throw new Error('NotImplemented: T13'); return 0; }
}
