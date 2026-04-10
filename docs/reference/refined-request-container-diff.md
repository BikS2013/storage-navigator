# Refined Request: Container vs. Repository Diff Feature

**Date**: 2026-04-08  
**Author**: AI Assistant (request refinement)  
**Status**: Specification — ready for investigation / planning

---

## 1. Summary

Add a `diff` command to the CLI and a "Diff" action to the UI that compares the files currently
stored in an Azure Blob Storage container (or a prefix within one) against the remote repository
snapshot linked to it, and presents the results as a structured, human-readable diff report.
The report categorises every file managed by a link into one of four states: **identical**
(same SHA on both sides), **modified** (file exists on both sides but SHAs differ), **container-only**
(file is in the container but has been removed from or was never in the repo), and **repo-only**
(file is in the repo but has not yet been downloaded to the container). For multi-link containers
the diff is run per link, with each link's report presented separately. The feature is
read-only — it inspects and reports but never writes to either the container or the repository.

---

## 2. Motivation

The existing `sync` and `sync --dry-run` commands are action-oriented: `sync` writes changes
without surfacing the full picture, and `--dry-run` only lists files it *would* upload or delete
but does not show unchanged files or give a comprehensive view of divergence.  
Users need to answer questions such as:

- "Which files in my container are outdated relative to the linked branch?"
- "Did someone manually edit or delete blobs that should be managed by the repository?"
- "Is the container fully in sync before I proceed with a deployment?"
- "I linked a folder last week but never synced — what would actually change if I did?"

A dedicated diff command provides this audit capability without risk: it is non-destructive and
can be run by operators with read-only storage credentials. It is also a prerequisite for
building confidence before executing a sync in environments where accidental overwrites are costly.

---

## 3. Functional Requirements

### 3.1 Core Engine — `diffLink()`

A new function `diffLink()` must be added to `src/core/sync-engine.ts` (or a new
`src/core/diff-engine.ts` file if deemed cleaner by the implementation team).

#### 3.1.1 Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `blobClient` | `BlobClient` | Authenticated blob client |
| `container` | `string` | Container name |
| `provider` | `RepoProvider` | Repo provider instance (GitHub, DevOps, SSH) |
| `link` | `RepoLink` | The link to diff — supplies `repoSubPath`, `targetPrefix`, and `fileShas` |
| `onProgress?` | `(msg: string) => void` | Optional progress callback |

#### 3.1.2 Behaviour

1. Call `provider.listFiles()` to obtain the current remote file tree with SHAs.
2. Apply `filterByRepoSubPath()` and `mapToTargetPaths()` (existing helpers in `sync-engine.ts`)
   to produce a `MappedFileEntry[]` that represents what the container should contain per
   the current repo state.
3. Build a `Map<string, string>` of `blobPath → remoteSha` from the mapped entries.
4. Build a `Map<string, string>` of `blobPath → storedSha` from `link.fileShas`.
5. Classify every file:
   - **identical**: `blobPath` present in both maps with equal SHAs.
   - **modified**: `blobPath` present in both maps with different SHAs.
   - **repo-only**: `blobPath` present in remote map but absent from `link.fileShas`.
     This includes files that were in the repo when the link was created but have never been
     downloaded (link-only, never synced), as well as files added to the repo after the last sync.
   - **container-only**: `blobPath` present in `link.fileShas` but absent from remote map
     (deleted from repo since last sync, or manually added to `fileShas` incorrectly).

   **Important nuance for `repo-only`**: because `link.fileShas` only records blobs that were
   *actually uploaded*, a file may be `repo-only` either because the container was created via
   `link-github` (never synced) or because the repo added files after the last sync.
   The diff output must make this clear by reporting both the remote SHA and whether a matching
   blob *physically exists* in the container (via `BlobClient.listBlobsFlat` cross-reference).

6. Optionally (configurable via `includePhysicalCheck` flag, default `false`): call
   `blobClient.listBlobsFlat(container)` filtered to the `targetPrefix` to detect blobs that
   exist physically in the container but are not tracked in `link.fileShas` at all (orphaned
   blobs). These are reported as a separate `untracked` category.

#### 3.1.3 Return Type — `DiffReport`

```typescript
export interface DiffEntry {
  blobPath: string;       // Path as it appears/would appear in the container
  repoPath: string;       // Original path in the repository (pre-prefix mapping)
  remoteSha: string | null;  // Git object SHA from the repo; null for container-only
  storedSha: string | null;  // SHA recorded in link.fileShas; null for repo-only
  physicallyExists?: boolean; // Set when includePhysicalCheck=true; indicates blob is in container
}

export type DiffCategory = "identical" | "modified" | "repo-only" | "container-only" | "untracked";

export interface DiffReport {
  linkId: string;
  provider: "github" | "azure-devops" | "ssh";
  repoUrl: string;
  branch: string;
  targetPrefix: string | undefined;
  repoSubPath: string | undefined;
  lastSyncAt: string | undefined;
  generatedAt: string;           // ISO 8601 timestamp of when the diff was produced

  identical:      DiffEntry[];
  modified:       DiffEntry[];
  repoOnly:       DiffEntry[];
  containerOnly:  DiffEntry[];
  untracked:      DiffEntry[];   // only populated when includePhysicalCheck=true

  summary: {
    total: number;
    identicalCount:     number;
    modifiedCount:      number;
    repoOnlyCount:      number;
    containerOnlyCount: number;
    untrackedCount:     number;
    isInSync: boolean;  // true iff modifiedCount + repoOnlyCount + containerOnlyCount == 0
  };
}
```

#### 3.1.4 Error behaviour

- If `provider.listFiles()` fails (network error, auth failure), the function must propagate
  the error — it must not return a partial or empty report silently.
- If `link.fileShas` is empty and `link.lastSyncAt` is undefined, the report is still valid:
  every remote file will appear as `repoOnly` and there will be no `identical`, `modified`, or
  `containerOnly` entries. A `note` field should be added to `DiffReport` to surface this
  human-readable explanation (e.g. "Link has never been synced; all repo files appear as repo-only").

---

### 3.2 CLI — `diff` Command

#### 3.2.1 Command definition

Register a new `diff` command in `src/cli/index.ts`, implemented in a new file
`src/cli/commands/diff-ops.ts`.

**Signature:**

```
npx tsx src/cli/index.ts diff --container <name> [options]
```

#### 3.2.2 Options

| Option | Required | Description |
|--------|----------|-------------|
| `--container <name>` | Yes | Container name |
| `--storage <name>` | No | Storage account (uses first if omitted) |
| `--account-key <key>` | No | Inline account key |
| `--sas-token <token>` | No | Inline SAS token |
| `--account <account>` | No | Azure Storage account name (required with inline key/token) |
| `--pat <token>` | No | Inline PAT (overrides stored token) |
| `--token-name <name>` | No | PAT token name to use |
| `--prefix <path>` | No | Diff only the link at this target prefix |
| `--link-id <id>` | No | Diff a specific link by ID |
| `--all` | No | Diff all links in the container (default if only one link exists) |
| `--format <fmt>` | No | Output format: `table` (default), `json`, `summary` |
| `--show-identical` | No | Include identical files in the output (omitted by default to reduce noise) |
| `--physical-check` | No | Cross-reference with actual blobs in the container to detect untracked files |
| `--output <file>` | No | Write the report to a file instead of stdout |

#### 3.2.3 Link selection logic

Mirrors the logic in `syncContainer()` exactly:
- If `--all` is passed, diff every link.
- If `--link-id` is passed, diff that specific link.
- If `--prefix` is passed, find the link whose `targetPrefix` matches and diff it.
- If none of the above are passed and the container has exactly one link, diff it automatically.
- If none of the above are passed and the container has multiple links, print the list of links
  and exit with an error asking the user to use `--prefix`, `--link-id`, or `--all`.

#### 3.2.4 Output formats

**`table` (default):**

```
Diff Report — container: my-container
Link: github / https://github.com/owner/repo (branch: main)
Target prefix: docs/   Repo sub-path: src/docs
Last sync: 2026-04-01T10:00:00Z
Generated at: 2026-04-08T09:15:00Z
────────────────────────────────────────────────────────────────────────
MODIFIED (2)
  docs/guide.md        stored: a1b2c3d4  remote: e5f6a7b8
  docs/api-ref.md      stored: 11223344  remote: 55667788

REPO-ONLY (3)  [in repo, not yet in container]
  docs/changelog.md    remote: aabbccdd
  docs/faq.md          remote: 11223344
  docs/install.md      remote: 55667788

CONTAINER-ONLY (1)  [in container, removed from repo]
  docs/old-setup.md    stored: 99aabbcc

────────────────────────────────────────────────────────────────────────
Summary: 2 modified, 3 repo-only, 1 container-only, 12 identical
Status: OUT OF SYNC
```

- Identical files are hidden unless `--show-identical` is passed.
- Each category section is omitted entirely if it contains zero entries.
- SHAs are truncated to 8 characters for display.
- The final status line reads `IN SYNC` (green) or `OUT OF SYNC` (red) using ANSI colours when
  stdout is a TTY; plain text when piped/redirected.

**`summary`:**

Single line per link:
```
my-container / github / https://github.com/owner/repo (main) — 2 modified, 3 repo-only, 1 container-only, 12 identical — OUT OF SYNC
```

**`json`:**

The raw `DiffReport` object(s) as a JSON array, pretty-printed. When `--output <file>` is also
provided, the report is written to the file; otherwise it goes to stdout.

#### 3.2.5 Exit codes

| Code | Meaning |
|------|---------|
| 0 | All diffed links are in sync |
| 1 | One or more links have differences (modified / repo-only / container-only) |
| 2 | Fatal error (auth failure, container not found, no links, etc.) |

This enables scripted usage: `if npx tsx ... diff --container x --format summary; then echo "in sync"; fi`

---

### 3.3 CLI — CLAUDE.md documentation

The `diff` command must be added to the `storage-nav` tool documentation block in `CLAUDE.md`
following the same format as existing commands, including:
- Command description
- All options with descriptions
- At least three usage examples covering single-link, multi-link, and JSON output cases

---

### 3.4 API — Express server endpoint

Add a new endpoint to `src/electron/server.ts`:

```
GET /api/diff/:storage/:container/:linkId
```

Query parameters:
- `physicalCheck=true` — enables the untracked blob cross-reference (default: false)
- `showIdentical=true` — include identical entries in the response (default: false, to reduce payload size)

Response body: a `DiffReport` JSON object.

A second convenience endpoint for diffing all links in one call:

```
GET /api/diff-all/:storage/:container
```

Response body:
```json
{
  "reports": [DiffReport, DiffReport, ...]
}
```

Both endpoints:
- Follow the existing error-handling pattern in `server.ts` (try/catch, `{ error: msg }` with
  appropriate HTTP status codes).
- Use `buildProviderForLink()` (the existing private helper in `server.ts`) for provider
  construction — no new auth logic needed.
- Return `400` with `code: "MISSING_PAT"` if a PAT is required but not configured (same
  pattern as existing sync endpoints).
- Return `404` if the container has no links or the specified linkId does not exist.

---

### 3.5 UI — Diff action in the Links Panel

#### 3.5.1 Trigger

Add a **"Diff"** button in the actions column of each link row in the Links Panel table
(in `renderLinksPanel()` in `src/electron/public/app.js`). Position it to the left of the
existing "Sync" button so the visual order reads: **Diff | Sync | Unlink**.

#### 3.5.2 Diff result panel

When the user clicks "Diff" for a single link:

1. Call `GET /api/diff/:storage/:container/:linkId`.
2. Display a diff result section inside the Links Panel modal (below the links table)
   or in a dedicated secondary modal. The display must show:
   - A header row with: provider icon, repo URL (truncated), branch, target prefix,
     last sync time, and generated-at time.
   - A summary bar: `N modified | N repo-only | N container-only | N identical`.
   - A status badge: **IN SYNC** (green) or **OUT OF SYNC** (amber/red).
   - Per-category collapsible sections:
     - **Modified** — file path, stored SHA (8 chars), remote SHA (8 chars).
     - **Repo-only** — file path, remote SHA.
     - **Container-only** — file path, stored SHA.
     - **Identical** — collapsed by default; expandable by the user.
   - An optional **Untracked** section (only shown when data is present), explaining
     that these blobs exist in the container at the target prefix but are not tracked by this link.
3. The diff result panel must include a **"Sync Now"** button that, when clicked, triggers
   `POST /api/sync-link/:storage/:container/:linkId` and refreshes the links panel afterward.

#### 3.5.3 "Diff All" button

Add a **"Diff All"** button next to the existing "Sync All" button in the Links Panel header.
When clicked, it calls `GET /api/diff-all/:storage/:container` and displays a combined result
with one section per link, each following the same format as 3.5.2.

#### 3.5.4 UI loading states

While the diff request is in flight, disable the "Diff" button and show a spinner or loading
indicator in the diff result area. Restore the button on completion (success or error).

#### 3.5.5 Error display

If the API call fails (network, auth, etc.), display the error message in the diff result area
with an "X" icon. Do not use `alert()`.

---

## 4. Non-Functional Requirements

### 4.1 Performance

- `diffLink()` must call `provider.listFiles()` exactly once. It must not download any file
  content — SHA comparison is sufficient. This means the diff is lightweight: it makes one
  API call to the repo provider (GitHub tree API, DevOps items API, or `git ls-tree`) and
  reads from `link.fileShas` in memory.
- `includePhysicalCheck = true` adds one `listBlobsFlat` call per link — callers should be
  aware that this adds latency proportional to the number of blobs in the container prefix.
  The CLI defaults `--physical-check` to off; the UI never enables it by default.
- For SSH links, `provider.listFiles()` requires an `SshGitClient.clone()` call first
  (a full shallow clone). This is expensive. The CLI must warn the user when the link is an
  SSH link that the diff may take longer.
- No new concurrency requirements. Single-link diff is sequential. Multi-link (`--all` /
  `diff-all`) runs links one at a time (matches existing sync-all behaviour) to avoid
  overwhelming rate limits.

### 4.2 Output size

- The JSON output for a large repo (thousands of files) can be large. The `showIdentical`
  filter (default: off) is the primary mechanism to keep API responses and CLI output compact.
- When `--output <file>` is used with `--format json`, the entire `DiffReport[]` is written
  to the file with no truncation.

### 4.3 No writes

`diffLink()` and all code paths through the diff feature must make zero write operations to
the container (no blob creates, updates, or deletes) and zero write operations to the credential
store or link registry. Violation of this constraint is a defect.

### 4.4 Code placement

- Core logic (`diffLink()`, `DiffEntry`, `DiffReport`, `DiffCategory`) belongs in
  `src/core/sync-engine.ts` (preferred, to keep the module cohesive) or in a new
  `src/core/diff-engine.ts` file if the implementer judges the module is already too large.
- CLI handler belongs in a new file `src/cli/commands/diff-ops.ts`.
- API endpoints belong in `src/electron/server.ts` alongside existing endpoints.
- UI code belongs in `src/electron/public/app.js` and `src/electron/public/index.html`.

### 4.5 TypeScript typing

All new functions, interfaces, and types must be fully typed in TypeScript. No `any` types.
`DiffReport` and `DiffEntry` must be exported from whichever core file they reside in so
that `server.ts` and `diff-ops.ts` can import them.

### 4.6 Compatibility

- The feature must work for all three provider types: `github`, `azure-devops`, and `ssh`.
- The feature must work for links created before this feature was implemented (links with
  empty `fileShas: {}` and no `lastSyncAt`). The diff will show all remote files as `repoOnly`.
- The feature must work for containers migrated from the old `.repo-sync-meta.json` format
  (via `resolveLinks()` auto-migration), because `resolveLinks()` already handles migration
  transparently before returning a `RepoLinksRegistry`.

---

## 5. Acceptance Criteria

Each criterion below must be testable either via an automated test script or a documented
manual test procedure.

### 5.1 Core engine

- **AC-CORE-01**: Given a link whose `fileShas` exactly matches the remote file list, `diffLink()`
  returns a `DiffReport` where `summary.isInSync === true` and all files appear in `identical`.
- **AC-CORE-02**: Given a link where one file has a different SHA in `fileShas` vs. remote,
  `diffLink()` returns that file in `modified` and `summary.modifiedCount === 1`.
- **AC-CORE-03**: Given a link where one file is in the remote list but absent from `fileShas`,
  `diffLink()` returns that file in `repoOnly`.
- **AC-CORE-04**: Given a link where one file is in `fileShas` but absent from the remote list,
  `diffLink()` returns that file in `containerOnly`.
- **AC-CORE-05**: Given a link with empty `fileShas` and no `lastSyncAt`, `diffLink()` returns
  all remote files in `repoOnly`, `summary.isInSync === false`, and `report.note` contains
  a human-readable explanation.
- **AC-CORE-06**: Given a link with `repoSubPath = "src/docs"` and `targetPrefix = "docs/"`,
  `diffLink()` correctly strips `src/docs/` from repo paths and prepends `docs/` for blobPaths,
  and only files under `src/docs/` in the repo are included in the report.
- **AC-CORE-07**: `diffLink()` makes exactly one call to `provider.listFiles()` and zero calls
  to `provider.downloadFile()`.
- **AC-CORE-08**: When `includePhysicalCheck = true`, `diffLink()` populates `physicallyExists`
  on `DiffEntry` objects and populates `untracked` with blobs present in the container at the
  target prefix that are not in `link.fileShas`.

### 5.2 CLI

- **AC-CLI-01**: `diff --container <c>` with one link produces `table` output containing the
  four category sections (empty sections omitted) and a summary line.
- **AC-CLI-02**: `diff --container <c> --format json` produces valid JSON matching the
  `DiffReport[]` interface, parseable with `JSON.parse()`.
- **AC-CLI-03**: `diff --container <c> --format summary` outputs one line per link.
- **AC-CLI-04**: `diff --container <c> --show-identical` includes the identical files section
  in the output.
- **AC-CLI-05**: `diff --container <c>` exits with code `0` when `summary.isInSync === true`
  for all diffed links.
- **AC-CLI-06**: `diff --container <c>` exits with code `1` when any link has differences.
- **AC-CLI-07**: `diff --container <c>` exits with code `2` if no links are configured.
- **AC-CLI-08**: `diff --container <c>` with a multi-link container and no `--prefix`,
  `--link-id`, or `--all` exits with code `2` and prints the list of links.
- **AC-CLI-09**: `diff --container <c> --all` produces one report section per link.
- **AC-CLI-10**: `diff --container <c> --output /tmp/report.json --format json` writes the
  JSON file to disk and exits silently.

### 5.3 API

- **AC-API-01**: `GET /api/diff/:storage/:container/:linkId` returns `200` with a `DiffReport`
  JSON object for a valid, configured link.
- **AC-API-02**: `GET /api/diff/:storage/:container/nonexistent-id` returns `404`.
- **AC-API-03**: `GET /api/diff/:storage/:container/:linkId` returns `400` with
  `code: "MISSING_PAT"` when the link's provider has no stored PAT.
- **AC-API-04**: `GET /api/diff-all/:storage/:container` returns `200` with
  `{ "reports": [...] }` where `reports.length === registry.links.length`.
- **AC-API-05**: `GET /api/diff/:storage/:container/:linkId?physicalCheck=true` returns a
  `DiffReport` where `untracked` is an array (may be empty).
- **AC-API-06**: `GET /api/diff/:storage/:container/:linkId?showIdentical=true` includes
  entries in `report.identical`.
- **AC-API-07**: Neither diff endpoint writes anything to the container or credential store.

### 5.4 UI

- **AC-UI-01**: A "Diff" button appears in each link row of the Links Panel.
- **AC-UI-02**: Clicking "Diff" disables the button, shows a loading indicator, and re-enables
  the button on completion (success or error).
- **AC-UI-03**: A successful diff displays: summary bar, status badge (IN SYNC / OUT OF SYNC),
  and per-category sections for modified, repo-only, and container-only files.
- **AC-UI-04**: An error from the API is shown in the diff result area as a message, not as
  an `alert()` dialog.
- **AC-UI-05**: A "Diff All" button calls the `diff-all` endpoint and displays results for
  all links.
- **AC-UI-06**: The "Sync Now" button in the diff result panel triggers the sync endpoint and
  refreshes the links panel.
- **AC-UI-07**: The identical files section is collapsed by default; clicking it expands it.

---

## 6. Out of Scope

The following items are explicitly not part of this feature:

- **Content-level diff**: The feature compares file identity via SHA hashes only. It does not
  show line-level differences within a file (no unified diff output).
- **Applying changes**: The diff command is read-only. It does not trigger a sync. The "Sync Now"
  button in the UI is a convenience affordance but is implemented as a separate call to the
  existing sync endpoint.
- **Bidirectional sync / push to repo**: The feature describes what is different in the container
  relative to the repo, not the reverse. There is no mechanism to push changes from the container
  back to the repository.
- **Unlinked containers**: The diff command only operates on containers with at least one
  `RepoLink` in `.repo-links.json`. It does not compare arbitrary blob folders to arbitrary
  repositories without a link.
- **Cross-container diffing**: Comparing two containers against each other is out of scope.
- **Deleted blob detection without physical check**: Detecting blobs that were manually deleted
  from the container (and thus are missing both from `fileShas` and the physical blob list) is
  only possible with `--physical-check`. Without it, such files are invisible to the diff because
  the SHA store has no record of their physical existence.
- **Pagination or streaming for very large repos**: The `DiffReport` is built in memory. Handling
  repos with tens of thousands of files is not a v1 concern.
- **UI-level PAT entry during diff**: If a PAT is missing, the UI shows the existing
  "missing PAT" error flow (same as for sync). Adding a PAT inline from the diff UI is out of scope.

---

## 7. Dependencies

### 7.1 Existing code reused directly

| Component | File | Usage |
|-----------|------|-------|
| `filterByRepoSubPath()` | `src/core/sync-engine.ts` | Filter remote files to `link.repoSubPath` |
| `mapToTargetPaths()` | `src/core/sync-engine.ts` | Map repo paths to blob paths using `repoSubPath` + `targetPrefix` |
| `resolveLinks()` | `src/core/sync-engine.ts` | Load link registry (with auto-migration) |
| `findLinkByPrefix()` | `src/core/sync-engine.ts` | Resolve a link from a prefix string |
| `BlobClient.listBlobsFlat()` | `src/core/blob-client.ts` | Used only when `includePhysicalCheck = true` |
| `RepoProvider` interface | `src/core/sync-engine.ts` | Abstract provider for all three repo types |
| `GitHubClient` | `src/core/github-client.ts` | GitHub file listing (SHAs via Trees API) |
| `DevOpsClient` | `src/core/devops-client.ts` | Azure DevOps file listing |
| `SshGitClient` | `src/core/ssh-git-client.ts` | SSH clone + `git ls-tree` for file listing |
| `buildProviderForLink()` | `src/electron/server.ts` | Provider factory (private — may need export or duplication) |
| `resolveStorageEntry()` | `src/cli/commands/shared.ts` | Storage credential resolution for CLI |
| `resolvePatToken()` | `src/cli/commands/shared.ts` | PAT token resolution for CLI |
| `RepoLink`, `RepoLinksRegistry`, `RepoFileEntry` | `src/core/types.ts` | Type definitions |

### 7.2 New types to be added to `src/core/types.ts`

- `DiffEntry` (see section 3.1.3)
- `DiffReport` (see section 3.1.3)
- `DiffCategory` (see section 3.1.3)

### 7.3 New exports required

- `diffLink()` must be exported from whichever core file it is placed in, so both
  `src/cli/commands/diff-ops.ts` and `src/electron/server.ts` can import it.
- `buildProviderForLink()` in `server.ts` is currently a module-level private function.
  If `diff-ops.ts` (CLI) needs the same provider-construction logic, either:
  (a) Extract `buildProviderForLink()` into a shared utility in `src/core/` (recommended), or
  (b) Duplicate a simplified version in `src/cli/commands/shared.ts`.
  Option (a) is preferred for maintainability.

### 7.4 New files to be created

| File | Purpose |
|------|---------|
| `src/cli/commands/diff-ops.ts` | CLI diff command implementation |
| `src/core/diff-engine.ts` | (Optional) Core diff logic if extracted from `sync-engine.ts` |

### 7.5 Files to be modified

| File | Change |
|------|--------|
| `src/core/sync-engine.ts` | Add `diffLink()` (or re-export from `diff-engine.ts`) |
| `src/core/types.ts` | Add `DiffEntry`, `DiffReport`, `DiffCategory` |
| `src/cli/index.ts` | Register `diff` command |
| `src/electron/server.ts` | Add `GET /api/diff/:storage/:container/:linkId` and `GET /api/diff-all/:storage/:container` |
| `src/electron/public/app.js` | Add "Diff" and "Diff All" buttons, diff result display |
| `src/electron/public/index.html` | Add any new HTML elements for diff result panel (if not rendered entirely via JS) |
| `CLAUDE.md` | Document the `diff` command under the `storage-nav` tool entry |

---

## 8. Open Questions for Investigation / Planning

The following items require investigation before the implementation plan can be finalised:

1. **`buildProviderForLink()` sharing**: Decide between extracting it to `src/core/` or
   duplicating a CLI-specific version. The investigation phase should assess how much
   credential-store logic is intertwined and whether a clean extraction is feasible.

2. **`DiffReport` placement**: Confirm whether `diffLink()` belongs in `sync-engine.ts` or
   a new `diff-engine.ts`. Consider the current file size of `sync-engine.ts` (~450 LOC)
   and whether a split aids maintainability.

3. **SSH diff performance UX**: Decide whether to add a confirmation prompt (`--yes` bypass)
   before running `git clone` for SSH links in the CLI diff command, given that clones can
   be slow.

4. **API response size for large repos**: Confirm whether `showIdentical=false` (default) is
   sufficient to keep API payloads under a practical size limit, or whether pagination is
   needed even for non-identical entries in very large repos.

5. **UI diff result location**: Decide whether the diff results should appear inline in the
   Links Panel modal (expanding it downward) or in a separate overlay/drawer. The inline
   approach is simpler; a drawer provides better readability for large diffs.
