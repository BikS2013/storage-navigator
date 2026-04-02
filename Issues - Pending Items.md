# Issues - Pending Items

## Pending

### Medium Priority

- **Test coverage**: No automated tests exist yet for repo sync features. Tests needed for: GitHub/DevOps client URL parsing, sync engine SHA diffing, token CRUD operations, link registry CRUD, path filtering/mapping, migration logic.
- **XSS in tree node names (pre-existing)**: `createTreeNode()` in `app.js` renders the `name` parameter via `innerHTML` without `escapeHtml()`. Container names and folder names from Azure could theoretically contain HTML special characters. Low risk since Azure Blob Storage restricts these characters, but should be hardened.
- **Link dialog does not validate repo access before creating link**: The CLI commands (`link-github`, `link-devops`) validate that the repo is accessible by resolving the default branch, but the UI's `POST /api/links` endpoint only writes metadata without validating repo accessibility. The spec requires validation.
- **GitHub Trees API truncation**: For very large repos (100k+ files), the Git Trees API may truncate results. A recursive fallback is not yet implemented.
- **Git LFS files**: LFS-tracked files return pointer files, not actual content. Not handled in v1.

### Low Priority

- **Link dialog missing token dropdown**: The spec requires the link dialog to have a token dropdown populated from configured PATs filtered by provider. Current implementation only collects provider, URL, branch, prefix, and sub-path. Token selection is server-side (first matching token).
- **Folder-level "Sync from Repository" context menu not implemented**: The spec calls for right-click on linked folders showing "Sync from Repository" and "Unlink Repository" options. Currently only "Link to Repo" appears in the folder context menu. Sync/unlink for linked folders must go through the Links Panel.
- **Multi-link sync badge count**: The spec says the container badge should show count (e.g., "2 links") for multi-link containers. Current implementation shows a generic sync arrow icon. The tooltip shows count but the visual badge does not.

## Completed

- **Credential encryption key instability**: Fixed. The encryption key was derived from `os.hostname()` which changes on macOS depending on network. Migrated to a persisted random key at `~/.storage-navigator/machine.key`. Includes automatic migration from old hostname-based keys.
- **Electron app name showing "Electron" in macOS dock**: Fixed. The launch script now renames `Electron.app` to `Storage Navigator.app` before launch and restores on exit.
- **Electron static files not served**: Fixed. The esbuild bundle rewrote `__dirname`, breaking the public directory path. Now resolved via `process.cwd()` and passed as parameter to `createServer()`.
- **DOCX file viewing support**: Implemented. Uses mammoth.js for server-side conversion to HTML (UI) and plain text extraction (CLI).
- **Repository sync**: Implemented. GitHub and Azure DevOps repo cloning into containers with incremental sync via SHA comparison. PAT token management integrated into the encrypted credential store. UI shows sync badges on mirrored containers.
- **Inline secrets as CLI parameters**: Implemented. All blob commands accept `--account-key`/`--sas-token`/`--account`, all repo commands accept `--pat`. Resolution chain: inline param → stored credential → interactive prompt (with option to store). Shared helpers in `src/cli/commands/shared.ts`.
