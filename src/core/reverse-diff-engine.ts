// ===========================================================================
// src/core/reverse-diff-engine.ts
//
// Reverse-git diff engine. Compares the current Azure-blob snapshot
// (built by `blob-enumerator.ts`) against the link's stored
// `blobSnapshot: Record<repoPath, etag>` from the last successful push,
// and produces a `ReverseDiffResult` classifying each path as one of
//   `added | modified | deleted | unchanged`.
//
// The diff engine is INTENTIONALLY pure (no I/O): it consumes two
// in-memory snapshots and returns a plain JSON-serialisable result.
// Content loading for `add`/`edit` changes is the responsibility of the
// sync engine (Phase D), which calls {@link buildRepoChanges} after
// this function. That helper accepts a `contentLoader` callback so the
// sync engine can fetch blob bytes lazily, in parallel, with whatever
// concurrency policy the write-client demands.
//
// The forward `diff-engine.ts` is NOT imported — the two engines
// operate on different fingerprint families (Git SHA-1 vs Azure ETag)
// and must stay independent (Investigation §Dimension 10 / D-2).
//
// Source of truth: docs/design/project-design.md §"Reverse-diff
// (ETag-based snapshot diff)" (5.1).
// ===========================================================================

import type {
  EnumeratedBlob,
  RepoChange,
  ReverseDiffResult,
} from "./reverse-git-types.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Options for {@link computeReverseDiff}. */
export interface ComputeReverseDiffOptions {
  /**
   * When true, every path that would normally be classified as
   * `unchanged` is re-classified as `modified`. Drives the `--force`
   * CLI flag (R4.8): re-pushes every tracked file regardless of ETag.
   * `added` and `deleted` are unaffected — they are membership-based,
   * not value-based.
   */
  force?: boolean;
}

/**
 * Compute the reverse diff between the current storage snapshot and
 * the last successfully pushed snapshot.
 *
 * Algorithm (design §5.1):
 *
 *   added    = currentPaths \ lastPaths
 *   deleted  = lastPaths \ currentPaths
 *   modified = { p ∈ both : currentSnapshot[p] != lastSnapshot[p] }
 *   unchanged = both \ modified
 *
 *   when `options.force === true`:
 *     modified  = modified ∪ unchanged
 *     unchanged = ∅
 *
 * The function is pure: no I/O, no time source, no randomness. Output
 * arrays are sorted lexicographically so consecutive calls with the
 * same inputs produce byte-identical results (useful for snapshot
 * tests and reproducible commit messages).
 *
 * @param linkId          The owning reverse-link's id, copied into the result.
 * @param currentSnapshot Map of `repoPath → etag` for blobs that exist
 *                        in storage RIGHT NOW (built by blob-enumerator).
 * @param lastSnapshot    Plain object `repoPath → etag` taken from the
 *                        reverse-link's `blobSnapshot` field. Empty
 *                        object means "first publish" — every current
 *                        blob will appear in `added`.
 * @param options         See {@link ComputeReverseDiffOptions}.
 */
export function computeReverseDiff(
  linkId: string,
  currentSnapshot: Map<string, string>,
  lastSnapshot: Record<string, string>,
  options?: ComputeReverseDiffOptions,
): ReverseDiffResult {
  const force = options?.force ?? false;

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  // 1. Walk current snapshot — classify added vs modified vs unchanged.
  for (const [path, etag] of currentSnapshot) {
    const lastEtag = Object.prototype.hasOwnProperty.call(lastSnapshot, path)
      ? lastSnapshot[path]
      : undefined;

    if (lastEtag === undefined) {
      added.push(path);
    } else if (lastEtag !== etag) {
      modified.push(path);
    } else {
      unchanged.push(path);
    }
  }

  // 2. Walk last snapshot — classify paths absent from current as deleted.
  for (const path of Object.keys(lastSnapshot)) {
    if (!currentSnapshot.has(path)) {
      deleted.push(path);
    }
  }

  // 3. `--force` semantics — promote unchanged → modified.
  let finalModified = modified;
  let finalUnchanged = unchanged;
  if (force) {
    finalModified = [...modified, ...unchanged];
    finalUnchanged = [];
  }

  // 4. Sort for deterministic output.
  added.sort();
  finalModified.sort();
  deleted.sort();
  finalUnchanged.sort();

  return {
    linkId,
    added,
    modified: finalModified,
    deleted,
    unchanged: finalUnchanged,
    counts: {
      added: added.length,
      modified: finalModified.length,
      deleted: deleted.length,
      unchanged: finalUnchanged.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: build a current snapshot from the enumerator's output.
// ---------------------------------------------------------------------------

/**
 * Drain an `AsyncIterable<EnumeratedBlob>` produced by
 * `blob-enumerator.ts` into the `(currentSnapshot, repoPathToStoragePath)`
 * pair the diff engine and content loader need.
 *
 * The `repoPathToStoragePath` lookup is needed by the content loader
 * to fetch bytes from Azure: the diff result speaks in repo paths
 * (`docs/foo.txt`), but the BlobClient needs the original storage path
 * (`my-container/foo.txt` post-prefix-strip).
 */
export async function collectSnapshot(
  blobs: AsyncIterable<EnumeratedBlob>,
): Promise<{
  snapshot: Map<string, string>;
  repoPathToStoragePath: Map<string, string>;
}> {
  const snapshot = new Map<string, string>();
  const repoPathToStoragePath = new Map<string, string>();
  for await (const b of blobs) {
    snapshot.set(b.repoPath, b.etag);
    repoPathToStoragePath.set(b.repoPath, b.storagePath);
  }
  return { snapshot, repoPathToStoragePath };
}

// ---------------------------------------------------------------------------
// Convenience: convert a diff result into a `RepoChange[]` ready for
// `RepoWriteClient.createCommit`.
// ---------------------------------------------------------------------------

/**
 * Callback that fetches the bytes for one repo path. The sync engine
 * supplies this — typically a wrapper around `BlobClient.getBlobContent`
 * that consults the `repoPathToStoragePath` map produced by
 * {@link collectSnapshot}.
 */
export type RepoChangeContentLoader = (repoPath: string) => Promise<Uint8Array>;

/**
 * Translate a {@link ReverseDiffResult} into a `RepoChange[]` suitable
 * for `RepoWriteClient.createCommit({ changes, ... })`.
 *
 * Content bytes are loaded ONLY for `add` and `edit` entries via the
 * supplied {@link RepoChangeContentLoader}. `delete` entries carry no
 * content (per the `RepoChange` discriminated union in
 * `reverse-git-types.ts`).
 *
 * The function does NOT impose a concurrency policy on the loader —
 * the sync engine (Phase D) is responsible for batching according to
 * the write client's rate-limit profile (GitHub: 10 in-flight uploads
 * per design D-13; ADO: single-shot push).
 *
 * @param diff           The pure diff produced by {@link computeReverseDiff}.
 * @param contentLoader  Loader invoked once per add/edit path.
 * @returns A list of `RepoChange` ready to ship to the write client.
 *          Ordering: all `add` first, then `edit`, then `delete` — this
 *          matches the order GitHub's tree assembly expects and is the
 *          same order ADO sees in `commits[0].changes`.
 */
export async function buildRepoChanges(
  diff: ReverseDiffResult,
  contentLoader: RepoChangeContentLoader,
): Promise<RepoChange[]> {
  const out: RepoChange[] = [];

  for (const path of diff.added) {
    const bytes = await contentLoader(path);
    out.push({ kind: "add", path, contentBytes: bytes });
  }
  for (const path of diff.modified) {
    const bytes = await contentLoader(path);
    out.push({ kind: "edit", path, contentBytes: bytes });
  }
  for (const path of diff.deleted) {
    out.push({ kind: "delete", path });
  }

  return out;
}
