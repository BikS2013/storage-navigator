# Plan 005: Container vs. Repository Diff Feature

**Date:** 2026-04-08  
**Status:** Ready for implementation  
**Author:** AI Planning Assistant  
**References:**
- `docs/reference/refined-request-container-diff.md` — Full requirements and acceptance criteria
- `docs/reference/investigation-container-diff.md` — Architecture decisions and approach
- `docs/reference/codebase-scan-container-diff.md` — Codebase analysis and integration points

---

## 1. Overview

This plan covers the end-to-end implementation of the container diff feature: a read-only comparison of the files currently stored in an Azure Blob Storage container (keyed by `link.fileShas`) against the current remote repository snapshot. The feature classifies every tracked file into one of four categories — **identical**, **modified**, **repo-only**, or **container-only** — and optionally a fifth **untracked** category when a physical blob check is requested.

The implementation touches every layer of the stack: core engine, CLI command, Express API endpoints, and browser UI.

---

## 2. Architecture Summary

| Layer | Decision | Rationale |
|-------|----------|-----------|
| Core diff engine | New `src/core/diff-engine.ts` | Keeps read-only diff logic separated from write-capable `sync-engine.ts`; avoids pushing the already-456-LOC sync engine further |
| Shared types | `src/core/types.ts` | Consistent with all other shared interfaces in the codebase |
| Provider factory | Extract `buildProviderForLink()` to `src/core/repo-utils.ts` | Eliminates duplication between CLI and server; clean extraction with zero server-specific imports |
| CLI command | New `src/cli/commands/diff-ops.ts` | Consistent with existing command-per-file pattern |
| Server endpoints | `src/electron/server.ts` (two new GET endpoints) | Consistent with existing endpoint pattern |
| UI | `src/electron/public/app.js` + `index.html` | Inline below links table in Links Panel modal (simpler, no extra overlay) |

---

## 3. Dependency Graph

```
Phase 1: Foundation
  ├── 1A: Add types to types.ts
  └── 1B: Export MappedFileEntry from sync-engine.ts
       (1A and 1B are independent; both must complete before Phase 2)

Phase 2: Provider Factory Extraction
  └── 2A: Extract buildProviderForLink() to repo-utils.ts
       (depends on Phase 1 completing; must verify existing sync still works before Phase 3)

Phase 3: Core Diff Engine
  └── 3A: Implement diffLink() in diff-engine.ts
       (depends on 1A, 1B, 2A)

Phase 4: CLI Command          Phase 5: Server Endpoints
  └── 4A: diff-ops.ts              └── 5A: server.ts endpoints
       (depends on 3A)                   (depends on 2A, 3A)
  └── 4B: Register in index.ts
       (depends on 4A)

Phase 6: UI
  └── 6A: app.js + index.html
       (depends on 5A)

Phase 7: Documentation
  └── 7A: CLAUDE.md update
       (depends on 4A, can be written after CLI is stable)
```

**Parallelisable pairs after prerequisites are met:**
- Phase 4 (CLI) and Phase 5 (Server) can be implemented in parallel once Phase 3 is complete.
- Phase 7 (Docs) can be written in parallel with Phase 6 (UI).

---

## 4. Phase Details

---

### Phase 1 — Foundation: Types and MappedFileEntry Export

**Goal:** Establish the shared type contracts that all subsequent phases depend on, and expose the one unexported interface that `diff-engine.ts` needs from `sync-engine.ts`.

**Dependencies:** None (first phase).

**Can be parallelised with:** Nothing (must complete before everything else).

#### 1A — Add diff types to `src/core/types.ts`

**File to modify:** `src/core/types.ts`

Add the following three exports at the end of the file (after the existing `RepoLinksRegistry` interface):

```typescript
/** A single file entry in a diff report, representing one file across both sides */
export interface DiffEntry {
  blobPath: string;             // Path as it appears/would appear in the container
  repoPath: string;             // Original path in the repository (pre-prefix mapping)
  remoteSha: string | null;     // Git object SHA from the repo; null for container-only entries
  storedSha: string | null;     // SHA recorded in link.fileShas; null for repo-only entries
  physicallyExists?: boolean;   // Only set when includePhysicalCheck=true
}

/** Category of a diff entry */
export type DiffCategory = "identical" | "modified" | "repo-only" | "container-only" | "untracked";

/** Full diff report for a single RepoLink */
export interface DiffReport {
  linkId: string;
  provider: "github" | "azure-devops" | "ssh";
  repoUrl: string;
  branch: string;
  targetPrefix: string | undefined;
  repoSubPath: string | undefined;
  lastSyncAt: string | undefined;
  generatedAt: string;         // ISO 8601 timestamp of when the diff was produced
  note?: string;               // Human-readable note (e.g. "Link has never been synced")

  identical:     DiffEntry[];
  modified:      DiffEntry[];
  repoOnly:      DiffEntry[];
  containerOnly: DiffEntry[];
  untracked:     DiffEntry[];  // Only populated when includePhysicalCheck=true

  summary: {
    total: number;
    identicalCount:     number;
    modifiedCount:      number;
    repoOnlyCount:      number;
    containerOnlyCount: number;
    untrackedCount:     number;
    isInSync: boolean;  // true iff modifiedCount + repoOnlyCount + containerOnlyCount === 0
  };
}
```

#### 1B — Export `MappedFileEntry` from `src/core/sync-engine.ts`

**File to modify:** `src/core/sync-engine.ts`

Change the `interface MappedFileEntry` declaration from internal to exported:

```typescript
// Before:
interface MappedFileEntry {
// After:
export interface MappedFileEntry {
```

This is a one-line change. `MappedFileEntry` has no behavioural implications; exporting it does not alter any existing behaviour.

**Acceptance criteria for Phase 1:**
- `npx tsc --noEmit` passes with no new errors after both 1A and 1B changes.
- `DiffEntry`, `DiffReport`, `DiffCategory` are importable from `../../core/types.js` in any new file.
- `MappedFileEntry` is importable from `../../core/sync-engine.js`.

---

### Phase 2 — Provider Factory Extraction

**Goal:** Move `buildProviderForLink()` from `src/electron/server.ts` to `src/core/repo-utils.ts`, adding an optional `inlinePat` parameter, so that both the CLI diff command and the server can use identical provider-construction logic.

**Dependencies:** Phase 1 must be complete (types are stable).

**Risk:** This is the only refactor in the plan that modifies a live code path. The existing sync endpoints in `server.ts` depend on this function. See Risk 4.4.

**File to modify:** `src/core/repo-utils.ts`  
**File to modify:** `src/electron/server.ts`

#### 2A — Add `buildProviderForLink()` to `src/core/repo-utils.ts`

Add the following function to `repo-utils.ts`. The function body is moved verbatim from `server.ts` lines 23–61, with one new parameter (`inlinePat?: string`) added:

```typescript
import { CredentialStore } from "./credential-store.js";
import { GitHubClient } from "./github-client.js";
import { DevOpsClient } from "./devops-client.js";
import { SshGitClient } from "./ssh-git-client.js";
import type { RepoLink, RepoProvider } from "./types.js";

/**
 * Construct a RepoProvider for the given link.
 * Returns null if the link requires a PAT and none is configured (callers must respond with
 * a MISSING_PAT error to the user).
 * For SSH links, the returned cleanup() function must be called in a finally block.
 *
 * @param store       Credential store instance
 * @param link        The RepoLink to build a provider for
 * @param inlinePat   Optional PAT override (CLI --pat flag); takes priority over stored tokens
 */
export async function buildProviderForLink(
  store: CredentialStore,
  link: RepoLink,
  inlinePat?: string
): Promise<{ provider: RepoProvider; cleanup?: () => void } | null> {
  // ... (exact body moved from server.ts, with inlinePat precedence inserted before stored-token lookup)
}
```

The `inlinePat` parameter must be used as follows inside the function body:
- If `inlinePat` is provided, it takes precedence over any stored PAT.
- If `inlinePat` is not provided, the existing logic (look up from `store`) applies unchanged.

After adding the function to `repo-utils.ts`, update `server.ts`:
1. Remove the `buildProviderForLink` function body from `server.ts`.
2. Add an import: `import { buildProviderForLink } from "../core/repo-utils.js";`
3. All existing call sites in `server.ts` pass no `inlinePat`, which means the optional parameter defaults to `undefined` — behaviour is identical.

**Verification steps (must all pass before Phase 3):**
1. `npx tsc --noEmit` — zero new errors.
2. Manually run `npx tsx src/cli/index.ts list` — no regression.
3. If a storage account is configured: `npx tsx src/cli/index.ts containers` — no regression.
4. If a linked container is configured: `npx tsx src/cli/index.ts sync --container <name> --dry-run` — no regression.

**Acceptance criteria for Phase 2:**
- `buildProviderForLink` is exported from `src/core/repo-utils.ts`.
- `server.ts` no longer contains the `buildProviderForLink` function body.
- All existing sync-related CLI and API behaviours are unchanged (verified by dry-run test).
- `npx tsc --noEmit` passes.

---

### Phase 3 — Core Diff Engine

**Goal:** Implement `diffLink()` — the pure, read-only diff function that takes a provider and a link, calls `provider.listFiles()` exactly once, and returns a `DiffReport`.

**Dependencies:** Phase 1 (types), Phase 2 (provider factory available for test usage).

**New file to create:** `src/core/diff-engine.ts`

#### 3A — Implement `diffLink()` in `src/core/diff-engine.ts`

The file must implement the following logic exactly:

**Phase 1 of diffLink (always runs):**
1. Call `provider.listFiles()` to get `RepoFileEntry[]`.
2. Apply `filterByRepoSubPath(files, link.repoSubPath)` — imported from `sync-engine.ts`.
3. Apply `mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix)` — produces `MappedFileEntry[]`.
4. Build `remoteMap: Map<string, string>` = `blobPath → remoteSha` from mapped entries.
5. Build `storedMap: Map<string, string>` = `blobPath → storedSha` from `link.fileShas`.
6. Classify:
   - For each key in `remoteMap`:
     - If in `storedMap` AND SHAs equal → `identical`
     - If in `storedMap` AND SHAs differ → `modified`
     - If NOT in `storedMap` → `repoOnly`
   - For each key in `storedMap` NOT in `remoteMap` → `containerOnly`
7. Detect never-synced links: if `Object.keys(link.fileShas).length === 0 && !link.lastSyncAt`, set `report.note = "Link has never been synced; all repo files appear as repo-only"`.

**Phase 2 of diffLink (only when `options.includePhysicalCheck === true`):**
1. Call `blobClient.listBlobsFlat(container, link.targetPrefix)` to get the physical blob list.
2. Build a `Set<string>` of physical blob paths.
3. For each `repoOnly` entry, set `physicallyExists = physicalSet.has(entry.blobPath)`.
4. For each physical blob path NOT in `storedMap` → add to `untracked`.

**Function signature:**
```typescript
export async function diffLink(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  options?: {
    includePhysicalCheck?: boolean;
    onProgress?: (msg: string) => void;
  }
): Promise<DiffReport>
```

**Non-negotiable constraints:**
- Zero calls to `provider.downloadFile()`.
- Zero mutations to the `link` object.
- Zero write operations on `blobClient`.
- Errors from `provider.listFiles()` must propagate — no silent fallback to empty arrays.

**Estimated size:** 80–100 LOC.

**Test script requirement:**
Create `test_scripts/test-diff-engine.ts` as a unit test for `diffLink()`. The test script must:
- Create mock `provider` and `link` objects without any real network calls.
- Cover the following scenarios:
  - AC-CORE-01: Perfect sync (all identical)
  - AC-CORE-02: One file modified
  - AC-CORE-03: One file repo-only
  - AC-CORE-04: One file container-only
  - AC-CORE-05: Never-synced link (empty `fileShas`)
  - AC-CORE-06: Path mapping with `repoSubPath` and `targetPrefix`
  - AC-CORE-07: `downloadFile` never called (verify by mock)

**Acceptance criteria for Phase 3:**
- `npx tsc --noEmit` passes.
- `npx tsx test_scripts/test-diff-engine.ts` runs to completion with no assertion failures.
- All 7 AC-CORE test scenarios pass in the test script.
- `diffLink()` is exported from `src/core/diff-engine.ts`.

---

### Phase 4 — CLI Diff Command

**Goal:** Implement the `diff` CLI command with `table`, `summary`, and `json` output formats; link selection logic mirroring `syncContainer()`; and tri-state exit codes.

**Dependencies:** Phase 3 (`diffLink()` available); Phase 2 (`buildProviderForLink()` in repo-utils).

**Can be parallelised with:** Phase 5 (Server Endpoints) after Phase 3 is complete.

**New file to create:** `src/cli/commands/diff-ops.ts`  
**File to modify:** `src/cli/index.ts`

#### 4A — Implement `diffContainer()` in `src/cli/commands/diff-ops.ts`

The file exports one main function `diffContainer()` plus private formatting helpers.

**Function signature:**
```typescript
export async function diffContainer(
  container: string,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  opts: {
    prefix?: string;
    linkId?: string;
    all?: boolean;
    format: "table" | "summary" | "json";
    showIdentical?: boolean;
    physicalCheck?: boolean;
    output?: string;
  }
): Promise<void>
```

**Exit code conventions (document in source code comments):**
```
Exit 0: All diffed links are in sync (summary.isInSync === true for all)
Exit 1: One or more links have differences (not an error condition — expected for diff)
Exit 2: Fatal/operational error (no links, auth failure, container not found, ambiguous selection)
```

**Link selection logic (must mirror `syncContainer()` in `repo-sync.ts` exactly):**
1. Load registry via `resolveLinks(blobClient, container)`.
2. If registry has zero links → `console.error(...)` + `process.exit(2)`.
3. If `--all` → process all links.
4. If `--link-id` → find link by ID; if not found → `process.exit(2)`.
5. If `--prefix` → `findLinkByPrefix(registry.links, prefix)`; if not found → `process.exit(2)`.
6. If none of the above AND exactly one link → use that link automatically.
7. If none of the above AND multiple links → print link list + `process.exit(2)` with message asking user to use `--prefix`, `--link-id`, or `--all`.

**SSH warning (mandatory before `provider.listFiles()`):**
```typescript
if (link.provider === "ssh") {
  console.warn("Warning: this link uses SSH. Diff requires cloning the repository which may take a while...");
}
```

**Output format — `table`:**
- Print header block: provider, repo URL, branch, target prefix, last sync, generated-at.
- Print per-category sections in order: MODIFIED → REPO-ONLY → CONTAINER-ONLY → IDENTICAL.
- Omit any section that has zero entries.
- Omit IDENTICAL section unless `--show-identical` is passed.
- Truncate SHAs to 8 characters for display.
- Use ANSI colours only when `process.stdout.isTTY === true` (use `chalk`).
- Print summary line: `Summary: N modified, N repo-only, N container-only, N identical`.
- Print status: `Status: IN SYNC` (green) or `OUT OF SYNC` (red).
- If `report.note` is set, print it prominently before the category sections.
- For multi-link (`--all`), print one report block per link with a separator between them.

**Output format — `summary`:**
- One line per link: `<container> / <provider> / <repoUrl> (<branch>) — N modified, N repo-only, N container-only, N identical — STATUS`

**Output format — `json`:**
- `JSON.stringify(reports, null, 2)` where `reports` is a `DiffReport[]`.
- If `--output <file>` is provided, write to file with `fs.writeFileSync`; do NOT print to stdout.
- If no `--output`, print to stdout.
- `--output` with `--format table` or `--format summary`: ignore `--output` (document in help text).

**Cleanup requirement:**
Every link iteration must wrap the diff call in try/finally to call `cleanup?.()` for SSH providers.

**Estimated size:** 150–180 LOC.

#### 4B — Register `diff` command in `src/cli/index.ts`

Add the following Commander registration (following the exact pattern of existing commands):

```typescript
program
  .command("diff")
  .description("Compare container blobs against the linked remote repository (read-only)")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name")
  .option("--account-key <key>", "Inline account key")
  .option("--sas-token <token>", "Inline SAS token")
  .option("--account <account>", "Azure Storage account name (required with inline key/token)")
  .option("--pat <token>", "Inline PAT (overrides stored token)")
  .option("--token-name <name>", "PAT token name to use")
  .option("--prefix <path>", "Diff only the link at this target prefix")
  .option("--link-id <id>", "Diff a specific link by ID")
  .option("--all", "Diff all links in the container")
  .option("--format <fmt>", "Output format: table, json, summary (default: table)", "table")
  .option("--show-identical", "Include identical files in output")
  .option("--physical-check", "Cross-reference with actual container blobs to detect untracked files")
  .option("--output <file>", "Write JSON report to file (only with --format json)")
  .action(async (opts) => {
    await diffContainer(opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, { pat: opts.pat, tokenName: opts.tokenName }, { prefix: opts.prefix, linkId: opts.linkId, all: opts.all, format: opts.format, showIdentical: opts.showIdentical, physicalCheck: opts.physicalCheck, output: opts.output });
  });
```

**Acceptance criteria for Phase 4:**
- `npx tsc --noEmit` passes.
- `npx tsx src/cli/index.ts diff --help` prints the full option list.
- AC-CLI-01 through AC-CLI-10 are verifiable (manual or scripted).
- `diff --container <c>` with a fully-synced container exits `0`.
- `diff --container <c>` with a modified/missing file exits `1`.
- `diff --container <c>` with no links configured exits `2`.
- `diff --container <c> --format json` output passes `JSON.parse()`.

---

### Phase 5 — Server API Endpoints

**Goal:** Add two new GET endpoints to `src/electron/server.ts` for the UI to call.

**Dependencies:** Phase 2 (`buildProviderForLink()` extractd), Phase 3 (`diffLink()` available).

**Can be parallelised with:** Phase 4 (CLI) after Phase 3 is complete.

**File to modify:** `src/electron/server.ts`

#### 5A — Add diff endpoints

**Endpoint 1:** `GET /api/diff/:storage/:container/:linkId`

Query parameters:
- `physicalCheck=true` — enables untracked blob check (default: false)
- `showIdentical=true` — include identical entries (default: false)

Response: `DiffReport` JSON object.

HTTP status codes:
- `200` — success
- `404` — storage not found, container has no links, or `linkId` not found
- `400` with `{ error: "...", code: "MISSING_PAT" }` — PAT required but not configured
- `500` — unexpected error

**Endpoint 2:** `GET /api/diff-all/:storage/:container`

Query parameters: same as above (`physicalCheck`, `showIdentical`)

Response: `{ reports: DiffReport[] }`

HTTP status codes:
- `200` — success (array may contain partial results if some links error — but see below)
- `404` — storage not found, container has no links
- `500` — unexpected error

**Implementation notes:**
- Both endpoints use `buildProviderForLink(store, link, undefined)` — no inline PAT from the UI.
- Both endpoints must call `cleanup?.()` in a `finally` block for SSH links.
- For `diff-all`, if a single link fails, the entire response returns `500` (not partial results) — consistency with existing sync-all behaviour.
- The `showIdentical=false` default is enforced inside the endpoint handler (not in `diffLink()`). When `showIdentical=false`, the endpoint receives the full `DiffReport` from `diffLink()` but sets `report.identical = []` before serialising the response, preserving `summary.identicalCount`.

**Estimated additions:** ~80 LOC.

**Acceptance criteria for Phase 5:**
- `npx tsc --noEmit` passes.
- AC-API-01 through AC-API-07 verifiable (manual via `curl` or browser devtools).
- `GET /api/diff/:s/:c/:linkId` returns `200` with valid `DiffReport` for a known link.
- `GET /api/diff/:s/:c/nonexistent` returns `404`.
- `GET /api/diff-all/:s/:c` returns `200` with `{ reports: [...] }`.
- Neither endpoint creates, updates, or deletes any blob (AC-API-07).

---

### Phase 6 — UI Diff Panel

**Goal:** Add "Diff" and "Diff All" buttons to the Links Panel, implement the diff result display area, and wire up the "Sync Now" convenience button.

**Dependencies:** Phase 5 (API endpoints available).

**Files to modify:** `src/electron/public/app.js`, `src/electron/public/index.html`

#### 6A — UI implementation

**Button placement (in `renderLinksPanel()` in `app.js`):**

In each link row's action column, insert a "Diff" button to the left of the existing "Sync" button:
```
[Diff] [Sync] [Unlink]
```

In the Links Panel modal header (where "Sync All" exists), add a "Diff All" button to its left:
```
[Diff All] [Sync All] [Close]
```

**Diff result panel (inline below the links table):**

The diff result area is a `<div id="diff-result-panel">` rendered below the links table inside the Links Panel modal. It is hidden by default and shown when a diff completes or errors.

Structure (rendered via innerHTML string construction):
```html
<div id="diff-result-panel" style="display:none">
  <!-- Header row: provider icon, repo URL, branch, target prefix, last sync, generated-at -->
  <!-- Summary bar: N modified | N repo-only | N container-only | N identical -->
  <!-- Status badge: IN SYNC (green) | OUT OF SYNC (amber/red) -->
  <!-- Note (if present): displayed prominently above categories -->
  <!-- Per-category collapsible sections:
       MODIFIED — file path, stored SHA (8 chars), remote SHA (8 chars)
       REPO-ONLY — file path, remote SHA
       CONTAINER-ONLY — file path, stored SHA
       IDENTICAL — collapsed by default; expandable via click -->
  <!-- UNTRACKED section — only shown if untracked.length > 0 -->
  <!-- Sync Now button — triggers POST /api/sync-link/:storage/:container/:linkId -->
</div>
```

**Loading state pattern (consistent with codebase):**
```javascript
btn.disabled = true;
const origText = btn.textContent;
btn.textContent = "Diffing...";
try {
  const report = await apiJson(`/api/diff/${storage}/${container}/${linkId}`);
  renderDiffResult(report);
} catch (e) {
  renderDiffError(e);
} finally {
  btn.disabled = false;
  btn.textContent = origText;
}
```

**Error display (no `alert()`):**
```javascript
function renderDiffError(e) {
  const panel = document.getElementById("diff-result-panel");
  panel.style.display = "";
  panel.innerHTML = `<div class="diff-error"><span class="icon">✗</span> ${escapeHtml(e.message || String(e))}</div>`;
}
```

**Collapsible sections:** Use a `<details>/<summary>` HTML pattern or a CSS class toggle. The IDENTICAL section must be collapsed by default (`<details>` without `open` attribute).

**"Sync Now" button wiring:**
```javascript
document.getElementById("diff-sync-now-btn").addEventListener("click", async () => {
  await postApiJson(`/api/sync-link/${storage}/${container}/${linkId}`);
  closeModal("links-panel-modal");
  loadLinksPanel(storage, container); // refresh
});
```

**Acceptance criteria for Phase 6:**
- AC-UI-01 through AC-UI-07 verifiable by manual interaction.
- "Diff" button present in each link row (AC-UI-01).
- Button disables and shows loading indicator during API call (AC-UI-02).
- Successful diff shows summary bar, status badge, and category sections (AC-UI-03).
- API error displays as inline message, not `alert()` (AC-UI-04).
- "Diff All" calls `diff-all` endpoint and shows all link results (AC-UI-05).
- "Sync Now" triggers sync and refreshes links panel (AC-UI-06).
- Identical section starts collapsed; click expands it (AC-UI-07).

---

### Phase 7 — Documentation

**Goal:** Document the `diff` command in `CLAUDE.md` under the `storage-nav` tool block.

**Dependencies:** Phase 4 (CLI stable — options and output format confirmed).

**Can be parallelised with:** Phase 6 (UI).

**File to modify:** `CLAUDE.md`

Add `diff` command documentation to the `<info>` section of the `storage-nav` tool entry, following the format of existing commands:

```
diff         Compare container blobs against linked remote repository (read-only)
  --container <name>    Container name (required)
  --storage <name>      Storage account (optional)
  --account-key <key>   Inline account key
  --sas-token <token>   Inline SAS token
  --account <account>   Azure Storage account name (required with inline key/token)
  --pat <token>         Inline PAT (overrides stored token)
  --token-name <name>   PAT token name
  --prefix <path>       Diff only the link at this target prefix
  --link-id <id>        Diff a specific link by ID
  --all                 Diff all links in the container
  --format <fmt>        Output format: table (default), json, summary
  --show-identical      Include identical files in output
  --physical-check      Cross-reference with actual container blobs to detect untracked files
  --output <file>       Write JSON report to file (only with --format json)

Exit codes: 0=in sync, 1=differences found, 2=fatal error
```

Add three examples:
```bash
# Single-link diff, default table output
npx tsx src/cli/index.ts diff --container my-container

# Multi-link container: diff all links
npx tsx src/cli/index.ts diff --container my-container --all

# JSON output to file for CI pipeline
npx tsx src/cli/index.ts diff --container my-container --format json --output /tmp/diff-report.json
```

---

## 5. Files to Create or Modify

### New Files

| File | Phase | Estimated LOC | Purpose |
|------|-------|---------------|---------|
| `src/core/diff-engine.ts` | 3A | 80–100 | Core `diffLink()` implementation |
| `src/cli/commands/diff-ops.ts` | 4A | 150–180 | CLI diff command and formatters |
| `test_scripts/test-diff-engine.ts` | 3A | 80–120 | Unit tests for core diff logic |

### Modified Files

| File | Phase | Type of Change |
|------|-------|----------------|
| `src/core/types.ts` | 1A | Add `DiffEntry`, `DiffReport`, `DiffCategory` (~40 LOC) |
| `src/core/sync-engine.ts` | 1B | Export `MappedFileEntry` (1 line) |
| `src/core/repo-utils.ts` | 2A | Add extracted `buildProviderForLink()` (~50 LOC) |
| `src/electron/server.ts` | 2A + 5A | Remove function body, add import, add 2 endpoints (~80 LOC net) |
| `src/cli/index.ts` | 4B | Register `diff` command (~25 LOC) |
| `src/electron/public/app.js` | 6A | Diff buttons, result panel, event handlers (~150 LOC) |
| `src/electron/public/index.html` | 6A | Minimal structural changes (if any; prefer JS-only rendering) |
| `CLAUDE.md` | 7A | Document `diff` command |

---

## 6. Acceptance Criteria Reference

### Phase-by-Phase Summary

| Phase | Key Pass Criteria |
|-------|-------------------|
| 1 | `npx tsc --noEmit` clean; types importable; `MappedFileEntry` exported |
| 2 | `npx tsc --noEmit` clean; existing sync commands unaffected |
| 3 | `npx tsx test_scripts/test-diff-engine.ts` passes all 7 AC-CORE scenarios |
| 4 | `diff --help` shows all options; exit codes 0/1/2 verified |
| 5 | `curl` tests for AC-API-01 through AC-API-07 pass |
| 6 | Manual UI walkthrough covers AC-UI-01 through AC-UI-07 |
| 7 | `CLAUDE.md` contains `diff` command documentation with examples |

### Full Acceptance Criteria (from spec)

**Core engine (AC-CORE-01 to AC-CORE-08):**
- AC-CORE-01: Perfect-sync link → `isInSync === true`, all files in `identical`
- AC-CORE-02: One SHA mismatch → that file in `modified`, `modifiedCount === 1`
- AC-CORE-03: File in remote, absent from `fileShas` → in `repoOnly`
- AC-CORE-04: File in `fileShas`, absent from remote → in `containerOnly`
- AC-CORE-05: Empty `fileShas` + no `lastSyncAt` → all remote in `repoOnly`, `note` field set, `isInSync === false`
- AC-CORE-06: `repoSubPath="src/docs"`, `targetPrefix="docs/"` → paths correctly mapped, only `src/docs/` files included
- AC-CORE-07: `provider.listFiles()` called exactly once; `provider.downloadFile()` never called
- AC-CORE-08: `includePhysicalCheck=true` → `physicallyExists` set on entries, `untracked` populated

**CLI (AC-CLI-01 to AC-CLI-10):**
- AC-CLI-01: `--container <c>` with one link → table output with category sections and summary
- AC-CLI-02: `--format json` → valid parseable `DiffReport[]` JSON
- AC-CLI-03: `--format summary` → one line per link
- AC-CLI-04: `--show-identical` → identical section included
- AC-CLI-05: In-sync container → exit code `0`
- AC-CLI-06: Container with differences → exit code `1`
- AC-CLI-07: No links configured → exit code `2`
- AC-CLI-08: Multi-link with no selector → exit code `2` with link list
- AC-CLI-09: `--all` → one report block per link
- AC-CLI-10: `--output /tmp/report.json --format json` → file written, stdout silent

**API (AC-API-01 to AC-API-07):**
- AC-API-01: Valid link → `200` with `DiffReport`
- AC-API-02: Nonexistent link ID → `404`
- AC-API-03: Missing PAT → `400` with `code: "MISSING_PAT"`
- AC-API-04: `diff-all` → `200` with `{ reports: [...] }`, count matches registry
- AC-API-05: `?physicalCheck=true` → `untracked` array present in response
- AC-API-06: `?showIdentical=true` → `identical` entries present in response
- AC-API-07: No blob writes occur

**UI (AC-UI-01 to AC-UI-07):**
- AC-UI-01: "Diff" button in each link row
- AC-UI-02: Loading state during API call (button disabled, spinner/text)
- AC-UI-03: Success shows summary bar, status badge, category sections
- AC-UI-04: API error shown inline (no `alert()`)
- AC-UI-05: "Diff All" shows results for all links
- AC-UI-06: "Sync Now" triggers sync + refreshes links panel
- AC-UI-07: Identical section collapsed by default; expandable

---

## 7. Verification Criteria

The following commands can be executed at the end of each phase to verify correctness:

### After Phase 1
```bash
npx tsc --noEmit
# Expected: zero errors
```

### After Phase 2
```bash
npx tsc --noEmit
npx tsx src/cli/index.ts list
# If storage accounts configured:
npx tsx src/cli/index.ts containers
```

### After Phase 3
```bash
npx tsc --noEmit
npx tsx test_scripts/test-diff-engine.ts
# Expected: all test assertions pass, no uncaught exceptions
```

### After Phase 4
```bash
npx tsc --noEmit
npx tsx src/cli/index.ts diff --help
npx tsx src/cli/index.ts diff --container nonexistent-container 2>&1; echo "exit: $?"
# Expected exit code: 2

# With a real linked container:
npx tsx src/cli/index.ts diff --container <linked-container> --format json | python3 -m json.tool
# Expected: valid JSON output
```

### After Phase 5
```bash
npx tsc --noEmit
# With server running (npx tsx src/cli/index.ts ui &):
curl -s "http://localhost:3100/api/diff/<storage>/<container>/nonexistent-id" | python3 -m json.tool
# Expected: { "error": "..." }, HTTP 404

curl -s "http://localhost:3100/api/diff-all/<storage>/<container>" | python3 -m json.tool
# Expected: { "reports": [...] }
```

### After Phase 6
Manual walkthrough:
1. Open UI at `http://localhost:3100`
2. Navigate to a container with at least one link
3. Open Links Panel
4. Click "Diff" on a link — verify loading state then result panel appears
5. Verify "Diff All" button calls the endpoint and shows multi-link results
6. Simulate API error (disconnect network) — verify inline error message, no `alert()`

### After Phase 7
```bash
grep -A 5 "diff" CLAUDE.md | head -30
# Expected: diff command documentation present with examples
```

---

## 8. Risks and Mitigation Strategies

### Risk 1 — SSH clone performance (Medium probability, Medium impact)

**Description:** SSH links require a full shallow `git clone` before `listFiles()` returns. This can take 10–60+ seconds. CLI users may believe the process is hung.

**Mitigation:**
1. Print warning before SSH diff: `"Warning: this link uses SSH. Diff requires cloning the repository which may take a while..."`
2. Wrap SSH provider usage in `try/finally` to guarantee `cleanup?.()` is called even on error, preventing orphaned temp directories.
3. If user presses Ctrl+C, Node.js process exit triggers cleanup via the `finally` block.

**Residual risk:** Low. Same latency is accepted in `sync` for SSH links; pattern is established.

---

### Risk 2 — `buildProviderForLink()` extraction breaking sync (Low probability, High impact)

**Description:** Moving `buildProviderForLink()` from `server.ts` to `repo-utils.ts` touches the live code path for all sync API endpoints. If the import path, function signature, or TypeScript resolution is wrong, existing sync operations break immediately.

**Mitigation:**
1. Implement Phase 2 as its own isolated step; do NOT proceed to Phase 3 until Phase 2 verification passes.
2. Verification includes running `sync --dry-run` on a real linked container if one is available.
3. The extraction is mechanically straightforward: no logic change, only a move + import update.
4. The `inlinePat` parameter is additive (optional, default `undefined`) — all existing callers pass no argument, so behaviour is unchanged.

**Residual risk:** Low. The function has no server-specific imports; extraction is clean.

---

### Risk 3 — Never-synced links producing confusing output (Low probability, Medium impact)

**Description:** A link created via `link-github` and never synced has `fileShas: {}`. All remote files appear as `repo-only`. For a large repository, this could be hundreds of files showing as "not in container", which may alarm users or be mistaken for a sync failure.

**Mitigation:**
1. `DiffReport.note` field is set to `"Link has never been synced; all repo files appear as repo-only"`.
2. CLI `table` format prints the `note` prominently before any category sections.
3. UI displays the note in a dedicated callout above the category sections.

**Residual risk:** Low. The spec explicitly requires this behaviour; the note field is a first-class part of the output.

---

### Risk 4 — Large repository output size (Low probability, Low impact)

**Description:** For repos with thousands of files, the `DiffReport` built in memory may be large. With `--show-identical`, the identical array could contain thousands of entries.

**Mitigation:**
1. `showIdentical` defaults to `false` in both CLI and API — the primary guard.
2. The spec explicitly marks pagination as out of scope for v1.
3. `--output <file>` allows saving large JSON reports to disk without terminal truncation.

**Residual risk:** Medium for repos >5000 files when `--show-identical` is passed. Acceptable for v1.

---

### Risk 5 — Exit code convention conflict (Low probability, Low impact)

**Description:** The diff command introduces a tri-state exit code (0/1/2) where all other CLI commands use exit code 1 for all errors. Scripts wrapping the existing CLI may not expect exit code 1 to mean "non-error: differences found".

**Mitigation:**
1. Document the exit code semantics clearly in `diff-ops.ts` source code comments.
2. Document in `CLAUDE.md` tool entry: `Exit codes: 0=in sync, 1=differences found, 2=fatal error`.
3. The convention is required by the spec (section 3.2.5) and enables CI scripted usage.

**Residual risk:** Low. The convention is well-defined and scoped to the `diff` command only.

---

### Risk 6 — Physical check latency on large container prefixes (Low probability, Low impact)

**Description:** `BlobClient.listBlobsFlat(container, targetPrefix)` enumerates all blobs. For a container with thousands of blobs under a shared prefix, this adds latency.

**Mitigation:**
1. `--physical-check` defaults to `false` in CLI; `physicalCheck=false` default in API.
2. UI never enables physical check by default.
3. Spec documents the latency trade-off in section 4.1.

**Residual risk:** Low. User opt-in only.

---

### Risk 7 — UI diff result panel layout conflicts (Low probability, Low impact)

**Description:** The diff result panel added inline below the links table could overflow the modal height or push UI elements off-screen on small monitors.

**Mitigation:**
1. Use `max-height` + `overflow-y: auto` CSS on the diff result panel to contain it within the modal.
2. If the modal needs height adjustment, update the existing modal CSS class rather than introducing new layout constraints.

**Residual risk:** Low. CSS adjustment is contained; no structural HTML changes needed.

---

## 9. Implementation Sequence Summary

```
Step 1:  Add types to types.ts (1A) — ~30 min
Step 2:  Export MappedFileEntry from sync-engine.ts (1B) — ~5 min
Step 3:  Verify: npx tsc --noEmit
Step 4:  Extract buildProviderForLink() to repo-utils.ts (2A) — ~30 min
Step 5:  Verify: npx tsc --noEmit + manual sync dry-run test
Step 6:  Implement diffLink() in diff-engine.ts (3A) — ~90 min
Step 7:  Write test_scripts/test-diff-engine.ts (3A) — ~60 min
Step 8:  Verify: npx tsc --noEmit + npx tsx test_scripts/test-diff-engine.ts

PARALLEL TRACK A:                   PARALLEL TRACK B:
Step 9A: diff-ops.ts (4A)           Step 9B: server.ts endpoints (5A)
         ~120 min                            ~60 min
Step 10A: Register in index.ts (4B) Step 10B: Verify API endpoints
          ~15 min

Step 11: Integrate: verify CLI + API work together end-to-end
Step 12: Implement UI (6A) — ~150 min
Step 13: Manual UI walkthrough (AC-UI-01 to AC-UI-07)
Step 14: Update CLAUDE.md (7A) — ~20 min
Step 15: Final full verification: npx tsc --noEmit + all acceptance criteria
```

**Total estimated implementation time:** 8–10 hours

---

## 10. Out of Scope (from spec section 6)

The following are explicitly excluded from this implementation:

- Content-level (line-by-line) diff within a file
- Applying changes from the diff (the "Sync Now" button delegates to the existing sync endpoint)
- Bidirectional sync / push to repository
- Unlinked containers (no `RepoLink`)
- Cross-container comparison
- Deleted blob detection without `--physical-check`
- Pagination or streaming for very large repos
- UI-level PAT entry during diff
