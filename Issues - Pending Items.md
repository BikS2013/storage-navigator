# Issues - Pending Items

## Pending

### Medium Priority

- **Test coverage**: No automated tests exist yet for repo sync features. Tests needed for: GitHub/DevOps client URL parsing, sync engine SHA diffing, token CRUD operations.
- **GitHub Trees API truncation**: For very large repos (100k+ files), the Git Trees API may truncate results. A recursive fallback is not yet implemented.
- **Git LFS files**: LFS-tracked files return pointer files, not actual content. Not handled in v1.

## Completed

- **Credential encryption key instability**: Fixed. The encryption key was derived from `os.hostname()` which changes on macOS depending on network. Migrated to a persisted random key at `~/.storage-navigator/machine.key`. Includes automatic migration from old hostname-based keys.
- **Electron app name showing "Electron" in macOS dock**: Fixed. The launch script now renames `Electron.app` to `Storage Navigator.app` before launch and restores on exit.
- **Electron static files not served**: Fixed. The esbuild bundle rewrote `__dirname`, breaking the public directory path. Now resolved via `process.cwd()` and passed as parameter to `createServer()`.
- **DOCX file viewing support**: Implemented. Uses mammoth.js for server-side conversion to HTML (UI) and plain text extraction (CLI).
- **Repository sync**: Implemented. GitHub and Azure DevOps repo cloning into containers with incremental sync via SHA comparison. PAT token management integrated into the encrypted credential store. UI shows sync badges on mirrored containers.
- **Inline secrets as CLI parameters**: Implemented. All blob commands accept `--account-key`/`--sas-token`/`--account`, all repo commands accept `--pat`. Resolution chain: inline param → stored credential → interactive prompt (with option to store). Shared helpers in `src/cli/commands/shared.ts`.
