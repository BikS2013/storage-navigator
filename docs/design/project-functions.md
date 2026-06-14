# Storage Navigator — Functional Requirements

## File Viewing

| Format | UI Rendering | CLI Rendering |
|--------|-------------|---------------|
| JSON | Syntax-highlighted with highlight.js | Pretty-printed with 2-space indent |
| Markdown | Rendered HTML via marked.js, code blocks highlighted | Plain text output |
| PDF | Embedded iframe viewer | Size notice, suggests `download` command |
| Text (.txt) | Monospace preformatted | Plain text output |
| DOCX (.docx, .doc) | Converted to HTML via mammoth.js (server-side), rendered in content panel | Plain text extraction via mammoth.extractRawText() |

## Secret Resolution

All commands support a 3-step resolution chain for secrets (account keys, SAS tokens, PATs):
1. **Inline CLI parameter** (`--account-key`, `--sas-token`, `--pat`) — highest priority
2. **Stored credential** — looked up from the encrypted credential store
3. **Interactive prompt** — asks user for the secret and offers to store it for future use

Shared resolution logic is in `src/cli/commands/shared.ts` (`resolveStorageEntry`, `resolvePatToken`).

## Storage Management

- Add storage accounts with account key or SAS token authentication
- Credentials encrypted with AES-256-GCM using a persisted random key
- List, remove, and export storage account configurations

## Blob Operations

- List containers in a storage account
- Browse blobs with hierarchical folder navigation
- View blob content (format-dependent rendering)
- Download blobs to local files
- Rename blobs (copy + delete)
- Delete blobs (with confirmation)
- Create/upload blobs from file or inline content

## PAT Token Management

- Add personal access tokens for GitHub and Azure DevOps
- Tokens stored encrypted alongside storage credentials (same AES-256-GCM store)
- List tokens with expiry warnings (14-day threshold)
- Remove tokens by name
- Token lookup by name or by provider (auto-selects first matching token)

## Repository Sync

- Clone a GitHub repository into a blob container via REST API (Git Trees + Contents API)
- Clone an Azure DevOps repository into a blob container via REST API (Items API)
- Incremental sync: SHA-based file comparison, only upload changed/new files, delete removed
- Sync metadata stored as `.repo-sync-meta.json` blob in each synced container (legacy) or `.repo-links.json` (new)
- Dry-run mode to preview changes without applying
- Batch processing with 10-concurrent downloads/uploads
- Rate-limit handling with automatic retry
- CLI commands: `clone-github`, `clone-devops`, `sync`
- UI: sync badge on mirrored containers, sync confirmation modal with repo info

## Repository Link Management

- **Folder-level linking:** Associate a specific folder prefix within a container (not just the entire container) to a GitHub or Azure DevOps repository
- **Link as separate step from clone:** Establish a link (metadata only) without downloading files; sync on demand later
- **Repo sub-path filtering:** Link to a sub-path within a repository (e.g., `src/templates/`) — only files under that path are synced
- **Multiple links per container:** A single container can have multiple links to different repositories targeting different folder prefixes
- **Link registry:** `.repo-links.json` blob at container root holds an array of `RepoLink` entries with UUID identifiers
- **Backward compatibility:** Auto-migration from `.repo-sync-meta.json` to `.repo-links.json` on first access; old file retained
- **Conflict detection:** Exact prefix duplicates rejected; nested prefix overlaps produce warnings
- **Unlink:** Remove link metadata without deleting synced files
- **CLI commands:** `link-github`, `link-devops`, `unlink`, `list-links`
- **Extended commands:** `clone-github`/`clone-devops` accept `--prefix` and `--repo-path`; `sync` accepts `--prefix`, `--link-id`, `--all`
- **API endpoints:** Link CRUD (`GET/POST/DELETE /api/links`), per-link sync (`POST /api/sync/:linkId`), sync-all (`POST /api/sync-all`)
- **UI: Link dialog** — triggered from container/folder context menus; collects provider, repo URL, branch, repo sub-path, target prefix, PAT; supports "Link Only" and "Link & Sync" actions
- **UI: Link indicators** — containers show link count badge; linked folders show link icon with tooltip
- **UI: Multi-link sync** — dialog listing all links with per-link sync and "Sync All" buttons
- **UI: Unlink** — context menu option with confirmation dialog; files preserved after unlink
- **UI: Links panel** — view all links for a container with sync and unlink actions per link

## Repository Diff

- **Read-only diff:** Compare files in a container (tracked via `link.fileShas`) against the current remote repository snapshot without making any writes to the container or credential store
- **File classification:** Every tracked file is classified into one of four categories:
  - **identical** — same SHA on both the container side and the remote
  - **modified** — file exists on both sides but SHAs differ
  - **repo-only** — file is in the remote repo but not yet in the container (never downloaded, or added to repo after last sync)
  - **container-only** — file is tracked in the container but has been removed from or was never in the remote repo
- **Untracked category (optional):** When `--physical-check` is enabled, blobs that physically exist in the container prefix but are not recorded in `link.fileShas` are reported as `untracked`
- **Multi-link support:** For containers with multiple links, diff is run per link; each link's report is presented separately
- **Never-synced link handling:** Links created via `link-github`/`link-devops` and never synced have empty `fileShas`; all remote files appear as `repo-only` with a human-readable note explaining the state
- **DiffReport:** Structured report object containing categorised `DiffEntry[]` arrays, a summary (counts per category), `isInSync` boolean, `generatedAt` timestamp, and an optional `note` field
- **CLI `diff` command:**
  - `--container <name>` (required), `--storage`, `--account-key`, `--sas-token`, `--account`, `--pat`, `--token-name`
  - `--prefix`, `--link-id`, `--all` for link selection (mirrors sync command selection logic)
  - `--format table|json|summary` (default: table)
  - `--show-identical` — include identical files in output (omitted by default to reduce noise)
  - `--physical-check` — enable untracked blob cross-reference
  - `--output <file>` — write JSON report to file
  - Tri-state exit codes: `0` = in sync, `1` = differences found, `2` = fatal/operational error
  - SSH warning printed before diff when link uses SSH provider
- **API endpoints:**
  - `GET /api/diff/:storage/:container/:linkId` — diff a single link; query params: `physicalCheck`, `showIdentical`
  - `GET /api/diff-all/:storage/:container` — diff all links; returns `{ reports: DiffReport[] }`
  - `400` with `code: "MISSING_PAT"` when PAT is required but not configured
  - `404` when container has no links or specified link ID does not exist
- **UI — Diff action in Links Panel:**
  - "Diff" button in each link row (left of "Sync" button): order reads Diff | Sync | Unlink
  - "Diff All" button in the Links Panel header (left of "Sync All")
  - Diff result panel displayed inline below the links table within the Links Panel modal
  - Result panel shows: summary bar (N modified | N repo-only | N container-only | N identical), status badge (IN SYNC / OUT OF SYNC), per-category collapsible sections, optional untracked section
  - Identical section collapsed by default; expandable by the user
  - Loading state: button disabled with indicator during API call; restored on completion
  - Errors displayed as inline message (no `alert()`)
  - "Sync Now" convenience button triggers the existing sync endpoint and refreshes the links panel
- **Performance:**
  - `diffLink()` calls `provider.listFiles()` exactly once; never calls `provider.downloadFile()`
  - Physical check (`--physical-check`) adds one `listBlobsFlat` call per link; opt-in only
  - SSH diff requires a shallow clone (same cost as SSH sync); warning shown to user
  - Multi-link diff runs links sequentially (matches sync-all behaviour)

## UI Features

- Electron desktop app with Express server backend
- Tree panel with expandable container/folder hierarchy
- Content panel with format-aware rendering
- Right-click context menu (rename, delete)
- Create file modal with container selector
- Refresh button to reload tree
- Theme toggle (dark/light)
- Export storage config
- Custom app icon and "Storage Navigator" branding in macOS dock
- Sync badge on containers that mirror a repository
- Sync confirmation modal showing repo URL, branch, last sync time, and file count

## RBAC API (`API/`)

- HTTP API exposing Azure Blob + Azure Files behind OIDC + three roles (`StorageReader`, `StorageWriter`, `StorageAdmin`).
- Auth provider: NBG IdentityServer at `https://my.nbg.gr/identity`. JWT validated locally via JWKS.
- Toggleable auth: `AUTH_ENABLED=true|false`. When false, `ANON_ROLE` decides the default role.
- Discovery endpoint: `GET /.well-known/storage-nav-config` returns `{authEnabled, issuer, clientId, audience, scopes}`.
- URL shape:
  - `/storages` — list visible accounts
  - `/storages/{account}/containers[/{c}]` — container CRUD
  - `/storages/{account}/containers/{c}/blobs[/{path}]` — blob CRUD + rename + delete-folder
  - `/storages/{account}/shares[/{s}]` — share CRUD
  - `/storages/{account}/shares/{s}/files[/{path}]` — file CRUD + rename + delete-folder
- Storage access: `DefaultAzureCredential` (Managed Identity in App Service).
- Storage account discovery: ARM scan via `@azure/arm-storage`.
- Reads proxy-streamed through the API; writes streamed; client disconnects cancel via `AbortSignal`.
- Pagination: `?pageSize=` (default 200, max 1000), `?continuationToken=`.
- Errors: `{error: {code, message, correlationId}}`.
- Tests: vitest unit + integration (Azurite + mock IdP).
- Deployment: Azure App Service Linux Node 22 with System-Assigned MI; container via multi-stage Dockerfile.

## API backend client (Plan 007)

- New CLI commands: `add-api`, `login`, `logout`, `shares`, `share-create`, `share-delete`, `files`, `file-view`, `file-upload`, `file-rename`, `file-delete`, `file-delete-folder`.
- All existing blob commands gain `--account` to disambiguate Azure storage account when targeting an api backend.
- Electron "Add Storage" dialog has a third tab for connecting to a Storage Navigator API. Storage tree shows a Shares sibling node under each backend.
- OIDC login flows: PKCE via system browser + loopback redirect (Electron); device-code (CLI). Tokens persisted via Electron `safeStorage` or chmod-600 file (CLI), keyed by api backend name.
- File-share support added to the existing `direct` backends as well, via the new `FileShareClient` wrapping `@azure/storage-file-share` with the same account-key / SAS the user already provides.

## Static auth header (Plan 008)

- API has an opt-in perimeter API-key gate via `STATIC_AUTH_HEADER_VALUE`.
- Independent of OIDC: when both are configured, every request needs the header AND a valid Bearer JWT.
- Header NAME is operator-configurable (`STATIC_AUTH_HEADER_NAME`, default `X-Storage-Nav-Auth`).
- Comma-separated values for zero-downtime rotation.
- Discovery exposes `staticAuthHeaderRequired` + `staticAuthHeaderName` (never the value).
- `/.well-known/*`, `/healthz`, `/readyz`, `/openapi.yaml`, `/docs` remain public.
- Client persists the value on `ApiBackendEntry.staticAuthHeader` (encrypted via the existing credential store) and sends it on every request.
- CLI: `add-api --static-secret <v>` or hidden interactive prompt; `login --static-secret <v>` for rotation.
- Electron UI: Add Storage tab reveals a password input when the API requires it.

## Agent Subcommand (FR-AGT-*)

| ID | Requirement |
|---|---|
| FR-AGT-1 | Agent is a subcommand (`storage-nav agent`) registered in the existing Commander pipeline. It does not change any existing command behavior. |
| FR-AGT-2 | Agent supports one-shot mode (positional prompt argument) and interactive REPL mode (`--interactive`). |
| FR-AGT-3 | Agent wraps all 35 existing storage-nav commands as LLM tools. |
| FR-AGT-4 | Read-only tools are always available. Mutating tools are excluded from the catalog unless `--allow-mutations` is set. |
| FR-AGT-5 | Destructive tools (delete, remove, unlink, logout) require explicit `y/yes` confirmation from the user before executing. On refusal, return `{declined: true}` for the agent to reason about. |
| FR-AGT-6 | Six LLM providers are supported: openai, anthropic, gemini, azure-openai, azure-anthropic, local-openai. Default for first deploy: azure-openai. |
| FR-AGT-7 | Config precedence (Policy B — file-wins): CLI flag > ~/.tool-agents/storage-nav/.env > shell env > ~/.tool-agents/storage-nav/config.json > ConfigurationError (exit 3). |
| FR-AGT-8 | No fallback for required settings. Missing required value throws ConfigurationError with checkedSources. |
| FR-AGT-9 | Config folder is created on first run with secure permissions (dir 0700, .env 0600). |
| FR-AGT-10 | Every log write (stderr + log file) passes through redactString(). Log files created with mode 0600. |
| FR-AGT-11 | Tool results are truncated to a configurable byte budget (default 16 KiB) before reaching the model. |
| FR-AGT-12 | Interactive mode uses MemorySaver checkpointer with stable thread_id. Supports /exit and /reset slash-commands. |
| FR-AGT-13 | Agent uses LangChain v1 createAgent (not deprecated createReactAgent from @langchain/langgraph/prebuilt). |
| FR-AGT-14 | Token values are never returned by the list_tokens tool — metadata only. |
| FR-AGT-15 | rename_blob and rename_file tools return both old and new paths so the agent chains the correct identifier. |

## Agent TUI (FR-AGT-TUI-*)

When `storage-nav agent --interactive` is run from a TTY, the CLI launches a raw-mode TUI
on top of the LangGraph ReAct agent. When stdin is not a TTY, the existing line-based
REPL is used.

| ID | Requirement |
|---|---|
| FR-AGT-TUI-1 | TTY detection: when `--interactive` and `process.stdin.isTTY`, mount the raw-mode TUI; otherwise fall back to `runInteractive`. One-shot mode is unaffected. |
| FR-AGT-TUI-2 | Raw-mode multiline reader with byte-level keybindings (arrows, Home/End, Ctrl+A/E/U/K/W, Option/Ctrl/Cmd+←/→, Alt+Backspace, Delete). No external readline / inquirer / ink / blessed. |
| FR-AGT-TUI-3 | UTF-8 input via stateful StringDecoder so multi-byte characters (Greek, Cyrillic, CJK, emoji) round-trip even when split across stdin chunks. Regression test mandatory. |
| FR-AGT-TUI-4 | Escape-sequence framing follows ANSI shape (CSI / SS3 / ESC<char>) so arrow keys never echo as letters. Regression test mandatory. |
| FR-AGT-TUI-5 | Token-by-token streaming with animated braille spinner. Spinner stops on first token; "↳ calling <tool>(...)" indicator on tool start, "✓" on tool end. |
| FR-AGT-TUI-6 | New streaming seam `streamAgentTurn()` in `src/agent/stream.ts` wraps `graph.streamEvents()` v2 and yields normalised StreamEvent records. ESC propagates via AbortSignal. |
| FR-AGT-TUI-7 | ESC during execution aborts the in-flight model turn (does NOT exit). Ctrl+C twice in a row exits cleanly. Ctrl+D on empty input exits. |
| FR-AGT-TUI-8 | Slash commands: /help, /quit (alias /exit), /new, /history, /last, /copy, /memory (list/show/add/remove/edit), /model, /provider, /tools, /allow-mutations. |
| FR-AGT-TUI-9 | Persistent memory at `~/.tool-agents/storage-nav/memory/<name>.md` (folder 0700, files 0600). Each entry's content is appended to the system prompt as a `## Persistent memory` section on every turn. |
| FR-AGT-TUI-10 | `/provider` re-loads `~/.tool-agents/storage-nav/.env` (Policy B file-wins, override:true) before re-running `loadAgentConfig`. Missing required env vars surface ConfigurationError to the TUI. |
| FR-AGT-TUI-11 | Destructive tool calls are confirmed via an in-TUI modal that runs against the same raw-mode stdin (no second readline). The legacy readline confirm path is preserved for non-TUI callers. |
| FR-AGT-TUI-12 | Structured logger writes are redirected to `~/.tool-agents/storage-nav/logs/tui-<ts>.log` (mode 0600); stderr is silenced in TUI mode. `--log-file` overrides the default location. Critical errors are surfaced as `[error]` lines in the TUI. |

---

## Reverse Git Publication (FR-RG-*)

Added by plan-011. Publishes Azure Blob Storage content as a Git repository on GitHub or
Azure DevOps. Directional opposite of the forward Repository Sync feature. One-way only:
storage → repo. PAT auth, REST-only (no local working tree). See
`docs/design/plan-011-reverse-git.md` for the full implementation plan and provenance.

### R1 — Reverse-link creation (initialize)

| ID | Requirement |
|---|---|
| FR-RG-R1.1 | Reverse-link creation supports storage-account scope (every blob across every container; container name becomes top-level folder per R5.3). |
| FR-RG-R1.2 | Reverse-link creation supports container scope (all blobs in a single container, 1:1 mapping). |
| FR-RG-R1.3 | Reverse-link creation supports prefix (subfolder) scope (blobs under a prefix; prefix stripped per R5.2). |

### R2 — Target identification

| ID | Requirement |
|---|---|
| FR-RG-R2.1 | GitHub target: `owner/repo` plus optional `branch` (default `main`). When repo missing and `--create-repo` set, creates via `POST /user/repos` or `POST /orgs/{org}/repos` with `auto_init:true`, `private:true` default. |
| FR-RG-R2.2 | Azure DevOps target: `org/project/repo` plus optional `branch`. When repo missing and `--create-repo` set, creates via `POST /{org}/{project}/_apis/git/repositories`. ADO repos inherit project visibility (no per-repo visibility flag). |
| FR-RG-R2.3 | Auth reuses existing `TokenEntry` from `CredentialStore`. CLI flags `--token-name <name>` or `--pat <inline>`; no parallel PAT store. |

### R3 — Initial push (publish)

| ID | Requirement |
|---|---|
| FR-RG-R3.1 | Enumerates every blob under the source scope (recursive for account + prefix scopes). |
| FR-RG-R3.2 | Maps each blob to a deterministic repo path per R5.1–R5.5. |
| FR-RG-R3.3 | Applies user-supplied exclusion patterns and (default-on) storage-side `.gitignore`. |
| FR-RG-R3.4 | Produces a single commit with configurable message; default: `"Initial publish from storage <scope> at <iso>"`. |
| FR-RG-R3.5 | Pushes commit to the configured branch. |
| FR-RG-R3.6 | Persists a `ReverseLink` record (blob ETag snapshot + pushed commit SHA + tree SHA) to durable storage. |

### R4 — Incremental push (update)

| ID | Requirement |
|---|---|
| FR-RG-R4.1 | Change detection by ETag comparison: current `listBlobsFlat` ETag map vs. stored `blobSnapshot`. |
| FR-RG-R4.2 | Classifies each path as `added`, `modified`, `deleted`, or `unchanged`. |
| FR-RG-R4.3 | Builds a single commit per push run with all add/modify/delete changes. |
| FR-RG-R4.4 | Configurable commit message; default: `"Sync from storage <scope> at <iso> (+N ~M -K)"`. |
| FR-RG-R4.5 | Pushes to configured branch (fast-forward-only by default). |
| FR-RG-R4.6 | Updates the reverse-link metadata with the new commit SHA, tree SHA, and blob snapshot. |
| FR-RG-R4.7 | `--dry-run` flag previews changes without pushing; exits 0 if no changes, 1 if changes would be pushed. |
| FR-RG-R4.8 | `--force` flag re-classifies every file as `modified` (recovery use case). |

### R5 — Path-mapping rules

| ID | Requirement |
|---|---|
| FR-RG-R5.1 | Container scope: blob `foo/bar.txt` → repo path `foo/bar.txt` at configured `repoSubPath`. |
| FR-RG-R5.2 | Prefix scope: prefix is stripped (e.g. `docs/foo.txt` with prefix `docs/` → `foo.txt`). |
| FR-RG-R5.3 | Storage-account scope: container name becomes the top-level folder (`cust-data/foo.txt`). |
| FR-RG-R5.4 | Paths with characters illegal in Git (control chars, paths starting with `.git/`) are excluded with a warning. |
| FR-RG-R5.5 | Path collisions (e.g. case-only differences) raise `PathCollisionError` by default and abort the push (configurable to skip). |

### R6 — Exclusion / `.gitignore`-style filtering

| ID | Requirement |
|---|---|
| FR-RG-R6.1 | Per-link exclusion pattern list stored in reverse-link metadata. |
| FR-RG-R6.2 | Storage-side `.gitignore` honoured when `--respect-gitignore` true (default true), patterns evaluated relative to scope root. |
| FR-RG-R6.3 | Forward-sync metadata blobs (`.repo-sync-meta.json`, `.repo-links.json`) always excluded from publication. |
| FR-RG-R6.4 | Reverse-link's own metadata blob (`.reverse-git-links.json`) always excluded. |

### R7 — Binary and large-file handling

| ID | Requirement |
|---|---|
| FR-RG-R7.1 | All blobs treated as opaque byte sequences (no text/binary distinction at the publication stage). |
| FR-RG-R7.2 | Large files pushed via provider's appropriate API (GitHub Git Data API blob endpoint; ADO `/pushes` with `base64encoded`). |
| FR-RG-R7.3 | Files exceeding provider hard limits (GitHub 100 MB, ADO 100 MB per file / 5 GB per push) accumulate per-file errors in `PushResult.errors`; push of remaining files continues. |
| FR-RG-R7.4 | Git LFS documented as known v1 limitation. |

### R8 — Deletion semantics

| ID | Requirement |
|---|---|
| FR-RG-R8.1 | Blob disappearing from storage between syncs → Git deletion on next push. |
| FR-RG-R8.2 | Previously-excluded blob added back (removed from exclusion list) → Git add on next push. |
| FR-RG-R8.3 | Previously-published blob added to exclusion list → Git delete on next push, with CLI/UI warning. |

### R9 — Reverse-link metadata model

| ID | Requirement |
|---|---|
| FR-RG-R9.1 | Container/prefix scope metadata persisted as `.reverse-git-links.json` at container root. Storage-account scope metadata persisted in the local `CredentialData` JSON keyed by account name (`reverseLinks` field). |
| FR-RG-R9.2 | Per-link record stores: scope, provider, repoUrl, branch, repoSubPath, tokenName, exclusionPatterns, respectGitignore, lastPushedCommitSha, lastPushedTreeSha, blobSnapshot (path→ETag), author, createdAt, lastPushedAt, lastPushResult. |
| FR-RG-R9.3 | Link IDs are UUID v4. |
| FR-RG-R9.4 | Multiple reverse-links per container and per storage account are supported independently. |

### R10 — CLI surface

| ID | Requirement |
|---|---|
| FR-RG-R10.1 | `publish-github` — initialize reverse-link AND perform first push. |
| FR-RG-R10.2 | `publish-devops` — same for Azure DevOps. |
| FR-RG-R10.3 | `reverse-link-github` — create reverse-link metadata only, no push. |
| FR-RG-R10.4 | `reverse-link-devops` — same for Azure DevOps. |
| FR-RG-R10.5 | `push` — perform incremental update for a specific link or all links matching a source. |
| FR-RG-R10.6 | `reverse-unlink` — remove reverse-link metadata; never touches the remote repo or storage source. |
| FR-RG-R10.7 | `list-reverse-links` — enumerate reverse-links for storage account / container. |
| FR-RG-R10.8 | All commands support `--storage`, `--account`, `--account-key`, `--sas-token`, `--token-name`, `--pat`. |
| FR-RG-R10.9 | `push` supports `--dry-run`, `--force`, `--allow-overwrite-remote`, `--all`, `--link-id`, `--prefix`. |
| FR-RG-R10.10 | `publish-*` supports `--branch`, `--commit-message`, `--exclude <pattern>` (repeatable), `--respect-gitignore`, `--repo-sub-path`, `--visibility public\|private`, `--create-repo`, `--author-name`, `--author-email`. |
| FR-RG-R10.11 | Tri-state exit codes: 0=success/no-op, 1=changes pushed (or would be pushed in dry-run), 2=fatal error. |

### R11 — Electron UI surface

| ID | Requirement |
|---|---|
| FR-RG-R11.1 | Right-click "Publish to Git Repository…" on storage-account, container, and folder nodes. |
| FR-RG-R11.2 | Publish modal: provider selector, repo input, branch, repoSubPath, exclusion textarea, respect-gitignore checkbox, visibility radio, token selector populated from `/api/tokens?provider=…`, commit message override, "Publish Only" / "Publish & Push Now" / "Cancel" buttons. |
| FR-RG-R11.3 | Distinct visual indicator (`.reverse-link-badge`) on nodes with reverse-links; visually distinguishable from forward `.link-badge`. |
| FR-RG-R11.4 | Reverse Links Panel modal showing all reverse-links for current scope, with per-link "Push Now", "Dry-Run Diff", "Unlink" actions. |
| FR-RG-R11.5 | Push progress feedback (spinner / progress bar) and results summary (added/modified/deleted counts, errors). |
| FR-RG-R11.6 | Errors surfaced inline (no `alert()`), consistent with existing UI conventions. |

### R12 — Server API surface

| ID | Requirement |
|---|---|
| FR-RG-R12.1 | `GET /api/reverse-links/:storage/:container?` — list reverse-links. |
| FR-RG-R12.2 | `POST /api/reverse-links/:storage/:container?` — create a new reverse-link. |
| FR-RG-R12.3 | `DELETE /api/reverse-links/:storage/:container?/:linkId` — remove a reverse-link. |
| FR-RG-R12.4 | `POST /api/push/:storage/:container?/:linkId` — push a single reverse-link (query: `dryRun`, `force`). |
| FR-RG-R12.5 | `POST /api/push-all/:storage/:container?` — push all reverse-links for the scope. |
| FR-RG-R12.6 | `GET /api/reverse-diff/:storage/:container?/:linkId` — read-only diff between current storage state and last-pushed snapshot. |
| FR-RG-R12.7 | All endpoints use a shared `buildWriteClientForLink()` factory (parallel to `buildProviderForLink`). |

### Non-functional (FR-RG-NFR-*)

| ID | Requirement |
|---|---|
| FR-RG-NFR1 | Zero new runtime dependencies. Reuse `fetch`, `@azure/storage-blob`, `crypto.randomUUID()`, existing `rateLimitedFetch` and `processInBatches`. |
| FR-RG-NFR2 | Initial publish of 1,000 files ≤ 1 MB average completes in ≤ 5 minutes; incremental push of ≤ 50 changed files completes in ≤ 60 seconds. |
| FR-RG-NFR3 | All HTTP calls via `rateLimitedFetch`; ADO 50 ms inter-request delay honoured. GitHub blob uploads capped at 10 concurrent with 100 ms inter-batch pause. |
| FR-RG-NFR4 | Per-file failures accumulate in `PushResult.errors`; never abort the push. |
| FR-RG-NFR5 | Idempotency: re-running push with no storage changes produces zero new commits and zero metadata mutations. |
| FR-RG-NFR6 | Backward compatibility: all existing forward-sync commands, endpoints, and metadata blobs continue to function unchanged. |
| FR-RG-NFR7 | Every push operation emits progress via `onProgress?: (msg: string) => void` callback. |
| FR-RG-NFR8 | PATs never logged; auto-created repos default to `private`. |
