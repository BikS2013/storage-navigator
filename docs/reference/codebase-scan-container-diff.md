# Codebase Scan: Container vs. Repository Diff Feature

**Date:** 2026-04-08  
**Purpose:** Provide downstream phases (planning, design, implementation) with an accurate understanding of the current architecture as it relates to the container diff feature described in `docs/reference/refined-request-container-diff.md`.

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| Language | TypeScript (backend/CLI), plain JavaScript (frontend) |
| Runtime | Node.js (ESM modules — `"type": "module"`) |
| Framework | Express 5 (server), Commander 14 (CLI), Electron 41 (desktop shell) |
| Build | `tsc` (TypeScript compiler); `tsx` for dev execution |
| Package manager | npm (package-lock.json) |
| TypeScript config | `target: ES2022`, `module: Node16`, `strict: true` — no `any` types permissible |
| Key dependencies | `@azure/storage-blob`, `commander`, `express`, `mammoth`, `marked`, `highlight.js`, `chalk` |
| Import style | All core/CLI imports use `.js` extension suffix (Node16 ESM resolution); e.g. `import { BlobClient } from "./blob-client.js"` |

The project is a CLI + Electron desktop app for browsing Azure Blob Storage. Multi-link repository sync is a fully implemented existing feature; the diff feature builds directly on top of it.

---

## 2. Module Map

```
src/
  core/                          # Shared business logic — no console I/O
    types.ts                     # All shared interfaces (RepoLink, RepoLinksRegistry,
                                 #   RepoFileEntry, SyncResult, StorageEntry, TokenEntry, …)
    blob-client.ts               # BlobClient class — Azure Blob Storage CRUD wrapper
    credential-store.ts          # CredentialStore class — AES-256-GCM encrypted local store
    sync-engine.ts               # All repo-sync logic: resolveLinks, syncRepo,
                                 #   filterByRepoSubPath, mapToTargetPaths, createLink,
                                 #   removeLink, findLinkByPrefix, readLinks, writeLinks
                                 #   (~456 LOC — borderline; new diff-engine.ts is viable)
    github-client.ts             # GitHubClient — Trees API, file download
    devops-client.ts             # DevOpsClient — Azure DevOps Items API
    ssh-git-client.ts            # SshGitClient — shallow clone + git ls-tree
    repo-utils.ts                # processInBatches(), inferContentType()

  cli/
    index.ts                     # Commander program — registers all commands
    commands/
      shared.ts                  # resolveStorageEntry(), resolvePatToken(),
                                 #   promptYesNo(), promptSecret()
                                 #   StorageOpts and PatOpts interfaces
      repo-sync.ts               # syncContainer() — CLI handler for sync command
      link-ops.ts                # linkGitHub(), linkDevOps(), linkSsh(),
                                 #   unlinkContainer(), listLinks()
      blob-ops.ts                # createBlob(), deleteBlob(), deleteFolder(), renameBlob()
      token-ops.ts               # add/list/remove PAT tokens
      view.ts                    # View blob content
      add-storage.ts             # Add storage account
      list-storages.ts           # List storage accounts
      remove-storage.ts          # Remove storage account

  electron/
    main.ts                      # Electron entry point
    launch.ts                    # Launch helpers
    server.ts                    # Express server (~551 LOC)
                                 #   createServer() — all API routes
                                 #   buildProviderForLink() — private provider factory
    public/
      app.js                     # Frontend JS (~1113 LOC): all UI logic
      index.html                 # HTML shell
      styles.css                 # CSS

test_scripts/                    # Existing test/utility scripts (TypeScript)
  compare-containers.ts          # (new, unimplemented as of scan date)
  test-credential-store.ts
  test-link-registry.ts
  test-path-mapping.ts
```

---

## 3. Key Data Structures

### `RepoLink` (src/core/types.ts)
```typescript
interface RepoLink {
  id: string;              // UUID
  provider: string;        // "github" | "azure-devops" | "ssh"
  repoUrl: string;
  branch: string;
  targetPrefix?: string;   // Container blob prefix for this link
  repoSubPath?: string;    // Filter: only files under this repo sub-path
  fileShas: Record<string, string>;  // blobPath → git SHA (written by syncRepo)
  lastSyncAt?: string;     // ISO 8601; undefined if never synced
  lastCommitSha?: string;
  createdAt: string;
}
```

`fileShas` is the central data structure for the diff: it maps every blob path that was **actually uploaded** to its git SHA at last sync time. It is empty (`{}`) for links created via `link-github`/`link-devops` that have never been synced.

### `RepoProvider` interface (src/core/sync-engine.ts)
```typescript
interface RepoProvider {
  listFiles(): Promise<RepoFileEntry[]>;
  downloadFile(filePath: string): Promise<Buffer>;
}
```
All three provider clients (GitHub, DevOps, SSH) are wrapped as `RepoProvider` objects at the call site — the diff engine will use `listFiles()` only, never `downloadFile()`.

### `MappedFileEntry` (src/core/sync-engine.ts, internal)
```typescript
interface MappedFileEntry {
  repoPath: string;   // Original repo path (used for downloadFile)
  blobPath: string;   // Target container path (used as fileShas key)
  sha: string;        // Git object SHA
}
```
Currently unexported. The diff engine needs access to this structure; it must be exported if `diffLink()` lives in a separate file, or can remain internal if `diffLink()` is added directly to `sync-engine.ts`.

---

## 4. Coding Conventions

### 4.1 Error Handling

**CLI commands:** Use `console.error()` + `process.exit(1)` for user errors; propagate thrown errors from core functions. No silent swallowing.

**Server endpoints:** Uniform pattern — every async handler is wrapped in `try/catch`. On caught error: `const msg = err instanceof Error ? err.message : String(err); res.status(500).json({ error: msg })`. Specific cases return 400/404 before the catch. No fallback/default values for missing config.

**Core functions:** Propagate errors upward; do not swallow. A function that cannot proceed throws — the CLI or server decides how to surface it.

### 4.2 CLI Command Pattern

Each command is a standalone exported `async function` in `src/cli/commands/*.ts`. The function signature always receives the business parameters plus `StorageOpts` and optionally `PatOpts`. Credential resolution always goes through `resolveStorageEntry()` and `resolvePatToken()` from `shared.ts`.

Registration in `src/cli/index.ts` follows the Commander pattern:
```typescript
program
  .command("diff")
  .description("...")
  .requiredOption("--container <name>", "...")
  .option("--format <fmt>", "...")
  .action(async (opts) => { await diffContainer(opts.container, ...) });
```

### 4.3 Server Endpoint Pattern

`buildProviderForLink(store, link)` is the single private factory that constructs a `RepoProvider` for any link. It returns `null` when no PAT is found for a non-SSH link (callers respond with `400 / code: "MISSING_PAT"`). It returns `{ provider, cleanup? }` on success.

The `cleanup` function (SSH only) calls `sshClient.cleanup()` and must be invoked in a `finally` block.

The standard endpoint skeleton:
```typescript
app.get("/api/...", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    // ... logic ...
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

### 4.4 UI Pattern (app.js)

- Plain ES2022 JavaScript; no bundler or framework.
- DOM manipulation via `innerHTML` string concatenation for tables; event listeners attached after render.
- Async calls via a shared `apiJson(url, options?)` helper that throws on non-2xx.
- Button disable/restore pattern: `btn.disabled = true; btn.textContent = "Loading..."; ... finally { btn.disabled = false; btn.textContent = origText; }`.
- Errors displayed via `handleSyncError(e, label, retryFn)` or inline `alert()` (the diff feature spec prohibits `alert()` for its error display — use DOM insertion instead).
- `escapeHtml()` is used for all user-sourced text inserted into HTML.

### 4.5 TypeScript Imports

All intra-project imports use explicit `.js` extension: `import { X } from "../../core/types.js"`. This is mandatory for Node16 ESM resolution. New files must follow the same convention.

---

## 5. Existing Helpers the Diff Feature Will Reuse

| Helper | Location | Role in diff |
|--------|----------|--------------|
| `resolveLinks(blobClient, container)` | `sync-engine.ts:310` | Load link registry; auto-migrates old `.repo-sync-meta.json` format |
| `findLinkByPrefix(links, prefix)` | `sync-engine.ts` | Resolve a link from `--prefix` CLI option |
| `filterByRepoSubPath(files, repoSubPath?)` | `sync-engine.ts:46` | Filter remote file list to `link.repoSubPath` |
| `mapToTargetPaths(files, repoSubPath?, targetPrefix?)` | `sync-engine.ts:61` | Map repo paths to blob paths; produces `MappedFileEntry[]` |
| `BlobClient.listBlobsFlat(container, prefix?)` | `blob-client.ts` | Physical blob enumeration (only needed for `--physical-check`) |
| `resolveStorageEntry(storageOpts)` | `cli/commands/shared.ts` | Storage credential resolution (CLI) |
| `resolvePatToken(store, provider, patOpts)` | `cli/commands/shared.ts` | PAT token resolution (CLI) |
| `buildProviderForLink(store, link)` | `server.ts:22` | Provider construction (server only — currently private) |

---

## 6. Integration Points for the Diff Feature

### 6.1 Core Engine — `src/core/sync-engine.ts` vs. new `src/core/diff-engine.ts`

**Decision needed (Open Question 2 from refined request):** `sync-engine.ts` is 456 LOC — above the 450-LOC threshold flagged in the refined request as the split point. Given that:
- `diffLink()` will add ~60–80 LOC,
- The new `DiffReport` / `DiffEntry` interfaces add further bulk,
- `MappedFileEntry` is currently unexported and referenced only in `syncRepo`,

the recommended approach is to create `src/core/diff-engine.ts` and export `diffLink()`, `DiffEntry`, `DiffReport`, and `DiffCategory` from it. `sync-engine.ts` re-exports `MappedFileEntry` if needed, or `diff-engine.ts` imports the helper functions directly.

`DiffEntry`, `DiffReport`, and `DiffCategory` belong in `src/core/types.ts` (consistent with where all other shared interfaces live), not inside the engine file.

### 6.2 `buildProviderForLink()` — Sharing Between CLI and Server

Currently a module-level private function in `server.ts`. The CLI diff command (`diff-ops.ts`) needs the same provider-construction logic. The cleanest solution is to extract `buildProviderForLink()` into `src/core/repo-utils.ts` (or a new `src/core/provider-factory.ts`) and re-import it in both `server.ts` and the CLI command. The function signature must change from taking a `CredentialStore` instance to taking `(store: CredentialStore, link: RepoLink)` — which it already does — so extraction is straightforward.

The alternative (duplicating a simplified version in `shared.ts`) is acceptable only if the extraction proves to pull in unwanted server-side imports; inspection shows no such issue since `CredentialStore`, `GitHubClient`, `DevOpsClient`, and `SshGitClient` are all pure core modules.

### 6.3 New Files to Create

| File | Purpose |
|------|---------|
| `src/core/diff-engine.ts` | `diffLink()` implementation |
| `src/cli/commands/diff-ops.ts` | CLI `diff` command handler (`diffContainer()`) |

### 6.4 Files to Modify

| File | Changes |
|------|---------|
| `src/core/types.ts` | Add `DiffEntry`, `DiffReport`, `DiffCategory` interfaces |
| `src/core/sync-engine.ts` | Export `MappedFileEntry` (needed by diff-engine.ts); no other changes |
| `src/core/repo-utils.ts` | Add extracted `buildProviderForLink()` (move from server.ts) |
| `src/cli/index.ts` | Register `diff` command via Commander |
| `src/electron/server.ts` | Import `buildProviderForLink` from repo-utils; add two GET endpoints |
| `src/electron/public/app.js` | Add Diff button per link row, Diff All button, diff result panel |
| `src/electron/public/index.html` | Any static HTML scaffolding for diff result panel (if not fully JS-generated) |
| `CLAUDE.md` | Document the `diff` command in the `storage-nav` tool block |

### 6.5 Link Selection Logic (must mirror `syncContainer`)

The `syncContainer()` function in `src/cli/commands/repo-sync.ts` (lines 160–263) implements the canonical link-selection logic for `--all`, `--link-id`, `--prefix`, single-link auto-select, and multi-link error. The `diffContainer()` CLI function must replicate this logic exactly, including the `process.exit(1)` + link listing on ambiguous multi-link case (exit code 2 per spec — but `process.exit(2)` instead of `1` for the diff-specific error cases).

### 6.6 SSH Performance Warning

`SshGitClient.clone()` performs a full shallow git clone — expensive. The CLI diff command must print a warning when the link uses `provider === "ssh"` before calling `provider.listFiles()`. No confirmation prompt is required by the spec (Open Question 3), but a warning line is mandatory.

### 6.7 Exit Code Semantics (New Pattern)

The diff command introduces a **tri-state exit code** not used elsewhere in the CLI:
- `0` — all diffed links in sync
- `1` — differences detected (not an error)
- `2` — fatal/operational error

Current CLI commands use `process.exit(1)` for all errors. The diff command must use `process.exit(2)` for operational errors and `process.exit(1)` for "differences found". This is a new convention that must be documented clearly in `diff-ops.ts` comments.

---

## 7. Key Observations for Implementation

1. **`link.fileShas` is the ground truth for the stored side.** The diff does not need to read any actual blob content — SHA comparison is pure in-memory work against `link.fileShas`. The only network call is `provider.listFiles()` for the remote side.

2. **Never-synced links are valid inputs.** `link.fileShas` is `{}` and `link.lastSyncAt` is `undefined` for `link-github`/`link-devops` links that have never been synced. The diff engine must handle this: all remote files classify as `repo-only`. The `DiffReport.note` field communicates this to users.

3. **`MappedFileEntry` path computation is already tested (test-path-mapping.ts).** The diff engine reuses the same `filterByRepoSubPath` + `mapToTargetPaths` pipeline that `syncRepo` uses. No new path logic is needed.

4. **Physical check (`listBlobsFlat`) is optional and additive.** Default `false`. The core engine must be structured so the physical check is a cleanly separable second phase, not interleaved with the SHA comparison logic.

5. **`buildProviderForLink()` cleanup is SSH-only.** The diff command must call `cleanup?.()` in a `finally` block, just as `syncContainer()` and the server sync endpoints do.

6. **The UI diff result panel is a new DOM section.** The Links Panel currently appends to `linksPanelBody`. The diff result panel should be appended below the links table within the same modal, or rendered in a secondary overlay. The spec leaves this open (Open Question 5); inline-below is the simpler path.

7. **No writes anywhere.** `diffLink()` must call zero write operations. The `link` object must not be mutated (no `link.lastSyncAt = ...` or `link.fileShas = ...` as `syncRepo` does).
