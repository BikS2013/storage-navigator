# Refined Request: Reverse Git — Publish Storage Content as a Git Repository

## Category
Development (feature extension across CLI, core, server API, and Electron UI)

## Objective
Add a "reverse Git" capability to the Storage Navigator that lets a user **initiate** a remote Git repository (on GitHub or Azure DevOps) whose initial content is materialized from an Azure storage location, and then **keep that remote repository up to date** with changes detected in the source storage location. The storage source must be selectable at three granularities — entire storage account, a single container, or a subfolder within a container — and the mechanism must operate alongside (not interfere with) the existing forward-direction repo-sync feature that clones repositories *into* storage.

## Scope

### In scope
- A new "reverse link" concept (storage location → remote Git repository) that is the directional opposite of the existing forward `RepoLink` (repository → container/prefix).
- Three source granularities:
  1. **Storage account** — every blob across every container of a storage account (each container mapped to a top-level folder in the repo).
  2. **Container** — all blobs in a single container.
  3. **Subfolder (prefix)** — all blobs under a given prefix in a container.
- Two target Git providers:
  1. **GitHub** (REST API v3 / `api.github.com`, PAT auth — reuse the credential store from plan-002).
  2. **Azure DevOps** (`dev.azure.com/{org}/_apis/git/...`, PAT basic auth — reuse the credential store from plan-002).
- Two operations:
  1. **Initialize**: create (or attach to) a target repository, optionally create the branch, and perform the **first push** of storage content as the initial commit on that branch.
  2. **Update**: detect what has changed in the storage source since the last reverse-sync, build a new commit (or commits) that mirrors those changes, and push it.
- Authentication and PAT reuse via the existing `CredentialStore` `TokenEntry` mechanism (no new PAT storage subsystem).
- A new persistent metadata blob (analogous to `.repo-links.json`) recording reverse-link configuration and last-pushed state per source.
- Diff/change detection between the current storage snapshot and the last-pushed snapshot, including handling of added, modified, and deleted blobs.
- Both **CLI surface** (new subcommands following the existing `clone-github` / `clone-devops` / `sync` / `link-github` / `link-devops` / `unlink` / `list-links` naming family) and **Electron UI surface** (right-click on storage account / container / folder → "Publish to Git Repository…", per-link status indicators, "Push Now" action, multi-link panel).
- A `.gitignore`-like exclusion mechanism so users can keep certain blobs out of the published repository.
- Documentation updates to `CLAUDE.md`, `docs/design/project-design.md`, and `docs/design/project-functions.md`, plus removal/addition of any related entries in `Issues - Pending Items.md`.

### Out of scope
- **Bidirectional sync** (pulling changes made directly in the remote repo back into storage). Conflict handling for concurrent edits in both places is explicitly deferred. The feature is one-way: storage → repo.
- **Auto-creation of new GitHub organisations or Azure DevOps projects/orgs.** The target org/owner and project must already exist; the feature may create the *repository* itself if the PAT has the scope to do so, but never the org/project.
- **Continuous, automatic background monitoring** of storage. Push is on-demand (CLI command or UI button) or triggered by an explicit user-driven schedule (cron-style scheduling is out of scope for v1 — see Open Questions).
- **Real-time event-driven monitoring via Azure Event Grid / Blob change feed.** Polling-on-demand only for v1 (see Open Questions for a possible v2 enhancement).
- **Branch management beyond a single configured branch per reverse-link** (no per-push branch selection, no PRs, no merge handling).
- **Conflict resolution** when the remote branch's tip has diverged from what we last pushed. v1 will fail closed and surface the conflict; user must resolve manually (see Open Questions).
- **Git LFS** for large blobs.
- **Commit signing (GPG/SSH-signed commits).**
- **SSH-based Git providers** (SSH support exists for the forward direction per plan-005; for the reverse direction v1 supports GitHub and Azure DevOps via REST/HTTPS only).
- **Preserving blob metadata** (content-type, custom metadata, blob tier) inside the Git repo beyond the file content itself. Only the byte content is published.
- **Snapshots / versioning of blobs** — only the current version of each blob is published.

## Requirements

### Functional requirements

1. **R1 — Reverse-link creation (initialize)** must be callable for any of the three source granularities:
   - `R1.1` Storage account (all containers).
   - `R1.2` Single container.
   - `R1.3` Container + prefix (subfolder).
2. **R2 — Target identification** must accept:
   - `R2.1` For GitHub: `owner/repo` plus optional `branch` (default: `main`). If the repo does not exist, the feature attempts to create it under `owner` using the configured PAT (visibility — public/private — controlled by an explicit flag; default: private).
   - `R2.2` For Azure DevOps: `org/project/repo` plus optional `branch`. If the repo does not exist, it is created under the existing project.
   - `R2.3` Authentication uses an existing `TokenEntry` from the credential store, selected by `--token-name` or by provider default (reuse of plan-002 PAT mechanism).
3. **R3 — Initial push** must:
   - `R3.1` Enumerate every blob under the source scope (recursively for storage-account and subfolder scopes).
   - `R3.2` Map each blob to a repository path according to a deterministic, documented mapping (see Path-Mapping Rules below).
   - `R3.3` Apply user-supplied exclusion patterns (`.gitignore`-style) before commit.
   - `R3.4` Produce a single commit on the target branch with a configurable commit message (default: `"Initial publish from storage <scope-description> at <ISO timestamp>"`).
   - `R3.5` Push that commit to the remote.
   - `R3.6` Persist a reverse-link metadata record (blob SHA snapshot + pushed commit SHA + tree SHA) to durable storage so the next update operation can compute deltas.
4. **R4 — Incremental push (update)** must:
   - `R4.1` Detect changes by comparing the current blob inventory (path + ETag/MD5/size) against the last-pushed snapshot stored in the reverse-link metadata.
   - `R4.2` Classify each path as one of: `added`, `modified`, `deleted`, `unchanged`.
   - `R4.3` Build a single commit that adds/updates the changed paths and deletes the removed paths.
   - `R4.4` Use a configurable commit message (default: `"Sync from storage <scope-description> at <ISO timestamp> (+N ~M -K)"` where N/M/K are added/modified/deleted counts).
   - `R4.5` Push to the configured branch.
   - `R4.6` Update the reverse-link metadata with the new pushed commit SHA, tree SHA, and blob snapshot.
   - `R4.7` Support `--dry-run` to preview changes without pushing.
   - `R4.8` Support `--force` to re-push every file as `modified` regardless of detected change (mirroring the forward-sync `--force`).
5. **R5 — Path-mapping rules** must be deterministic and documented:
   - `R5.1` Container scope: blob path `foo/bar.txt` → repo path `foo/bar.txt` (1:1) at the configured `repoSubPath` (default: repo root).
   - `R5.2` Subfolder scope: source prefix `docs/` and blob `docs/foo/bar.txt` → repo path `foo/bar.txt` at `repoSubPath` (default: repo root). The source prefix is stripped.
   - `R5.3` Storage-account scope: container `cust-data` and blob `foo/bar.txt` → repo path `cust-data/foo/bar.txt` at `repoSubPath` (default: repo root). Container name becomes the top-level folder.
   - `R5.4` Paths containing characters illegal in Git (control chars, backslash on case-insensitive filesystems, paths starting with `.git/`) must be flagged and excluded with a warning rather than silently mangled.
   - `R5.5` Two blobs whose mapped paths collide (e.g., case-only differences on case-insensitive filesystems) must be flagged and the operation must surface the collision; the user decides whether to skip or abort (configurable behaviour, default: abort).
6. **R6 — Exclusion / `.gitignore`-style filtering** must:
   - `R6.1` Support a reverse-link-level exclusion pattern list (committed to the reverse-link metadata, not to the repo).
   - `R6.2` Optionally honour a `.gitignore` file inside the source scope itself, if present (configurable via flag, default: enabled).
   - `R6.3` Always exclude the existing forward-sync metadata blobs (`.repo-sync-meta.json`, `.repo-links.json`) from publication.
   - `R6.4` Always exclude reverse-link's own metadata blob.
7. **R7 — Binary and large-file handling** must:
   - `R7.1` Treat all blobs as opaque byte sequences (no text/binary distinction at the publication stage).
   - `R7.2` Push large files using the provider's appropriate API path (e.g., Git Data API for files > 1 MB on GitHub).
   - `R7.3` For files exceeding provider hard limits (GitHub: 100 MB per file with API, Azure DevOps: similar), record the failure in the operation result and continue with remaining files; do not abort the whole push.
   - `R7.4` Document Git LFS as a known v1 limitation.
8. **R8 — Deletion semantics** must:
   - `R8.1` A blob that disappears from storage between syncs must appear as a Git deletion in the next push.
   - `R8.2` A user-initiated removal of a path from the exclusion list (i.e., a previously-excluded blob is now included) must appear as a Git `add` on the next push.
   - `R8.3` Adding a path to the exclusion list (i.e., a previously-published blob is now excluded) must appear as a Git `delete` on the next push, with a warning in the CLI/UI summary.
9. **R9 — Reverse-link metadata model** must:
   - `R9.1` Be persisted in a deterministic, discoverable location per source scope (see Open Questions for the exact location decision):
     - Container or subfolder scope: as a blob in that container (e.g., `.reverse-git-links.json` at the container root, supporting multiple subfolder links per container).
     - Storage account scope: as a record in the local user config (the same place the credential store lives) keyed by storage account name, since no single container is "the" home.
   - `R9.2` Record per-link: source scope (account/container/prefix), provider (`github` | `azure-devops`), target repo URL, target branch, `repoSubPath`, PAT token name, exclusion patterns, last-pushed commit SHA, last-pushed tree SHA, last-pushed blob snapshot (path → ETag/MD5), creation timestamp, last-pushed timestamp, last-push result summary.
   - `R9.3` Use UUID v4 for the link ID (parallel to the forward `RepoLink.id`).
   - `R9.4` Support multiple reverse-links per container (e.g., two subfolders each publishing to a different repo) and multiple reverse-links per storage account.
10. **R10 — CLI surface** must follow the existing naming family in plan-002/004/005:
    - `R10.1` `publish-github` — initialize a new reverse-link AND perform the first push (one-shot equivalent of `clone-github`).
    - `R10.2` `publish-devops` — same for Azure DevOps.
    - `R10.3` `reverse-link-github` — create the reverse-link metadata only, no push (parallel to `link-github`).
    - `R10.4` `reverse-link-devops` — same for Azure DevOps.
    - `R10.5` `push` — perform incremental update for a specific reverse-link or all reverse-links matching a source (parallel to `sync`).
    - `R10.6` `reverse-unlink` — remove a reverse-link's metadata without touching the remote repo or the storage source.
    - `R10.7` `list-reverse-links` — enumerate configured reverse-links for a storage account / container.
    - `R10.8` Every command must support `--storage`, `--account`, `--account-key`, `--sas-token`, `--token-name`, `--pat` (inline override) following the existing convention.
    - `R10.9` `push` must support `--dry-run`, `--force`, `--all`, `--link-id`, `--prefix`.
    - `R10.10` `publish-*` must support `--branch`, `--commit-message`, `--exclude <pattern>` (repeatable), `--respect-gitignore`, `--repo-sub-path`, `--visibility public|private` (for repo auto-creation), `--create-repo` (boolean flag controlling whether to attempt auto-creation).
    - `R10.11` Tri-state exit codes consistent with the `diff` command pattern from plan-005 (0 = success / no-op, 1 = changes published, 2 = fatal error). For `--dry-run`, 0 = no changes detected, 1 = changes would be pushed, 2 = fatal error.
11. **R11 — Electron UI surface** must:
    - `R11.1` Add a "Publish to Git Repository…" entry to the right-click context menu on (a) the storage account node, (b) a container node, (c) a folder node.
    - `R11.2` Open a publish-configuration modal with: provider selector, repo URL / org-project-repo input, branch, `repoSubPath`, exclusion patterns (textarea), respect-gitignore checkbox, visibility radio (public/private), token selector (populated from `/api/tokens` filtered by provider), commit message override, "Publish Only" / "Publish & Push Now" / "Cancel" buttons.
    - `R11.3` Show a visual indicator (badge/icon) on storage account / container / folder nodes that have one or more reverse-links configured. Distinguish visually from forward-link indicators.
    - `R11.4` Provide a "Reverse Links Panel" modal (parallel to the existing Links Panel from plan-004/005) showing all reverse-links for the current scope, with per-link "Push Now", "Dry-Run Diff", and "Unlink" actions.
    - `R11.5` Provide push progress feedback (spinner / progress bar) and a results summary (added/modified/deleted counts, errors).
    - `R11.6` Errors must be displayed inline (no `alert()`), matching the existing UI pattern.
12. **R12 — Server API surface** must add endpoints behind the existing `src/electron/server.ts`:
    - `R12.1` `GET /api/reverse-links/:storage/:container?` — list reverse-links (container optional for storage-account-scope links).
    - `R12.2` `POST /api/reverse-links/:storage/:container?` — create a new reverse-link (body carries provider, repoUrl, branch, repoSubPath, exclusions, etc.).
    - `R12.3` `DELETE /api/reverse-links/:storage/:container?/:linkId` — remove a reverse-link.
    - `R12.4` `POST /api/push/:storage/:container?/:linkId` — push a single reverse-link (query: `dryRun`, `force`).
    - `R12.5` `POST /api/push-all/:storage/:container?` — push all reverse-links for the scope.
    - `R12.6` `GET /api/reverse-diff/:storage/:container?/:linkId` — read-only diff between current storage state and last-pushed snapshot (parallel to plan-005 `diff`).
    - `R12.7` Endpoints must use a shared `buildReverseProviderForLink()` factory (parallel to plan-005's `buildProviderForLink()`).

### Non-functional requirements

13. **NFR1 — No new runtime dependencies** unless strictly required. Reuse Node 18+ built-in `fetch`, `@azure/storage-blob`, `crypto.randomUUID()`. New libraries (e.g., for tree/object SHA computation matching Git's blob SHA algorithm) are permitted only if the investigation shows no built-in alternative; any such addition must follow the project's `<dependency-vetting>` rules in `CLAUDE.md`.
14. **NFR2 — Performance**: An initial publish of up to 1,000 files at ≤ 1 MB average must complete in ≤ 5 minutes on a typical broadband connection. An incremental push of ≤ 50 changed files within the same source must complete in ≤ 60 seconds.
15. **NFR3 — Rate-limit safety**: Reuse the existing `rateLimitedFetch` helper from `src/core/repo-utils.ts`. Azure DevOps requires 50 ms inter-request delay (already implemented for forward-sync).
16. **NFR4 — Failure granularity**: Per-file failures during push must not abort the operation; they accumulate in a `PushResult.errors` array (parallel to `SyncResult.errors`).
17. **NFR5 — Idempotency**: Repeated `push` invocations on a source with no changes must result in zero new commits on the remote and zero metadata mutations.
18. **NFR6 — Backward compatibility**: All existing forward-sync commands, endpoints, UI flows, and metadata blobs (`.repo-sync-meta.json`, `.repo-links.json`) must continue to work unchanged. The reverse-link feature must be additive.
19. **NFR7 — Observability**: Every push operation must emit progress callbacks (`onProgress?: (msg: string) => void`) consistent with the forward-sync engine's contract, so CLI and server can stream progress.
20. **NFR8 — Security**: PATs must never be logged. Repository auto-creation must respect the `--visibility` flag and default to **private** if unspecified.

## Constraints

- **Language / runtime**: TypeScript, Node 18+. No Python.
- **Project conventions**: All new files under `src/core/`, `src/cli/commands/`, `src/electron/`. New CLI commands registered in `src/cli/index.ts`. New server endpoints in `src/electron/server.ts`. Follow existing naming conventions (kebab-case file names, camelCase exports, `.js` extensions on TypeScript imports).
- **Tooling reuse**: This work belongs to the existing `storage-nav` tool. It is an extension, not a new tool — do NOT scaffold a new tool via `/tool-conventions scaffold`. Documentation goes into the existing `docs/tools/storage-nav.md` file.
- **No fallback configuration values**: Per project rule, every required configuration setting must raise an exception if missing; do not substitute defaults silently (except where this spec explicitly defines a default such as `branch=main`, `visibility=private`, `respect-gitignore=enabled`).
- **No silent version-control operations**: The implementation may invoke remote Git REST APIs (that *is* the feature). It must not invoke local `git` CLI commands against the project's own working copy. The user explicitly forbids unrequested VCS operations on the local repo.
- **Credential store reuse**: Reuse `CredentialStore.getToken()` / `getTokenByProvider()` from plan-002. Do not introduce a parallel PAT storage.
- **Reuse existing repo clients where feasible**: `GitHubClient` and `DevOpsClient` from `src/core/github-client.ts` / `devops-client.ts` are currently read-only (list + download). They must be extended (or paralleled by a `*-write-client.ts`) with write operations (create blob object, create tree, create commit, update ref, create repo, get current ref). The investigator must decide between "extend in place" vs "new sibling client" — see Open Questions.
- **Metadata-blob conflict avoidance**: The reverse-link metadata blob must not collide with any existing well-known blob name. Suggested name `.reverse-git-links.json` for container scope. Final naming decision should be settled in the design phase.
- **Dependency vetting**: Any new package must follow the `<dependency-vetting>` rules: latest stable major, zero HIGH+ advisories, audit log entry in `Issues - Pending Items.md`.

## Acceptance Criteria

The feature is considered complete when ALL of the following are demonstrably true:

### AC group A — Initialization (initial publish)

- **AC-A1**: `publish-github --container my-container --repo gmarinos/my-export --branch main --token-name my-pat` produces a remote GitHub repository `gmarinos/my-export` with branch `main`, where the file tree matches the container contents according to R5.1, and the only commit on the branch is the one created by this operation.
- **AC-A2**: `publish-github --container my-container --prefix docs/ --repo gmarinos/my-docs --token-name my-pat` produces a remote repository whose root contains exactly the files that were under `docs/` in the container, with the `docs/` prefix stripped (R5.2).
- **AC-A3**: `publish-github --storage my-storage --repo gmarinos/full-account --token-name my-pat` produces a remote repository where each top-level folder corresponds to a container in the storage account, and each container's blobs are mapped 1:1 inside that folder (R5.3).
- **AC-A4**: `publish-devops --container my-container --org my-org --project my-proj --repo my-export --token-name my-devops-pat` performs the equivalent of AC-A1 on Azure DevOps and the remote branch carries the expected file tree.
- **AC-A5**: When the target repo does not exist, `--create-repo` causes it to be created with the specified `--visibility`. Without `--create-repo`, the command fails with a clear error: `"Repository <name> not found. Pass --create-repo to create it."`.
- **AC-A6**: A reverse-link metadata record is persisted (R9) after a successful initial publish, containing the new commit SHA, tree SHA, and the blob-snapshot map.
- **AC-A7**: Re-running the same `publish-github` command on the same source with no storage changes produces zero new commits (NFR5) and exits 0.
- **AC-A8**: Authentication failure (invalid/expired PAT) produces a clear, actionable error and exits with code 2.

### AC group B — Incremental update (push)

- **AC-B1**: After a successful initial publish, adding a new blob to the storage source and running `push --link-id <id>` results in one new commit on the remote branch that contains exactly the new file at the correct repo path.
- **AC-B2**: Modifying an existing blob's content (without changing its name) and running `push` results in a commit whose tree differs in exactly that one file.
- **AC-B3**: Deleting a blob from storage and running `push` results in a commit that removes the corresponding file from the repo.
- **AC-B4**: `push --dry-run --link-id <id>` reports the added/modified/deleted count and the list of affected paths, performs zero network writes to the remote repository, and exits 1 if changes would be made or 0 if no changes.
- **AC-B5**: `push --force --link-id <id>` re-pushes every file as `modified`, producing a single commit that touches every tracked path (use case: corrupted/lost remote state recovery).
- **AC-B6**: `push --all --container my-container` iterates every reverse-link associated with `my-container` and pushes each sequentially; failures of one link do not abort the others; the final exit code reflects the worst outcome across all links.
- **AC-B7**: An unchanged blob (same ETag/MD5) is detected as `unchanged` and is not re-uploaded (NFR5, NFR2).

### AC group C — Authentication

- **AC-C1**: `add-token --name my-pat --provider github --token ghp_xxx` registers a GitHub PAT and `publish-github --token-name my-pat` uses it (reuses plan-002 mechanism).
- **AC-C2**: `add-token --name my-devops-pat --provider azure-devops --token <pat>` registers an Azure DevOps PAT and `publish-devops --token-name my-devops-pat` uses it.
- **AC-C3**: `--pat <inline-token>` overrides any stored PAT (parallel to plan-005's `--pat` flag).
- **AC-C4**: When no PAT is configured for the requested provider and stdin is not a TTY, the command fails with `"No <provider> PAT found. Use 'add-token' to register one."` and exits 2.
- **AC-C5**: An expired PAT (per `TokenEntry.expiresAt`) prints a warning before use; an already-expired PAT prints a more severe warning but still attempts the operation (the remote API will be the source of truth on whether the PAT works).

### AC group D — Path mapping, edge cases, exclusions

- **AC-D1**: A blob named `.git/config` in the container is excluded with a warning (R5.4), regardless of `--respect-gitignore`.
- **AC-D2**: Two blobs `Foo/bar.txt` and `foo/bar.txt` (case-only collision) are detected; default behaviour aborts the push with exit code 2 and a clear error listing both paths.
- **AC-D3**: A file > 100 MB causes a per-file failure recorded in `PushResult.errors`, but the push of all smaller files still succeeds.
- **AC-D4**: A binary blob (e.g., a PNG) is published with byte-identical content (verified by hash) — R7.1.
- **AC-D5**: An exclusion pattern `*.log` excludes all `.log` blobs from publication; a previously-published `.log` blob added to the exclusion list later is removed in the next push (R8.3).
- **AC-D6**: A `.gitignore` file present in the container is honoured when `--respect-gitignore` is true; the `.gitignore` file itself IS published to the repo.
- **AC-D7**: The reverse-link metadata blob (`.reverse-git-links.json`) is never published to the remote repo (R6.4), and existing forward-sync blobs (`.repo-sync-meta.json`, `.repo-links.json`) are also never published (R6.3).

### AC group E — Reverse-link lifecycle

- **AC-E1**: `reverse-link-github --container c --prefix docs/ --repo owner/repo --token-name t` creates a reverse-link metadata record WITHOUT performing any push (R10.3).
- **AC-E2**: `list-reverse-links --container c` displays all reverse-links for the container in a tabular format showing id, provider, repo URL, branch, source scope (account/container/prefix), last push timestamp, and last push result.
- **AC-E3**: `reverse-unlink --link-id <id>` removes the reverse-link metadata record. The remote Git repo is not touched. The storage source is not touched.
- **AC-E4**: After `reverse-unlink`, `list-reverse-links` no longer shows that link.
- **AC-E5**: A storage account can have multiple reverse-links (e.g., container A → repo X, container B → repo Y, account-scope → repo Z). All are listable, pushable, and removable independently.

### AC group F — CLI / UI parity

- **AC-F1**: Every CLI capability listed in R10 is reachable from the Electron UI per R11 (publish from context menu, push from reverse-links panel, dry-run preview, unlink).
- **AC-F2**: UI shows a distinct visual indicator on storage-account / container / folder nodes that have reverse-links (R11.3), distinguishable from forward-link indicators introduced by plan-004.
- **AC-F3**: UI errors are surfaced inline (no `alert()`); successes show a summary toast/banner with the added/modified/deleted counts.
- **AC-F4**: The same metadata file written by the CLI is readable by the server API (and vice versa) — i.e., a user who publishes via CLI and then opens the UI sees the link.

### AC group G — Documentation and registration

- **AC-G1**: `docs/tools/storage-nav.md` documents every new CLI subcommand (R10) with options, examples, and exit-code semantics.
- **AC-G2**: `docs/design/project-design.md` adds a "Reverse Git Publication" section documenting the metadata schema, the path-mapping rules, the change-detection algorithm, the auto-repo-creation behaviour, and the security stance.
- **AC-G3**: `docs/design/project-functions.md` registers each new functional requirement (R1–R12).
- **AC-G4**: `Issues - Pending Items.md` is updated to reflect any new known limitations (e.g., LFS not supported, conflict on diverged remote not handled, no event-driven monitoring), each ranked by priority per the project rule.
- **AC-G5**: Any new dependency adoption (per NFR1) appears in `Issues - Pending Items.md` under the "Dependency vetting log" with vetted-on date.

### AC group H — Compilation and regression

- **AC-H1**: `npx tsc --noEmit` passes with zero new errors.
- **AC-H2**: Existing forward-direction commands (`clone-github`, `clone-devops`, `sync`, `link-github`, `link-devops`, `unlink`, `list-links`, `diff`) continue to function unchanged — verified by re-running their existing acceptance criteria.
- **AC-H3**: Existing metadata blobs (`.repo-sync-meta.json`, `.repo-links.json`) continue to be readable and writable; reverse-link metadata coexists without interference.

## Assumptions

- **A1**: The reuse of the existing `CredentialStore` for PATs is acceptable — the same PAT used for forward `clone-github` is suitable for `publish-github` provided it has write scope (`contents:write` / `repo` on GitHub, `Code (Read & Write)` on Azure DevOps). If the user wants distinct PATs for read vs. write, they can register two `TokenEntry` records with different names and select via `--token-name`. *Basis*: minimises new surface area; consistent with project rule against parallel config systems.
- **A2**: Reverse-link metadata for **container-scoped** and **prefix-scoped** links lives in the container itself at `.reverse-git-links.json`. Reverse-link metadata for **storage-account-scoped** links lives in the local config file (alongside the credential store), keyed by storage account name, because there is no canonical "home container". *Basis*: parallel to the existing forward `.repo-links.json` design from plan-004; storage-account-scope has no other place to land.
- **A3**: Change detection uses the **Azure blob ETag** as the primary "content fingerprint" because ETag changes with content and is returned cheaply by `listBlobsFlat`. MD5 (when set on the blob) is used as a verification fallback. *Basis*: avoids downloading every blob just to compute a hash on every poll; the forward-sync engine in plan-002 uses Git tree SHAs in the equivalent role.
- **A4**: The publish operation builds commits via the provider's **Git Data API** (GitHub: `/git/blobs`, `/git/trees`, `/git/commits`, `/git/refs`; Azure DevOps: `/git/pushes` with `refUpdates` + `commits` + `changes`). No local Git working copy is used; no local `git` CLI invocation occurs. *Basis*: avoids dependency on a working `git` binary; the forward direction already uses REST exclusively.
- **A5**: A "scope-description" used in default commit messages is a human-readable identifier such as `"storage gm-storage / container my-container / prefix docs/"`, derived from the reverse-link record. *Basis*: matches the level of detail in forward-sync progress messages.
- **A6**: For storage-account scope, the **set of containers** in scope is computed at push time (`listContainers`), so newly created containers automatically join the publication on the next push and removed containers translate to deletions. *Basis*: consistent with the "current snapshot wins" semantics of incremental sync.
- **A7**: Push is **on-demand** for v1 (CLI command or UI button). Scheduling/automation (cron, Azure Function trigger, Event Grid) is out of scope and tracked as a v2 enhancement under Open Questions. *Basis*: aligns with forward-sync (plan-002) which is also on-demand.
- **A8**: If the remote branch's HEAD has moved since our last recorded push (i.e., someone else wrote to the branch), the push will **fail closed** with a clear error and exit code 2. v1 does not attempt rebase, merge, or force-push. *Basis*: safer default; conflict semantics are explicitly out of scope.
- **A9**: The Electron UI surface for reverse-links is implemented as **new modals + new context-menu entries**, not as a redesign of the existing forward Links Panel. *Basis*: keeps blast radius small; existing forward-link UI continues to work unchanged.
- **A10**: All reverse-Git work is on the existing `reverse-git-integration` branch (current branch per git status). *Basis*: visible from the conversation context.

## Open Questions

The following questions could not be unambiguously resolved from the raw request or existing project context and should be answered before or during the Investigation/Design phases. They are intentionally NOT silently assumed.

1. **OQ-1 — Repo auto-creation policy**: Should the CLI default to attempting repo auto-creation when the target doesn't exist (with `--create-repo` as opt-out), or should auto-creation always require an explicit `--create-repo` flag? This refined spec assumes opt-in (R2.1 / AC-A5). Confirm.
2. **OQ-2 — Storage-account-scope metadata location**: Should storage-account-scope reverse-link metadata really live in the local user config (Assumption A2), or should it live in a designated "system" container (e.g., create one named `.storage-nav-system` if absent)? The latter makes the configuration portable across machines; the former keeps storage clean.
3. **OQ-3 — `GitHubClient` / `DevOpsClient` extension vs. sibling client**: Should the existing read-only clients gain write methods (`createBlob`, `createTree`, `createCommit`, `updateRef`, `createRepo`), or should new `GitHubWriteClient` / `DevOpsWriteClient` modules be introduced to keep the read surface clean? This is an architectural decision deferred to Investigation.
4. **OQ-4 — Commit granularity**: For incremental push, should every changed blob become its own commit (preserving per-blob commit messages), or should a sync operation produce a single batched commit (R4.3, default in this spec)? Single batched is simpler and matches the forward-sync semantics — confirm.
5. **OQ-5 — Branch divergence handling**: When the remote branch tip has advanced since our last recorded push, v1 fails closed (Assumption A8). Confirm this is acceptable for v1, or whether a `--force-with-lease`-style "publish anyway, overwriting other commits" option is wanted.
6. **OQ-6 — Event-driven monitoring**: Is on-demand-only push acceptable for v1 (Assumption A7), or is automatic push on storage change (via Event Grid, blob change feed, or a scheduled poller) in scope?
7. **OQ-7 — Provider extensibility**: Should the reverse-link metadata schema and code structure accommodate future providers (GitLab, Bitbucket, self-hosted Gitea) by being provider-agnostic at the engine layer (like the forward `SyncEngine` is), or is GitHub-and-DevOps-only acceptable for v1?
8. **OQ-8 — Naming**: This spec proposes CLI verbs `publish-github` / `publish-devops` / `push` / `reverse-link-github` / `reverse-unlink` / `list-reverse-links` and metadata file `.reverse-git-links.json`. Are these names acceptable, or should an alternative naming pattern be chosen (e.g., `mirror-out-*`, `export-to-repo`)?
9. **OQ-9 — Commit author identity**: What `author` / `committer` identity should the generated commits carry? Options: (a) hardcoded `"Storage Navigator <storage-nav@local>"`, (b) a configurable per-reverse-link `--author-name` / `--author-email`, (c) inferred from the PAT's GitHub/DevOps profile via an extra API call. Confirm preference.
10. **OQ-10 — Storage-account scope tracking accuracy**: Iterating every blob in every container in a large storage account can be expensive. Is the on-demand iteration in Assumption A6 acceptable, or is per-container link splitting recommended (i.e., discourage account-scope and document it as a "use sparingly" mode)?
11. **OQ-11 — Backward `.gitignore` semantics**: When `--respect-gitignore` is true, do the patterns in the storage-side `.gitignore` apply relative to the **source scope root** (the prefix or container root) or relative to the **mapped repo root**? This spec implicitly assumes source-scope-relative; confirm.
12. **OQ-12 — Conflict between forward and reverse linking**: Can the same container/prefix simultaneously have a forward `RepoLink` (pulling from repo X) AND a reverse-link (pushing to repo Y, possibly the same or different)? If yes, what is the interaction semantics — does forward sync trigger an automatic reverse push? v1 default proposal: allow both independently, no implicit chaining. Confirm.

## Original Request

```
I want you to implement a reverse Git capability that allows a storage navigator to initiate a Git repository based on the current storage account, a subfolder of the current storage account, or a container within the current storage account. Besides initiating the Git repository, it must be able to update the repository based on the content of the connected linked storage account, container, or subfolder. It should monitor changes and update the content of the Git repository accordingly.

These capabilities must be implemented to support GitHub repositories and Azure DevOps repositories.
```
