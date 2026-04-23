import {
  BlobServiceClient,
  ContainerClient,
  type BlockBlobUploadStreamOptions,
} from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';
import { Readable } from 'node:stream';
import { ApiError } from '../errors/api-error.js';

export type BlobListItem = {
  name: string;
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  isPrefix?: boolean;
};

export type BlobReadHandle = {
  stream: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
};

export class BlobService {
  constructor(
    private readonly credential: TokenCredential,
    private readonly resolveEndpoint: (account: string) => string
  ) {}

  private svc(account: string): BlobServiceClient {
    return new BlobServiceClient(this.resolveEndpoint(account), this.credential);
  }

  private container(account: string, container: string): ContainerClient {
    return this.svc(account).getContainerClient(container);
  }

  async listContainers(account: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: { name: string }[]; continuationToken: string | null }> {
    const iter = this.svc(account).listContainers().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
    const result = await iter.next();
    if (result.done) return { items: [], continuationToken: null };
    const items = (result.value.containerItems ?? []).map((c) => ({ name: c.name }));
    return { items, continuationToken: result.value.continuationToken ?? null };
  }

  async createContainer(account: string, name: string): Promise<void> {
    const r = await this.container(account, name).createIfNotExists();
    if (!r.succeeded) throw ApiError.conflict(`Container '${name}' already exists`);
  }

  async deleteContainer(account: string, name: string): Promise<void> {
    const r = await this.container(account, name).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`Container '${name}' not found`);
  }

  async listBlobs(
    account: string,
    container: string,
    opts: { prefix?: string; delimiter?: string; pageSize: number; continuationToken?: string }
  ): Promise<{ items: BlobListItem[]; continuationToken: string | null }> {
    const c = this.container(account, container);
    const items: BlobListItem[] = [];
    if (opts.delimiter) {
      const iter = c.listBlobsByHierarchy(opts.delimiter, { prefix: opts.prefix }).byPage({ maxPageSize: opts.pageSize, continuationToken: opts.continuationToken });
      const r = await iter.next();
      if (r.done) return { items: [], continuationToken: null };
      for (const seg of r.value.segment.blobPrefixes ?? []) {
        items.push({ name: seg.name, isPrefix: true });
      }
      for (const b of r.value.segment.blobItems) {
        items.push({
          name: b.name,
          size: b.properties.contentLength ?? undefined,
          contentType: b.properties.contentType ?? undefined,
          etag: b.properties.etag ?? undefined,
          lastModified: b.properties.lastModified?.toISOString(),
        });
      }
      return { items, continuationToken: r.value.continuationToken ?? null };
    }
    const iter = c.listBlobsFlat({ prefix: opts.prefix }).byPage({ maxPageSize: opts.pageSize, continuationToken: opts.continuationToken });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    for (const b of r.value.segment.blobItems) {
      items.push({
        name: b.name,
        size: b.properties.contentLength ?? undefined,
        contentType: b.properties.contentType ?? undefined,
        etag: b.properties.etag ?? undefined,
        lastModified: b.properties.lastModified?.toISOString(),
      });
    }
    return { items, continuationToken: r.value.continuationToken ?? null };
  }

  async readBlob(account: string, container: string, path: string, range?: { offset: number; count?: number }, signal?: AbortSignal): Promise<BlobReadHandle> {
    const blob = this.container(account, container).getBlobClient(path);
    try {
      const dl = await blob.download(range?.offset, range?.count, { abortSignal: signal });
      return {
        stream: dl.readableStreamBody as NodeJS.ReadableStream,
        contentType: dl.contentType ?? undefined,
        contentLength: dl.contentLength ?? undefined,
        etag: dl.etag ?? undefined,
        lastModified: dl.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `Blob '${path}' not found in container '${container}'`);
    }
  }

  async headBlob(account: string, container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const blob = this.container(account, container).getBlobClient(path);
    try {
      const p = await blob.getProperties();
      return {
        contentType: p.contentType ?? undefined,
        contentLength: p.contentLength ?? undefined,
        etag: p.etag ?? undefined,
        lastModified: p.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `Blob '${path}' not found in container '${container}'`);
    }
  }

  async uploadBlob(
    account: string, container: string, path: string,
    body: Readable, contentType: string | undefined, opts: { blockSizeMb: number },
    signal?: AbortSignal,
  ): Promise<{ etag?: string; lastModified?: string }> {
    const blob = this.container(account, container).getBlockBlobClient(path);
    const blockSize = opts.blockSizeMb * 1024 * 1024;
    const uploadOpts: BlockBlobUploadStreamOptions = {
      blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
      abortSignal: signal,
    };
    const r = await blob.uploadStream(body, blockSize, 4, uploadOpts);
    return { etag: r.etag ?? undefined, lastModified: r.lastModified?.toISOString() };
  }

  async deleteBlob(account: string, container: string, path: string): Promise<void> {
    const r = await this.container(account, container).getBlobClient(path).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`Blob '${path}' not found`);
  }

  async renameBlob(account: string, container: string, fromPath: string, toPath: string): Promise<void> {
    const c = this.container(account, container);
    const src = c.getBlobClient(fromPath);
    const dst = c.getBlobClient(toPath);
    const poller = await dst.beginCopyFromURL(src.url);
    await poller.pollUntilDone();
    await src.deleteIfExists();
  }

  /** Delete every blob whose name starts with prefix. Returns count deleted. */
  async deleteFolder(account: string, container: string, prefix: string): Promise<number> {
    if (!prefix || prefix === '/') throw ApiError.badRequest('prefix must be non-empty and not "/"');
    const c = this.container(account, container);
    let deleted = 0;
    for await (const b of c.listBlobsFlat({ prefix })) {
      const r = await c.getBlobClient(b.name).deleteIfExists();
      if (r.succeeded) deleted++;
    }
    return deleted;
  }
}

function mapStorageError(err: unknown, notFoundMessage: () => string): ApiError {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 404) return ApiError.notFound(notFoundMessage());
  if (status === 409) return ApiError.conflict('Storage conflict');
  if (status === 412) return ApiError.conflict('Precondition failed');
  if (status === 403) return ApiError.upstream('Storage refused access (check role assignments)');
  return ApiError.upstream(`Storage error${status ? ` (${status})` : ''}: ${(err as Error).message}`);
}
