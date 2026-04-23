import { Readable } from 'node:stream';
import type { ApiBackendEntry, BlobItem, ContainerInfo } from '../types.js';
import type {
  IStorageBackend,
  Page,
  PageOpts,
  ListBlobOpts,
  ShareInfo,
  FileItem,
  BlobReadHandle,
} from './backend.js';
import { TokenStore } from './auth/token-store.js';
import { refreshTokens } from './auth/token-refresh.js';
import { fromResponseBody, NeedsLoginError, NetworkError } from './http-error.js';

export class ApiBackend implements IStorageBackend {
  private readonly entry: ApiBackendEntry;
  private readonly account: string;
  private readonly tokens = new TokenStore();

  constructor(entry: ApiBackendEntry, accountName: string) {
    this.entry = entry;
    this.account = accountName;
  }

  // ---- internals ----
  private base(): string { return this.entry.baseUrl.replace(/\/$/, ''); }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.entry.authEnabled) return {};
    if (!this.entry.oidc) throw new NeedsLoginError(this.entry.name);
    let t = await this.tokens.load(this.entry.name);
    if (!t) throw new NeedsLoginError(this.entry.name);
    if (t.expiresAt < Date.now() + 60_000) {
      t = await refreshTokens(this.entry.name, this.entry.oidc, t);
    }
    return { Authorization: `Bearer ${t.accessToken}` };
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { ...(init.headers as Record<string, string> | undefined ?? {}), ...(await this.authHeaders()) };
    let res: Response;
    try { res = await fetch(`${this.base()}${path}`, { ...init, headers }); }
    catch (err) { throw new NetworkError(err as Error); }
    if (res.status === 204) return undefined as never;
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('application/json') ? await res.json() : undefined;
    if (!res.ok) throw fromResponseBody(res.status, body, this.entry.name);
    return body as T;
  }

  private encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  // ---- containers ----
  async listContainers(opts: PageOpts = {}): Promise<Page<ContainerInfo>> {
    const params = new URLSearchParams();
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.json(`/storages/${this.account}/containers${qs}`);
  }
  async createContainer(name: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }
  async deleteContainer(name: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- blobs ----
  async listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>> {
    const params = new URLSearchParams();
    if (opts.prefix) params.set('prefix', opts.prefix);
    if (opts.delimiter) params.set('delimiter', opts.delimiter);
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const r = await this.json<{ items: Array<{ name: string; size?: number; contentType?: string; etag?: string; lastModified?: string; isPrefix?: boolean }>; continuationToken: string | null }>(
      `/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs${qs}`,
    );
    return {
      items: r.items.map((i) => ({
        name: i.name,
        isPrefix: i.isPrefix ?? false,
        size: i.size,
        contentType: i.contentType,
        lastModified: i.lastModified,
      })),
      continuationToken: r.continuationToken,
    };
  }

  async readBlob(container: string, path: string, range?: { offset: number; count?: number }): Promise<BlobReadHandle> {
    const headers: Record<string, string> = { ...(await this.authHeaders()) };
    if (range) {
      const end = range.count !== undefined ? range.offset + range.count - 1 : '';
      headers.Range = `bytes=${range.offset}-${end}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, { headers });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      const body = ct.includes('application/json') ? await res.json().catch(() => undefined) : undefined;
      throw fromResponseBody(res.status, body, this.entry.name);
    }
    return {
      stream: Readable.fromWeb(res.body as never) as NodeJS.ReadableStream,
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, {
        method: 'HEAD', headers: await this.authHeaders(),
      });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) throw fromResponseBody(res.status, undefined, this.entry.name);
    return {
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async uploadBlob(container: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    return this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(sizeBytes),
      },
      body: body as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex?: 'half' });
  }

  async deleteBlob(container: string, path: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, { method: 'DELETE' });
  }

  async renameBlob(container: string, fromPath: string, toPath: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(fromPath)}:rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: toPath }),
    });
  }

  async deleteFolder(container: string, prefix: string): Promise<number> {
    const r = await this.json<{ deleted: number }>(
      `/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs?prefix=${encodeURIComponent(prefix)}&confirm=true`,
      { method: 'DELETE' },
    );
    return r.deleted;
  }

  // ---- shares + files (Task 14 fills in) ----
  async listShares(): Promise<Page<ShareInfo>> { throw new Error('NotImplemented: T14'); }
  async createShare(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async deleteShare(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async listDir(): Promise<Page<FileItem>> { throw new Error('NotImplemented: T14'); }
  async readFile(): Promise<BlobReadHandle> { throw new Error('NotImplemented: T14'); }
  async headFile(): Promise<Omit<BlobReadHandle, 'stream'>> { throw new Error('NotImplemented: T14'); }
  async uploadFile(): Promise<{ etag?: string; lastModified?: string }> { throw new Error('NotImplemented: T14'); }
  async deleteFile(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async renameFile(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async deleteFileFolder(): Promise<number> { throw new Error('NotImplemented: T14'); }
}
