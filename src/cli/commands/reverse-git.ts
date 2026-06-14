// ===========================================================================
// src/cli/commands/reverse-git.ts
//
// CLI handlers for the reverse-git publication feature.
//
// Implements the seven Commander subcommands defined in
// `docs/design/project-design.md` §4.1 (CLI subcommand matrix):
//
//   publishGitHub        → publish-github
//   publishDevOps        → publish-devops
//   reverseLinkGitHub    → reverse-link-github
//   reverseLinkDevOps    → reverse-link-devops
//   pushReverseLinkCmd   → push
//   reverseUnlink        → reverse-unlink
//   listReverseLinksCmd  → list-reverse-links
//
// Each handler:
//   1. Resolves the storage entry (`resolveStorageEntry`) and PAT
//      (`resolvePatToken`) via the shared chain.
//   2. Builds a `BlobClient` for direct-mode access.
//   3. Translates CLI flags into the engine's option shape.
//   4. Dispatches to `reverse-sync-engine.ts`.
//   5. Maps the result + thrown typed errors to the tri-state exit code
//      (0 = no-op/success, 1 = changes pushed/would push, 2 = fatal,
//       3 = configuration error) per
//      `docs/design/plan-011-reverse-git.md` §"Error type taxonomy".
//
// No business logic lives here — every algorithm is in
// `reverse-sync-engine.ts`. This file is purely an I/O adaptor.
// ===========================================================================

import { BlobClient } from "../../core/blob-client.js";
import {
  initReverseLink,
  pushReverseLink,
  removeReverseLink,
  listReverseLinks,
  resolveReverseLinks,
} from "../../core/reverse-sync-engine.js";
import {
  ReverseGitError,
  ConfigurationError,
} from "../../core/reverse-git-errors.js";
import type {
  CommitAuthor,
  PushResult,
  RepoVisibility,
  ReverseLink,
  ReverseLinkScope,
} from "../../core/reverse-git-types.js";
import type { DirectStorageEntry } from "../../core/types.js";
import {
  promptYesNo,
  resolveGitHubCredential,
  resolvePatToken,
  resolveStorageEntry,
  type GitHubAppOpts,
  type PatOpts,
  type StorageOpts,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Shared option shapes
// ---------------------------------------------------------------------------

/**
 * Scope flags shared by every reverse-git command.
 *
 * Resolution precedence (per design §4.1): `--prefix > --container > --storage`.
 * When only `--storage` is provided the scope is an account-level scope
 * (every container under the account becomes a top-level folder in the
 * target repo — see D-4 / R5.3).
 */
export interface ReverseScopeOpts {
  container?: string;
  prefix?: string;
}

/**
 * Publishing target + behavioural flags shared by `publish-*` and
 * `reverse-link-*`. These match the design's "Target flags" column
 * exactly.
 */
export interface PublishTargetOpts {
  repo: string;
  branch?: string;
  commitMessage?: string;
  exclude?: string[];
  respectGitignore?: boolean;
  repoSubPath?: string;
  visibility?: string;
  createRepo?: boolean;
  authorName?: string;
  authorEmail?: string;
  /** Azure DevOps only. */
  org?: string;
  /** Azure DevOps only. */
  project?: string;
}

/** Operation flags accepted by the `push` subcommand. */
export interface PushOperationOpts {
  dryRun?: boolean;
  force?: boolean;
  allowOverwriteRemote?: boolean;
  all?: boolean;
  linkId?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Translate the scope flags into a typed `ReverseLinkScope` for the
 * supplied storage entry. The storage entry must be a direct (Azure)
 * entry — reverse-git does not support API-backend storages because the
 * write path requires direct blob enumeration.
 */
function buildScope(
  entry: DirectStorageEntry,
  scope: ReverseScopeOpts,
): ReverseLinkScope {
  if (scope.prefix) {
    if (!scope.container) {
      throw new ConfigurationError(
        "--prefix requires --container (a prefix scope is rooted in a container).",
      );
    }
    return {
      kind: "prefix",
      account: entry.accountName,
      container: scope.container,
      prefix: scope.prefix,
    };
  }
  if (scope.container) {
    return {
      kind: "container",
      account: entry.accountName,
      container: scope.container,
    };
  }
  return { kind: "account", account: entry.accountName };
}

/**
 * Parse the `--visibility` flag into a `RepoVisibility`. Defaults to
 * `private` per D-3 when omitted. Rejects any other value via
 * `ConfigurationError`.
 */
function parseVisibility(raw: string | undefined): RepoVisibility {
  if (!raw) return "private";
  if (raw === "public" || raw === "private") return raw;
  throw new ConfigurationError(
    `--visibility must be 'public' or 'private' (got '${raw}').`,
  );
}

/**
 * Build a `CommitAuthor` from the `--author-name` / `--author-email`
 * flags. Returns `undefined` when both are absent so the engine can
 * apply its default ("Storage Navigator <storage-nav@local>").
 */
function buildAuthor(
  authorName: string | undefined,
  authorEmail: string | undefined,
): CommitAuthor | undefined {
  if (!authorName && !authorEmail) return undefined;
  if (!authorName || !authorEmail) {
    throw new ConfigurationError(
      "--author-name and --author-email must be provided together.",
    );
  }
  return { name: authorName, email: authorEmail };
}

/**
 * Compose the Azure DevOps repo identifier from `--org`, `--project`,
 * and `--repo`. The engine's write client accepts either a full URL or
 * an ADO triple — we synthesise the canonical URL here so the rest of
 * the pipeline does not branch on provider.
 */
function buildDevOpsRepoUrl(
  org: string | undefined,
  project: string | undefined,
  repo: string,
): string {
  // If `repo` is already a URL, trust the user.
  if (repo.startsWith("http://") || repo.startsWith("https://")) {
    return repo;
  }
  if (!org || !project) {
    throw new ConfigurationError(
      "publish-devops requires --org and --project when --repo is a bare name (or pass a full repo URL).",
    );
  }
  return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
}

/**
 * Render the relevant summary for a {@link PushResult} to stdout and
 * return the tri-state exit code:
 *
 *   - dry-run with changes pending: 1
 *   - dry-run with no changes:      0
 *   - pushed (commit landed):       1
 *   - no-op (already in sync):      0
 *
 * Errors are reported but never raise the exit code on their own — they
 * surface inside the result and the user can inspect them. Fatal errors
 * are thrown by the engine before reaching this point.
 */
function reportPushResult(result: PushResult, dryRun: boolean): 0 | 1 {
  const addedCount = result.added.length;
  const modifiedCount = result.modified.length;
  const deletedCount = result.deleted.length;
  const skippedCount = result.skipped.length;
  const errorCount = result.errors.length;
  const hasChanges = addedCount + modifiedCount + deletedCount > 0;

  console.log();
  if (dryRun) {
    console.log(`(dry-run) Would push: +${addedCount} ~${modifiedCount} -${deletedCount}, skipped ${skippedCount}, errors ${errorCount}`);
  } else if (result.pushed) {
    console.log(`Commit ${result.commitSha ?? "(no commit)"} pushed.`);
    console.log(`  Added:    ${addedCount}`);
    console.log(`  Modified: ${modifiedCount}`);
    console.log(`  Deleted:  ${deletedCount}`);
    if (skippedCount > 0) console.log(`  Skipped:  ${skippedCount}`);
    if (errorCount > 0) console.log(`  Errors:   ${errorCount}`);
  } else {
    console.log(`No changes detected — nothing to push.`);
  }

  if (errorCount > 0) {
    console.error(`\nPer-file errors (${errorCount}):`);
    for (const e of result.errors) {
      console.error(`  ${e.path}: ${e.reason}`);
    }
  }

  return hasChanges ? 1 : 0;
}

/**
 * Translate a thrown error into an exit code and a human-readable
 * stderr message. Honours the taxonomy in
 * `docs/design/plan-011-reverse-git.md` §"Error type taxonomy" by
 * reading the typed error's `exitCode` property.
 *
 * Non-`ReverseGitError` instances exit 2 by default.
 */
function reportError(err: unknown): never {
  if (err instanceof ReverseGitError) {
    console.error(`[${err.code}] ${err.message}`);
    process.exit(err.exitCode);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[error] ${msg}`);
  process.exit(2);
}

/**
 * Ensure we have a direct-mode storage entry (account key or SAS token
 * authentication). Reverse-git writes through `BlobClient` which only
 * supports direct mode — see `src/core/blob-client.ts` for the
 * invariant.
 */
function assertDirectEntry(
  entry: { kind: string; name: string },
): asserts entry is DirectStorageEntry {
  if (entry.kind !== "direct") {
    throw new ConfigurationError(
      `Storage '${entry.name}' is kind='${entry.kind}'. ` +
        `reverse-git requires a direct-mode storage entry (account key or SAS token).`,
    );
  }
}

// ---------------------------------------------------------------------------
// publishGitHub / publishDevOps
// ---------------------------------------------------------------------------

/**
 * `publish-github` — initialise a reverse-link to a GitHub repo and
 * immediately push the current scope contents.
 *
 * Exit codes: 0 no-op, 1 pushed, 2 fatal, 3 configuration error.
 */
export async function publishGitHub(
  scope: ReverseScopeOpts,
  target: PublishTargetOpts,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  appOpts: GitHubAppOpts,
): Promise<void> {
  try {
    if (!target.repo) {
      throw new ConfigurationError("publish-github requires --repo <owner/repo>.");
    }
    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    
    // Resolve GitHub credential (PAT or GitHub App)
    const { token, authType, credentialName } = await resolveGitHubCredential(
      store,
      "github",
      patOpts,
      appOpts
    );
    
    const blobClient = new BlobClient(entry);

    const linkScope = buildScope(entry, scope);
    const visibility = parseVisibility(target.visibility);
    const author = buildAuthor(target.authorName, target.authorEmail);

    console.log(`Publishing to github:${target.repo} (branch: ${target.branch ?? "main"})...`);

    // Pass the resolved token to the engine as `patOverride` (supports both PAT and GitHub App tokens)
    const link = await initReverseLink({
      blobClient,
      credentialStore: store,
      scope: linkScope,
      provider: "github",
      repoUrl: target.repo,
      branch: target.branch,
      repoSubPath: target.repoSubPath,
      tokenName: patOpts.tokenName ?? "",
      author,
      exclusionPatterns: target.exclude ?? [],
      respectGitignore: target.respectGitignore ?? true,
      createRepo: target.createRepo ?? false,
      visibility,
      authType,
      authCredentialName: credentialName,
      patOverride: token,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    const result = await pushReverseLink(link.id, {
      blobClient,
      credentialStore: store,
      containerHint:
        link.scope.kind === "account" ? undefined : link.scope.container,
      commitMessage: target.commitMessage,
      patOverride: token,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    const code = reportPushResult(result, false);
    process.exit(code);
  } catch (err) {
    reportError(err);
  }
}

/**
 * `publish-devops` — initialise a reverse-link to an Azure DevOps repo
 * and immediately push the current scope contents.
 *
 * Exit codes: 0 no-op, 1 pushed, 2 fatal, 3 configuration error.
 */
export async function publishDevOps(
  scope: ReverseScopeOpts,
  target: PublishTargetOpts,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
): Promise<void> {
  try {
    if (!target.repo) {
      throw new ConfigurationError("publish-devops requires --repo <name|url>.");
    }
    const repoUrl = buildDevOpsRepoUrl(target.org, target.project, target.repo);

    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    const pat = await resolvePatToken(store, "azure-devops", patOpts);
    const blobClient = new BlobClient(entry);

    const linkScope = buildScope(entry, scope);
    // `--visibility` is accepted but ignored for ADO (project-level
    // visibility is inherited from the parent project) — surface this
    // explicitly in the help text rather than throwing.
    void parseVisibility(target.visibility);
    const author = buildAuthor(target.authorName, target.authorEmail);

    console.log(`Publishing to azure-devops:${repoUrl} (branch: ${target.branch ?? "main"})...`);

    const link = await initReverseLink({
      blobClient,
      credentialStore: store,
      scope: linkScope,
      provider: "azure-devops",
      repoUrl,
      branch: target.branch,
      repoSubPath: target.repoSubPath,
      tokenName: patOpts.tokenName ?? "",
      author,
      exclusionPatterns: target.exclude ?? [],
      respectGitignore: target.respectGitignore ?? true,
      createRepo: target.createRepo ?? false,
      // ADO ignores visibility — pass "private" as a no-op default.
      visibility: "private",
      patOverride: pat,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    const result = await pushReverseLink(link.id, {
      blobClient,
      credentialStore: store,
      containerHint:
        link.scope.kind === "account" ? undefined : link.scope.container,
      commitMessage: target.commitMessage,
      patOverride: pat,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    const code = reportPushResult(result, false);
    process.exit(code);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// reverseLinkGitHub / reverseLinkDevOps — create link without pushing
// ---------------------------------------------------------------------------

/**
 * `reverse-link-github` — create a reverse-link record pointing at a
 * GitHub repo WITHOUT pushing any blobs.
 *
 * Exit codes: 0 created, 2 fatal, 3 configuration error.
 */
export async function reverseLinkGitHub(
  scope: ReverseScopeOpts,
  target: PublishTargetOpts,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  appOpts: GitHubAppOpts,
): Promise<void> {
  try {
    if (!target.repo) {
      throw new ConfigurationError("reverse-link-github requires --repo <owner/repo>.");
    }
    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    
    // Resolve GitHub credential (PAT or GitHub App)
    const { token, authType, credentialName } = await resolveGitHubCredential(
      store,
      "github",
      patOpts,
      appOpts
    );
    
    const blobClient = new BlobClient(entry);

    const linkScope = buildScope(entry, scope);
    const visibility = parseVisibility(target.visibility);
    const author = buildAuthor(target.authorName, target.authorEmail);

    const link = await initReverseLink({
      blobClient,
      credentialStore: store,
      scope: linkScope,
      provider: "github",
      repoUrl: target.repo,
      branch: target.branch,
      repoSubPath: target.repoSubPath,
      tokenName: patOpts.tokenName ?? "",
      author,
      exclusionPatterns: target.exclude ?? [],
      respectGitignore: target.respectGitignore ?? true,
      authType,
      authCredentialName: credentialName,
      patOverride: token,
      createRepo: target.createRepo ?? false,
      visibility,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    console.log(`Reverse-link created. ID: ${link.id}`);
    console.log(`  Repo:   ${link.repoUrl}`);
    console.log(`  Branch: ${link.branch}`);
    console.log(`  Scope:  ${describeScope(link.scope)}`);
    console.log(`\nRun 'push --link-id ${link.id}' to publish.`);
    process.exit(0);
  } catch (err) {
    reportError(err);
  }
}

/**
 * `reverse-link-devops` — create a reverse-link record pointing at an
 * Azure DevOps repo WITHOUT pushing any blobs.
 *
 * Exit codes: 0 created, 2 fatal, 3 configuration error.
 */
export async function reverseLinkDevOps(
  scope: ReverseScopeOpts,
  target: PublishTargetOpts,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
): Promise<void> {
  try {
    if (!target.repo) {
      throw new ConfigurationError("reverse-link-devops requires --repo <name|url>.");
    }
    const repoUrl = buildDevOpsRepoUrl(target.org, target.project, target.repo);

    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    const pat = await resolvePatToken(store, "azure-devops", patOpts);
    const blobClient = new BlobClient(entry);

    const linkScope = buildScope(entry, scope);
    const author = buildAuthor(target.authorName, target.authorEmail);

    const link = await initReverseLink({
      blobClient,
      credentialStore: store,
      scope: linkScope,
      provider: "azure-devops",
      repoUrl,
      branch: target.branch,
      repoSubPath: target.repoSubPath,
      tokenName: patOpts.tokenName ?? "",
      author,
      exclusionPatterns: target.exclude ?? [],
      respectGitignore: target.respectGitignore ?? true,
      createRepo: target.createRepo ?? false,
      visibility: "private",
      patOverride: pat,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    console.log(`Reverse-link created. ID: ${link.id}`);
    console.log(`  Repo:   ${link.repoUrl}`);
    console.log(`  Branch: ${link.branch}`);
    console.log(`  Scope:  ${describeScope(link.scope)}`);
    console.log(`\nRun 'push --link-id ${link.id}' to publish.`);
    process.exit(0);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// push — execute a push for one or more reverse-links
// ---------------------------------------------------------------------------

/**
 * `push` — execute a push (or dry-run) for one or more reverse-links.
 *
 * Selection precedence:
 *   1. `--link-id <uuid>`         — push the single named link.
 *   2. `--all`                    — push every link in the resolved scope.
 *   3. `--container` / `--prefix` — push the (single) link recorded at that scope.
 *
 * `--all` and `--link-id` are mutually exclusive.
 *
 * Exit codes: 0 no changes / dry-run no-op, 1 pushed (or would push in
 * dry-run), 2 fatal.
 */
export async function pushReverseLinkCmd(
  scope: ReverseScopeOpts,
  op: PushOperationOpts,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  appOpts: GitHubAppOpts,
): Promise<void> {
  try {
    if (op.all && op.linkId) {
      throw new ConfigurationError(
        "--all and --link-id are mutually exclusive.",
      );
    }

    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    const blobClient = new BlobClient(entry);

    // Resolve which link(s) to push.
    const linksToPush = await resolveReverseLinks({
      blobClient,
      credentialStore: store,
      scopeHint: {
        linkId: op.linkId,
        container: scope.container,
        prefix: scope.prefix,
        account: scope.container || scope.prefix ? undefined : entry.accountName,
        all: op.all,
      },
    });

    if (linksToPush.length === 0) {
      console.error("No matching reverse-links found.");
      process.exit(2);
    }

    // Resolve a PAT override only when the user supplied an inline `--pat`
    // or `--token-name`. We can't always resolve a single PAT up-front
    // because different links may target different providers — in that
    // case we let the engine fall back to its per-link resolution chain.
    // An inline `--pat`, however, MUST take precedence (AC-C3).
    let inlinePat: string | undefined;
    if (patOpts.pat) {
      inlinePat = patOpts.pat;
    } else if (patOpts.tokenName) {
      // Same-name lookup works for both providers (the token-name is
      // provider-agnostic); resolve once and reuse.
      const tok = store.getToken(patOpts.tokenName);
      if (!tok) {
        throw new ConfigurationError(
          `Token '${patOpts.tokenName}' not found in credential store.`,
        );
      }
      inlinePat = tok.token;
    }

    let aggregateExit: 0 | 1 = 0;

    for (const link of linksToPush) {
      console.log(
        `Pushing link ${link.id.slice(0, 8)} (${link.provider}) → ${link.repoUrl}@${link.branch}`,
      );
      if (op.dryRun) console.log("  (dry-run — no changes will be made)");

      const result = await pushReverseLink(link.id, {
        blobClient,
        credentialStore: store,
        containerHint:
          link.scope.kind === "account" ? undefined : link.scope.container,
        dryRun: op.dryRun,
        force: op.force,
        allowOverwriteRemote: op.allowOverwriteRemote,
        patOverride: inlinePat,
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      const code = reportPushResult(result, op.dryRun ?? false);
      if (code === 1) aggregateExit = 1;

      if (linksToPush.length > 1) console.log(); // visual separator
    }

    process.exit(aggregateExit);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// reverseUnlink — drop a link record (does NOT touch the remote)
// ---------------------------------------------------------------------------

/**
 * `reverse-unlink` — remove a reverse-link record. NEVER touches the
 * remote repository.
 *
 * Confirms before deleting unless `--yes` (passed via `assumeYes`) is
 * set.
 *
 * Exit codes: 0 removed, 2 fatal, 3 configuration error.
 */
export async function reverseUnlink(
  scope: ReverseScopeOpts,
  linkId: string | undefined,
  storageOpts: StorageOpts,
  assumeYes: boolean,
): Promise<void> {
  try {
    if (!linkId) {
      throw new ConfigurationError("reverse-unlink requires --link-id <uuid>.");
    }
    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    const blobClient = new BlobClient(entry);

    // Locate the link first so we can show what we are about to remove.
    const candidates = await resolveReverseLinks({
      blobClient,
      credentialStore: store,
      scopeHint: {
        linkId,
        container: scope.container,
        prefix: scope.prefix,
        account: scope.container || scope.prefix ? undefined : entry.accountName,
      },
    });
    const link = candidates.find((l) => l.id === linkId);
    if (!link) {
      console.error(`Reverse-link '${linkId}' not found.`);
      process.exit(2);
    }

    console.log(`About to remove reverse-link:`);
    console.log(`  ID:     ${link.id}`);
    console.log(`  Repo:   ${link.repoUrl}@${link.branch}`);
    console.log(`  Scope:  ${describeScope(link.scope)}`);
    console.log(`  (Remote repository will NOT be touched.)`);

    if (!assumeYes) {
      const ok = await promptYesNo("Proceed?");
      if (!ok) {
        console.log("Cancelled.");
        process.exit(0);
      }
    }

    await removeReverseLink(link.id, {
      blobClient,
      credentialStore: store,
      containerHint:
        link.scope.kind === "account" ? undefined : link.scope.container,
    });
    console.log("Reverse-link removed.");
    process.exit(0);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// listReverseLinks — tabular enumeration of persisted links
// ---------------------------------------------------------------------------

/**
 * `list-reverse-links` — print every persisted reverse-link rooted at
 * the resolved scope.
 *
 *   - `--container <name>` (no `--prefix`)  → container registry.
 *   - `--container <name> --prefix <p>`     → just that prefix's link(s).
 *   - (no scope flags)                       → account-scope registry.
 *
 * Exit codes: 0 always (even when the registry is empty), 2 fatal.
 */
export async function listReverseLinksCmd(
  scope: ReverseScopeOpts,
  storageOpts: StorageOpts,
): Promise<void> {
  try {
    const { store, entry } = await resolveStorageEntry(storageOpts);
    assertDirectEntry(entry);
    const blobClient = new BlobClient(entry);

    const links = await listReverseLinks(
      buildScope(entry, scope),
      { blobClient, credentialStore: store },
    );

    if (links.length === 0) {
      console.log("No reverse-links found.");
      process.exit(0);
    }

    const header = [
      "ID".padEnd(10),
      "Provider".padEnd(14),
      "Repo".padEnd(50),
      "Branch".padEnd(16),
      "Scope".padEnd(28),
      "Last Push",
    ].join("  ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const l of links) {
      const repo = l.repoUrl.length > 48
        ? l.repoUrl.slice(0, 47) + "…"
        : l.repoUrl;
      const row = [
        l.id.slice(0, 8).padEnd(10),
        l.provider.padEnd(14),
        repo.padEnd(50),
        l.branch.padEnd(16),
        describeScope(l.scope).padEnd(28),
        l.lastPushedAt ?? "never",
      ].join("  ");
      console.log(row);
    }
    process.exit(0);
  } catch (err) {
    reportError(err);
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Render a `ReverseLinkScope` as a single-line, human-readable string. */
function describeScope(s: ReverseLink["scope"]): string {
  switch (s.kind) {
    case "account":
      return `account:${s.account}`;
    case "container":
      return `${s.account}/${s.container}`;
    case "prefix":
      return `${s.account}/${s.container}/${s.prefix}`;
  }
}
