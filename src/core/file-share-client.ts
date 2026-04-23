import {
  ShareServiceClient,
  StorageSharedKeyCredential,
} from '@azure/storage-file-share';
import { Readable } from 'node:stream';
import type { DirectStorageEntry } from './types.js';
import type { Page, PageOpts, ShareInfo, FileItem, BlobReadHandle } from './backend/backend.js';

/**
 * Azure Files (SMB / REST) client used by DirectBackend. Mirrors BlobClient's
 * shape: constructor takes a DirectStorageEntry; auth is account-key or SAS.
 * Production deployments that want OAuth-on-Files-REST should use the api
 * backend instead — that path is already covered by Plan 006.
 */
export class FileShareClient {
  private readonly serviceClient: ShareServiceClient;

  constructor(entry: DirectStorageEntry) {
    if (entry.accountKey) {
      const cred = new StorageSharedKeyCredential(entry.accountName, entry.accountKey);
      this.serviceClient = new ShareServiceClient(
        `https://${entry.accountName}.file.core.windows.net`,
        cred,
      );
    } else if (entry.sasToken) {
      const url = `https://${entry.accountName}.file.core.windows.net?${entry.sasToken}`;
      this.serviceClient = new ShareServiceClient(url);
    } else {
      throw new Error(`Storage '${entry.name}' has no accountKey or sasToken configured.`);
    }
  }

  async listShares(opts: PageOpts = {}): Promise<Page<ShareInfo>> {
    const iter = this.serviceClient.listShares().byPage({
      maxPageSize: opts.pageSize,
      continuationToken: opts.continuationToken,
    });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    return {
      items: (r.value.shareItems ?? []).map((s) => ({ name: s.name, quotaGiB: s.properties?.quota })),
      continuationToken: r.value.continuationToken ?? null,
    };
  }

  async createShare(name: string, quotaGiB?: number): Promise<void> {
    await this.serviceClient.getShareClient(name).createIfNotExists({ quota: quotaGiB });
  }

  async deleteShare(name: string): Promise<void> {
    await this.serviceClient.getShareClient(name).deleteIfExists();
  }

  async listDir(share: string, path: string, opts: PageOpts = {}): Promise<Page<FileItem>> {
    const dir = this.serviceClient.getShareClient(share).getDirectoryClient(path);
    const iter = dir.listFilesAndDirectories().byPage({
      maxPageSize: opts.pageSize,
      continuationToken: opts.continuationToken,
    });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    const items: FileItem[] = [];
    for (const f of r.value.segment.fileItems ?? []) {
      items.push({ name: f.name, isDirectory: false, size: f.properties.contentLength });
    }
    for (const d of r.value.segment.directoryItems ?? []) {
      items.push({ name: d.name, isDirectory: true });
    }
    return { items, continuationToken: r.value.continuationToken ?? null };
  }

  async readFile(share: string, filePath: string): Promise<BlobReadHandle> {
    const { dir, file } = splitPath(filePath);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    const dl = await f.download(0);
    return {
      stream: dl.readableStreamBody as NodeJS.ReadableStream,
      contentType: dl.contentType ?? undefined,
      contentLength: dl.contentLength ?? undefined,
      etag: dl.etag ?? undefined,
      lastModified: dl.lastModified?.toISOString(),
    };
  }

  async headFile(share: string, filePath: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const { dir, file } = splitPath(filePath);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    const p = await f.getProperties();
    return {
      contentType: p.contentType ?? undefined,
      contentLength: p.contentLength ?? undefined,
      etag: p.etag ?? undefined,
      lastModified: p.lastModified?.toISOString(),
    };
  }

  async uploadFile(share: string, filePath: string, body: Readable | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    const { dir, file } = splitPath(filePath);
    await this.ensureDirChain(share, dir);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    await f.create(sizeBytes);
    const stream = body instanceof Buffer ? Readable.from(body) : body;
    await f.uploadStream(stream, sizeBytes, 4 * 1024 * 1024, 4, {
      fileHttpHeaders: contentType ? { fileContentType: contentType } : undefined,
    });
    const p = await f.getProperties();
    return { etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
  }

  async deleteFile(share: string, filePath: string): Promise<void> {
    const { dir, file } = splitPath(filePath);
    await this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file).deleteIfExists();
  }

  async renameFile(share: string, fromPath: string, toPath: string): Promise<void> {
    const { dir, file } = splitPath(fromPath);
    await this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file).rename(toPath);
  }

  async deleteFileFolder(share: string, path: string): Promise<number> {
    if (!path || path === '/') throw new Error('path must be non-empty and not "/"');
    let count = 0;
    const walk = async (dirPath: string): Promise<void> => {
      const dir = this.serviceClient.getShareClient(share).getDirectoryClient(dirPath);
      for await (const item of dir.listFilesAndDirectories()) {
        const child = `${dirPath}/${item.name}`;
        if (item.kind === 'directory') {
          await walk(child);
          await this.serviceClient.getShareClient(share).getDirectoryClient(child).delete();
        } else {
          const r = await dir.getFileClient(item.name).deleteIfExists();
          if (r.succeeded) count++;
        }
      }
    };
    await walk(path);
    await this.serviceClient.getShareClient(share).getDirectoryClient(path).deleteIfExists();
    return count;
  }

  private async ensureDirChain(share: string, dir: string): Promise<void> {
    if (!dir) return;
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      await this.serviceClient.getShareClient(share).getDirectoryClient(cur).createIfNotExists();
    }
  }
}

function splitPath(p: string): { dir: string; file: string } {
  const i = p.lastIndexOf('/');
  if (i === -1) return { dir: '', file: p };
  return { dir: p.slice(0, i), file: p.slice(i + 1) };
}
