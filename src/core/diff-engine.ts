import { filterByRepoSubPath, mapToTargetPaths, type MappedFileEntry } from "./sync-engine.js";
import { BlobClient } from "./blob-client.js";
import type { RepoProvider, RepoLink, DiffEntry, DiffReport } from "./types.js";

const META_BLOB = ".repo-sync-meta.json";
const LINKS_BLOB = ".repo-links.json";

export interface DiffOptions {
  /** If true, calls listBlobsFlat to find untracked blobs. Requires blobClient and container. Default: false */
  includePhysicalCheck?: boolean;
  /** If false, identical[] is emptied before returning (but summary.identicalCount is preserved). Default: true */
  showIdentical?: boolean;
}

/**
 * Perform a read-only diff between the remote repository state (via provider.listFiles)
 * and the tracked state stored in link.fileShas.
 *
 * Constraints:
 * - Never calls provider.downloadFile()
 * - Never mutates the link object
 * - Never writes any blobs
 *
 * @param provider       Repository provider (GitHub, Azure DevOps, or SSH)
 * @param link           The RepoLink describing the sync target
 * @param blobClient     Required only when options.includePhysicalCheck === true
 * @param container      Required only when options.includePhysicalCheck === true
 * @param options        Diff options
 */
export async function diffLink(
  provider: RepoProvider,
  link: RepoLink,
  blobClient?: BlobClient,
  container?: string,
  options?: DiffOptions
): Promise<DiffReport> {
  const includePhysicalCheck = options?.includePhysicalCheck ?? false;
  const showIdentical = options?.showIdentical ?? true;

  // ── Phase 1: SHA comparison ────────────────────────────────────────────────

  // 1. Fetch remote file list — errors propagate (no silent fallback)
  const remoteFiles = await provider.listFiles();

  // 2. Filter to the repo sub-path
  const filtered = filterByRepoSubPath(remoteFiles, link.repoSubPath);

  // 3. Map to target blob paths
  const mapped: MappedFileEntry[] = mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix);

  // 4. Build remote map: blobPath → remoteSha
  const remoteMap = new Map<string, string>();
  for (const entry of mapped) {
    remoteMap.set(entry.blobPath, entry.sha);
  }

  // 5. Build stored map: blobPath → storedSha (from link.fileShas — not mutated)
  const storedMap = new Map<string, string>(Object.entries(link.fileShas));

  // 6. Classify each file
  const identical: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const repoOnly: DiffEntry[] = [];
  const containerOnly: DiffEntry[] = [];
  const untracked: DiffEntry[] = [];

  // Build a reverse lookup: blobPath → repoPath from mapped entries
  const blobToRepoPath = new Map<string, string>();
  for (const entry of mapped) {
    blobToRepoPath.set(entry.blobPath, entry.repoPath);
  }

  for (const [blobPath, remoteSha] of remoteMap) {
    const storedSha = storedMap.get(blobPath);
    const repoPath = blobToRepoPath.get(blobPath) ?? blobPath;

    if (storedSha === undefined) {
      // File exists in repo but not tracked in container
      repoOnly.push({ blobPath, repoPath, remoteSha, storedSha: null });
    } else if (storedSha === remoteSha) {
      identical.push({ blobPath, repoPath, remoteSha, storedSha });
    } else {
      modified.push({ blobPath, repoPath, remoteSha, storedSha });
    }
  }

  for (const [blobPath, storedSha] of storedMap) {
    if (!remoteMap.has(blobPath)) {
      // File tracked in container but absent from remote repo
      containerOnly.push({ blobPath, repoPath: blobPath, remoteSha: null, storedSha });
    }
  }

  // 7. Detect never-synced links
  let note: string | undefined;
  if (Object.keys(link.fileShas).length === 0 && !link.lastSyncAt) {
    note = "Link has never been synced; all repo files appear as repo-only";
  }

  // ── Phase 2: Physical blob check (optional) ────────────────────────────────

  if (includePhysicalCheck) {
    if (!blobClient) {
      throw new Error("blobClient is required when includePhysicalCheck is true");
    }
    if (!container) {
      throw new Error("container is required when includePhysicalCheck is true");
    }

    // 1. List all physical blobs in the container
    const physicalBlobs = await blobClient.listBlobsFlat(container);

    // 2. Build a set of physical blob paths
    const physicalSet = new Set<string>(physicalBlobs.map((b) => b.name));

    // 3. Build the full set of tracked blob paths
    const trackedSet = new Set<string>([
      ...storedMap.keys(),
      ...remoteMap.keys(),
    ]);

    // 4. Annotate repo-only entries with physicallyExists
    for (const entry of repoOnly) {
      entry.physicallyExists = physicalSet.has(entry.blobPath);
    }

    // 5. Find untracked blobs: physical but not tracked, filtered by targetPrefix
    const targetPrefixFilter = link.targetPrefix
      ? (link.targetPrefix.endsWith("/") ? link.targetPrefix : link.targetPrefix + "/")
      : undefined;

    for (const blobName of physicalSet) {
      // Skip well-known metadata files
      if (blobName === META_BLOB || blobName === LINKS_BLOB) continue;

      // Filter to blobs under targetPrefix (if set)
      if (targetPrefixFilter && !blobName.startsWith(targetPrefixFilter)) continue;

      // Skip if tracked
      if (trackedSet.has(blobName)) continue;

      untracked.push({
        blobPath: blobName,
        repoPath: blobName,
        remoteSha: null,
        storedSha: null,
      });
    }
  }

  // ── Build the DiffReport ───────────────────────────────────────────────────

  const modifiedCount = modified.length;
  const repoOnlyCount = repoOnly.length;
  const containerOnlyCount = containerOnly.length;
  const identicalCount = identical.length;
  const untrackedCount = untracked.length;
  const total = modifiedCount + repoOnlyCount + containerOnlyCount + identicalCount;

  const report: DiffReport = {
    linkId: link.id,
    provider: link.provider,
    repoUrl: link.repoUrl,
    branch: link.branch,
    targetPrefix: link.targetPrefix,
    repoSubPath: link.repoSubPath,
    lastSyncAt: link.lastSyncAt,
    generatedAt: new Date().toISOString(),
    note,

    identical,
    modified,
    repoOnly,
    containerOnly,
    untracked,

    summary: {
      total,
      identicalCount,
      modifiedCount,
      repoOnlyCount,
      containerOnlyCount,
      untrackedCount,
      isInSync: modifiedCount + repoOnlyCount + containerOnlyCount === 0,
    },
  };

  // Strip identical entries from output if showIdentical is false,
  // but preserve the count in summary.
  if (!showIdentical) {
    report.identical = [];
  }

  return report;
}
