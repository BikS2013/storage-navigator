import crypto from "crypto";
import type { RepoSyncMeta, RepoFileEntry, SyncResult, RepoLink, RepoLinksRegistry, RepoProvider } from "./types.js";
import { BlobClient } from "./blob-client.js";
import { processInBatches, inferContentType } from "./repo-utils.js";

const META_BLOB = ".repo-sync-meta.json";
const LINKS_BLOB = ".repo-links.json";
const BATCH_CONCURRENCY = 10;

// Re-export RepoProvider so existing callers of `import type { RepoProvider } from "./sync-engine.js"` still work
export type { RepoProvider };

/** Maps a repo file to its target blob location. Internal to sync-engine. */
export interface MappedFileEntry {
  /** Original path in the repository (used for provider.downloadFile) */
  repoPath: string;
  /** Target path in the container (used for blobClient.createBlob and fileShas keys) */
  blobPath: string;
  /** Git object SHA (content hash) */
  sha: string;
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
 * Filter a list of repo file entries to include only files under the given sub-path.
 * If repoSubPath is undefined/empty, returns all files.
 */
export function filterByRepoSubPath(
  files: RepoFileEntry[],
  repoSubPath?: string
): RepoFileEntry[] {
  const norm = normalizePath(repoSubPath);
  if (!norm) return files;
  const prefix = norm + "/";
  return files.filter((f) => f.path === norm || f.path.startsWith(prefix));
}

/**
 * Map filtered repo files to their target blob paths.
 * Strips repoSubPath prefix and prepends targetPrefix.
 *
 * Identity transform when both repoSubPath and targetPrefix are undefined.
 */
export function mapToTargetPaths(
  files: RepoFileEntry[],
  repoSubPath?: string,
  targetPrefix?: string
): MappedFileEntry[] {
  const normRepo = normalizePath(repoSubPath);
  const normTarget = normalizePath(targetPrefix);
  const stripPrefix = normRepo ? normRepo + "/" : "";

  return files.map((file) => {
    // Compute relative path by stripping the repo sub-path prefix
    const relativePath = stripPrefix && file.path.startsWith(stripPrefix)
      ? file.path.slice(stripPrefix.length)
      : file.path;

    // Compute blob path by prepending the target prefix
    const blobPath = normTarget
      ? normTarget + "/" + relativePath
      : relativePath;

    return {
      repoPath: file.path,
      blobPath,
      sha: file.sha,
    };
  });
}

/**
 * Clone a repository (or sub-path) into a container (or container prefix).
 * The caller is responsible for writing the updated link back to the registry.
 *
 * @param link - The RepoLink describing what to clone and where. Updated in-place
 *               with lastSyncAt, lastCommitSha, and fileShas on success.
 * @returns SyncResult with upload/error counts
 */
export async function cloneRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} files in repository.`);

  // Apply path filtering and mapping
  const filtered = filterByRepoSubPath(remoteFiles, link.repoSubPath);
  const mapped = mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix);
  onProgress?.(`${mapped.length} files match after filtering.`);

  const fileShas: Record<string, string> = {};

  await processInBatches(mapped, BATCH_CONCURRENCY, async (entry) => {
    try {
      const content = await provider.downloadFile(entry.repoPath);
      const contentType = inferContentType(entry.blobPath);
      await blobClient.createBlob(container, entry.blobPath, content, contentType);
      fileShas[entry.blobPath] = entry.sha;
      result.uploaded.push(entry.blobPath);
      onProgress?.(`Uploaded: ${entry.blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entry.blobPath}: ${msg}`);
      onProgress?.(`Error: ${entry.blobPath} -- ${msg}`);
    }
  });

  // Update the link in-place (caller writes it to the registry)
  link.lastSyncAt = new Date().toISOString();
  link.fileShas = fileShas;

  return result;
}

/**
 * Sync a previously cloned link with its remote repository.
 * The caller provides the RepoLink (instead of this function reading meta internally).
 * The link is updated in-place with new lastSyncAt, lastCommitSha, and fileShas.
 * The caller is responsible for writing the updated link back to the registry.
 *
 * @param link - The RepoLink to sync. Updated in-place on success.
 * @returns SyncResult with upload/delete/skip/error counts
 */
export async function syncRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  dryRun: boolean = false,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} files in repository.`);

  // Apply path filtering and mapping
  const filtered = filterByRepoSubPath(remoteFiles, link.repoSubPath);
  const mapped = mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix);
  onProgress?.(`${mapped.length} files match after filtering.`);

  const oldShas = link.fileShas;
  const newShas: Record<string, string> = {};

  // Determine what changed
  const toUpload: MappedFileEntry[] = [];
  const remoteBlobPathSet = new Set<string>();

  for (const entry of mapped) {
    remoteBlobPathSet.add(entry.blobPath);
    if (oldShas[entry.blobPath] !== entry.sha) {
      toUpload.push(entry);
    } else {
      result.skipped.push(entry.blobPath);
      newShas[entry.blobPath] = entry.sha;
    }
  }

  // Files that were in the old sync but are no longer in the remote set
  const toDelete: string[] = [];
  for (const oldBlobPath of Object.keys(oldShas)) {
    if (!remoteBlobPathSet.has(oldBlobPath)) {
      toDelete.push(oldBlobPath);
    }
  }

  onProgress?.(`Changes: ${toUpload.length} to upload, ${toDelete.length} to delete, ${result.skipped.length} unchanged.`);

  if (dryRun) {
    result.uploaded = toUpload.map((e) => e.blobPath);
    result.deleted = toDelete;
    return result;
  }

  // Upload changed/new files
  await processInBatches(toUpload, BATCH_CONCURRENCY, async (entry) => {
    try {
      const content = await provider.downloadFile(entry.repoPath);
      const contentType = inferContentType(entry.blobPath);
      await blobClient.createBlob(container, entry.blobPath, content, contentType);
      newShas[entry.blobPath] = entry.sha;
      result.uploaded.push(entry.blobPath);
      onProgress?.(`Uploaded: ${entry.blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entry.blobPath}: ${msg}`);
    }
  });

  // Delete removed files
  for (const blobPath of toDelete) {
    try {
      await blobClient.deleteBlob(container, blobPath);
      result.deleted.push(blobPath);
      onProgress?.(`Deleted: ${blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`delete ${blobPath}: ${msg}`);
    }
  }

  // Update link in-place (caller writes registry)
  link.lastSyncAt = new Date().toISOString();
  link.fileShas = newShas;

  return result;
}

// ============================================================
// Link Registry Functions (Phase 1 — Folder-Level Linking)
// ============================================================

/**
 * Normalize a path by trimming leading and trailing slashes.
 * Returns empty string for undefined/null/empty input.
 */
export function normalizePath(path: string | undefined): string {
  if (!path) return "";
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Read the link registry from a container.
 * Returns null if .repo-links.json does not exist.
 */
export async function readLinks(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry | null> {
  try {
    const blob = await blobClient.getBlobContent(container, LINKS_BLOB);
    const text = typeof blob.content === "string" ? blob.content : blob.content.toString("utf-8");
    return JSON.parse(text) as RepoLinksRegistry;
  } catch {
    return null;
  }
}

/**
 * Write the link registry to a container.
 */
export async function writeLinks(
  blobClient: BlobClient,
  container: string,
  registry: RepoLinksRegistry
): Promise<void> {
  const content = JSON.stringify(registry, null, 2);
  await blobClient.createBlob(container, LINKS_BLOB, content, "application/json");
}

/**
 * Migrate .repo-sync-meta.json to .repo-links.json.
 * Returns the new registry if migration occurred, null if no old metadata exists.
 * Does NOT delete the old .repo-sync-meta.json (retained for safety).
 */
export async function migrateOldMeta(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry | null> {
  const oldMeta = await readSyncMeta(blobClient, container);
  if (!oldMeta) return null;

  const link: RepoLink = {
    id: crypto.randomUUID(),
    provider: oldMeta.provider,
    repoUrl: oldMeta.repoUrl,
    branch: oldMeta.branch,
    repoSubPath: undefined,
    targetPrefix: undefined,
    lastSyncAt: oldMeta.lastSyncAt,
    lastCommitSha: oldMeta.lastCommitSha,
    fileShas: { ...oldMeta.fileShas },
    createdAt: oldMeta.lastSyncAt, // best available timestamp
  };

  const registry: RepoLinksRegistry = { version: 1, links: [link] };
  await writeLinks(blobClient, container, registry);
  return registry;
}

/**
 * Read .repo-links.json, or auto-migrate from old format, or return empty registry.
 * This is the primary entry point for all callers needing link data.
 */
export async function resolveLinks(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry> {
  // 1. Try reading .repo-links.json
  const existing = await readLinks(blobClient, container);
  if (existing) return existing;

  // 2. Try auto-migrating from .repo-sync-meta.json
  const migrated = await migrateOldMeta(blobClient, container);
  if (migrated) return migrated;

  // 3. No metadata at all -- return empty registry
  return { version: 1, links: [] };
}

/**
 * Check if an exact prefix match already exists in the link list.
 * Returns true if a link with the same normalized targetPrefix exists.
 */
export function detectExactConflict(
  existingLinks: RepoLink[],
  newPrefix: string | undefined
): boolean {
  const norm = normalizePath(newPrefix);
  return existingLinks.some(
    (link) => normalizePath(link.targetPrefix) === norm
  );
}

/**
 * Check for nested prefix overlap (one prefix is a sub-path of another).
 * Returns a warning message if overlap is detected, null otherwise.
 * Does NOT check for exact match (that is detectExactConflict).
 */
export function detectOverlap(
  existingLinks: RepoLink[],
  newPrefix: string | undefined
): string | null {
  const norm = normalizePath(newPrefix);
  for (const link of existingLinks) {
    const existing = normalizePath(link.targetPrefix);
    // Skip exact match (handled by detectExactConflict)
    if (norm === existing) continue;
    if (norm.startsWith(existing + "/") || existing.startsWith(norm + "/")) {
      return `Warning: prefix "${newPrefix ?? "(container root)"}" overlaps with existing link to ${link.repoUrl} at prefix "${link.targetPrefix ?? "(container root)"}"`;
    }
    // Special case: one is empty (container root) and the other is not
    if ((norm === "" && existing !== "") || (norm !== "" && existing === "")) {
      return `Warning: prefix "${newPrefix ?? "(container root)"}" overlaps with existing link to ${link.repoUrl} at prefix "${link.targetPrefix ?? "(container root)"}" (one covers the entire container)`;
    }
  }
  return null;
}

/**
 * Add a new link to the container's link registry.
 * Throws on exact prefix conflict. Returns warning on nested overlap.
 *
 * @param linkData - All fields except id, createdAt, fileShas (auto-generated)
 * @returns The created RepoLink and an optional warning string
 */
export async function createLink(
  blobClient: BlobClient,
  container: string,
  linkData: {
    provider: "github" | "azure-devops" | "ssh";
    repoUrl: string;
    branch: string;
    repoSubPath?: string;
    targetPrefix?: string;
  }
): Promise<{ link: RepoLink; warning?: string }> {
  const registry = await resolveLinks(blobClient, container);

  // Check for exact prefix conflict
  if (detectExactConflict(registry.links, linkData.targetPrefix)) {
    const norm = normalizePath(linkData.targetPrefix);
    throw new Error(
      `A link already exists for prefix "${norm || "(container root)"}". Use "unlink" first or specify a different prefix.`
    );
  }

  // Check for nested overlap (warning, not error)
  const warning = detectOverlap(registry.links, linkData.targetPrefix);

  const link: RepoLink = {
    id: crypto.randomUUID(),
    provider: linkData.provider,
    repoUrl: linkData.repoUrl,
    branch: linkData.branch,
    repoSubPath: linkData.repoSubPath ? normalizePath(linkData.repoSubPath) : undefined,
    targetPrefix: linkData.targetPrefix ? normalizePath(linkData.targetPrefix) : undefined,
    lastSyncAt: undefined,
    lastCommitSha: undefined,
    fileShas: {},
    createdAt: new Date().toISOString(),
  };

  registry.links.push(link);
  await writeLinks(blobClient, container, registry);

  return { link, warning: warning ?? undefined };
}

/**
 * Remove a link by ID from the container's link registry.
 * Returns true if the link was found and removed, false otherwise.
 */
export async function removeLink(
  blobClient: BlobClient,
  container: string,
  linkId: string
): Promise<boolean> {
  const registry = await resolveLinks(blobClient, container);
  const before = registry.links.length;
  registry.links = registry.links.filter((l) => l.id !== linkId);

  if (registry.links.length === before) return false;

  await writeLinks(blobClient, container, registry);
  return true;
}

/**
 * Find a link by its normalized target prefix.
 * Returns the link if exactly one match is found.
 * Throws if ambiguous (multiple matches) or not found.
 */
export function findLinkByPrefix(
  links: RepoLink[],
  prefix: string | undefined
): RepoLink {
  const norm = normalizePath(prefix);
  const matches = links.filter((l) => normalizePath(l.targetPrefix) === norm);

  if (matches.length === 0) {
    throw new Error(`No link found for prefix "${norm || "(container root)"}".`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple links found for prefix "${norm || "(container root)"}". Use --link-id to specify.`
    );
  }
  return matches[0];
}
