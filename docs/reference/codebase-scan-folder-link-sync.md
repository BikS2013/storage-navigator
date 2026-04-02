# Codebase Scan: Folder-Level Repository Linking and Sync

**Date:** 2026-04-02
**Purpose:** Provide downstream phases (planning, design, implementation) with an accurate understanding of the current architecture relevant to the folder-link-sync feature.

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| Language | TypeScript (backend/CLI), plain JavaScript (frontend) |
| Runtime | Node.js (ESM modules — `"type": "module"`) |
| Framework | Express 5 (server), Commander (CLI), Electron 41 (desktop shell) |
| Build | `tsc` (TypeScript compiler); `tsx` for dev execution |
| Package manager | npm (package-lock.json) |
| Key dependencies | `@azure/storage-blob`, `commander`, `express`, `mammoth`, `marked`, `highlight.js`, `electron` |

The project is a CLI + Electron desktop app for browsing Azure Blob Storage. Repository clone/sync is an existing feature that targets **whole containers** only.

---

## 2. Module Map

```
src/
  core/                        # Shared business logic (no I/O to console)
    types.ts                   # All shared interfaces
    blob-client.ts             # Azure Blob Storage CRUD wrapper
    credential-store.ts        # Encrypted local credential store (~/.storage-navigator/)
    github-client.ts           # GitHub REST API client (list files, download)
    devops-client.ts           # Azure DevOps REST API client (list files, download)
    sync-engine.ts             # Clone & sync orchestration, metadata read/write
    repo-utils.ts              # Utilities: rateLimitedFetch, processInBatches, inferContentType

  cli/
    index.ts                   # CLI entry point (Commander program definition)
    commands/
      shared.ts                # resolveStorageEntry(), resolvePatToken(), StorageOpts, PatOpts
      repo-sync.ts             # cloneGitHub(), cloneDevOps(), syncContainer()
      add-storage.ts           # add command
      list-storages.ts         # list command
      remove-storage.ts        # remove command
      blob-ops.ts              # rename, delete, delete-folder, create
      token-ops.ts             # add-token, list-tokens, remove-token
      view.ts                  # view, ls, containers, download

  electron/
    main.ts                    # Electron BrowserWindow bootstrap
    launch.ts                  # Spawns Express server + Electron
    server.ts                  # Express app with all REST API endpoints
    public/
      index.html               # Single-page UI shell
      app.js                   # Frontend JavaScript (all UI logic in one IIFE)
      styles.css               # All styles
      favicon.png
```

---

## 3. Conventions

### 3.1 Coding Style
- **No class-based services** in core except `BlobClient` and `CredentialStore`. The sync engine and CLI commands are pure exported functions.
- **Error handling:** try/catch with `err instanceof Error ? err.message : String(err)` pattern throughout.
- **Async everywhere:** all I/O functions are async. CLI actions are async arrow functions in Commander.
- **Console output:** CLI commands use `console.log` / `console.error` directly. Core engine uses `onProgress` callbacks.
- **No test framework:** test scripts are ad-hoc TypeScript files in `test_scripts/`.

### 3.2 Import/Export
- ESM with `.js` extensions in import paths (TypeScript compiles to ESM).
- Named exports only (no default exports).
- Types imported via `import type { ... }`.

### 3.3 Configuration
- No fallback values for configuration. Missing config throws or exits with `process.exit(1)`.
- Credentials are encrypted at rest using AES-256-GCM with a persisted random key.

### 3.4 Secret Resolution Chain
Both CLI and server follow a priority chain:
1. Inline CLI parameter (`--account-key`, `--sas-token`, `--pat`)
2. Stored credential (via `--storage`, `--token-name`)
3. First stored credential for the provider
4. Interactive prompt (CLI only)

The server always uses stored credentials (no interactive prompts).

### 3.5 Server API Pattern
- Routes follow: `/<verb>/:storage/:container` with query params for blob paths.
- Each endpoint instantiates `new CredentialStore()` and `new BlobClient(entry)` inline.
- JSON responses. Errors return `{ error: string }` with appropriate HTTP status.

### 3.6 Frontend Pattern
- Single IIFE in `app.js`. All state as closure variables.
- Tree-based navigation: containers > folders > files.
- Context menus for right-click operations on files, folders, and containers.
- Modals for confirmations and forms.

---

## 4. Integration Points (Folder-Link-Sync Feature)

### 4.1 `src/core/types.ts` — Types to Add

**Current relevant type:**
```typescript
interface RepoSyncMeta {
  provider: "github" | "azure-devops";
  repoUrl: string;
  branch: string;
  lastSyncAt: string;
  lastCommitSha?: string;
  fileShas: Record<string, string>;
}
```

**New types needed:** `RepoLink`, `RepoLinksRegistry` (as specified in the request). These are additive; no existing types change.

### 4.2 `src/core/sync-engine.ts` — Primary Modification Target

**Current state (165 lines):**
- `META_BLOB = ".repo-sync-meta.json"` — constant for the metadata blob name.
- `RepoProvider` interface — `{ listFiles(): Promise<RepoFileEntry[]>; downloadFile(path: string): Promise<Buffer> }`. This interface is **also exported** and used by CLI and server.
- `readSyncMeta()` — reads `.repo-sync-meta.json` from a container. Returns `null` if absent.
- `writeSyncMeta()` — private, writes `.repo-sync-meta.json`.
- `cloneRepo(blobClient, container, provider, meta, onProgress)` — downloads all files, writes metadata. File paths from `provider.listFiles()` are used **directly** as blob names (no prefix mapping).
- `syncRepo(blobClient, container, provider, dryRun, onProgress)` — reads existing metadata, compares SHAs, uploads changed files, deletes removed files. Also uses file paths directly as blob names.

**Key observations for modification:**
1. `cloneRepo` and `syncRepo` store and read file paths without any prefix transformation. The new feature needs a path-mapping layer: `repoSubPath` filtering + `targetPrefix` prepending.
2. `syncRepo` reads metadata internally via `readSyncMeta()`. The new version should accept a `RepoLink` object instead (or in addition) so the caller can specify which link to sync.
3. `writeSyncMeta` is private. New functions (`readLinks`, `writeLinks`, `createLink`, `removeLink`, `migrateOldMeta`) will handle the `.repo-links.json` blob.
4. The `RepoProvider` interface needs no changes — filtering by `repoSubPath` happens **after** `listFiles()` returns (as specified in the request).

### 4.3 `src/cli/commands/repo-sync.ts` — CLI Commands to Extend

**Current exports:** `cloneGitHub()`, `cloneDevOps()`, `syncContainer()`.

**Pattern:** Each function resolves storage + PAT, constructs a `RepoProvider` adapter, then delegates to the sync engine. This pattern should be followed for the new `linkGitHub()`, `linkDevOps()`, `unlinkContainer()`, `listLinks()` functions.

**Modifications needed:**
- `cloneGitHub` / `cloneDevOps`: add `--prefix` and `--repo-path` options. Create a link entry before cloning.
- `syncContainer`: add `--prefix`, `--link-id`, `--all` options. Read links registry to determine which link(s) to sync.

### 4.4 `src/cli/index.ts` — Command Registration

**Pattern:** Each command is defined with `program.command(...)` followed by `.requiredOption()` / `.option()` / `.action()`. Options use `--kebab-case` and are accessed as `opts.camelCase`.

**New commands to register:** `link-github`, `link-devops`, `unlink`, `list-links`.
**Commands to modify:** `clone-github` (add `--prefix`, `--repo-path`), `clone-devops` (same), `sync` (add `--prefix`, `--link-id`, `--all`).

### 4.5 `src/cli/commands/shared.ts` — Reusable Helpers

**`StorageOpts`** and **`PatOpts`** interfaces plus `resolveStorageEntry()` and `resolvePatToken()` are already extracted. New commands should use these unchanged.

### 4.6 `src/electron/server.ts` — Server API Endpoints

**Current sync-related endpoints:**
- `GET /api/sync-meta/:storage/:container` — returns `RepoSyncMeta | null`. Must be preserved; should check `.repo-links.json` first.
- `POST /api/sync/:storage/:container` — reads meta, constructs provider, calls `syncRepo()`. Must be preserved for single-link containers; returns error for multi-link.

**New endpoints needed:**
- `GET /api/links/:storage/:container` — list all links
- `POST /api/links/:storage/:container` — create link
- `DELETE /api/links/:storage/:container/:linkId` — remove link
- `POST /api/sync/:storage/:container/:linkId` — sync specific link
- `POST /api/sync-all/:storage/:container` — sync all links

**Pattern to follow:** Each endpoint creates `CredentialStore` and `BlobClient` inline. PAT resolution uses `store.getTokenByProvider()`. Error handling wraps the body in try/catch.

### 4.7 `src/electron/public/app.js` — Frontend UI

**Sync-related UI (current):**
- In `toggleContainer()`, after loading blobs, fetches `/api/sync-meta/...` and if sync metadata exists, adds a `.sync-badge` span to the container tree item.
- Clicking the badge opens `syncModal` showing repo info and a "Sync Now" button.
- `syncConfirm` click handler POSTs to `/api/sync/...`.

**State variables relevant to extension:**
- `syncTarget = { container, meta }` — holds the target for the sync modal.
- `containerContextTarget`, `folderContextTarget`, `contextTarget` — hold right-click targets.

**New UI elements needed:**
- Link management dialog (triggered from container/folder context menus)
- Link indicators on containers (enhanced badge with count) and folders (link icon)
- Multi-link sync dialog (when badge clicked on multi-link container)
- Folder-level sync in folder context menu
- Unlink option in context menus
- "Repository Links" panel in container detail view

### 4.8 `src/electron/public/index.html` — HTML Shell

Contains modal definitions for: add-storage, rename, delete, delete-folder, create-file, sync. New modals needed for: link-dialog, multi-link-sync, unlink-confirm, links-panel.

### 4.9 `src/electron/public/styles.css` — Styles

Contains styles for `.sync-badge`, `.tree-item`, `.modal`, context menus. New styles needed for link indicators, link dialog, links panel.

### 4.10 Provider Clients — No Changes Needed

- `src/core/github-client.ts` — `listFiles()` returns all blobs in the repo tree. Filtering by `repoSubPath` will be done in the sync engine after the full list is retrieved.
- `src/core/devops-client.ts` — Same pattern. No modification needed.

### 4.11 `src/core/repo-utils.ts` — No Changes Needed

Utility functions (`rateLimitedFetch`, `processInBatches`, `inferContentType`) are generic and will be reused as-is.

### 4.12 `src/core/blob-client.ts` — No Changes Needed

All needed blob operations (create, delete, get content, list) are already available.

---

## 5. Risk Areas

1. **Path normalization:** The new `targetPrefix` and `repoSubPath` need consistent trailing-slash handling. The existing code does not normalize paths (e.g., `BlobClient.deleteFolder` normalizes to ensure trailing slash, but `listBlobs` uses prefix as-is).

2. **Concurrent link syncs:** If `--all` syncs multiple links concurrently, file conflicts between overlapping prefixes could corrupt data. The conflict detection described in the request (section 6.4) should prevent this at link creation time.

3. **Migration atomicity:** Auto-migrating `.repo-sync-meta.json` to `.repo-links.json` involves reading one blob and writing another. If the write fails, the next read will re-attempt migration. This is acceptable but should be documented.

4. **Server-side PAT resolution:** The server currently uses `store.getTokenByProvider()` which returns the **first** token for a provider. With multiple links potentially using different providers, each link's provider must be checked individually.

5. **Frontend complexity:** `app.js` is a single 749-line IIFE. Adding link management, multi-link sync, and folder indicators will significantly increase its size. Consider structuring new code in clearly demarcated sections within the IIFE.
