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
