---
language: typescript
framework: express
package_manager: npm
build_command: "tsc"
test_command: "vitest run"
lint_command: null
entry_points:
  - src/cli/index.ts
  - src/electron/main.ts
  - src/electron/server.ts
last_scanned_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
scanned_for_request: refined-request-reverse-git.md
scanned_at: "2026-06-01T12:10:00Z"
---

# Codebase Scan — Storage Navigator (reverse-git-integration branch)

## 1. Project Overview

Storage Navigator is a TypeScript / Node 18+ project with three surfaces: a Commander-based CLI (`src/cli/index.ts`), an Electron desktop UI (`src/electron/main.ts` + browser-side `src/electron/public/`), and an Express HTTP server (`src/electron/server.ts`) that brokers all Azure Blob and File Share operations. The project is built with `tsc` (module: Node16 / ES2022) and tested with Vitest. The project already implements a **forward** repo-sync feature (Git → Storage) across `src/core/sync-engine.ts`, `src/core/diff-engine.ts`, `src/core/github-client.ts`, `src/core/devops-client.ts`, `src/cli/commands/repo-sync.ts`, `src/cli/commands/link-ops.ts`, and several Express endpoints in `src/electron/server.ts`. The reverse-git feature is the directional mirror of this existing surface.

## 2. Module Map

| Path | Purpose | Representative symbols |
|---|---|---|
| `src/core/types.ts` | Shared type definitions for the entire project | `RepoLink`, `RepoLinksRegistry`, `TokenEntry`, `SyncResult`, `DiffReport`, `RepoProvider` |
| `src/core/sync-engine.ts` | Forward-sync engine: clone, sync, link registry CRUD | `cloneRepo`, `syncRepo`, `createLink`, `removeLink`, `resolveLinks`, `writeLinks` |
| `src/core/diff-engine.ts` | Read-only diff between repo state and tracked SHA store | `diffLink`, `DiffOptions`, `DiffReport` |
| `src/core/github-client.ts` | Read-only GitHub REST client (list files, download) | `GitHubClient`, `parseRepoUrl`, `listFiles`, `downloadFile` |
| `src/core/devops-client.ts` | Read-only Azure DevOps REST client | `DevOpsClient`, `parseRepoUrl`, `listFiles`, `downloadFile` |
| `src/core/repo-utils.ts` | Shared helpers: `buildProviderForLink`, `rateLimitedFetch`, `processInBatches`, `inferContentType` | — |
| `src/core/credential-store.ts` | AES-256-GCM encrypted store at `~/.storage-navigator/credentials.json`; holds `StorageEntry[]` + `TokenEntry[]` | `CredentialStore`, `getToken`, `getTokenByProvider`, `addToken` |
| `src/core/blob-client.ts` | Azure Blob Storage wrapper (direct mode only) | `BlobClient`, `createBlob`, `deleteBlob`, `listBlobsFlat`, `getBlobContent` |
| `src/core/backend/` | Backend abstraction layer (`IStorageBackend`) with direct + api implementations | `makeBackend`, `DirectBackend`, `ApiBackend` |
| `src/cli/index.ts` | Commander root; registers all subcommands | — (command wiring) |
| `src/cli/commands/repo-sync.ts` | `cloneGitHub`, `cloneDevOps`, `cloneSsh`, `syncContainer` | — |
| `src/cli/commands/link-ops.ts` | `linkGitHub`, `linkDevOps`, `linkSsh`, `unlinkContainer`, `listLinks` | — |
| `src/cli/commands/diff-ops.ts` | `diffContainer` (wraps `diffLink` for CLI output) | — |
| `src/cli/commands/shared.ts` | `resolveStorageEntry`, `resolvePatToken`, `StorageOpts`, `PatOpts` | — |
| `src/electron/server.ts` | Express server; mounts all `/api/*` routes (~1,100 lines) | `createServer`, `/api/links/*`, `/api/sync*`, `/api/diff*` |
| `src/electron/public/index.html` | SPA shell; defines all modals + context menus | `link-modal`, `links-panel-modal`, `container-context-menu`, `folder-context-menu` |
| `src/electron/public/app.js` | Vanilla-JS front-end (~1,900 lines): tree rendering, context menus, modal wiring | `openLinksPanel`, `.link-badge`, `.sync-badge`, context menu handlers |
| `src/config/agent-config.ts` | Agent / LLM backend configuration | — |
| `src/agent/` | LangGraph ReAct agent with provider adapters | `graph`, `run`, `tools/` |
| `src/util/` | Text detection, ZIP streaming, redaction | — |
| `tests/unit/` | Vitest unit tests (21 files) | — |
| `test_scripts/` | Manual integration scripts for credential store, diff engine, link registry, path mapping | — |

## 3. Conventions

- **Import style** — Named imports with `.js` extension on all intra-project TypeScript imports (e.g., `import { BlobClient } from "../../core/blob-client.js"`), per Node16 module resolution. Observed in `src/cli/commands/repo-sync.ts:1-8`.

- **Error handling** — Functions throw plain `Error` objects for unrecoverable conditions; callers catch and convert to HTTP status codes or `process.exit(1)`. No `Result`/`Either` wrappers. Observed in `src/cli/commands/shared.ts:80-86` (`resolveStorageEntry`) and `src/electron/server.ts:851-855` (409 on conflict).

- **Config loading** — No `DEFAULT` fallbacks for required settings; missing config raises an error and exits. The `CredentialStore` reads from `~/.storage-navigator/credentials.json` (AES-256-GCM). Observed in `src/core/credential-store.ts:6-9` and `src/cli/commands/shared.ts:100-126`.

- **Progress callbacks** — Core engine functions accept `onProgress?: (msg: string) => void` for streaming progress to CLI or server. Pattern established in `src/core/sync-engine.ts:102` (`cloneRepo`) and `src/core/sync-engine.ts:154` (`syncRepo`).

- **Metadata blob naming** — Well-known blob names are constants at the top of `sync-engine.ts`: `META_BLOB = ".repo-sync-meta.json"` (legacy) and `LINKS_BLOB = ".repo-links.json"` (current). Observed in `src/core/sync-engine.ts:6-7`.

- **Rate-limit safety** — All external HTTP calls go through `rateLimitedFetch` in `src/core/repo-utils.ts:66-92`, which retries on 403/429 with exponential back-off up to 5 retries.

## 4. Integration Points

### In-Scope (files/modules the reverse-git feature must touch or parallel)

#### Core types — `src/core/types.ts`
Lines 68–106 define the forward-direction types that reverse-git must mirror:
- `RepoLink` (lines 69–90) — the forward link record. A new `ReverseLink` type must parallel its fields: `id`, `provider`, `repoUrl`, `branch`, `repoSubPath`, `lastPushedAt`, `lastPushedCommitSha`, `lastPushedTreeSha`, `blobSnapshot` (path→ETag), `exclusionPatterns`, `respectGitignore`, `createdAt`.
- `RepoLinksRegistry` (lines 92–98) — the container-level registry. A new `ReverseLinksRegistry` must parallel it.
- `SyncResult` (lines 100–106) — the forward result. A new `PushResult` must parallel it, adding an `errors: string[]` accumulator for per-file failures.
- `TokenEntry` (lines 43–49) — **reused as-is**. No changes needed.
- `RepoProvider` (lines 186–190) — forward-only read interface. Reverse-git needs a new **write** interface (e.g., `RepoWriteClient`) with `createBlob`, `createTree`, `createCommit`, `updateRef`, `createRepo`.

#### Core — `src/core/github-client.ts` (lines 1–65)
Currently read-only (`listFiles`, `downloadFile`, `getDefaultBranch`). The reverse-git feature needs write operations. Per the refined request (OQ-3), an investigation must decide between extending this class or creating `src/core/github-write-client.ts`. Required new methods: `createBlob`, `createTree`, `createCommit`, `updateRef` (update branch ref), `createRepo` (optional auto-creation), `getRef` (fetch current branch tip for divergence check).

#### Core — `src/core/devops-client.ts` (lines 1–71)
Same situation as `github-client.ts`. The Azure DevOps write path uses the `/git/pushes` endpoint with `refUpdates` + `commits` + `changes` in a single POST. Required new methods or a sibling `src/core/devops-write-client.ts`.

#### Core — New file: `src/core/reverse-sync-engine.ts` (does not exist yet)
The forward `sync-engine.ts` is the pattern to mirror. The new engine must implement:
- `publishRepo()` — initial push (analogous to `cloneRepo`)
- `pushRepo()` — incremental update (analogous to `syncRepo`)
- `readReverseLinks()` / `writeReverseLinks()` — registry CRUD using `.reverse-git-links.json`
- `createReverseLink()` / `removeReverseLink()` — metadata-only operations (analogous to `createLink`/`removeLink`)
- `resolveReverseLinks()` — same auto-resolution pattern as `resolveLinks`

The well-known constant `REVERSE_LINKS_BLOB = ".reverse-git-links.json"` should live here, alongside the exclusion of `.repo-sync-meta.json`, `.repo-links.json`, and itself from publication.

#### Core — `src/core/repo-utils.ts` (lines 62–133)
- `rateLimitedFetch` — **reused as-is** by any new write client. No changes needed.
- `processInBatches` — **reused as-is** for parallel blob enumeration.
- `buildProviderForLink` (lines 17–61) — forward-direction factory. A parallel `buildWriteClientForLink()` must be added here (or nearby) that instantiates the GitHub/DevOps write client for a given `ReverseLink`.

#### Core — `src/core/credential-store.ts`
`getToken()`, `getTokenByProvider()`, `addToken()` — **reused as-is**. For storage-account-scope reverse links (no canonical container), the metadata must live in the local user config file (Assumption A2 in the refined request). The `CredentialStore` may need a new field `reverseLinks?: AccountScopeReverseLinksRegistry` added to the `CredentialData` interface in `types.ts`, and corresponding `getAccountReverseLinks()` / `setAccountReverseLinks()` methods on `CredentialStore`.

#### Core — `src/core/diff-engine.ts` (lines 1–195)
The forward diff compares repo-side SHAs against stored `fileShas`. The reverse diff (for `GET /api/reverse-diff/…` and `push --dry-run`) must compare the **current blob ETag snapshot** against the `lastPushedBlobSnapshot` stored in the `ReverseLink`. A new `src/core/reverse-diff-engine.ts` (or an extension of `diff-engine.ts`) must implement this. Categories are renamed: `added` (blob exists now but not in snapshot), `modified` (ETag changed), `deleted` (in snapshot but no longer in storage), `unchanged`.

#### Core — New file: `src/core/blob-enumerator.ts` (does not exist yet)
Blob enumeration for the three source granularities (storage-account scope, container scope, prefix scope) is a new concern. It must call `BlobClient.listContainers()` + `BlobClient.listBlobsFlat()` and apply path-mapping rules (R5.1–R5.5) and exclusion filters (R6). This is cleanly separable from the push engine.

#### CLI — `src/cli/index.ts` (lines 1–500+)
Seven new Commander subcommands must be registered here following the existing pattern:
1. `publish-github` (parallel to `clone-github`, line 262)
2. `publish-devops` (parallel to `clone-devops`, line 280)
3. `reverse-link-github` (parallel to `link-github`, line 335)
4. `reverse-link-devops` (parallel to `link-devops`, line 354)
5. `push` (parallel to `sync`, line 316)
6. `reverse-unlink` (parallel to `unlink`, line 390)
7. `list-reverse-links` (parallel to `list-links`, line 405)

#### CLI — New file: `src/cli/commands/reverse-git.ts` (does not exist yet)
All implementation functions for the seven new commands must land here, parallel to `src/cli/commands/repo-sync.ts` (for `publishGitHub`, `publishDevOps`, `pushReverseLink`) and `src/cli/commands/link-ops.ts` (for `reverseLinkGitHub`, `reverseLinkDevOps`, `reverseUnlink`, `listReverseLinks`). Uses `resolveStorageEntry` and `resolvePatToken` from `shared.ts` unchanged.

#### Server — `src/electron/server.ts` (lines 800–1,100 approx.)
Six new Express endpoints must be added in a new section parallel to the "Link Registry API Endpoints" block (lines 798–878) and "Sync / Links / Diff" block (lines 880–990):
1. `GET /api/reverse-links/:storage/:container?`
2. `POST /api/reverse-links/:storage/:container?`
3. `DELETE /api/reverse-links/:storage/:container?/:linkId`
4. `POST /api/push/:storage/:container?/:linkId`
5. `POST /api/push-all/:storage/:container?`
6. `GET /api/reverse-diff/:storage/:container?/:linkId`

A new factory function `buildWriteClientForLink()` (parallel to `buildProviderForLink` at `repo-utils.ts:17`) must be called inside these handlers.

#### UI — `src/electron/public/index.html` (lines 244–266)
Three existing context menus need new items:
- `#container-context-menu` (line 261): add `<div class="context-menu-item" id="ctx-publish-container">Publish to Git Repository…</div>` and `<div class="context-menu-item" id="ctx-view-reverse-links">Reverse Links…</div>`.
- `#folder-context-menu` (line 253): add `<div class="context-menu-item" id="ctx-publish-folder">Publish to Git Repository…</div>`.
- No storage-account-level context menu exists today — a new one must be added or the existing container menu must be extended to surface account-scope publish.

Two new modals must be added:
- `#publish-modal` — Publish configuration (provider, repo URL, branch, repoSubPath, exclusion patterns, token selector, visibility, commit message, "Publish Only" / "Publish & Push Now" / "Cancel").
- `#reverse-links-panel-modal` — Reverse links panel (parallel to `#links-panel-modal`, lines 206–222), with per-link "Push Now", "Dry-Run Diff", "Unlink" buttons and a push-progress indicator.

#### UI — `src/electron/public/app.js`
- `openLinksPanel()` function (line 1645) — pattern to mirror as `openReverseLinksPanel()`.
- `.sync-badge` / `.link-badge` rendering (lines 564–578) — a new `.reverse-link-badge` indicator must be added alongside but visually distinct (different symbol/colour).
- Context menu event wiring for the three context menu levels must be extended.

#### Metadata blob names (new constant, no existing file)
`REVERSE_LINKS_BLOB = ".reverse-git-links.json"` — does not collide with `META_BLOB` (`.repo-sync-meta.json`) or `LINKS_BLOB` (`.repo-links.json`). Must be excluded from publication (R6.4).

---

### Out of Scope (modules the reverse-git feature must NOT touch)

- `src/core/file-share-client.ts` — Azure Files shares; not involved in blob publication.
- `src/core/ssh-git-client.ts` — SSH forward-sync only; reverse-git v1 is HTTPS/REST only.
- `src/agent/` — LangGraph agent; not impacted.
- `src/config/agent-config.ts` — Agent config; not impacted.
- `src/util/` — Text detection, ZIP streaming; not impacted.
- `src/electron/site-routes.ts`, `src/electron/zip-download.ts` — File serving and ZIP; not impacted.
- `src/electron/oidc-loopback.ts`, `src/core/backend/auth/` — OIDC auth for API backends; not impacted.
- `tests/unit/api-backend-*.test.ts`, `tests/unit/backend-factory.test.ts` — API backend tests; not impacted.
- All existing forward-sync endpoints, CLI commands, and metadata blobs must remain unchanged (NFR6).

---

### New Integration Points (landing locations for code that does not exist yet)

| New Artifact | Type | Recommended Location | Notes |
|---|---|---|---|
| `ReverseLink`, `ReverseLinksRegistry`, `PushResult`, `RepoWriteClient` types | TypeScript interfaces | `src/core/types.ts` (append) | Parallel to `RepoLink`, `RepoLinksRegistry`, `SyncResult`, `RepoProvider` |
| `GitHubWriteClient` (or extension of `GitHubClient`) | Class | `src/core/github-write-client.ts` OR `src/core/github-client.ts` | Investigation required (OQ-3) |
| `DevOpsWriteClient` (or extension of `DevOpsClient`) | Class | `src/core/devops-write-client.ts` OR `src/core/devops-client.ts` | Investigation required (OQ-3) |
| `reverse-sync-engine.ts` | Core module | `src/core/reverse-sync-engine.ts` | Mirror of `sync-engine.ts` |
| `blob-enumerator.ts` | Core module | `src/core/blob-enumerator.ts` | Blob listing for 3 source granularities + path mapping |
| `reverse-diff-engine.ts` | Core module | `src/core/reverse-diff-engine.ts` | Storage-snapshot diff (ETag-based, not SHA-based) |
| `buildWriteClientForLink()` | Helper function | `src/core/repo-utils.ts` (append) | Parallel to `buildProviderForLink` |
| `reverse-git.ts` CLI command handlers | CLI module | `src/cli/commands/reverse-git.ts` | Parallel to `repo-sync.ts` + `link-ops.ts` |
| 7 new Commander subcommands | CLI registrations | `src/cli/index.ts` (append) | After existing `list-links` / `diff` registrations |
| 6 new Express endpoints | Server routes | `src/electron/server.ts` (append) | New section after existing link/diff section |
| `#publish-modal`, `#reverse-links-panel-modal` | HTML modals | `src/electron/public/index.html` | After `#links-panel-modal` (line 205) |
| `openReverseLinksPanel()`, `.reverse-link-badge` | JS UI functions | `src/electron/public/app.js` | Mirror of `openLinksPanel()` + `.link-badge` |
| Account-scope reverse-link storage | `CredentialData` field | `src/core/types.ts` + `src/core/credential-store.ts` | New field `reverseLinks` for storage-account-scope links with no canonical container |

## 5. Notes

- **`GitHubClient` and `DevOpsClient` are purely read-only today.** They have no `createBlob`, `createTree`, `createCommit`, or `updateRef` methods. The investigation phase (OQ-3) must decide "extend in place" vs "sibling write client" before implementation begins, since this decision affects how many new files land and whether the existing test surface needs to expand.

- **No storage-account-level context menu exists in the Electron UI.** The HTML defines file, folder, and container context menus, but the top-level storage account node has no right-click handler. The reverse-git account-scope "Publish to Git Repository…" entry requires either adding a fourth context menu or surfacing the account-scope publish from the container-level menu with a "Scope: entire account" option.

- **`.repo-sync-meta.json` (legacy) is still written in some paths and must be excluded from publication.** The forward `diff-engine.ts` already special-cases both `META_BLOB` and `LINKS_BLOB` (lines 132–134). The reverse push engine must exclude `.repo-sync-meta.json`, `.repo-links.json`, AND `.reverse-git-links.json` from the blob set it publishes.

- **Vitest test suite covers the forward direction but has no reverse-git tests yet.** `tests/unit/` has 21 test files covering backend, credential store, diff, and zip — none of which touch reverse-git. New test files for `reverse-sync-engine`, write clients, and the reverse diff engine will need to be created in `tests/unit/` following the existing Vitest + `happy-dom` conventions.
