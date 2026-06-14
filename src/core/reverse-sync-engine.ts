// ===========================================================================
// src/core/reverse-sync-engine.ts
//
// Reverse-git orchestration engine. Glues the Phase A write clients
// (`GitHubWriteClient`, `DevOpsWriteClient`), the Phase B enumerator +
// diff (`blob-enumerator.ts`, `reverse-diff-engine.ts`), and the Phase C
// registries (`reverse-link-registry.ts`, `credential-store.ts`) into a
// single end-to-end push pipeline.
//
// Public surface (per the Phase-D brief):
//
//   - initReverseLink(opts)     — create + persist a new ReverseLink record
//                                 (optionally auto-create the remote repo).
//   - pushReverseLink(linkId, opts) — enumerate → diff → push → persist
//                                 snapshot. The heart of the feature.
//   - previewReverseDiff(linkId)— enumerate → diff only (no push). Drives
//                                 the CLI `diff` subcommand and the UI
//                                 "Dry-Run Diff" panel.
//   - removeReverseLink(linkId, opts) — drop the link record. Never
//                                 touches the remote repo.
//   - listReverseLinks(scope)   — enumerate persisted links under a scope.
//
// Design-compat aliases (per `docs/design/project-design.md` §4.3):
//   - publishRepo(opts)         — alias for the per-link push path used by
//                                 the legacy design surface.
//   - resolveReverseLinks(opts) — fan-out helper used by `push --all`.
//
// Source of truth: docs/design/project-design.md §4.3 (signatures) and
// §5.3–§5.6 (algorithms).
// ===========================================================================

import type { BlobClient } from "./blob-client.js";
import type { CredentialStore } from "./credential-store.js";
import { generateInstallationToken } from "./github-app-auth.js";
import {
  buildRepoChanges,
  collectSnapshot,
  computeReverseDiff,
  type RepoChangeContentLoader,
} from "./reverse-diff-engine.js";
import { buildWriteClientForLink } from "./repo-utils.js";
import { enumerateScope } from "./blob-enumerator.js";
import {
  ConfigurationError,
  RemoteDivergedError,
  type CommitAuthor,
  type PushError,
  type PushResult,
  type RepoChange,
  type RepoVisibility,
  type RepoWriteClient,
  type ReverseDiffResult,
  type ReverseLink,
  type ReverseLinkScope,
} from "./reverse-git-types.js";
import {
  createReverseLink,
  findReverseLink,
  readAccountReverseLinks,
  readReverseLinks,
  removeReverseLink as registryRemoveReverseLink,
  updateReverseLink,
  writeAccountReverseLinks,
} from "./reverse-link-registry.js";

// ---------------------------------------------------------------------------
// Public option shapes
// ---------------------------------------------------------------------------

/** Input for {@link initReverseLink}. */
export interface InitReverseLinkOptions {
  /** Read/write access to Azure storage (required for container/prefix scope). */
  blobClient: BlobClient;
  /** Credential store — used to look up PATs by name. */
  credentialStore: CredentialStore;
  /** Source scope the link will publish from. */
  scope: ReverseLinkScope;
  /** Target provider. */
  provider: "github" | "azure-devops";
  /** Target repo identifier (owner/repo or full URL). */
  repoUrl: string;
  /** Branch name. Defaults to "main" when omitted. */
  branch?: string;
  /** Sub-folder inside the repo. Defaults to "" (repo root). */
  repoSubPath?: string;
  /** Name of the `TokenEntry` to use for this link. */
  tokenName: string;
  /** Commit author identity. Defaults to "Storage Navigator <storage-nav@local>". */
  author?: CommitAuthor;
  /** Glob-style exclusion patterns. */
  exclusionPatterns?: string[];
  /** Honour a `.gitignore` at the scope root. Default true. */
  respectGitignore?: boolean;
  /** When true and the repo is absent, create it on the remote. Default false. */
  createRepo?: boolean;
  /** Visibility — used only when `createRepo=true` and the repo did not exist. */
  visibility?: RepoVisibility;
  /** Optional explicit id; generated via `crypto.randomUUID()` when omitted. */
  id?: string;
  /**
   * Optional inline PAT override (CLI `--pat`). When supplied, supersedes
   * every other resolution path in {@link resolvePATForLink}. Required for
   * AC-C3: `--pat <inline-token>` must override any stored PAT.
   */
  patOverride?: string;
  /** Auth method used for this link (default "pat" for backward compat). */
  authType?: "pat" | "github-app";
  /** Name of the credential (PAT or GitHub App) used for this link. */
  authCredentialName?: string;
  /** Optional progress sink (NFR7). */
  onProgress?: (msg: string) => void;
}

/** Input for {@link pushReverseLink} / {@link publishRepo}. */
export interface PushOptions {
  /** Read/write access to Azure storage. */
  blobClient: BlobClient;
  /** Credential store — used to resolve the PAT for this link. */
  credentialStore: CredentialStore;
  /** When true, compute the diff but do NOT push. */
  dryRun?: boolean;
  /** When true, re-push every tracked file (R4.8). */
  force?: boolean;
  /** When true, override divergence with a force-update on the remote ref. */
  allowOverwriteRemote?: boolean;
  /** Override the commit message. */
  commitMessage?: string;
  /**
   * Optional inline PAT override (CLI `--pat`). When supplied, supersedes
   * every other resolution path in {@link resolvePATForLink}. Required for
   * AC-C3: `--pat <inline-token>` must override any stored PAT.
   */
  patOverride?: string;
  /**
   * Container the link is rooted in, when known by the caller (e.g. the
   * HTTP route `/api/push/:storage/:container/:linkId`, or a CLI scope
   * flag). Container/prefix-scoped links live in the container's
   * `.reverse-git-links.json` blob, NOT the account registry, so id-only
   * lookup cannot find them without this hint. Ignored for account-scope
   * links. See {@link lookupLinkById}.
   */
  containerHint?: string;
  /** Optional progress sink (NFR7). */
  onProgress?: (msg: string) => void;
}

/** Input for {@link removeReverseLink}. */
export interface RemoveOptions {
  /** Read/write access to Azure storage. */
  blobClient: BlobClient;
  /** Credential store — used for account-scope removal. */
  credentialStore: CredentialStore;
  /**
   * When true and the link's container registry becomes empty after the
   * removal, also delete the `.reverse-git-links.json` blob.
   * Currently a no-op stub: deletion is performed implicitly when the
   * registry is rewritten as empty. Reserved for future blob-deletion
   * support if `BlobClient.deleteBlob` is added.
   */
  removeEmptyRegistryBlob?: boolean;
  /**
   * Container the link is rooted in, when known by the caller. Required to
   * locate container/prefix-scoped links by id (they are not in the account
   * registry). Ignored for account-scope links. See {@link lookupLinkById}.
   */
  containerHint?: string;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a single reverse-link by id. Searches:
 *   1. Account-scope registry on `CredentialStore` (every recorded account).
 *   2. Container-scope `.reverse-git-links.json` for the supplied container
 *      hint, when provided.
 *
 * Returns `null` when the link cannot be located.
 */
async function lookupLinkById(
  blobClient: BlobClient,
  credentialStore: CredentialStore,
  linkId: string,
  containerHint?: string,
): Promise<ReverseLink | null> {
  // 1. Search account-scope registry (covers `kind:"account"` links).
  //    `getAccountReverseLinks` requires a known account name — we walk
  //    every account recorded in the credential store.
  const accountNames = collectAccountNames(credentialStore);
  for (const account of accountNames) {
    const links = readAccountReverseLinks(credentialStore, account);
    const hit = links.find((l) => l.id === linkId);
    if (hit) return hit;
  }

  // 2. Try the container hint when supplied.
  if (containerHint) {
    const hit = await findReverseLink(blobClient, containerHint, linkId);
    if (hit) return hit;
  }

  return null;
}

/**
 * Collect every storage-account name that appears as a key in the
 * `CredentialStore.reverseLinks.byAccount` map. We avoid reaching into
 * the store's private state by relying on `getAccountReverseLinks`
 * returning empty when an unknown account is queried — this helper
 * exposes the actual keys via a typed cast on the public surface.
 *
 * The store does not currently publish a "list known accounts" method,
 * so we make a defensive cast through `unknown` to read the internal
 * registry. If a future refactor adds a public accessor, this helper
 * should switch to it.
 */
function collectAccountNames(store: CredentialStore): string[] {
  const internal = store as unknown as {
    data?: { reverseLinks?: { byAccount?: Record<string, ReverseLink[]> } };
  };
  const map = internal.data?.reverseLinks?.byAccount;
  return map ? Object.keys(map) : [];
}

/**
 * Persist an updated link back to whichever registry owns it
 * (account-scope vs. container-scope).
 */
async function persistLink(
  blobClient: BlobClient,
  credentialStore: CredentialStore,
  link: ReverseLink,
): Promise<void> {
  if (link.scope.kind === "account") {
    const list = readAccountReverseLinks(credentialStore, link.scope.account);
    const idx = list.findIndex((l) => l.id === link.id);
    if (idx < 0) {
      // Link not previously stored — append.
      list.push(link);
    } else {
      list[idx] = link;
    }
    await writeAccountReverseLinks(credentialStore, link.scope.account, list);
    return;
  }
  // container / prefix scope → blob-based registry on the container.
  const ok = await updateReverseLink(blobClient, link.scope.container, link);
  if (!ok) {
    // Link not yet recorded — create it.
    await createReverseLink(blobClient, link.scope.container, link);
  }
}

// ---------------------------------------------------------------------------
// PAT resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the PAT to use for a given link. Priority:
 *   0. Inline `patOverride` (CLI `--pat`) — takes precedence over every
 *      stored resolution. Required for AC-C3.
 *   1. Explicit `linkId → tokenName` binding on `CredentialStore`
 *      (`getReverseLinkPAT`).
 *   2. The `tokenName` field stored on the link itself
 *      (`getToken(link.tokenName)`).
 *   3. The provider's first matching token (`getTokenByProvider`).
 *
 * Throws `ConfigurationError` when no PAT can be found. Per the
 * project's no-fallback rule, we do NOT substitute a default value.
 */
function resolvePATForLink(
  store: CredentialStore,
  link: ReverseLink,
  patOverride?: string,
): string {
  if (patOverride) return patOverride;

  const explicit = store.getReverseLinkPAT(link.id);
  if (explicit) return explicit;

  if (link.tokenName) {
    const tok = store.getToken(link.tokenName);
    if (tok?.token) return tok.token;
  }

  const fallback = store.getTokenByProvider(link.provider);
  if (fallback?.token) return fallback.token;

  throw new ConfigurationError(
    `No PAT available for reverse-link '${link.id}' (provider=${link.provider}, ` +
      `tokenName='${link.tokenName}'). Configure a token via 'add-token' or ` +
      `bind a token to the link before pushing.`,
  );
}

/**
 * Resolve authentication token for a reverse-link (PAT or GitHub App).
 * 
 * @param store Credential store
 * @param link The reverse-link record
 * @param patOverride Inline PAT override (takes precedence)
 * @returns Bearer token string (PAT or installation token)
 */
async function resolveTokenForLink(
  store: CredentialStore,
  link: ReverseLink,
  patOverride?: string,
): Promise<string> {
  // Inline PAT override always takes precedence (AC-C3)
  if (patOverride) return patOverride;
  
  // GitHub App auth
  if (link.authType === "github-app") {
    const credName = link.authCredentialName ?? "";
    const appEntry = store.getGitHubApp(credName);
    if (!appEntry) {
      throw new ConfigurationError(
        `GitHub App '${credName}' not found for reverse-link '${link.id}'. ` +
        `Run 'storage-nav list-github-apps' to see available credentials.`
      );
    }
    return await generateInstallationToken(
      appEntry.appId,
      appEntry.privateKeyPem,
      appEntry.installationId
    );
  }
  
  // PAT auth (default)
  return resolvePATForLink(store, link, patOverride);
}

// ---------------------------------------------------------------------------
// initReverseLink
// ---------------------------------------------------------------------------

/**
 * Create a new {@link ReverseLink}, optionally auto-create the remote
 * repository, and persist the record to the appropriate registry:
 *
 *   - `kind: "container"` / `"prefix"`  → `.reverse-git-links.json`
 *     at the container root.
 *   - `kind: "account"`                 → `CredentialData.reverseLinks`.
 *
 * Does NOT push any blobs — that's `pushReverseLink`. The returned link
 * has an empty `blobSnapshot` so the first push classifies every blob
 * as `added`.
 */
export async function initReverseLink(
  opts: InitReverseLinkOptions,
): Promise<ReverseLink> {
  const branch = opts.branch ?? "main";
  const author: CommitAuthor = opts.author ?? {
    name: "Storage Navigator",
    email: "storage-nav@local",
  };
  const id = opts.id ?? cryptoRandomUuid();
  const visibility: RepoVisibility = opts.visibility ?? "private";

  const link: ReverseLink = {
    id,
    scope: opts.scope,
    provider: opts.provider,
    repoUrl: opts.repoUrl,
    branch,
    repoSubPath: opts.repoSubPath ?? "",
    tokenName: opts.tokenName,
    author,
    exclusionPatterns: opts.exclusionPatterns ?? [],
    respectGitignore: opts.respectGitignore ?? true,
    createRepo: opts.createRepo ?? false,
    visibility,
    authType: opts.authType,
    authCredentialName: opts.authCredentialName,
    blobSnapshot: {},
    createdAt: new Date().toISOString(),
  };

  // Optional remote repo creation — short-circuits when the link does
  // not request it; lets the user create the link record up-front and
  // create the remote repo later via `pushReverseLink`.
  if (link.createRepo) {
    opts.onProgress?.(
      `Ensuring repo ${link.repoUrl} exists (createIfMissing=true)…`,
    );
    const token = await resolveTokenForLink(opts.credentialStore, link, opts.patOverride);
    const client = buildWriteClientForLink(link, token, opts.credentialStore);
    await client.ensureRepo({
      name: link.repoUrl,
      visibility,
      createIfMissing: true,
    });
  }

  // Persist into the right registry.
  if (link.scope.kind === "account") {
    const list = readAccountReverseLinks(
      opts.credentialStore,
      link.scope.account,
    );
    if (list.some((l) => l.id === link.id)) {
      throw new Error(
        `Reverse-link with id '${link.id}' already exists for account '${link.scope.account}'`,
      );
    }
    list.push(link);
    await writeAccountReverseLinks(
      opts.credentialStore,
      link.scope.account,
      list,
    );
  } else {
    await createReverseLink(opts.blobClient, link.scope.container, link);
  }

  return link;
}

// ---------------------------------------------------------------------------
// pushReverseLink (the heart of Phase D)
// ---------------------------------------------------------------------------

/**
 * Enumerate the current scope, compute the reverse diff against the
 * stored snapshot, push the resulting commit to the remote, and persist
 * the updated snapshot back to the link record.
 *
 * Honours {@link PushOptions.dryRun}, {@link PushOptions.force}, and
 * {@link PushOptions.allowOverwriteRemote}. Throws
 * {@link RemoteDivergedError} when the remote tip drifted since the
 * last successful push (unless `allowOverwriteRemote` is set).
 *
 * Order of operations matches design §5.5 / §5.6:
 *
 *   1. Load link from registry.
 *   2. Resolve PAT (binding → link.tokenName → provider fallback).
 *   3. Build write client.
 *   4. Pre-flight divergence check (`getCurrentRefSha`).
 *   5. Enumerate blobs → snapshot.
 *   6. Compute reverse diff against last snapshot.
 *   7. Short-circuit on `dryRun` OR zero changes.
 *   8. Load content for added/modified via `BlobClient.getBlobContent`.
 *   9. `createCommit` on the write client.
 *  10. Persist updated link (`blobSnapshot`, `lastPushed*`, `lastPushResult`).
 *  11. Return {@link PushResult}.
 */
export async function pushReverseLink(
  linkId: string,
  opts: PushOptions,
): Promise<PushResult> {
  const onProgress = opts.onProgress ?? (() => undefined);

  // 1. Load link.
  const link = await lookupLinkById(
    opts.blobClient,
    opts.credentialStore,
    linkId,
    opts.containerHint,
  );
  if (!link) {
    throw new ConfigurationError(`Reverse-link '${linkId}' not found`);
  }

  // 2. Resolve token (PAT or GitHub App installation token).
  const token = await resolveTokenForLink(opts.credentialStore, link, opts.patOverride);

  // 3. Build write client.
  const client = buildWriteClientForLink(link, token, opts.credentialStore);

  // Ensure the repo exists (no auto-create on push — first publish must
  // explicitly opt-in via initReverseLink's createRepo flag or the
  // dedicated `publish-*` CLI which routes through initReverseLink).
  onProgress(`Verifying repo ${link.repoUrl}…`);
  await client.ensureRepo({
    name: link.repoUrl,
    visibility: link.visibility,
    createIfMissing: false,
  });

  // 4. Pre-flight divergence check.
  onProgress(`Reading branch tip for '${link.branch}'…`);
  const currentRemoteSha = await client.getCurrentRefSha(link.branch);
  if (
    link.lastPushedCommitSha &&
    currentRemoteSha &&
    currentRemoteSha !== link.lastPushedCommitSha &&
    !opts.allowOverwriteRemote
  ) {
    throw new RemoteDivergedError(
      link.lastPushedCommitSha,
      currentRemoteSha,
      `Remote branch '${link.branch}' diverged: local=${link.lastPushedCommitSha} ` +
        `remote=${currentRemoteSha}. Re-run with --allow-overwrite-remote ` +
        `to force-update the remote.`,
    );
  }

  // 5. Enumerate blobs into a snapshot.
  onProgress(`Enumerating blobs for scope ${describeScope(link.scope)}…`);
  const { snapshot, repoPathToStoragePath } = await collectSnapshot(
    enumerateScope(opts.blobClient, link.scope, {
      exclusionPatterns: link.exclusionPatterns,
      respectGitignore: link.respectGitignore,
      repoSubPath: link.repoSubPath,
      onWarn: (msg) => onProgress(msg),
    }),
  );

  // 6. Compute reverse diff against the last snapshot.
  const diff = computeReverseDiff(link.id, snapshot, link.blobSnapshot, {
    force: opts.force ?? false,
  });
  onProgress(
    `Diff: +${diff.counts.added} ~${diff.counts.modified} ` +
      `-${diff.counts.deleted} =${diff.counts.unchanged}`,
  );

  const at = new Date().toISOString();

  // 7. Short-circuit on no changes OR dry-run.
  const hasChanges =
    diff.counts.added + diff.counts.modified + diff.counts.deleted > 0;

  if (opts.dryRun) {
    onProgress("Dry-run: skipping push.");
    return {
      linkId: link.id,
      pushed: false,
      added: diff.added,
      modified: diff.modified,
      deleted: diff.deleted,
      skipped: [],
      errors: [],
      at,
    };
  }

  if (!hasChanges) {
    onProgress("No changes detected — nothing to push.");
    return {
      linkId: link.id,
      pushed: false,
      added: [],
      modified: [],
      deleted: [],
      skipped: [],
      errors: [],
      at,
    };
  }

  // 8. Build RepoChange[] with a content loader that pulls bytes from
  //    Azure Blob storage. The loader consults the `repoPath →
  //    storagePath` map produced by `collectSnapshot` so we go through
  //    the canonical `BlobClient.getBlobContent` path for every byte.
  const contentLoader: RepoChangeContentLoader = async (repoPath) => {
    const storagePath = repoPathToStoragePath.get(repoPath);
    if (!storagePath) {
      throw new Error(
        `Internal error: no storage-path mapping for repo path '${repoPath}'`,
      );
    }
    return loadBlobBytes(opts.blobClient, storagePath);
  };

  let changes: RepoChange[];
  try {
    changes = await buildRepoChanges(diff, contentLoader);
  } catch (err) {
    // Failure during content load — surface as a fatal error rather
    // than silently producing a partial commit.
    throw err instanceof Error
      ? err
      : new Error(`Content load failed: ${String(err)}`);
  }

  // 9. Push.
  onProgress(
    `Pushing ${changes.length} change(s) to ${link.repoUrl}@${link.branch}…`,
  );
  const commitMessage =
    opts.commitMessage ??
    defaultCommitMessage(diff.counts, link.scope, link.repoSubPath);

  // Resolve parent commit + tree SHAs. For an empty repo, both are
  // null (initial publish — the write client handles the 0×40
  // / Strategy-A bootstrap internally).
  const tip = await client.getBranchTip(link.branch);
  const parentCommitSha = tip?.commitSha ?? null;
  const parentTreeSha = tip?.treeSha ?? null;

  const result = await client.createCommit({
    branch: link.branch,
    parentCommitSha,
    parentTreeSha,
    message: commitMessage,
    author: link.author,
    changes,
    allowForce: opts.allowOverwriteRemote ?? false,
  });

  // 10. Persist updated link. The snapshot is replaced wholesale with
  //     the current enumeration (drops `deleted` paths, refreshes
  //     ETags for `added` + `modified` + `unchanged`).
  const newSnapshot: Record<string, string> = {};
  for (const [path, etag] of snapshot) {
    newSnapshot[path] = etag;
  }

  const pushErrors: PushError[] = result.perFileErrors.map((e) => ({
    path: e.path,
    reason: e.reason,
    at,
  }));

  // Paths that were intended changes but ended up in perFileErrors are
  // considered "skipped" rather than successfully pushed. The summary
  // counts on the link's `lastPushResult` reflect what actually landed.
  const skippedSet = new Set(pushErrors.map((e) => e.path));
  const added = diff.added.filter((p) => !skippedSet.has(p));
  const modified = diff.modified.filter((p) => !skippedSet.has(p));
  const deleted = diff.deleted.filter((p) => !skippedSet.has(p));

  const updatedLink: ReverseLink = {
    ...link,
    blobSnapshot: newSnapshot,
    lastPushedCommitSha: result.commitSha,
    lastPushedTreeSha: result.treeSha,
    lastPushedAt: at,
    lastPushResult: {
      added: added.length,
      modified: modified.length,
      deleted: deleted.length,
      errors: pushErrors,
    },
  };
  await persistLink(opts.blobClient, opts.credentialStore, updatedLink);

  onProgress(
    `Pushed commit ${result.commitSha} (` +
      `+${added.length} ~${modified.length} -${deleted.length}, ` +
      `${pushErrors.length} per-file error(s)).`,
  );

  // 11. Return PushResult.
  return {
    linkId: link.id,
    pushed: true,
    commitSha: result.commitSha,
    treeSha: result.treeSha,
    added,
    modified,
    deleted,
    skipped: Array.from(skippedSet),
    errors: pushErrors,
    at,
  };
}

// ---------------------------------------------------------------------------
// previewReverseDiff — Steps 1–6 of pushReverseLink, no push.
// ---------------------------------------------------------------------------

/**
 * Compute the reverse-diff for a link WITHOUT pushing. Used by the CLI
 * `diff` subcommand and the UI "Dry-Run Diff" button.
 *
 * Unlike `pushReverseLink({ dryRun: true })`, this function does not
 * round-trip to the remote (no `ensureRepo`, no `getCurrentRefSha`) —
 * it only needs the local snapshot + the stored snapshot.
 */
export async function previewReverseDiff(
  linkId: string,
  opts: {
    blobClient: BlobClient;
    credentialStore: CredentialStore;
    /** Container hint to locate container/prefix-scoped links by id. */
    containerHint?: string;
  },
): Promise<ReverseDiffResult> {
  const link = await lookupLinkById(
    opts.blobClient,
    opts.credentialStore,
    linkId,
    opts.containerHint,
  );
  if (!link) {
    throw new ConfigurationError(`Reverse-link '${linkId}' not found`);
  }
  const { snapshot } = await collectSnapshot(
    enumerateScope(opts.blobClient, link.scope, {
      exclusionPatterns: link.exclusionPatterns,
      respectGitignore: link.respectGitignore,
      repoSubPath: link.repoSubPath,
    }),
  );
  return computeReverseDiff(link.id, snapshot, link.blobSnapshot);
}

// ---------------------------------------------------------------------------
// removeReverseLink — drop the link record (NEVER touches the remote).
// ---------------------------------------------------------------------------

/**
 * Remove a reverse-link from whichever registry owns it. Does NOT
 * delete the remote repository or any commits — that is intentionally
 * out of scope for v1 (refined-request §"Out of scope").
 */
export async function removeReverseLink(
  linkId: string,
  opts: RemoveOptions,
): Promise<void> {
  const link = await lookupLinkById(
    opts.blobClient,
    opts.credentialStore,
    linkId,
    opts.containerHint,
  );
  if (!link) {
    throw new ConfigurationError(`Reverse-link '${linkId}' not found`);
  }

  if (link.scope.kind === "account") {
    const list = readAccountReverseLinks(
      opts.credentialStore,
      link.scope.account,
    );
    const filtered = list.filter((l) => l.id !== linkId);
    await writeAccountReverseLinks(
      opts.credentialStore,
      link.scope.account,
      filtered,
    );
    return;
  }

  await registryRemoveReverseLink(opts.blobClient, link.scope.container, linkId);

  // `opts.removeEmptyRegistryBlob` is reserved for future use. The
  // current registry semantics already rewrite the blob as an empty
  // registry (no `links`) when the last entry is removed, which is
  // benign for downstream readers. Explicit blob deletion would
  // require a `BlobClient.deleteBlob` method that does not yet exist.
  void opts.removeEmptyRegistryBlob;
}

// ---------------------------------------------------------------------------
// listReverseLinks — enumerate persisted links for a scope.
// ---------------------------------------------------------------------------

/**
 * Enumerate every persisted reverse-link whose scope matches `scope`.
 *
 *   - `kind: "account"`   → reads `CredentialData.reverseLinks.byAccount[account]`.
 *   - `kind: "container"` → reads `.reverse-git-links.json` under the
 *                            container; returns every link of any kind
 *                            stored there (typically `container` and
 *                            `prefix` entries).
 *   - `kind: "prefix"`    → same as `container`, then filters by prefix.
 */
export async function listReverseLinks(
  scope: ReverseLinkScope,
  opts: { blobClient: BlobClient; credentialStore: CredentialStore },
): Promise<ReverseLink[]> {
  if (scope.kind === "account") {
    return readAccountReverseLinks(opts.credentialStore, scope.account);
  }

  if (scope.kind === "container") {
    const registry = await readReverseLinks(opts.blobClient, scope.container);
    return registry.links;
  }

  // prefix scope — read container registry, filter by prefix.
  const registry = await readReverseLinks(opts.blobClient, scope.container);
  return registry.links.filter(
    (l) =>
      l.scope.kind === "prefix" &&
      l.scope.container === scope.container &&
      l.scope.prefix === scope.prefix,
  );
}

// ---------------------------------------------------------------------------
// Design-compat aliases
// ---------------------------------------------------------------------------

/**
 * Alias for `pushReverseLink` accepting the legacy design signature
 * (`{ link, ... }` rather than `(linkId, opts)`). Used by the CLI
 * `publish-*` handlers that pass an already-loaded link.
 */
export async function publishRepo(opts: {
  blobClient: BlobClient;
  credentialStore: CredentialStore;
  link: ReverseLink;
  pat?: string;
  options?: {
    dryRun?: boolean;
    force?: boolean;
    allowOverwriteRemote?: boolean;
  };
  onProgress?: (msg: string) => void;
}): Promise<PushResult> {
  // Persist the link first so `pushReverseLink` can look it up.
  await persistLink(opts.blobClient, opts.credentialStore, opts.link);
  return pushReverseLink(opts.link.id, {
    blobClient: opts.blobClient,
    credentialStore: opts.credentialStore,
    dryRun: opts.options?.dryRun,
    force: opts.options?.force,
    allowOverwriteRemote: opts.options?.allowOverwriteRemote,
    patOverride: opts.pat,
    onProgress: opts.onProgress,
  });
}

/**
 * Fan-out helper used by `push --all`. Returns every link matching
 * the supplied hint:
 *
 *   - `linkId`    → exact id (single-element list).
 *   - `container` → all links recorded in that container's registry.
 *   - `account`   → account-scope links for the named account.
 *   - `all=true`  → all account-scope links across every known account.
 */
export async function resolveReverseLinks(opts: {
  blobClient: BlobClient;
  credentialStore: CredentialStore;
  scopeHint: {
    container?: string;
    prefix?: string;
    account?: string;
    linkId?: string;
    all?: boolean;
  };
}): Promise<ReverseLink[]> {
  const { blobClient, credentialStore, scopeHint } = opts;

  if (scopeHint.linkId) {
    const link = await lookupLinkById(
      blobClient,
      credentialStore,
      scopeHint.linkId,
      scopeHint.container,
    );
    return link ? [link] : [];
  }

  if (scopeHint.container) {
    const registry = await readReverseLinks(blobClient, scopeHint.container);
    if (scopeHint.prefix) {
      return registry.links.filter(
        (l) => l.scope.kind === "prefix" && l.scope.prefix === scopeHint.prefix,
      );
    }
    return registry.links;
  }

  if (scopeHint.account) {
    return readAccountReverseLinks(credentialStore, scopeHint.account);
  }

  if (scopeHint.all) {
    const out: ReverseLink[] = [];
    for (const account of collectAccountNames(credentialStore)) {
      out.push(...readAccountReverseLinks(credentialStore, account));
    }
    return out;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read a blob's bytes via `BlobClient.getBlobContent`. */
async function loadBlobBytes(
  blobClient: BlobClient,
  storagePath: string,
): Promise<Uint8Array> {
  const slash = storagePath.indexOf("/");
  if (slash < 0) {
    throw new Error(
      `Invalid storage path '${storagePath}' — expected 'container/blobName'`,
    );
  }
  const container = storagePath.slice(0, slash);
  const blobName = storagePath.slice(slash + 1);
  const content = await blobClient.getBlobContent(container, blobName);
  if (typeof content.content === "string") {
    return new TextEncoder().encode(content.content);
  }
  // Buffer is a Uint8Array subclass — return a defensive slice so the
  // caller can't mutate the underlying buffer.
  const buf = content.content;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Default commit message based on the diff counts and scope. */
function defaultCommitMessage(
  counts: { added: number; modified: number; deleted: number },
  scope: ReverseLinkScope,
  repoSubPath: string,
): string {
  const target = repoSubPath ? `${repoSubPath}` : describeScope(scope);
  return (
    `Storage Navigator: +${counts.added} ~${counts.modified} -${counts.deleted} ` +
    `from ${target}`
  );
}

/** Human-readable description of a scope (used in progress + commit messages). */
function describeScope(scope: ReverseLinkScope): string {
  switch (scope.kind) {
    case "account":
      return `account ${scope.account}`;
    case "container":
      return `${scope.account}/${scope.container}`;
    case "prefix":
      return `${scope.account}/${scope.container}/${scope.prefix}`;
  }
}

/**
 * UUID v4 generator. Uses the Node `crypto` web-API binding when
 * available (Node ≥ 19), falls back to a tiny implementation
 * otherwise. We avoid importing `node:crypto` directly so this module
 * stays usable in any runtime that polyfills `globalThis.crypto`.
 */
function cryptoRandomUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // RFC 4122 v4 fallback — random bits with version + variant nibbles.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { RepoWriteClient };
