import { Readable } from 'node:stream';
import type { DirectStorageEntry, BlobItem, ContainerInfo } from '../types.js';
import type {
  IStorageBackend,
  Page,
  PageOpts,
  ListBlobOpts,
  BlobReadHandle,
} from './backend.js';
import { BlobClient } from '../blob-client.js';
import { FileShareClient } from '../file-share-client.js';

export class DirectBackend implements IStorageBackend {
  private readonly blob: BlobClient;
  private readonly file: FileShareClient;

  constructor(entry: DirectStorageEntry) {
    this.blob = new BlobClient(entry);
    this.file = new FileShareClient(entry);
  }

  // Containers ---------------------------------------------------------
  async listContainers(_opts: PageOpts = {}): Promise<Page<ContainerInfo>> {
    const items = await this.blob.listContainers();
    return { items, continuationToken: null };
  }
  async createContainer(name: string): Promise<void> {
    await this.blob.createContainer(name);
  }
  async deleteContainer(name: string): Promise<void> {
    await this.blob.deleteContainer(name);
  }

  // Blobs --------------------------------------------------------------
  async listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>> {
    const items = await this.blob.listBlobs(container, opts.prefix);
    return { items, continuationToken: null };
  }
  async readBlob(container: string, path: string): Promise<BlobReadHandle> {
    const r = await this.blob.viewBlob(container, path);
    const body = r.content instanceof Buffer ? r.content : Buffer.from(r.content);
    return {
      stream: Readable.from(body),
      contentType: r.contentType,
      contentLength: r.size,
    };
  }
  async headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const r = await this.blob.viewBlob(container, path);
    return { contentType: r.contentType, contentLength: r.size };
  }
  async uploadBlob(
    container: string,
    path: string,
    body: NodeJS.ReadableStream | Buffer,
    sizeBytes: number,
    contentType?: string,
  ): Promise<{ etag?: string; lastModified?: string }> {
    // TS 6.0 + @types/node 25.x types Buffer as Buffer<ArrayBufferLike>, so
    // the else-branch narrowing of `body` to NodeJS.ReadableStream fails.
    // Cast to ReadableStream here — runtime instanceof Buffer is the real
    // discriminator. Same pattern as FileShareClient.uploadFile (T7).
    const buf: Buffer = body instanceof Buffer
      ? body
      : await readStreamToBuffer(body as NodeJS.ReadableStream, sizeBytes);
    await this.blob.uploadBlob(container, path, buf, contentType);
    return {};
  }
  async deleteBlob(container: string, path: string): Promise<void> {
    await this.blob.deleteBlob(container, path);
  }
  async renameBlob(container: string, fromPath: string, toPath: string): Promise<void> {
    await this.blob.renameBlob(container, fromPath, toPath);
  }
  async deleteFolder(container: string, prefix: string): Promise<number> {
    const n = await this.blob.deleteFolder(container, prefix);
    return n;
  }

  // Shares -------------------------------------------------------------
  async listShares(opts: PageOpts = {}) {
    return this.file.listShares(opts);
  }
  async createShare(name: string, quotaGiB?: number) {
    await this.file.createShare(name, quotaGiB);
  }
  async deleteShare(name: string) {
    await this.file.deleteShare(name);
  }
  async listDir(share: string, path: string, opts: PageOpts = {}) {
    return this.file.listDir(share, path, opts);
  }
  async readFile(share: string, path: string) {
    return this.file.readFile(share, path);
  }
  async headFile(share: string, path: string) {
    return this.file.headFile(share, path);
  }
  async uploadFile(
    share: string,
    path: string,
    body: NodeJS.ReadableStream | Buffer,
    sizeBytes: number,
    contentType?: string,
  ) {
    return this.file.uploadFile(share, path, body as Buffer | Readable, sizeBytes, contentType);
  }
  async deleteFile(share: string, path: string) {
    await this.file.deleteFile(share, path);
  }
  async renameFile(share: string, fromPath: string, toPath: string) {
    await this.file.renameFile(share, fromPath, toPath);
  }
  async deleteFileFolder(share: string, path: string) {
    return this.file.deleteFileFolder(share, path);
  }
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream, _hintSize: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
