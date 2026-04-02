# Plan 004: Folder-Level Repository Linking and Sync

**Date:** 2026-04-02
**Status:** Ready for implementation
**References:**
- `docs/reference/refined-request-folder-link-sync.md` (requirements)
- `docs/reference/investigation-folder-link-sync.md` (technical investigation)
- `docs/reference/codebase-scan-folder-link-sync.md` (codebase scan)
- `docs/design/project-design.md` (current design)

---

## Overview

Extend the existing container-level clone/sync feature to support:
1. **Linking** a container or sub-folder to a GitHub/Azure DevOps repository (metadata only, no file download)
2. **Cloning** into a specific folder prefix within a container
3. **Syncing** individual folder-level links or all links in a container
4. **Unlinking** to remove the association without deleting files
5. **UI** support for link management, visual indicators, and per-link sync

The feature introduces a new `.repo-links.json` metadata blob per container (replacing the single-link `.repo-sync-meta.json` pattern) with automatic migration from the old format.

---

## Phase Breakdown

### Phase 1: Core Types and Link Registry (Foundation)

**Risk:** Low
**Dependencies:** None
**Can parallelize with:** Nothing (all subsequent phases depend on this)

#### 1.1 New Types in `src/core/types.ts`

Add the following interfaces after the existing `RepoSyncMeta` and related types:

```typescript
interface RepoLink {
  id: string;                    // UUID v4
  provider: "github" | "azure-devops";
  repoUrl: string;
  branch: string;
  repoSubPath?: string;         // Sub-path within repo (e.g., "src/templates/")
  targetPrefix?: string;        // Blob prefix in container (e.g., "prompts/coa/")
  lastSyncAt?: string;          // ISO 8601
  lastCommitSha?: string;
  fileShas: Record<string, string>;  // blobPath -> SHA
  createdAt: string;            // ISO 8601
}

interface RepoLinksRegistry {
  version: 1;
  links: RepoLink[];
}
```

Also add an internal type (not exported, stays in `sync-engine.ts`):

```typescript
interface MappedFileEntry {
  repoPath: string;    // Original path in repo (for provider.downloadFile)
  blobPath: string;    // Target path in container (for blobClient.createBlob)
  sha: string;
}
```

**Files modified:**
- `src/core/types.ts` -- add `RepoLink`, `RepoLinksRegistry`

#### 1.2 Link Registry CRUD in `src/core/sync-engine.ts`

Add the following functions to `sync-engine.ts`:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `normalizePath` | `(path: string \| undefined): string` | Trim leading/trailing slashes, return empty string for undefined/null/empty |
| `readLinks` | `(blobClient, container): Promise<RepoLinksRegistry \| null>` | Read `.repo-links.json`, return parsed registry or null |
| `writeLinks` | `(blobClient, container, registry): Promise<void>` | Write `.repo-links.json` |
| `migrateOldMeta` | `(blobClient, container): Promise<RepoLinksRegistry \| null>` | Read `.repo-sync-meta.json`, create `.repo-links.json` with single link, return registry |
| `resolveLinks` | `(blobClient, container): Promise<RepoLinksRegistry>` | Read `.repo-links.json`, or auto-migrate, or return empty registry (`{ version: 1, links: [] }`) |
| `createLink` | `(blobClient, container, linkData): Promise<{ link: RepoLink; warning?: string }>` | Add link to registry with conflict detection; returns warning for nested prefix overlap |
| `removeLink` | `(blobClient, container, linkId): Promise<boolean>` | Remove link by ID, write updated registry |
| `detectOverlap` | `(existingLinks, newPrefix): string \| null` | Check for nested prefix overlap (warning, not error) |
| `detectExactConflict` | `(existingLinks, newPrefix): boolean` | Check for exact prefix match (hard error) |

Constants to add:
- `LINKS_BLOB = ".repo-links.json"`

UUID generation: `crypto.randomUUID()` (Node.js built-in).

**Migration logic in `migrateOldMeta`:**
1. Read `.repo-sync-meta.json` via existing `readSyncMeta()`.
2. If found, construct a `RepoLink` with `id = crypto.randomUUID()`, `targetPrefix = undefined` (container root), `repoSubPath = undefined`, and copy `provider`, `repoUrl`, `branch`, `lastSyncAt`, `lastCommitSha`, `fileShas` from the old meta.
3. Write `.repo-links.json`.
4. Return the new registry.
5. Do NOT delete `.repo-sync-meta.json` (retained for safety).

**Conflict detection in `createLink`:**
1. Call `detectExactConflict()` -- if true, throw error: `"A link already exists for prefix '{prefix}'. Use 'unlink' first or specify a different prefix."`
2. Call `detectOverlap()` -- if non-null, attach as `warning` in the return value.

**Files modified:**
- `src/core/sync-engine.ts`

#### 1.3 Verification

```bash
npx tsc --noEmit
```

Verify that:
- New types compile without errors
- All new functions compile with correct signatures
- Existing code still compiles (no breaking changes to existing types)

#### Acceptance Criteria
- [ ] `RepoLink` and `RepoLinksRegistry` types are defined and exported
- [ ] `resolveLinks()` returns empty registry when no metadata exists
- [ ] `resolveLinks()` auto-migrates from `.repo-sync-meta.json` when `.repo-links.json` is absent
- [ ] `resolveLinks()` reads `.repo-links.json` when it exists
- [ ] `createLink()` rejects duplicate prefix
- [ ] `createLink()` warns on nested prefix overlap
- [ ] `removeLink()` removes by ID and writes updated registry
- [ ] `normalizePath()` handles leading/trailing slashes, undefined, empty string
- [ ] `npx tsc --noEmit` passes

---

### Phase 2: Refactor Clone/Sync for Path Mapping (Engine)

**Risk:** Medium (touches existing working behavior)
**Dependencies:** Phase 1
**Can parallelize with:** Nothing (must complete before Phase 3)

#### 2.1 Path Filtering and Mapping Utilities

Add to `sync-engine.ts`:

```typescript
function filterByRepoSubPath(files: RepoFileEntry[], repoSubPath?: string): RepoFileEntry[]
function mapToTargetPaths(files: RepoFileEntry[], repoSubPath?: string, targetPrefix?: string): MappedFileEntry[]
```

**`filterByRepoSubPath`:**
- If `repoSubPath` is undefined/empty, return all files.
- Otherwise, normalize `repoSubPath` and keep only files where `file.path` starts with `normalizedRepoSubPath + "/"` or equals `normalizedRepoSubPath`.

**`mapToTargetPaths`:**
- For each file after filtering:
  - Compute `relativePath` by stripping `normalizedRepoSubPath + "/"` from `file.path`.
  - Compute `blobPath` = `normalizedTargetPrefix ? normalizedTargetPrefix + "/" + relativePath : relativePath`.
  - Return `{ repoPath: file.path, blobPath, sha: file.sha }`.

#### 2.2 Refactor `cloneRepo`

**Current signature:**
```typescript
cloneRepo(blobClient, container, provider, meta, onProgress)
```

**New signature:**
```typescript
cloneRepo(blobClient, container, provider, link: RepoLink, onProgress)
```

Changes:
1. After `provider.listFiles()`, apply `filterByRepoSubPath()` and `mapToTargetPaths()`.
2. Use `mappedFile.repoPath` for `provider.downloadFile()`.
3. Use `mappedFile.blobPath` for `blobClient.createBlob()`.
4. Store `mappedFile.blobPath -> mappedFile.sha` in `link.fileShas`.
5. Update `link.lastSyncAt`, `link.lastCommitSha`.
6. The caller writes the updated link to the registry (not `cloneRepo` itself).

**Backward compatibility:** When `link.targetPrefix` and `link.repoSubPath` are both undefined, `blobPath === repoPath`, preserving current behavior exactly.

#### 2.3 Refactor `syncRepo`

**Current behavior:** Reads metadata internally via `readSyncMeta()`.

**New signature:**
```typescript
syncRepo(blobClient, container, provider, link: RepoLink, dryRun, onProgress): Promise<{ updatedLink: RepoLink; result: SyncResult }>
```

Changes:
1. Accept `RepoLink` instead of reading meta internally.
2. After `provider.listFiles()`, apply `filterByRepoSubPath()` and `mapToTargetPaths()`.
3. Compare `mappedFile.blobPath` keys against `link.fileShas` for change detection.
4. Use `mappedFile.repoPath` for downloading, `mappedFile.blobPath` for uploading.
5. For deletions: iterate `link.fileShas` keys and delete blobs whose paths are not in the new mapped file set.
6. Return the updated link (with new `fileShas`, `lastSyncAt`, `lastCommitSha`) and `SyncResult`.
7. The **caller** is responsible for writing the updated link back to the registry.

#### 2.4 Update Existing Callers

The following callers of `cloneRepo` and `syncRepo` must be updated to use the new signatures:

1. `src/cli/commands/repo-sync.ts` -- `cloneGitHub()`, `cloneDevOps()`, `syncContainer()`
2. `src/electron/server.ts` -- `POST /api/sync/:storage/:container`

For backward compatibility during this phase, each caller:
1. Calls `resolveLinks()` to get the registry.
2. For clone: creates a new `RepoLink` via `createLink()`, then calls `cloneRepo()` with that link, then writes the updated registry.
3. For sync: selects the appropriate link from the registry, calls `syncRepo()`, then writes the updated registry.

#### 2.5 Verification

```bash
npx tsc --noEmit
```

Additionally, run an existing clone + sync scenario to verify backward compatibility:
```bash
npx tsx src/cli/index.ts clone-github --repo <test-repo> --container <test-container> --pat <token> --account <account> --account-key <key>
npx tsx src/cli/index.ts sync --container <test-container> --account <account> --account-key <key>
```

#### Acceptance Criteria
- [ ] `cloneRepo` accepts `RepoLink` and applies path filtering/mapping
- [ ] `syncRepo` accepts `RepoLink` and applies path filtering/mapping
- [ ] When `targetPrefix` and `repoSubPath` are both undefined, behavior is identical to pre-change
- [ ] `fileShas` keys are blob paths (not repo paths)
- [ ] Existing callers updated to use new signatures
- [ ] `npx tsc --noEmit` passes
- [ ] Existing clone/sync workflow still works end-to-end

---

### Phase 3: New CLI Commands

**Risk:** Low
**Dependencies:** Phase 1, Phase 2
**Can parallelize with:** Phase 4 (partially -- API endpoints can be developed once CLI command functions exist)

#### 3.1 New Functions in `src/cli/commands/repo-sync.ts`

| Function | Purpose |
|----------|---------|
| `linkGitHub(opts)` | Validate repo access, create link in `.repo-links.json`, do NOT download files |
| `linkDevOps(opts)` | Same for Azure DevOps |
| `unlinkContainer(opts)` | Remove link by prefix or link-id from `.repo-links.json` |
| `listLinks(opts)` | Read registry, print table (id, provider, repoUrl, branch, repoSubPath, targetPrefix, lastSyncAt) |

**`linkGitHub` / `linkDevOps` behavior:**
1. Resolve storage entry (via `resolveStorageEntry`).
2. Resolve PAT (via `resolvePatToken`).
3. Construct provider client (`GitHubClient` / `DevOpsClient`).
4. Validate repo access: call `provider.listFiles()` (or at minimum, validate the branch exists).
5. Call `createLink()` from the sync engine.
6. If warning (overlap), print it to stderr.
7. Print success message with link ID.

**`unlinkContainer` behavior:**
1. Resolve storage entry.
2. Read link registry via `resolveLinks()`.
3. If `--link-id` provided, find link by ID. If `--prefix` provided, find link by normalized prefix. If neither and only one link exists, select it.
4. If ambiguous (multiple matches or no qualifier on multi-link container), print error with guidance.
5. Call `removeLink()`.
6. Print success message confirming files were NOT deleted.

**`listLinks` behavior:**
1. Resolve storage entry.
2. Read link registry via `resolveLinks()`.
3. Print table. If no links, print "No repository links found."

#### 3.2 Extend Existing Functions in `src/cli/commands/repo-sync.ts`

**`cloneGitHub` / `cloneDevOps`:**
- Add support for `opts.prefix` and `opts.repoPath` parameters.
- When provided, create link with those values before cloning.
- Store results in `.repo-links.json` (not `.repo-sync-meta.json`).

**`syncContainer`:**
- Add support for `opts.prefix`, `opts.linkId`, `opts.all` parameters.
- If `--all`: iterate all links, sync each sequentially. Print per-link progress.
- If `--prefix` or `--link-id`: select specific link, sync it.
- If none specified and single link: sync that link (backward compatible).
- If none specified and multiple links: print error listing available links.

#### 3.3 Register Commands in `src/cli/index.ts`

Add four new commands following the existing pattern:

```
program.command("link-github")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .requiredOption("--container <name>", "Target container")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--branch <branch>", "Branch (default: repo default)")
  .option("--storage <name>", "Storage account")
  .option("--token-name <name>", "PAT token name")
  .option("--pat <token>", "Inline GitHub PAT")
  .option("--account-key <key>", "Inline account key")
  .option("--sas-token <token>", "Inline SAS token")
  .option("--account <account>", "Azure Storage account name")
  .action(linkGitHub)

program.command("link-devops")
  // Same options as link-github, with Azure DevOps URL

program.command("unlink")
  .requiredOption("--container <name>", "Container")
  .option("--prefix <path>", "Folder prefix to unlink")
  .option("--link-id <id>", "Link ID to unlink")
  .option("--storage <name>", "Storage account")
  .option("--account-key <key>", ...)
  .option("--sas-token <token>", ...)
  .option("--account <account>", ...)
  .action(unlinkContainer)

program.command("list-links")
  .requiredOption("--container <name>", "Container")
  .option("--storage <name>", "Storage account")
  .option("--account-key <key>", ...)
  .option("--sas-token <token>", ...)
  .option("--account <account>", ...)
  .action(listLinks)
```

Extend existing commands:
```
// clone-github: add options
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")

// clone-devops: same additions

// sync: add options
  .option("--prefix <path>", "Sync only the link at this prefix")
  .option("--link-id <id>", "Sync a specific link by ID")
  .option("--all", "Sync all links in the container")
```

**Files modified:**
- `src/cli/commands/repo-sync.ts`
- `src/cli/index.ts`

#### 3.4 Verification

```bash
npx tsc --noEmit
```

Manual CLI tests:
```bash
# Create a link (no download)
npx tsx src/cli/index.ts link-github --repo <url> --container <name> --prefix "docs/" --account <acct> --account-key <key> --pat <pat>

# List links
npx tsx src/cli/index.ts list-links --container <name> --account <acct> --account-key <key>

# Sync a specific link
npx tsx src/cli/index.ts sync --container <name> --prefix "docs/" --account <acct> --account-key <key>

# Unlink
npx tsx src/cli/index.ts unlink --container <name> --prefix "docs/" --account <acct> --account-key <key>

# Clone into a subfolder
npx tsx src/cli/index.ts clone-github --repo <url> --container <name> --prefix "src/" --repo-path "lib/" --account <acct> --account-key <key> --pat <pat>

# Sync all
npx tsx src/cli/index.ts sync --container <name> --all --account <acct> --account-key <key>
```

#### Acceptance Criteria
- [ ] `link-github` creates a link without downloading files
- [ ] `link-devops` creates a link without downloading files
- [ ] `link-github` with `--prefix` creates a folder-level link
- [ ] `link-github` with `--repo-path` records the repo sub-path
- [ ] `link-github` validates repo accessibility before creating link
- [ ] `list-links` displays table of all links
- [ ] `unlink` removes link without deleting files
- [ ] `unlink` by `--prefix` works
- [ ] `unlink` by `--link-id` works
- [ ] `clone-github --prefix` places files under the prefix
- [ ] `clone-devops --prefix` places files under the prefix
- [ ] `sync --prefix` syncs only the specified link
- [ ] `sync --link-id` syncs only the specified link
- [ ] `sync --all` syncs all links sequentially
- [ ] `sync` without qualifier on single-link container works (backward compatible)
- [ ] `sync` without qualifier on multi-link container prints error with guidance
- [ ] `npx tsc --noEmit` passes

---

### Phase 4: Server API Endpoints

**Risk:** Low
**Dependencies:** Phase 1, Phase 2
**Can parallelize with:** Phase 3 (independent code paths, same core engine)

#### 4.1 New Endpoints in `src/electron/server.ts`

| Method | Endpoint | Handler Logic |
|--------|----------|---------------|
| `GET` | `/api/links/:storage/:container` | Call `resolveLinks()`, return `registry.links` |
| `POST` | `/api/links/:storage/:container` | Parse body (`provider`, `repoUrl`, `branch`, `repoSubPath`, `targetPrefix`), validate repo access, call `createLink()`, return created link + optional warning |
| `DELETE` | `/api/links/:storage/:container/:linkId` | Call `removeLink()`, return 200 or 404 |
| `POST` | `/api/sync/:storage/:container/:linkId` | Find link by ID, construct provider, call `syncRepo()`, write updated registry, return `SyncResult` |
| `POST` | `/api/sync-all/:storage/:container` | Read all links, sync each sequentially, write registry after each, return array of results |

#### 4.2 Modify Existing Endpoints

**`GET /api/sync-meta/:storage/:container`** (preserve for backward compatibility):
- Call `resolveLinks()`.
- If registry has links, return the first link formatted as `RepoSyncMeta` shape (map `repoUrl` to `repository`, etc.).
- If no links, return null.

**`POST /api/sync/:storage/:container`** (existing, no linkId):
- Call `resolveLinks()`.
- If single link: sync it (backward compatible).
- If multiple links: return HTTP 400 with `{ error: "Multiple links exist. Use /api/sync/:storage/:container/:linkId or /api/sync-all/:storage/:container", links: [...] }`.

#### 4.3 PAT Resolution for Per-Link Sync

Each link has a `provider` field. When syncing a link via the server:
1. Get the link's `provider`.
2. Call `store.getTokenByProvider(link.provider)` to find a matching PAT.
3. If no PAT found, return HTTP 400 with `{ error: "No PAT configured for provider '<provider>'" }`.

This handles the case where multiple links use different providers correctly.

#### 4.4 Request/Response Formats

**POST `/api/links/:storage/:container` request body:**
```json
{
  "provider": "github",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "repoSubPath": "src/templates",
  "targetPrefix": "prompts/coa"
}
```

**POST `/api/links/:storage/:container` response:**
```json
{
  "link": { /* RepoLink object */ },
  "warning": "Optional overlap warning"
}
```

**POST `/api/sync/:storage/:container/:linkId` query params:**
- `?dryRun=true` -- preview only

**POST `/api/sync-all/:storage/:container` response:**
```json
{
  "results": [
    { "linkId": "...", "result": { /* SyncResult */ } },
    { "linkId": "...", "error": "..." }
  ]
}
```

**Files modified:**
- `src/electron/server.ts`

#### 4.5 Verification

```bash
npx tsc --noEmit
```

Launch UI and test endpoints via browser devtools or curl:
```bash
npx tsx src/cli/index.ts ui --port 3100

# In another terminal:
curl http://localhost:3100/api/links/<storage>/<container>
```

#### Acceptance Criteria
- [ ] `GET /api/links` returns all links (or empty array)
- [ ] `POST /api/links` creates a link and returns it with optional warning
- [ ] `POST /api/links` returns 400 on duplicate prefix
- [ ] `DELETE /api/links/:linkId` removes link, returns 200
- [ ] `DELETE /api/links/:linkId` returns 404 for unknown ID
- [ ] `POST /api/sync/:linkId` syncs a specific link
- [ ] `POST /api/sync/:linkId?dryRun=true` returns changes without applying
- [ ] `POST /api/sync-all` syncs all links sequentially
- [ ] Existing `GET /api/sync-meta` still works (returns first link as old format)
- [ ] Existing `POST /api/sync` still works for single-link containers
- [ ] Existing `POST /api/sync` returns 400 for multi-link containers
- [ ] PAT resolution uses the link's provider field
- [ ] `npx tsc --noEmit` passes

---

### Phase 5: UI — Link Management Dialog and Context Menus

**Risk:** Medium
**Dependencies:** Phase 4 (needs API endpoints)
**Can parallelize with:** Nothing (must be sequential after Phase 4)

#### 5.1 HTML: New Modals in `src/electron/public/index.html`

Add after the existing sync modal:

**Link Dialog** (`#linkDialog`):
- Provider dropdown (GitHub / Azure DevOps)
- Repository URL text input
- Branch text input (placeholder: "default branch")
- Repository sub-path text input (placeholder: "entire repository")
- Target prefix text input (pre-filled from context, placeholder: "container root")
- Token dropdown (populated from `/api/tokens`, with manual entry option)
- Warning area (for overlap warnings)
- Buttons: "Link Only", "Link & Sync", "Cancel"

**Multi-Link Sync Dialog** (`#multiLinkSyncDialog`):
- List of links with per-link info (provider icon, repo URL, branch, prefix, last sync)
- Per-link "Sync" button
- "Sync All" button
- "Close" button

**Unlink Confirmation Dialog** (`#unlinkConfirmDialog`):
- Text: "Remove the link to {repoUrl}? Synced files will NOT be deleted."
- Buttons: "Unlink", "Cancel"

**Links Panel** (`#linksPanel`):
- Table/list of all links for the current container
- Per-link actions: Sync, Unlink
- Can be shown from a container header button or context menu

#### 5.2 CSS: New Styles in `src/electron/public/styles.css`

Add after the existing sync-related styles:

- `.link-indicator` -- small icon next to linked folders in the tree
- `.link-badge` -- enhanced sync badge showing link count
- `#linkDialog`, `#multiLinkSyncDialog`, `#unlinkConfirmDialog`, `#linksPanel` -- modal styling following existing `.modal` pattern
- `.link-list-item` -- row styling for link list items
- `.provider-icon` -- GitHub/DevOps icons
- `.link-warning` -- warning text styling in link dialog

#### 5.3 JavaScript: New Code in `src/electron/public/app.js`

Add a new clearly-demarcated section: `// === Repository Link Management ===`

**New state variables:**
- `linkTarget` -- `{ container, prefix }` for the link dialog
- `containerLinks` -- `Map<string, RepoLink[]>` cache of link registries per container
- `unlinkTarget` -- `{ container, linkId, repoUrl }` for unlink confirmation

**New functions:**

| Function | Purpose |
|----------|---------|
| `fetchContainerLinks(storage, container)` | GET `/api/links/:storage/:container`, cache in `containerLinks` |
| `showLinkDialog(container, prefix?)` | Open link dialog, pre-fill prefix |
| `submitLink(syncAfter)` | POST to create link, optionally POST to sync |
| `showMultiLinkSyncDialog(container, links)` | Open multi-link sync dialog |
| `syncSingleLink(storage, container, linkId)` | POST to sync a specific link |
| `syncAllLinks(storage, container)` | POST to sync-all |
| `showUnlinkConfirm(container, linkId, repoUrl)` | Open unlink confirmation |
| `confirmUnlink()` | DELETE link |
| `renderLinkIndicators(containerName)` | After folder tree loads, check if any folder prefix matches a link target and add link icon |

**Context menu additions:**

1. **Container context menu** (`#containerContextMenu`):
   - Add "Link to Repository..." option (calls `showLinkDialog(container)`)
   - Add "View Links" option (calls `showLinksPanel(container)`)

2. **Folder context menu** (`#folderContextMenu`):
   - Add "Link to Repository..." option (calls `showLinkDialog(container, folderPrefix)`)
   - Add "Sync from Repository" option (visible only for linked folders)
   - Add "Unlink Repository" option (visible only for linked folders)

**Enhanced sync badge in `toggleContainer`:**
1. Replace `fetch('/api/sync-meta/...')` with `fetchContainerLinks()`.
2. If links exist:
   - Show badge with count if > 1 (e.g., "2 links"), or sync icon if 1.
   - Click handler: if 1 link, trigger sync directly; if multiple, open multi-link sync dialog.
3. After rendering folder tree items, call `renderLinkIndicators(containerName)`.

**Link indicator rendering:**
1. For each folder tree item, check if its prefix matches any link's `targetPrefix`.
2. If match found, append a small link icon (`<span class="link-indicator">`) to the tree item label.
3. The icon should have a tooltip showing repo URL, branch, last sync time.

#### 5.4 Token Dropdown in Link Dialog

The link dialog's token field needs to be populated with available PAT tokens for the selected provider:
1. On provider change, fetch `/api/tokens` (already exists from token management).
2. Filter tokens by selected provider.
3. Populate dropdown. Add an "Enter manually..." option that reveals a text input.

**Files modified:**
- `src/electron/public/index.html`
- `src/electron/public/styles.css`
- `src/electron/public/app.js`

#### 5.5 Verification

```bash
npx tsc --noEmit
```

Launch UI and test manually:
```bash
npx tsx src/cli/index.ts ui --port 3100
```

Manual test checklist:
1. Right-click container -> "Link to Repository..." opens dialog
2. Right-click folder -> "Link to Repository..." opens dialog with prefix pre-filled
3. "Link Only" creates link, no files downloaded
4. "Link & Sync" creates link and syncs
5. Container badge shows link count for multi-link containers
6. Clicking badge on single-link container triggers sync
7. Clicking badge on multi-link container opens multi-link dialog
8. Per-link sync works from multi-link dialog
9. "Sync All" works from multi-link dialog
10. Linked folders show link icon
11. Right-click linked folder -> "Sync from Repository" triggers sync
12. Right-click linked folder -> "Unlink Repository" shows confirmation
13. Unlink removes link, preserves files, removes indicator

#### Acceptance Criteria
- [ ] Link dialog opens from container context menu
- [ ] Link dialog opens from folder context menu with prefix pre-filled
- [ ] Provider dropdown populates token dropdown
- [ ] "Link Only" creates link metadata without downloading
- [ ] "Link & Sync" creates link and immediately syncs
- [ ] Overlap warning displayed in dialog when applicable
- [ ] Container sync badge shows link count for multi-link containers
- [ ] Single-link container badge triggers immediate sync
- [ ] Multi-link container badge opens multi-link sync dialog
- [ ] Per-link sync works from dialog
- [ ] Sync All works from dialog
- [ ] Linked folders display link indicator icon
- [ ] Link indicator tooltip shows repo info
- [ ] Folder context menu shows sync/unlink for linked folders
- [ ] Unlink confirmation dialog works correctly
- [ ] Files preserved after unlink
- [ ] Links panel shows all links for a container

---

### Phase 6: Backward Compatibility Verification and Documentation

**Risk:** Low
**Dependencies:** All previous phases
**Can parallelize with:** Nothing

#### 6.1 Backward Compatibility Tests

Test the following scenarios with containers that have the OLD `.repo-sync-meta.json` format (no `.repo-links.json`):

| Scenario | Expected Behavior |
|----------|-------------------|
| `sync --container X` on old-format container | Auto-migrates, syncs successfully |
| UI sync badge on old-format container | Shows badge, sync works |
| `list-links --container X` on old-format container | Shows single migrated link |
| `link-github` on container with old meta + new folder link | Migration creates root link, new folder link appended |
| Old `GET /api/sync-meta` endpoint | Returns data in old format |

#### 6.2 Documentation Updates

**`CLAUDE.md`:**
- Add new CLI commands to `<storage-nav>` tool documentation: `link-github`, `link-devops`, `unlink`, `list-links`
- Add new options to existing commands: `clone-github --prefix --repo-path`, `clone-devops --prefix --repo-path`, `sync --prefix --link-id --all`
- Add examples for the new commands

**`docs/design/project-design.md`:**
- Add "Technical Design: Folder-Level Repository Linking and Sync" section
- Document the `RepoLink` / `RepoLinksRegistry` types
- Document the migration strategy
- Document the path mapping logic
- Document the new API endpoints

**`docs/design/project-functions.MD`:**
- Add "Repository Link Management" section
- Add "Folder-Level Repository Sync" section

**`Issues - Pending Items.md`:**
- Add any issues discovered during implementation
- Remove any items resolved by this feature

**Files modified:**
- `CLAUDE.md`
- `docs/design/project-design.md`
- `docs/design/project-functions.MD`
- `Issues - Pending Items.md`

#### 6.3 Verification

Full verification checklist:
```bash
# TypeScript compilation
npx tsc --noEmit

# Backward-compatible clone
npx tsx src/cli/index.ts clone-github --repo <url> --container <test> --account <acct> --account-key <key> --pat <pat>

# List links on newly cloned container (should show 1 link)
npx tsx src/cli/index.ts list-links --container <test> --account <acct> --account-key <key>

# Create folder-level link
npx tsx src/cli/index.ts link-github --repo <url> --container <test> --prefix "docs/" --account <acct> --account-key <key> --pat <pat>

# List links (should show 2 links)
npx tsx src/cli/index.ts list-links --container <test> --account <acct> --account-key <key>

# Sync all
npx tsx src/cli/index.ts sync --container <test> --all --account <acct> --account-key <key>

# Unlink folder link
npx tsx src/cli/index.ts unlink --container <test> --prefix "docs/" --account <acct> --account-key <key>

# List links (should show 1 link)
npx tsx src/cli/index.ts list-links --container <test> --account <acct> --account-key <key>

# UI verification
npx tsx src/cli/index.ts ui --port 3100
```

#### Acceptance Criteria
- [ ] All backward compatibility scenarios pass
- [ ] `CLAUDE.md` updated with new commands and examples
- [ ] `project-design.md` updated with technical design
- [ ] `project-functions.MD` updated with new functional requirements
- [ ] `Issues - Pending Items.md` reviewed and updated
- [ ] Full end-to-end workflow verified (link -> sync -> unlink)

---

## Phase Dependency Graph

```
Phase 1: Core Types + Registry
    |
    v
Phase 2: Refactor Clone/Sync Engine
    |
    +--------+--------+
    |                 |
    v                 v
Phase 3: CLI      Phase 4: Server API
    |                 |
    +--------+--------+
             |
             v
      Phase 5: UI Integration
             |
             v
Phase 6: Backward Compat + Docs
```

Phases 3 and 4 can be developed in parallel after Phase 2 completes.

---

## Complete File Change Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/core/types.ts` | 1 | Add `RepoLink`, `RepoLinksRegistry` interfaces |
| `src/core/sync-engine.ts` | 1, 2 | Add link registry CRUD, migration, path normalization, path filtering/mapping; refactor `cloneRepo` and `syncRepo` signatures |
| `src/cli/commands/repo-sync.ts` | 2, 3 | Update existing callers for new signatures; add `linkGitHub()`, `linkDevOps()`, `unlinkContainer()`, `listLinks()` |
| `src/cli/index.ts` | 3 | Register new commands; add options to existing commands |
| `src/electron/server.ts` | 4 | Add link CRUD endpoints, per-link sync endpoint, sync-all endpoint; update existing endpoints |
| `src/electron/public/index.html` | 5 | Add link dialog, multi-link sync dialog, unlink confirm dialog, links panel |
| `src/electron/public/app.js` | 5 | Link management logic, context menu entries, link indicators, enhanced sync badge |
| `src/electron/public/styles.css` | 5 | Styles for link indicators, link dialog, links panel, provider icons |
| `CLAUDE.md` | 6 | Update tool documentation with new commands |
| `docs/design/project-design.md` | 6 | Add technical design section |
| `docs/design/project-functions.MD` | 6 | Add new functional requirements |
| `Issues - Pending Items.md` | 6 | Update with any new issues |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src/core/github-client.ts` | No changes; filtering done in sync engine |
| `src/core/devops-client.ts` | No changes; filtering done in sync engine |
| `src/core/blob-client.ts` | All needed blob operations already available |
| `src/core/repo-utils.ts` | Generic utilities, no changes needed |
| `src/core/credential-store.ts` | Token management already complete |
| `src/cli/commands/shared.ts` | Reusable helpers used as-is |
| `src/electron/main.ts` | No changes to Electron bootstrap |
| `src/electron/launch.ts` | No changes to launch logic |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing clone/sync behavior during Phase 2 refactor | High | When `targetPrefix` and `repoSubPath` are undefined, path mapping is identity transform; test existing flow after refactor |
| Path normalization bugs (trailing slashes, empty strings) | Medium | Centralized `normalizePath()` utility with explicit test cases; always normalize before comparison |
| Concurrent registry writes (two sync operations on same container) | Medium | Sync-all is sequential; UI sync buttons are disabled during sync; no parallel sync at API level |
| Migration creates duplicate link if retried | Low | Random UUID is acceptable since no external system references ID at migration time; second migration is a no-op if `.repo-links.json` already exists |
| `app.js` growing too large (currently 749 lines, will add ~250-300) | Low | New code in clearly-demarcated section; splitting into modules is out of scope (requires build step) |
| Rate limiting with many links synced via `--all` | Low | Sequential sync; existing `rateLimitedFetch` handles 429 responses |

---

## Estimated Effort

| Phase | Estimated Lines Changed | Complexity |
|-------|------------------------|------------|
| Phase 1: Core Types + Registry | ~150 new | Low |
| Phase 2: Refactor Clone/Sync | ~100 modified, ~50 new | Medium |
| Phase 3: CLI Commands | ~200 new, ~50 modified | Low |
| Phase 4: Server API | ~150 new, ~30 modified | Low |
| Phase 5: UI Integration | ~300 new (JS), ~80 new (HTML), ~50 new (CSS) | Medium |
| Phase 6: Docs + Verification | ~100 doc updates | Low |
| **Total** | ~1,260 lines | Medium |
