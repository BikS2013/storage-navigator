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
