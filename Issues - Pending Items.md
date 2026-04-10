# Issues - Pending Items

## Pending

### Medium Priority

- **Test coverage**: No automated tests exist yet for repo sync features. Tests needed for: GitHub/DevOps client URL parsing, sync engine SHA diffing, token CRUD operations, link registry CRUD, path filtering/mapping, migration logic.
- **Link dialog does not validate repo access before creating link**: The CLI commands (`link-github`, `link-devops`) validate that the repo is accessible by resolving the default branch, but the UI's `POST /api/links` endpoint only writes metadata without validating repo accessibility. The spec requires validation.
- **Git LFS files**: LFS-tracked files return pointer files, not actual content. Not handled in v1.
- **Duplicated content-type detection**: Three separate MIME-type maps exist in `blob-ops.ts`, `repo-utils.ts`, and `server.ts` with inconsistencies (`.md` maps to `text/plain` in one, `text/markdown` in another). Should consolidate to use `inferContentType()` from `repo-utils.ts` everywhere.
- **Dead code**: `promptSecret()` in `src/cli/commands/shared.ts` is defined but never called.
- **CredentialStore instantiated per request**: Every API request in `server.ts` creates a new `CredentialStore`, reading and decrypting from disk each time. Should use a singleton or request-scoped instance.
- **Registry race conditions**: `createLink()`, `removeLink()`, `cloneRepo()`, and `syncRepo()` all do read-modify-write on `.repo-links.json` with no locking. Concurrent CLI/UI operations can overwrite each other.
- **Diff All "Sync Now" button has no PAT retry**: In `attachDiffSyncHandlers()`, when sync fails with MISSING_PAT, `handleSyncError` is called with `null` as `retryAction`. After the user adds a token, the sync is not retried — they must manually click "Sync Now" again.
- **`findLinkByPrefix` unhandled throw in repo-sync.ts**: The same unhandled-throw pattern fixed in `diff-ops.ts` exists in `repo-sync.ts` line 193 and `link-ops.ts` line 148. If the prefix is not found or ambiguous, an uncaught exception is printed rather than a clean error message with exit code 2.

### Low Priority

- **Link dialog missing token dropdown**: The spec requires the link dialog to have a token dropdown populated from configured PATs filtered by provider. Current implementation only collects provider, URL, branch, prefix, and sub-path. Token selection is server-side (first matching token).
- **Folder-level "Sync from Repository" context menu not implemented**: The spec calls for right-click on linked folders showing "Sync from Repository" and "Unlink Repository" options. Currently only "Link to Repo" appears in the folder context menu. Sync/unlink for linked folders must go through the Links Panel.
- **Multi-link sync badge count**: The spec says the container badge should show count (e.g., "2 links") for multi-link containers. Current implementation shows a generic sync arrow icon. The tooltip shows count but the visual badge does not.

## Completed

- **`renderDiffAllResults` used wrong response key (data.reports vs data.results)**: Fixed. The `/api/diff-all` endpoint returns `{ results: [...] }` but `renderDiffAllResults()` was checking `data.reports`, so "Diff All" always showed "No diff results returned." Fixed by correcting the field name and iterating `item.report` from each result entry.
- **`findLinkByPrefix` throw not caught in diff-ops.ts**: Fixed. Wrapped the `findLinkByPrefix` call in a try/catch that prints the error message and exits with code 2, consistent with the function's documented error contract.

- **Command injection in ssh-git-client.ts**: Fixed. Replaced `execSync` with string interpolation by `spawnSync` with array args in `clone()` and `getDefaultBranch()` to prevent shell injection via repoUrl/branch. Also added path traversal guard in `downloadFile()`.
- **Server binding to 0.0.0.0**: Fixed. Express server now binds explicitly to `127.0.0.1` instead of all interfaces, preventing network-adjacent access to the unauthenticated API.
- **XSS via innerHTML in app.js**: Fixed. `createTreeNode()` now uses `textContent` via DOM APIs instead of `innerHTML`. All error messages use `escapeHtml()`. DOCX HTML output is sanitized by stripping script/iframe/object/embed tags.
- **Credentials file permissions**: Fixed. `save()` in `credential-store.ts` now creates the directory with `mode: 0o700` and the file with `mode: 0o600`, preventing world-readable ciphertext.
- **No SRI on CDN resources**: Fixed. Added `integrity` and `crossorigin="anonymous"` attributes to all CDN-loaded highlight.js and marked.js resources in `index.html`.
- **GitHub Trees API truncation silently ignored**: Fixed. `listFiles()` now throws an error when the tree is truncated, with guidance to use `--repo-path` for large repos.
- **Rate-limit header misinterpretation**: Fixed. `rateLimitedFetch()` now correctly distinguishes `x-ratelimit-reset` (epoch timestamp) from `Retry-After` (delta seconds). Added max retry limit of 5 to prevent unbounded recursion.
- **Credential encryption key instability**: Fixed. The encryption key was derived from `os.hostname()` which changes on macOS depending on network. Migrated to a persisted random key at `~/.storage-navigator/machine.key`. Includes automatic migration from old hostname-based keys.
- **Electron app name showing "Electron" in macOS dock**: Fixed. The launch script now renames `Electron.app` to `Storage Navigator.app` before launch and restores on exit.
- **Electron static files not served**: Fixed. The esbuild bundle rewrote `__dirname`, breaking the public directory path. Now resolved via `process.cwd()` and passed as parameter to `createServer()`.
- **DOCX file viewing support**: Implemented. Uses mammoth.js for server-side conversion to HTML (UI) and plain text extraction (CLI).
- **Repository sync**: Implemented. GitHub and Azure DevOps repo cloning into containers with incremental sync via SHA comparison. PAT token management integrated into the encrypted credential store. UI shows sync badges on mirrored containers.
- **Inline secrets as CLI parameters**: Implemented. All blob commands accept `--account-key`/`--sas-token`/`--account`, all repo commands accept `--pat`. Resolution chain: inline param → stored credential → interactive prompt (with option to store). Shared helpers in `src/cli/commands/shared.ts`.
