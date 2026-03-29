# Storage Navigator — Functional Requirements

## File Viewing

| Format | UI Rendering | CLI Rendering |
|--------|-------------|---------------|
| JSON | Syntax-highlighted with highlight.js | Pretty-printed with 2-space indent |
| Markdown | Rendered HTML via marked.js, code blocks highlighted | Plain text output |
| PDF | Embedded iframe viewer | Size notice, suggests `download` command |
| Text (.txt) | Monospace preformatted | Plain text output |
| DOCX (.docx, .doc) | Converted to HTML via mammoth.js (server-side), rendered in content panel | Plain text extraction via mammoth.extractRawText() |

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
