import {
  ShareServiceClient,
  ShareClient,
  ShareDirectoryClient,
  type FileUploadStreamOptions,
} from '@azure/storage-file-share';
import type { TokenCredential } from '@azure/identity';
import { Readable } from 'node:stream';
import { ApiError } from '../errors/api-error.js';

export type FileListItem = {
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
};

export class FileService {
  constructor(
    private readonly credential: TokenCredential,
    private readonly resolveEndpoint: (account: string) => string
  ) {}

  private svc(account: string): ShareServiceClient {
    // Azure Files OAuth-on-REST mandates the `x-ms-file-request-intent: backup`
    // header on every data-plane request. Without it the server returns 400
    // `MissingRequiredHeader`. Setting `fileRequestIntent: 'backup'` on the
    // pipeline options injects the header automatically. Required when the
    // credential is a TokenCredential (Managed Identity / az login); shared-key
    // / SAS auth ignores it.
    return new ShareServiceClient(this.resolveEndpoint(account), this.credential, {
      fileRequestIntent: 'backup',
    });
  }
  private share(account: string, share: string): ShareClient {
    return this.svc(account).getShareClient(share);
  }
  private dir(account: string, share: string, path: string): ShareDirectoryClient {
    return this.share(account, share).getDirectoryClient(path);
  }

  async listShares(account: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: { name: string; quotaGiB?: number }[]; continuationToken: string | null }> {
    try {
      const iter = this.svc(account).listShares().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
      const r = await iter.next();
      if (r.done) return { items: [], continuationToken: null };
      return {
        items: (r.value.shareItems ?? []).map((s) => ({ name: s.name, quotaGiB: s.properties?.quota })),
        continuationToken: r.value.continuationToken ?? null,
      };
    } catch (err) {
      throw mapStorageError(err, () => `Storage account '${account}' not reachable for share listing`);
    }
  }

  async createShare(account: string, name: string, quotaGiB?: number): Promise<void> {
    try {
      const r = await this.share(account, name).createIfNotExists({ quota: quotaGiB });
      if (!r.succeeded) throw ApiError.conflict(`Share '${name}' already exists`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw mapStorageError(err, () => `Share '${name}' creation failed`);
    }
  }

  async deleteShare(account: string, name: string): Promise<void> {
    try {
      const r = await this.share(account, name).deleteIfExists();
      if (!r.succeeded) throw ApiError.notFound(`Share '${name}' not found`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw mapStorageError(err, () => `Share '${name}' not found`);
    }
  }

  async listDir(account: string, share: string, path: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: FileListItem[]; continuationToken: string | null }> {
    try {
      const dir = this.dir(account, share, path);
      const iter = dir.listFilesAndDirectories().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
      const r = await iter.next();
      if (r.done) return { items: [], continuationToken: null };
      const items: FileListItem[] = [];
      for (const f of r.value.segment.fileItems ?? []) items.push({ name: f.name, isDirectory: false, size: f.properties.contentLength });
      for (const d of r.value.segment.directoryItems ?? []) items.push({ name: d.name, isDirectory: true });
      return { items, continuationToken: r.value.continuationToken ?? null };
    } catch (err) {
      throw mapStorageError(err, () => `Directory '${path}' not found in share '${share}'`);
    }
  }

  async readFile(account: string, share: string, path: string, signal?: AbortSignal): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number; etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    const f = this.dir(account, share, dir).getFileClient(file);
    try {
      const dl = await f.download(0, undefined, { abortSignal: signal });
      return {
        stream: dl.readableStreamBody as NodeJS.ReadableStream,
        contentType: dl.contentType ?? undefined,
        contentLength: dl.contentLength ?? undefined,
        etag: dl.etag ?? undefined,
        lastModified: dl.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `File '${path}' not found in share '${share}'`);
    }
  }

  async headFile(account: string, share: string, path: string): Promise<{ contentType?: string; contentLength?: number; etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    const f = this.dir(account, share, dir).getFileClient(file);
    try {
      const p = await f.getProperties();
      return { contentType: p.contentType ?? undefined, contentLength: p.contentLength ?? undefined, etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
    } catch (err) {
      throw mapStorageError(err, () => `File '${path}' not found in share '${share}'`);
    }
  }

  async uploadFile(account: string, share: string, path: string, body: Readable, sizeBytes: number, contentType: string | undefined, signal?: AbortSignal): Promise<{ etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    await this.ensureDirChain(account, share, dir);
    const f = this.dir(account, share, dir).getFileClient(file);
    const opts: FileUploadStreamOptions = {
      fileHttpHeaders: contentType ? { fileContentType: contentType } : undefined,
      abortSignal: signal,
    };
    await f.create(sizeBytes);
    await f.uploadStream(body, sizeBytes, 4 * 1024 * 1024, 4, opts);
    const p = await f.getProperties();
    return { etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
  }

  async deleteFile(account: string, share: string, path: string): Promise<void> {
    const { dir, file } = this.splitPath(path);
    const r = await this.dir(account, share, dir).getFileClient(file).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`File '${path}' not found`);
  }

  async renameFile(account: string, share: string, fromPath: string, toPath: string): Promise<void> {
    const { dir: srcDir, file: srcFile } = this.splitPath(fromPath);
    const src = this.dir(account, share, srcDir).getFileClient(srcFile);
    await src.rename(toPath);
  }

  async deleteFolder(account: string, share: string, path: string): Promise<number> {
    if (!path || path === '/') throw ApiError.badRequest('path must be non-empty and not "/"');
    let count = 0;
    const walk = async (dirPath: string): Promise<void> => {
      const dir = this.dir(account, share, dirPath);
      for await (const item of dir.listFilesAndDirectories()) {
        const child = `${dirPath}/${item.name}`;
        if (item.kind === 'directory') {
          await walk(child);
          await this.dir(account, share, child).delete();
        } else {
          const r = await dir.getFileClient(item.name).deleteIfExists();
          if (r.succeeded) count++;
        }
      }
    };
    await walk(path);
    await this.dir(account, share, path).deleteIfExists();
    return count;
  }

  private splitPath(path: string): { dir: string; file: string } {
    const i = path.lastIndexOf('/');
    if (i === -1) return { dir: '', file: path };
    return { dir: path.slice(0, i), file: path.slice(i + 1) };
  }

  private async ensureDirChain(account: string, share: string, dir: string): Promise<void> {
    if (!dir) return;
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      await this.dir(account, share, cur).createIfNotExists();
    }
  }
}

function mapStorageError(err: unknown, notFoundMessage: () => string): ApiError {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 404) return ApiError.notFound(notFoundMessage());
  if (status === 403) return ApiError.upstream('Storage refused access (check role assignments)');
  if (status === 409) return ApiError.conflict('Storage conflict');
  return ApiError.upstream(`Storage error${status ? ` (${status})` : ''}: ${(err as Error).message}`);
}
