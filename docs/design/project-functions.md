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
- Sync metadata stored as `.repo-sync-meta.json` blob in each synced container
- Dry-run mode to preview changes without applying
- Batch processing with 10-concurrent downloads/uploads
- Rate-limit handling with automatic retry
- CLI commands: `clone-github`, `clone-devops`, `sync`
- UI: sync badge on mirrored containers, sync confirmation modal with repo info

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
