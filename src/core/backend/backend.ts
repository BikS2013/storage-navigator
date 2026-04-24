import type { BlobItem, ContainerInfo } from '../types.js';

export type PageOpts = { pageSize?: number; continuationToken?: string };
export type Page<T> = { items: T[]; continuationToken: string | null };

export type ListBlobOpts = PageOpts & { prefix?: string; delimiter?: string };

export type ShareInfo = { name: string; quotaGiB?: number };
export type FileItem = {
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
};

export type BlobReadHandle = {
  stream: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
};

export interface IStorageBackend {
  // containers
  listContainers(opts?: PageOpts): Promise<Page<ContainerInfo>>;
  createContainer(name: string): Promise<void>;
  deleteContainer(name: string): Promise<void>;

  // blobs
  listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>>;
  readBlob(container: string, path: string, range?: { offset: number; count?: number }): Promise<BlobReadHandle>;
  headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>>;
  uploadBlob(container: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }>;
  deleteBlob(container: string, path: string): Promise<void>;
  renameBlob(container: string, fromPath: string, toPath: string): Promise<void>;
  deleteFolder(container: string, prefix: string): Promise<number>;

  // file shares
  listShares(opts?: PageOpts): Promise<Page<ShareInfo>>;
  createShare(name: string, quotaGiB?: number): Promise<void>;
  deleteShare(name: string): Promise<void>;
  listDir(share: string, path: string, opts?: PageOpts): Promise<Page<FileItem>>;
  readFile(share: string, path: string): Promise<BlobReadHandle>;
  headFile(share: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>>;
  uploadFile(share: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }>;
  deleteFile(share: string, path: string): Promise<void>;
  renameFile(share: string, fromPath: string, toPath: string): Promise<void>;
  deleteFileFolder(share: string, path: string): Promise<number>;
}
