import type { RepoSyncMeta, RepoFileEntry, SyncResult } from "./types.js";
import { BlobClient } from "./blob-client.js";
import { processInBatches, inferContentType } from "./repo-utils.js";

const META_BLOB = ".repo-sync-meta.json";
const BATCH_CONCURRENCY = 10;

export interface RepoProvider {
  listFiles(): Promise<RepoFileEntry[]>;
  downloadFile(filePath: string): Promise<Buffer>;
}

/** Read sync metadata from a container (returns null if not a synced container) */
export async function readSyncMeta(blobClient: BlobClient, container: string): Promise<RepoSyncMeta | null> {
  try {
    const blob = await blobClient.getBlobContent(container, META_BLOB);
    const text = typeof blob.content === "string" ? blob.content : blob.content.toString("utf-8");
    return JSON.parse(text) as RepoSyncMeta;
  } catch {
    return null;
  }
}

/** Write sync metadata to a container */
async function writeSyncMeta(blobClient: BlobClient, container: string, meta: RepoSyncMeta): Promise<void> {
  const content = JSON.stringify(meta, null, 2);
  await blobClient.createBlob(container, META_BLOB, content, "application/json");
}

/**
 * Clone a repository into a container (full initial copy).
 */
export async function cloneRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  meta: Omit<RepoSyncMeta, "lastSyncAt" | "fileShas">,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} files.`);

  const fileShas: Record<string, string> = {};

  await processInBatches(remoteFiles, BATCH_CONCURRENCY, async (file) => {
    try {
      const content = await provider.downloadFile(file.path);
      const contentType = inferContentType(file.path);
      await blobClient.createBlob(container, file.path, content, contentType);
      fileShas[file.path] = file.sha;
      result.uploaded.push(file.path);
      onProgress?.(`Uploaded: ${file.path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${file.path}: ${msg}`);
      onProgress?.(`Error: ${file.path} — ${msg}`);
    }
  });

  const syncMeta: RepoSyncMeta = {
    ...meta,
    lastSyncAt: new Date().toISOString(),
    fileShas,
  };
  await writeSyncMeta(blobClient, container, syncMeta);

  return result;
}

/**
 * Sync a previously cloned container with its remote repository.
 * Compares file SHAs and only transfers changed/new files.
 */
export async function syncRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  dryRun: boolean = false,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  const existingMeta = await readSyncMeta(blobClient, container);
  if (!existingMeta) {
    throw new Error(`Container '${container}' is not a synced repository. No ${META_BLOB} found.`);
  }

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} remote files.`);

  const oldShas = existingMeta.fileShas;
  const newShas: Record<string, string> = {};

  // Determine what changed
  const toUpload: RepoFileEntry[] = [];
  const remotePathSet = new Set<string>();

  for (const file of remoteFiles) {
    remotePathSet.add(file.path);
    if (oldShas[file.path] !== file.sha) {
      toUpload.push(file);
    } else {
      result.skipped.push(file.path);
      newShas[file.path] = file.sha;
    }
  }

  // Files that were in the old sync but are no longer in the repo
  const toDelete: string[] = [];
  for (const oldPath of Object.keys(oldShas)) {
    if (!remotePathSet.has(oldPath)) {
      toDelete.push(oldPath);
    }
  }

  onProgress?.(`Changes: ${toUpload.length} to upload, ${toDelete.length} to delete, ${result.skipped.length} unchanged.`);

  if (dryRun) {
    result.uploaded = toUpload.map((f) => f.path);
    result.deleted = toDelete;
    return result;
  }

  // Upload changed/new files
  await processInBatches(toUpload, BATCH_CONCURRENCY, async (file) => {
    try {
      const content = await provider.downloadFile(file.path);
      const contentType = inferContentType(file.path);
      await blobClient.createBlob(container, file.path, content, contentType);
      newShas[file.path] = file.sha;
      result.uploaded.push(file.path);
      onProgress?.(`Uploaded: ${file.path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${file.path}: ${msg}`);
    }
  });

  // Delete removed files
  for (const path of toDelete) {
    try {
      await blobClient.deleteBlob(container, path);
      result.deleted.push(path);
      onProgress?.(`Deleted: ${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`delete ${path}: ${msg}`);
    }
  }

  // Update metadata
  const updatedMeta: RepoSyncMeta = {
    ...existingMeta,
    lastSyncAt: new Date().toISOString(),
    fileShas: newShas,
  };
  await writeSyncMeta(blobClient, container, updatedMeta);

  return result;
}
