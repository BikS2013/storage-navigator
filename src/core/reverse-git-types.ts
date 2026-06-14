// ===========================================================================
// src/core/reverse-git-types.ts
// All types and constants for the reverse-git feature.
//
// This file is the canonical source for the data models consumed by every
// reverse-git module (engine, write clients, registry, CLI, server). It is
// re-exported from `src/core/types.ts` so legacy single-import call sites
// continue to compile.
//
// Source of truth: docs/design/project-design.md §"Data models".
// ===========================================================================

// Re-export typed errors so callers can pull them from this module too — the
// reverse-git feature uses both pure data types and error classes; lifting
// them here gives downstream files (engine, CLI, server) one import surface.
export * from "./reverse-git-errors.js";

/** Well-known blob name for container/prefix-scope reverse-link metadata. */
export const REVERSE_LINKS_BLOB = ".reverse-git-links.json";

/** Blob names that must NEVER be published to a remote repo. */
export const EXCLUDED_BLOB_NAMES: readonly string[] = [
  ".repo-sync-meta.json",
  ".repo-links.json",
  ".reverse-git-links.json",
];

// ---------------------------------------------------------------------------
// Reverse-link scope
// ---------------------------------------------------------------------------

/**
 * Source scope for a reverse-link. Discriminated union by `kind`.
 *
 * - `account`   — every container in the storage account becomes a top-
 *                 level folder in the repo (R5.3).
 * - `container` — a single container is mirrored 1:1 (R5.1).
 * - `prefix`    — a prefix inside a container is published with the prefix
 *                 stripped at the repo root (R5.2).
 */
export type ReverseLinkScope =
  | { kind: "account"; account: string }
  | { kind: "container"; account: string; container: string }
  | { kind: "prefix"; account: string; container: string; prefix: string };

// ---------------------------------------------------------------------------
// Reverse-link record
// ---------------------------------------------------------------------------

/** Default author identity for generated commits. */
export interface CommitAuthor {
  name: string;
  email: string;
}

/** Configurable per-link visibility for first-time repo auto-creation. */
export type RepoVisibility = "public" | "private";

/**
 * The ReverseLink record — directional opposite of `RepoLink`.
 *
 * Persisted either (a) inside `.reverse-git-links.json` at the container
 * root for container/prefix scope, or (b) inside
 * `CredentialData.reverseLinks` for storage-account scope.
 */
export interface ReverseLink {
  /** UUID v4 via `crypto.randomUUID()`. */
  id: string;
  /** Source scope (account / container / prefix). */
  scope: ReverseLinkScope;
  /** Provider — drives which `RepoWriteClient` is instantiated. */
  provider: "github" | "azure-devops";
  /**
   * Target repository identifier.
   *  - GitHub:       `owner/repo`  (or full URL — normalised at parse)
   *  - Azure DevOps: `https://dev.azure.com/{org}/{project}/_git/{repo}`
   */
  repoUrl: string;
  /** Branch name. Default `"main"` when omitted by user. */
  branch: string;
  /** Sub-folder inside the repo to write to. Default `""` (repo root). */
  repoSubPath: string;
  /** Name of the `TokenEntry` in `CredentialStore` used for this link. */
  tokenName: string;
  /** Author identity baked into every commit. */
  author: CommitAuthor;
  /** `.gitignore`-style exclusion patterns relative to the source scope root. */
  exclusionPatterns: string[];
  /** When true, honour a `.gitignore` present inside the source scope. */
  respectGitignore: boolean;
  /** Whether `ensureRepo` may create the repo if missing. Honoured ONLY on first publish. */
  createRepo: boolean;
  /** Visibility used iff `createRepo=true` and the repo did not exist. */
  visibility: RepoVisibility;
  /** ISO 8601 of last successful push. */
  lastPushedAt?: string;
  /** Last pushed commit SHA — used for divergence detection. */
  lastPushedCommitSha?: string;
  /** Last pushed tree SHA — informational. Null for ADO (server-side only). */
  lastPushedTreeSha?: string | null;
  /** path → ETag map for the LAST successful push. Drives reverse-diff. */
  blobSnapshot: Record<string, string>;
  /** ISO 8601 of creation. */
  createdAt: string;
  /** Counts + per-file errors from the last attempt. */
  lastPushResult?: {
    added: number;
    modified: number;
    deleted: number;
    errors: PushError[];
  };
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

/** Container-scope registry blob shape (persisted at `.reverse-git-links.json`). */
export interface ReverseGitLinkRegistry {
  /** Schema version. Bump on incompatible changes. */
  schemaVersion: 1;
  /** All reverse-links rooted at this container (`kind: "container"` or `"prefix"`). */
  links: ReverseLink[];
}

/** Storage-account-scope registry shape (lives inside `CredentialData`). */
export interface AccountScopeReverseLinksRegistry {
  schemaVersion: 1;
  /** Keyed by storage-account name. Each entry is a list of `kind:"account"` links. */
  byAccount: Record<string, ReverseLink[]>;
}

/**
 * Optional PAT-binding record stored alongside `TokenEntry`. Informational
 * — when present it provides an explicit `linkId → tokenName` mapping that
 * supersedes the `ReverseLink.tokenName` field. Phase C ships the type and
 * the companion CRUD methods on `CredentialStore`; downstream phases may
 * or may not honour the binding (current engines read `ReverseLink.tokenName`
 * directly).
 */
export interface ReverseGitLinkPATBinding {
  linkId: string;
  tokenName: string;
}

// ---------------------------------------------------------------------------
// RepoWriteClient — provider-agnostic write contract
// ---------------------------------------------------------------------------

/** Unified change for `RepoWriteClient.createCommit()`. */
export type RepoChange =
  | { kind: "add"; path: string; contentBytes: Uint8Array }
  | { kind: "edit"; path: string; contentBytes: Uint8Array }
  | { kind: "delete"; path: string };

/** Input shape for `RepoWriteClient.createCommit`. */
export interface RepoWriteClientCommitInput {
  branch: string;
  /** null → root commit (initial publish to empty repo). */
  parentCommitSha: string | null;
  /** null → use server-side resolution (ADO). GitHub uses for `base_tree`. */
  parentTreeSha: string | null;
  message: string;
  author: CommitAuthor;
  changes: RepoChange[];
  /** Force ref update past divergence (`--allow-overwrite-remote`). */
  allowForce?: boolean;
}

/** Output shape from `RepoWriteClient.createCommit`. */
export interface RepoWriteClientCommitResult {
  commitSha: string;
  /** Returned by GitHub; ADO returns it in `commits[0].treeId`. */
  treeSha: string | null;
  /** Per-file failures that did NOT abort the commit. */
  perFileErrors: Array<{ path: string; reason: string }>;
}

/**
 * The provider-agnostic write contract — implemented by `GitHubWriteClient`
 * (Phase A) and `DevOpsWriteClient` (Phase A).
 *
 * The interface deliberately exposes both the canonical 3 methods
 * (`ensureRepo`, `getBranchTip`, `createCommit`) AND a handful of helper
 * methods (`getOrCreateRepo`, `getCurrentRefSha`, `listRepoFiles`,
 * `pushChanges`, `bootstrapEmpty`) that the engine layer needs for
 * `--force` re-push, initial-publish bootstrap, and divergence pre-checks.
 */
export interface RepoWriteClient {
  /**
   * Verify the repo exists. If `createIfMissing` and the repo is absent,
   * create it (GitHub: `POST /user/repos` or `/orgs/.. ` with
   * `auto_init: true`; ADO: `POST /_apis/git/repositories`). Throws
   * `RepoNotFoundError` otherwise.
   */
  ensureRepo(opts: {
    name: string;
    visibility: RepoVisibility;
    createIfMissing: boolean;
  }): Promise<void>;

  /**
   * Read the current tip of `branch`. Returns `null` when the branch does
   * not exist (truly empty repo OR branch never created).
   */
  getBranchTip(
    branch: string,
  ): Promise<{ commitSha: string; treeSha: string | null } | null>;

  /**
   * Build one commit from `changes` and advance `branch`. Returns the new
   * commit + tree SHAs. Throws `RemoteDivergedError` when the current tip
   * `!= input.parentCommitSha` (unless `allowForce` is true).
   */
  createCommit(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult>;

  // ---- Convenience helpers exposed for the engine layer ------------------

  /** Build-or-create repo (alias for `ensureRepo` — kept for naming parity). */
  getOrCreateRepo(opts: {
    name: string;
    visibility: RepoVisibility;
    createIfMissing: boolean;
  }): Promise<void>;

  /** Synonym for `getBranchTip().commitSha` — `null` when branch absent. */
  getCurrentRefSha(branch: string): Promise<string | null>;

  /** List existing files (paths only) on `branch`. Used by `--force` re-push. */
  listRepoFiles(branch: string): Promise<string[]>;

  /** Apply a batch of changes — alias for `createCommit` (provider-neutral). */
  pushChanges(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult>;

  /**
   * Strategy A bootstrap: invoked when GitHub creates the repo with
   * `auto_init: true`. Pulls init commit/tree SHAs so the subsequent
   * `createCommit` can use `base_tree`. For ADO (which has no auto-init),
   * this is a no-op.
   */
  bootstrapEmpty(branch: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Push & reverse-diff results
// ---------------------------------------------------------------------------

/** Per-file error accumulated in `PushResult` (NFR4). */
export interface PushError {
  path: string;
  reason: string;
  /** ISO 8601 of when the error was captured. */
  at: string;
}

/** Result of a push (initial or incremental). */
export interface PushResult {
  linkId: string;
  /** Whether any commit was actually pushed (false on no-op / dry-run with no changes). */
  pushed: boolean;
  /** New commit SHA on the remote, set when `pushed === true`. */
  commitSha?: string;
  /** New tree SHA — GitHub only; null/undefined for ADO. */
  treeSha?: string | null;
  added: string[];
  modified: string[];
  deleted: string[];
  skipped: string[];
  errors: PushError[];
  /** ISO 8601 of the push attempt. */
  at: string;
}

/** Reverse-diff classification. */
export type DiffCategoryReverse =
  | "added"
  | "modified"
  | "deleted"
  | "unchanged";

/** Detailed diff between current storage snapshot and last-pushed snapshot. */
export interface ReverseDiffResult {
  linkId: string;
  /** Repo paths now present in storage but not in the last snapshot. */
  added: string[];
  /** Repo paths whose ETag changed since the last snapshot. */
  modified: string[];
  /** Repo paths last pushed but now absent from storage. */
  deleted: string[];
  /** Repo paths whose ETag matches the last snapshot. */
  unchanged: string[];
  /** Total counts for the CLI/UI summary. */
  counts: {
    added: number;
    modified: number;
    deleted: number;
    unchanged: number;
  };
}

/** A single enumerated blob from `blob-enumerator`. */
export interface EnumeratedBlob {
  storagePath: string;
  repoPath: string;
  etag: string;
  size: number;
}
