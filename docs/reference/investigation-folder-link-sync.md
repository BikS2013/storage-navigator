# Investigation: Folder-Level Repository Linking and Sync

**Date:** 2026-04-02
**Status:** Complete
**Inputs:** `docs/reference/refined-request-folder-link-sync.md`, `docs/reference/codebase-scan-folder-link-sync.md`, full source review of affected files.

---

## 1. Metadata Storage Approach

### 1.1 Recommendation: Single `.repo-links.json` at Container Root

The refined request proposes a single `.repo-links.json` blob per container holding an array of `RepoLink` entries. This is the correct approach for the following reasons:

1. **Atomic reads** -- A single blob read returns the full link registry. No need to scan the container for scattered metadata files.
2. **Conflict detection is centralized** -- Checking for overlapping `targetPrefix` values requires inspecting all links at once. A single file makes this a simple in-memory check.
3. **No path ambiguity** -- Per-folder metadata (e.g., storing `.repo-link.json` inside each linked folder) would create ambiguity when a folder is deleted or renamed, and would require scanning during sync to discover all links.
4. **Consistent with the existing pattern** -- The current `.repo-sync-meta.json` is a single blob at the container root. Evolving to `.repo-links.json` at the same location is the natural next step.

**Alternative considered and rejected:** Per-folder `.repo-link.json` files. This would avoid the "registry" pattern but introduces discovery overhead (must list all blobs to find links), makes conflict detection harder, and creates orphan metadata risk when folders are deleted.

### 1.2 Migration from `.repo-sync-meta.json`

The proposed auto-migration strategy is sound and low-risk:

1. On any read path (`readSyncMeta`, `readLinks`, or any API that needs link data), check for `.repo-links.json` first.
2. If absent but `.repo-sync-meta.json` exists, construct a `RepoLinksRegistry` with a single link derived from the old metadata. Write `.repo-links.json`. Retain `.repo-sync-meta.json` as-is.
3. All subsequent operations use `.repo-links.json` exclusively.

**Implementation detail:** The migration function should generate a deterministic UUID for the migrated link (e.g., a UUID v5 seeded from the repoUrl + branch) rather than a random UUID. This prevents duplicate migration if the write succeeds but the caller retries. However, since Azure Blob Storage writes are atomic (the blob either exists or it does not), a random UUID v4 is acceptable -- a retry of the migration would overwrite with a new UUID, which is harmless because no external system references the ID at migration time.

**Recommendation:** Use `crypto.randomUUID()` (available in Node.js 19+, and the project uses Node with ESM). Simple, no extra dependencies.

### 1.3 Schema Versioning

The `version: 1` field in `RepoLinksRegistry` is good practice. If the schema needs to change later, the reader can detect the version and apply the appropriate parser. No additional versioning mechanism is needed now.

---

## 2. Path Filtering for Sub-Folder Sync

### 2.1 Current State

Both `GitHubClient.listFiles()` and `DevOpsClient.listFiles()` return the **full repository tree** as an array of `RepoFileEntry` objects with `path` (relative to repo root), `sha`, and optional `size`. The sync engine iterates over all entries, comparing SHAs and uploading/deleting blobs. There is no filtering at any level.

### 2.2 Recommended Approach: Post-Fetch Filtering in Sync Engine

The refined request correctly identifies that filtering should happen **after** the full file list is retrieved, since the GitHub/DevOps tree APIs return the entire tree anyway. This means:

**In `cloneRepo` and `syncRepo`:**

```
// After: const remoteFiles = await provider.listFiles();
// Add:
const filteredFiles = filterByRepoSubPath(remoteFiles, link.repoSubPath);
const mappedFiles = mapToTargetPaths(filteredFiles, link.repoSubPath, link.targetPrefix);
```

The two transforms are:

1. **Filter** -- Keep only entries where `file.path` starts with `repoSubPath` (normalized with trailing slash). If `repoSubPath` is undefined/empty, no filtering occurs.
2. **Map** -- For each kept entry, compute `blobPath = targetPrefix + relativePath` where `relativePath = file.path.slice(repoSubPath.length)`. Store both the original repo path (for `provider.downloadFile()`) and the blob path (for `blobClient.createBlob()`).

This means the internal data structure during clone/sync needs to carry both the **repo path** (for downloading from the provider) and the **blob path** (for storing in Azure). Currently, `file.path` serves as both. With the new feature, these diverge.

**Suggested internal type:**

```typescript
interface MappedFileEntry {
  repoPath: string;    // Original path in the repository (for provider.downloadFile)
  blobPath: string;    // Target path in the container (for blobClient.createBlob)
  sha: string;
}
```

This type is internal to `sync-engine.ts` and does not need to be exported.

### 2.3 Path Normalization

The codebase scan identifies path normalization as a risk area. Specifically:

- `targetPrefix` might or might not have a trailing slash. Users typing `prompts/coa` vs `prompts/coa/` should get the same result.
- `repoSubPath` similarly needs normalization.

**Recommendation:** Create a `normalizePath(path: string): string` utility in `sync-engine.ts` that:
- Trims leading and trailing slashes.
- Returns an empty string for undefined/null/empty input.

Then, when constructing blob paths:
- If `targetPrefix` is non-empty: `blobPath = normalizedTargetPrefix + "/" + relativePath`
- If `targetPrefix` is empty: `blobPath = relativePath`

Same logic for stripping `repoSubPath` from repo file paths.

### 2.4 Performance Consideration

For large repositories, the full tree fetch is the bottleneck (GitHub returns up to 100,000 entries per tree API call). Filtering is an O(n) operation on the returned array, which is negligible. No optimization is needed here.

---

## 3. Backward Compatibility

### 3.1 Existing `clone-github` / `clone-devops` Commands

These commands currently write `.repo-sync-meta.json`. After the change, they should write to `.repo-links.json` instead. However, to maintain backward compatibility for any external tools that read `.repo-sync-meta.json`, the recommendation is:

**Option A (Recommended):** Clone commands write `.repo-links.json` only. The old `readSyncMeta` function is updated to read from `.repo-links.json` first (extracting the single root-level link) and fall back to `.repo-sync-meta.json`. This means new clones produce the new format, and old containers auto-migrate on first access.

**Option B (Rejected):** Write both files. This creates a dual-write maintenance burden and risks them drifting out of sync.

### 3.2 Existing `sync` Command

The `sync` command currently calls `readSyncMeta()` and then `syncRepo()`. After the change:

1. `sync` without `--prefix` or `--link-id` on a single-link container: works exactly as before (auto-migration if needed, then syncs the single link).
2. `sync` without `--prefix` or `--link-id` on a multi-link container: prints an error listing available links and instructing the user to specify `--prefix`, `--link-id`, or `--all`.
3. `sync --all`: syncs all links sequentially (not concurrently, to avoid rate-limiting issues with provider APIs).

### 3.3 Existing Server Endpoints

- `GET /api/sync-meta/:storage/:container`: Returns the first (or only) link in the registry, formatted as the old `RepoSyncMeta` shape. This preserves backward compatibility for any UI code that has not yet been updated.
- `POST /api/sync/:storage/:container`: Works for single-link containers. Returns 400 with guidance for multi-link containers.

### 3.4 `fileShas` Key Format Change

Currently, `fileShas` keys are repo-relative paths (e.g., `src/templates/extract.json`). With the new feature, `fileShas` keys in a `RepoLink` should be **blob paths** (e.g., `prompts/coa/extract.json`) since that is what we compare against in the container. The repo path can always be reconstructed as `repoSubPath + relativePath`.

For migrated links (from `.repo-sync-meta.json` where `targetPrefix` is undefined and `repoSubPath` is undefined), blob paths and repo paths are identical, so migration is transparent.

---

## 4. Sync Engine Refactoring Strategy

### 4.1 Current Function Signatures

```typescript
cloneRepo(blobClient, container, provider, meta, onProgress)
syncRepo(blobClient, container, provider, dryRun, onProgress)
```

### 4.2 Proposed Refactored Signatures

```typescript
cloneRepo(blobClient, container, provider, link: RepoLink, onProgress)
syncRepo(blobClient, container, provider, link: RepoLink, dryRun, onProgress)
```

Both functions now accept a `RepoLink` that carries `targetPrefix`, `repoSubPath`, and `fileShas`. The functions apply path filtering/mapping internally.

**Key change in `syncRepo`:** Instead of calling `readSyncMeta()` internally, the caller provides the `RepoLink`. After sync completes, the engine updates the link's `lastSyncAt`, `lastCommitSha`, and `fileShas`, and the caller writes the updated registry.

This means the caller (`repo-sync.ts` commands and `server.ts` endpoints) is responsible for:
1. Reading the link registry.
2. Selecting the appropriate link.
3. Calling `syncRepo` with that link.
4. Writing the updated registry back.

This separation of concerns keeps the sync engine focused on file operations and metadata transformation, while the caller handles registry I/O and link selection.

### 4.3 New Functions in `sync-engine.ts`

| Function | Purpose |
|----------|---------|
| `readLinks(blobClient, container)` | Read `.repo-links.json`, return `RepoLinksRegistry` or null |
| `writeLinks(blobClient, container, registry)` | Write `.repo-links.json` |
| `migrateOldMeta(blobClient, container)` | Auto-migrate `.repo-sync-meta.json` to `.repo-links.json` |
| `createLink(blobClient, container, linkData)` | Add a link to the registry (with conflict detection) |
| `removeLink(blobClient, container, linkId)` | Remove a link by ID |
| `resolveLinks(blobClient, container)` | Read `.repo-links.json`, or auto-migrate from old format, or return empty registry |

`resolveLinks` is the primary entry point that all callers should use. It encapsulates the migration logic.

---

## 5. UI Integration

### 5.1 Current UI Architecture

The frontend is a single 749-line IIFE in `app.js`. All state is in closure variables. The UI follows a tree-based navigation pattern with context menus for containers, folders, and files. Modals are defined in `index.html` and shown/hidden by toggling a `.hidden` class.

### 5.2 Recommended UI Approach

Given the single-file architecture, the recommended approach is to add new functionality in clearly delimited sections within the existing IIFE, following the established patterns:

1. **New modal HTML** in `index.html`: `link-dialog`, `multi-link-sync-dialog`, `links-panel`.
2. **New state variables** in `app.js`: `linkTarget` (holds container/prefix for the link dialog).
3. **New context menu entries**:
   - Container context menu: "Link to Repository..." option.
   - Folder context menu: "Link to Repository..." option.
   - Linked folder context menu: "Sync from Repository", "Unlink Repository".
4. **Enhanced sync badge**: Modify `toggleContainer()` to call `/api/links/:storage/:container` instead of `/api/sync-meta/...`. Display link count on the badge. Click handler shows multi-link dialog when count > 1.
5. **Folder link indicators**: After loading folder tree items, check if any folder's prefix matches a link's `targetPrefix` and add a small link icon.

### 5.3 Link Detection for Folder Indicators

To show link icons on folders, the UI needs the link registry for the current container. The approach:

1. When a container is expanded (`toggleContainer`), fetch `/api/links/:storage/:container`.
2. Store the result in a `containerLinks` map (keyed by container name).
3. When rendering folder tree items, check if `folderPrefix` matches any link's `targetPrefix`.

This is efficient because the link registry is small (typically 1-10 entries) and is fetched once per container expansion.

### 5.4 Link Dialog

The link dialog collects: provider (dropdown), repo URL, branch, repo sub-path, target prefix (pre-filled from context), and PAT token (dropdown populated from `/api/tokens`). It has three buttons: "Link Only", "Link & Sync", "Cancel".

- "Link Only" POSTs to `/api/links/:storage/:container`.
- "Link & Sync" POSTs to create the link, then POSTs to sync it.

### 5.5 Frontend Complexity Management

The `app.js` file will grow by approximately 200-300 lines. To manage complexity:
- Add a clear comment block separating the new link-related code: `// === Repository Link Management ===`
- Keep the link dialog event handlers grouped together.
- Reuse existing patterns (modal show/hide, `apiJson` helper, context menu positioning).

Splitting `app.js` into multiple files is out of scope for this feature and would require a build step (bundler) that the project currently does not have.

---

## 6. Conflict Detection

### 6.1 Exact Prefix Match

Two links with the same `targetPrefix` (after normalization) are not allowed. The `createLink` function should check for this and return an error.

### 6.2 Nested Prefix Overlap

A link with `targetPrefix = "prompts/"` and another with `targetPrefix = "prompts/coa/"` creates an overlap. The refined request specifies this should be a **warning, not an error**. Implementation:

```typescript
function detectOverlap(existingLinks: RepoLink[], newPrefix: string): string | null {
  const norm = normalizePath(newPrefix);
  for (const link of existingLinks) {
    const existing = normalizePath(link.targetPrefix ?? "");
    if (norm.startsWith(existing + "/") || existing.startsWith(norm + "/")) {
      return `Warning: new prefix "${newPrefix}" overlaps with existing link to ${link.repoUrl} at prefix "${link.targetPrefix}"`;
    }
  }
  return null;
}
```

The CLI should print the warning. The API should include it in the response. The UI should display it in the link dialog.

### 6.3 Root-Level Overlap

A container-root link (empty `targetPrefix`) overlaps with every folder-level link. This is an important edge case: if a user has an old container-level clone and wants to add a folder-level link, they will always get a warning. This is acceptable and expected -- the warning informs them that files may be managed by two different links.

---

## 7. Sequential vs Parallel Sync for `--all`

When `sync --all` is used, multiple links need to be synced. Options:

- **Sequential (recommended):** Sync links one at a time. Simpler, avoids rate-limiting from provider APIs (GitHub has 5000 requests/hour for authenticated users), and avoids concurrent writes to `.repo-links.json`.
- **Parallel (rejected):** Faster but risks rate-limit exhaustion and requires concurrent-safe registry writes.

The sync engine already uses `processInBatches` for concurrent file uploads within a single sync. Adding inter-link concurrency on top would compound the concurrency, making rate-limiting harder to manage.

---

## 8. Implementation Order

Recommended phased implementation:

### Phase 1: Core Types and Registry (Low Risk)
- Add `RepoLink` and `RepoLinksRegistry` to `types.ts`.
- Add `readLinks`, `writeLinks`, `resolveLinks`, `migrateOldMeta`, `createLink`, `removeLink` to `sync-engine.ts`.
- Add `MappedFileEntry` internal type and path normalization utilities.

### Phase 2: Refactor Clone/Sync for Path Mapping (Medium Risk)
- Refactor `cloneRepo` and `syncRepo` to accept `RepoLink` and apply path filtering/mapping.
- Ensure existing behavior is preserved when `targetPrefix` and `repoSubPath` are undefined.

### Phase 3: CLI Commands (Low Risk)
- Add `link-github`, `link-devops`, `unlink`, `list-links` commands.
- Extend `clone-github`, `clone-devops`, `sync` with new options.

### Phase 4: Server API Endpoints (Low Risk)
- Add new link CRUD and sync endpoints.
- Update existing `sync-meta` endpoint for backward compatibility.

### Phase 5: UI Integration (Medium Risk)
- Add link dialog HTML/CSS.
- Add context menu entries, link indicators, multi-link sync dialog.
- Update sync badge behavior.

---

## 9. Summary of Decisions

| Decision Point | Recommendation | Rationale |
|----------------|----------------|-----------|
| Metadata storage | Single `.repo-links.json` at container root | Atomic reads, centralized conflict detection, consistent with existing pattern |
| Per-folder metadata | Rejected | Discovery overhead, orphan risk, complex conflict detection |
| Migration strategy | Auto-migrate on first read, retain old file | Zero user intervention, safe rollback |
| UUID generation | `crypto.randomUUID()` | Built-in, no dependencies |
| Path filtering | Post-fetch in sync engine | Provider APIs return full tree regardless; O(n) filter is negligible |
| Internal file representation | `MappedFileEntry` with `repoPath` + `blobPath` | Clean separation of repo vs. blob paths |
| `fileShas` key format | Blob paths (not repo paths) | Direct comparison with container contents |
| `syncRepo` signature | Accept `RepoLink` instead of reading meta internally | Separation of concerns; caller manages registry I/O |
| `sync --all` execution | Sequential | Avoids rate-limiting and concurrent registry writes |
| UI architecture | Extend existing `app.js` IIFE with demarcated sections | No build step needed; follows existing conventions |
| Nested prefix overlap | Warning, not error | Flexible for power users; informative without blocking |

---

## 10. Technical Research Guidance

**Research needed: No**

All technologies, libraries, and patterns required for this feature are already present in the codebase:

- **TypeScript interfaces** for the new types -- standard language feature.
- **`crypto.randomUUID()`** for UUID generation -- available in Node.js 19+ (the project uses modern Node with ESM).
- **Azure Blob Storage SDK** (`@azure/storage-blob`) -- `BlobClient.createBlob`, `getBlobContent`, `deleteBlob` cover all needed blob operations.
- **Commander** for CLI command registration -- established pattern in `src/cli/index.ts`.
- **Express 5** for REST endpoints -- established pattern in `src/electron/server.ts`.
- **Vanilla JS** for frontend -- no framework dependencies; modal/context-menu patterns are well-established in `app.js`.
- **Path filtering** is basic string operations (`startsWith`, `slice`) -- no library needed.

No external libraries, new frameworks, or unfamiliar patterns are introduced. The implementation is a direct extension of existing architecture using existing tools and conventions.
