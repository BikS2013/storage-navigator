# Investigation: Container vs. Repository Diff Feature

**Date:** 2026-04-08
**Status:** Complete — ready for planning
**Input documents:**
- `docs/reference/refined-request-container-diff.md` — full requirement specification
- `docs/reference/codebase-scan-container-diff.md` — codebase analysis

---

## 1. Context Summary

The diff feature compares the files currently stored in an Azure Blob Storage container (keyed by
`link.fileShas`) against the current remote repository snapshot, and classifies every file into
one of four categories: **identical**, **modified**, **repo-only**, or **container-only**. An
optional fifth category, **untracked**, is populated when `--physical-check` is enabled and
cross-references actual blobs in the container.

The feature is entirely read-only. It reuses the existing path-mapping pipeline
(`filterByRepoSubPath` + `mapToTargetPaths`) and `link.fileShas` as the stored-side ground truth,
avoiding any content download.

The codebase already has all the building blocks in place:
- `sync-engine.ts` has the path-mapping helpers (exported).
- `server.ts` has `buildProviderForLink()` (private) that constructs any provider type.
- `syncContainer()` in `repo-sync.ts` has the link-selection logic to mirror.
- `BlobClient.listBlobsFlat()` exists for the optional physical check.

---

## 2. Approach Options

### 2.1 Where to place `diffLink()` — `sync-engine.ts` vs. new `diff-engine.ts`

**Option A: Add `diffLink()` directly to `sync-engine.ts`**

- Pros: No new file; `MappedFileEntry` is accessible without export changes; shared types stay close.
- Cons: `sync-engine.ts` is already 456 LOC. Adding ~80 LOC for `diffLink()` plus exporting
  `DiffEntry`, `DiffReport`, `DiffCategory` (which belong in `types.ts` per codebase convention)
  pushes it to ~540 LOC. The module then contains two distinct concerns: sync (writes) and diff
  (read-only).

**Option B: New `src/core/diff-engine.ts`** (recommended by codebase scan)

- Pros: Clean separation of concerns. The sync engine mutates `link` in-place; the diff engine
  must never mutate anything — keeping them separate makes this invariant structurally obvious.
  `diff-engine.ts` imports `filterByRepoSubPath` and `mapToTargetPaths` from `sync-engine.ts`
  directly. `MappedFileEntry` needs to be exported from `sync-engine.ts` (one-line change).
- Cons: One additional file; one export to add to `sync-engine.ts`.

**Verdict: Option B.** The read-only vs. write distinction is significant enough to warrant
separation. The 456 LOC threshold has already been reached; adding a write-free diff engine on
top is the cleaner long-term shape. `DiffEntry`, `DiffReport`, and `DiffCategory` go into
`src/core/types.ts` (the canonical home for all shared interfaces in this codebase).

---

### 2.2 Where to place `buildProviderForLink()` — extract to core vs. duplicate

**Option A: Extract to `src/core/repo-utils.ts`**

The function (`server.ts` lines 23–61) constructs a `RepoProvider` from a `CredentialStore` +
`RepoLink`. Its only dependencies are `CredentialStore`, `GitHubClient`, `DevOpsClient`,
`SshGitClient`, and `RepoProvider` — all of which are pure core modules with no server-side or
CLI-side imports. The extraction is mechanically clean: move the function body, update the import
in `server.ts`, import it in `diff-ops.ts`.

- Pros: Single source of truth. Both CLI and server use identical provider-construction logic.
  Future provider types (e.g. GitLab) only need to be added in one place.
- Cons: `repo-utils.ts` currently contains only low-level utilities (`rateLimitedFetch`,
  `processInBatches`, `inferContentType`). Placing a higher-level factory there is a slight
  mismatch of abstraction levels. A new `src/core/provider-factory.ts` would be more descriptive
  but adds another file.

**Option B: Duplicate a simplified version in `src/cli/commands/shared.ts`**

- Pros: No changes to `repo-utils.ts` or `server.ts`.
- Cons: Provider construction logic is duplicated. If a new provider type is added, both copies
  need updating — an immediate maintenance liability given the codebase already has three providers.

**Option C: New `src/core/provider-factory.ts`** (cleanest)

- Pros: Purpose-named file; clear abstraction. `buildProviderForLink()` is the only export,
  making its role unambiguous.
- Cons: One more file.

**Verdict: Option A (extract to `repo-utils.ts`).** The codebase already uses `repo-utils.ts`
as the "miscellaneous core utilities" module. A factory function fits acceptably. This avoids
introducing a fourth file when three already exist for a small codebase. If `repo-utils.ts` grows
significantly in a later phase, a rename to `provider-factory.ts` can be done then.

The extracted signature:
```typescript
export async function buildProviderForLink(
  store: CredentialStore,
  link: RepoLink,
  inlinePat?: string   // Optional: override stored PAT (for CLI --pat flag)
): Promise<{ provider: RepoProvider; cleanup?: () => void } | null>
```

The `inlinePat` parameter is new: `server.ts` never passes one (it always uses stored tokens),
but the CLI diff command needs to support `--pat`. The existing `server.ts` call site passes no
`inlinePat`, so the parameter is backward-compatible as optional.

---

### 2.3 The physical check — design strategy

The physical check (`--physical-check` / `includePhysicalCheck=true`) calls
`BlobClient.listBlobsFlat(container, targetPrefix)` to enumerate actual blobs and detect files
that exist physically but are not tracked in `link.fileShas` (`untracked` category).

**Design decision:** The physical check is a cleanly separable second phase after the SHA
comparison, not interleaved with it. The implementation structure is:

```
Phase 1 (always):
  remoteMap = provider.listFiles() → filter → map → Map<blobPath, remoteSha>
  storedMap = link.fileShas → Map<blobPath, storedSha>
  classify each entry → identical / modified / repoOnly / containerOnly

Phase 2 (only when includePhysicalCheck=true):
  physicalBlobs = blobClient.listBlobsFlat(container, targetPrefix)
  for each physicalBlob:
    if not in storedMap → add to untracked[]
  for each repoOnly entry:
    if physicalBlob exists at blobPath → set physicallyExists=true
```

This two-phase structure keeps the core SHA logic simple and testable without requiring a blob
client. Phase 2 is an optional enhancement that requires one additional network call.

**Key detail:** `physicallyExists` on `DiffEntry` is only set when Phase 2 runs. Without the
physical check, a `repo-only` file could physically exist in the container (if it was uploaded
manually outside of sync) — but the diff cannot detect this. The spec acknowledges this and
makes it explicit in the out-of-scope section.

---

### 2.4 Output formatting strategy for CLI

The CLI diff command supports three `--format` options. The strategy for each:

**`table` (default):**
- Render categories in order: MODIFIED → REPO-ONLY → CONTAINER-ONLY → IDENTICAL (last, hidden by
  default unless `--show-identical`).
- Omit empty categories entirely (no "MODIFIED (0)" headings).
- Use a fixed-width column layout: file path left-aligned, SHAs right-aligned, truncated to 8 chars.
- Apply ANSI colours only when `process.stdout.isTTY` is true (same pattern used by `chalk` in
  the existing codebase).
- The summary line at the bottom always appears.

**`summary`:**
- One line per link: `container / provider / repoUrl (branch) — N modified, N repo-only, N container-only, N identical — STATUS`
- No per-file details.
- Useful for CI pipeline checks: `diff --format summary --container x`.

**`json`:**
- Raw `DiffReport[]` as a JSON array, pretty-printed (`JSON.stringify(reports, null, 2)`).
- When `--output <file>` is provided, write to file; otherwise stdout.
- When `--output` is combined with `table` or `summary`, the human-readable output goes to stdout
  and nothing is written to the file (the `--output` option is only meaningful with `--format json`).

**Implementation note:** All formatting belongs in `diff-ops.ts`, not in `diff-engine.ts`. The
core engine returns a `DiffReport`; the CLI layer decides how to render it. This is consistent
with the existing pattern where `syncContainer()` in `repo-sync.ts` does all console output and
`syncRepo()` in `sync-engine.ts` is pure logic.

---

## 3. Recommended Approach

### 3.1 Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core engine placement | New `src/core/diff-engine.ts` | Separation of read-only vs. write concerns; `sync-engine.ts` already at size limit |
| Type definitions | `src/core/types.ts` | Consistent with all other shared interfaces |
| `buildProviderForLink()` | Extract to `src/core/repo-utils.ts` | Single source of truth; clean extraction with no server-side dependencies |
| Physical check | Two-phase, optional | Keeps core logic testable without a blob client; Phase 2 is additive |
| CLI output | `diff-ops.ts` only | Engine is pure logic; presentation layer is CLI concern |
| SSH confirmation prompt | Warning, no confirmation | Spec says warning only (Open Question 3 resolution) |
| Multi-link ambiguity | `process.exit(2)` | New convention: exit 2 = operational error, exit 1 = differences found |

### 3.2 File-Level Plan

**New files:**
1. `src/core/diff-engine.ts` — `diffLink()` implementation (~80–100 LOC)
2. `src/cli/commands/diff-ops.ts` — CLI command handler (`diffContainer()`) (~150–180 LOC)

**Modified files:**
1. `src/core/types.ts` — Add `DiffEntry`, `DiffReport`, `DiffCategory` (add ~35 LOC)
2. `src/core/sync-engine.ts` — Export `MappedFileEntry` (1-line change)
3. `src/core/repo-utils.ts` — Add extracted `buildProviderForLink()` (~45 LOC moved from server.ts)
4. `src/cli/index.ts` — Register `diff` command via Commander (~25 LOC)
5. `src/electron/server.ts` — Import `buildProviderForLink` from repo-utils; add two GET endpoints
   (`/api/diff/:storage/:container/:linkId` and `/api/diff-all/:storage/:container`) (~80 LOC)
6. `src/electron/public/app.js` — Diff button per link row, Diff All button, diff result panel
7. `src/electron/public/index.html` — Any static scaffolding for the diff result panel
8. `CLAUDE.md` — Document the `diff` command

### 3.3 Implementation Sequence

The recommended implementation order respects dependency direction:

1. **Types first** (`types.ts`): `DiffEntry`, `DiffReport`, `DiffCategory` — no dependencies on
   other new code; unblocks everything else.

2. **Export `MappedFileEntry`** (`sync-engine.ts`): One-line change; unblocks `diff-engine.ts`.

3. **Extract `buildProviderForLink()`** (`repo-utils.ts`): Move from `server.ts`, add `inlinePat`
   parameter, update `server.ts` import. Verify the server still compiles and existing sync
   endpoints still work before proceeding.

4. **Core engine** (`diff-engine.ts`): Implement `diffLink()`. At this point it can be tested
   independently with mock provider and link data (via `test_scripts/`).

5. **CLI command** (`diff-ops.ts`): Implement `diffContainer()` and all output formatters.
   Register in `index.ts`.

6. **Server endpoints** (`server.ts`): Add two GET endpoints using the existing pattern.

7. **UI** (`app.js`, `index.html`): Add Diff and Diff All buttons; implement diff result panel.

8. **Documentation** (`CLAUDE.md`): Document the `diff` command.

---

## 4. Risk Assessment

### 4.1 SSH clone performance
**Risk:** SSH links require a full shallow `git clone` before `listFiles()` can return. For large
repos, this takes 10–60+ seconds. The CLI diff command runs this synchronously; users may think
the process is hung.

**Mitigation:** Print a warning message before entering the SSH path:
```
Warning: this link uses SSH. Diff requires cloning the repository which may take a while...
```
The `cleanup()` function must be called in a `finally` block to remove the temp directory even
if the diff fails.

**Residual risk:** Low. The same latency exists for `sync` with SSH links and is accepted there.

### 4.2 Never-synced links (`fileShas: {}`)
**Risk:** A link created via `link-github` and never synced has `fileShas: {}`. All remote files
appear as `repo-only`. The output could be enormous for large repos, misleading users into
thinking the container is badly out of sync when it was simply never populated.

**Mitigation:** `DiffReport.note` field signals this case:
`"Link has never been synced; all repo files appear as repo-only"`. The CLI table output must
display this note prominently (before the category sections). The JSON output includes `note`
in the report object.

**Residual risk:** Low. The spec explicitly requires this behaviour and the note field.

### 4.3 Large repositories (thousands of files)
**Risk:** `DiffReport` is built entirely in memory. For a repo with 10,000 files, the `identical`
array alone could be large. The `--show-identical` flag being off by default (and `showIdentical`
defaulting to `false` in the API) is the primary guard against excessive output.

**Mitigation:** The spec explicitly marks pagination as out of scope for v1. The `showIdentical`
default is the only control needed for practical repo sizes. The JSON output to file (`--output`)
has no truncation, which is correct.

**Residual risk:** Medium for very large repos (>5000 files) when `--show-identical` is passed.
Acceptable for v1; pagination can be added later if needed.

### 4.4 `buildProviderForLink()` extraction breaking existing sync
**Risk:** Moving `buildProviderForLink()` from `server.ts` to `repo-utils.ts` is a refactor that
touches a live, working code path. If the import is wrong or a subtle difference is introduced,
existing sync endpoints break.

**Mitigation:**
- The extraction is mechanical (copy function body, update import in `server.ts`).
- The function has no side effects beyond constructing objects — it is easy to verify.
- The `inlinePat` parameter is added as optional with `undefined` default, so all existing callers
  pass no argument and behaviour is unchanged.
- Implement and verify this step before touching `diff-engine.ts` or any new code.

**Residual risk:** Low. The function is self-contained and has no server-specific dependencies.

### 4.5 Exit code convention conflict
**Risk:** The diff command introduces exit code 2 for operational errors, while all other CLI
commands use exit code 1 for errors. This is a new convention that could confuse users or scripts
that consume the CLI exit codes.

**Mitigation:** Document the exit code semantics clearly in `diff-ops.ts` code comments and in
the `CLAUDE.md` documentation. The tri-state exit code is explicitly required by the spec (section
3.2.5) and enables scripted usage (`if diff ...; then ...`).

**Residual risk:** Low. The convention is well-defined and documented.

### 4.6 Physical check performance on large prefixes
**Risk:** `BlobClient.listBlobsFlat(container, targetPrefix)` enumerates all blobs under a
prefix. For a container with thousands of blobs under a shared prefix, this could be slow.

**Mitigation:** The `--physical-check` flag defaults to `false` in both CLI and API. Users opt
in explicitly. The spec documents the latency trade-off in section 4.1.

**Residual risk:** Low. It is a user-opted-in operation.

### 4.7 `MappedFileEntry` export requirement
**Risk:** `MappedFileEntry` is currently an unexported interface in `sync-engine.ts`. Exporting
it requires a one-line change but also makes it part of the public API of `sync-engine.ts`.

**Mitigation:** Export is the correct choice since `diff-engine.ts` needs it. The type is not
sensitive; it is a pure data structure with no behavioural implications.

**Residual risk:** Negligible.

---

## 5. Open Questions Resolution

The refined request listed five open questions. This investigation resolves all of them:

| # | Question | Resolution |
|---|----------|------------|
| 1 | `buildProviderForLink()` sharing | Extract to `src/core/repo-utils.ts` with optional `inlinePat` parameter |
| 2 | `diffLink()` placement | New `src/core/diff-engine.ts`; types in `src/core/types.ts` |
| 3 | SSH diff confirmation prompt | Warning message only; no confirmation prompt required |
| 4 | API response size | `showIdentical=false` default is sufficient for v1; pagination deferred |
| 5 | UI diff result location | Inline below the links table within the Links Panel modal (simpler path) |

---

## 6. Technical Research Guidance

**Research needed: No**

All technology and architecture decisions can be made from first principles and codebase knowledge:

- **SHA comparison logic**: Pure in-memory Map comparison. No external libraries needed. The
  existing `link.fileShas` structure is a `Record<string, string>` (blobPath → sha); the remote
  file list is `RepoFileEntry[]` with `path` and `sha`. Both are already in the codebase.

- **Output formatting**: The codebase already uses `chalk` for coloured output. TTY detection
  (`process.stdout.isTTY`) is a Node.js built-in. No research needed.

- **ANSI colour for IN SYNC / OUT OF SYNC**: `chalk.green()` / `chalk.red()` with chalk's
  `level` auto-detection. Already used in the project.

- **Exit code semantics**: Node.js `process.exit(n)` with a new convention documented in code.
  No research needed.

- **Azure Blob `listBlobsFlat`**: Already in `BlobClient` and used in existing commands.

- **TypeScript strict mode compliance**: All new code must follow the existing `strict: true`
  config and use `.js` extension imports. No new patterns needed.

- **UI DOM manipulation**: The existing app.js uses innerHTML string concatenation and event
  listener attachment after render. The diff result panel follows the same pattern as the
  existing links panel render. No framework research needed.

The only area that warranted verification was the feasibility of extracting `buildProviderForLink()`
— confirmed clean: no server-specific imports, straightforward function move.

---

## 7. Summary

The container diff feature is well-specified and builds cleanly on existing infrastructure. The
core implementation requires two new files (`diff-engine.ts`, `diff-ops.ts`), minor additions to
`types.ts` and `sync-engine.ts`, and a mechanical extraction of `buildProviderForLink()` to
`repo-utils.ts`. No new technologies, protocols, or patterns are introduced. The main
architectural decision (separate `diff-engine.ts`) is driven by the clean read-only vs. write
separation and the existing file size of `sync-engine.ts`.

The feature can proceed directly to planning (plan document creation) and implementation without
further research or investigation phases.
