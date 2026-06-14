// ===========================================================================
// src/core/reverse-link-registry.ts
// CRUD on the reverse-link registry.
//
// Two storage layers are supported:
//
//   1. Container/prefix scope — persisted as a single `.reverse-git-links.json`
//      blob at the container root. Mirrors the existing `.repo-links.json`
//      pattern from `sync-engine.ts`.
//
//   2. Storage-account scope — persisted inside `CredentialData.reverseLinks`
//      (the encrypted credentials.json envelope). Wrapped by the methods
//      `CredentialStore.getAccountReverseLinks` / `setAccountReverseLinks`.
//
// This module dispatches by `ReverseLinkScope.kind`:
//   - kind `"container"` / `"prefix"` → blob-based registry
//   - kind `"account"`                → account-scope registry on the store
//
// Source of truth: docs/design/project-design.md §"Module structure" +
// §"Inter-module signatures".
// ===========================================================================

import type { BlobClient } from "./blob-client.js";
import type { CredentialStore } from "./credential-store.js";
import {
  REVERSE_LINKS_BLOB,
  type ReverseGitLinkRegistry,
  type ReverseLink,
} from "./reverse-git-types.js";

// ---------------------------------------------------------------------------
// Container/prefix scope — `.reverse-git-links.json` blob CRUD
// ---------------------------------------------------------------------------

/**
 * Read the reverse-link registry from a container.
 *
 * Returns an empty registry (schemaVersion 1, no links) when the blob does
 * not exist. This matches the existing `resolveLinks` semantics in
 * `sync-engine.ts` and lets callers treat "no metadata yet" and "empty
 * metadata" identically.
 */
export async function readReverseLinks(
  blobClient: BlobClient,
  container: string,
): Promise<ReverseGitLinkRegistry> {
  try {
    const blob = await blobClient.getBlobContent(container, REVERSE_LINKS_BLOB);
    const text =
      typeof blob.content === "string"
        ? blob.content
        : blob.content.toString("utf-8");
    const parsed = JSON.parse(text) as ReverseGitLinkRegistry;
    // Defensive: missing fields on hand-edited blobs become empty rather than
    // undefined property accesses later in the pipeline.
    if (!parsed.links) parsed.links = [];
    if (!parsed.schemaVersion) parsed.schemaVersion = 1;
    return parsed;
  } catch {
    return { schemaVersion: 1, links: [] };
  }
}

/**
 * Write the reverse-link registry to a container.
 *
 * Overwrites the existing blob (last-writer-wins). The forward `writeLinks`
 * in `sync-engine.ts` has the same posture — concurrent CLI + UI writes are
 * documented as a known limitation; see plan-011 Phase C risks.
 */
export async function writeReverseLinks(
  blobClient: BlobClient,
  container: string,
  registry: ReverseGitLinkRegistry,
): Promise<void> {
  const content = JSON.stringify(registry, null, 2);
  await blobClient.createBlob(
    container,
    REVERSE_LINKS_BLOB,
    content,
    "application/json",
  );
}

/**
 * Append a new reverse-link to the container registry.
 *
 * Reads the latest registry, pushes the new link, writes it back. Throws if
 * a link with the same `id` already exists — the caller is expected to
 * generate IDs via `crypto.randomUUID()` so collisions are vanishingly rare,
 * but we detect the conflict instead of silently overwriting.
 */
export async function createReverseLink(
  blobClient: BlobClient,
  container: string,
  link: ReverseLink,
): Promise<void> {
  const registry = await readReverseLinks(blobClient, container);
  if (registry.links.some((l) => l.id === link.id)) {
    throw new Error(
      `Reverse-link with id '${link.id}' already exists in container '${container}'`,
    );
  }
  registry.links.push(link);
  await writeReverseLinks(blobClient, container, registry);
}

/**
 * Remove a reverse-link by id from the container registry.
 *
 * Returns `true` when a link was removed, `false` when no matching id was
 * found. The blob is rewritten only on actual removal to avoid spurious
 * ETag churn.
 */
export async function removeReverseLink(
  blobClient: BlobClient,
  container: string,
  linkId: string,
): Promise<boolean> {
  const registry = await readReverseLinks(blobClient, container);
  const before = registry.links.length;
  registry.links = registry.links.filter((l) => l.id !== linkId);
  if (registry.links.length === before) {
    return false;
  }
  await writeReverseLinks(blobClient, container, registry);
  return true;
}

/**
 * Look up a single reverse-link by id within a container registry.
 *
 * Returns `null` when no matching id exists.
 */
export async function findReverseLink(
  blobClient: BlobClient,
  container: string,
  linkId: string,
): Promise<ReverseLink | null> {
  const registry = await readReverseLinks(blobClient, container);
  return registry.links.find((l) => l.id === linkId) ?? null;
}

/**
 * Replace a single reverse-link in the container registry by id.
 *
 * Used by the engine to persist `lastPushedCommitSha`, `blobSnapshot`,
 * `lastPushResult`, etc. after a successful push. Returns `true` when the
 * link was found and updated, `false` otherwise.
 */
export async function updateReverseLink(
  blobClient: BlobClient,
  container: string,
  link: ReverseLink,
): Promise<boolean> {
  const registry = await readReverseLinks(blobClient, container);
  const idx = registry.links.findIndex((l) => l.id === link.id);
  if (idx < 0) return false;
  registry.links[idx] = link;
  await writeReverseLinks(blobClient, container, registry);
  return true;
}

// ---------------------------------------------------------------------------
// Storage-account scope — wraps the methods on `CredentialStore`
// ---------------------------------------------------------------------------

/**
 * Read the storage-account-scope reverse-links for a given account name.
 *
 * Returns an empty array when the account has no links recorded. Delegates
 * to `CredentialStore.getAccountReverseLinks` so the same backward-compat
 * semantics (missing field on older config files → `[]`) are honoured.
 */
export function readAccountReverseLinks(
  store: CredentialStore,
  account: string,
): ReverseLink[] {
  return store.getAccountReverseLinks(account);
}

/**
 * Persist the storage-account-scope reverse-links for a given account.
 *
 * Replaces the full list (caller is responsible for the merge if needed).
 * Delegates to `CredentialStore.setAccountReverseLinks` which initialises
 * the `reverseLinks` field on `CredentialData` lazily on first write.
 */
export async function writeAccountReverseLinks(
  store: CredentialStore,
  account: string,
  links: ReverseLink[],
): Promise<void> {
  await store.setAccountReverseLinks(account, links);
}
