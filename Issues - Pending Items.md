# Issues - Pending Items

## Pending

### Medium Priority

- **[TUI] Multi-line input redraw assumes lines fit the terminal width**: The reader's
  `redrawAll` / `redrawCurrentLineOnly` move by logical row, not by physical row. If a
  single logical line is wider than the terminal it will wrap, and arrow-up may land in
  the wrong place. Acceptable for the typical chat input but worth a follow-up if users
  start pasting long single-line prompts.

- **[TUI] Shift+Enter detection only works on terminals that opt into CSI-u / kitty
  keyboard protocol**: This is unavoidable per spec §18.3 — Apple Terminal, default
  iTerm2, default Alacritty, and many others send plain `\r` for both Enter and
  Shift+Enter. The `/help` text already documents Ctrl+J as the universal fallback;
  keep an eye on user reports.

- **[TUI] No PTY-driven smoke test in CI**: We rely on the §14 unit tests against
  PassThrough streams. A proper end-to-end test would need `node-pty` and a real
  terminal emulator — deferred per the plan-010 non-goals.

- **[TUI] Resize handling is registered but does not redraw the transcript**: The
  TUI does not maintain a redrawable transcript region, so SIGWINCH only matters for
  the active input line, which already redraws on every keystroke. No action needed
  unless we add a scroll-back UI.

- **[Agent] diff_container tool returns link metadata only, not per-file diff**: The CLI `diff` command produces a formatted table via `diffContainer()` which writes directly to stdout and calls `process.exit`. The agent tool returns link registry metadata (tracked file counts, last sync date) instead. A richer adapter that calls `diffLink()` from the diff engine directly and returns structured `DiffReport` JSON is deferred. The current tool gives the agent enough context for most queries.

- **[Agent] clone-ssh and link-ssh commands not exposed as agent tools**: SSH operations require interactive key selection and system SSH agent wiring that is not suitable for unattended agent use. Deferred to a future plan that could add an SSH-key-name parameter.

- **[Agent] No agent-graph.test.ts or agent-run.test.ts**: These tests require either a live LLM or `FakeToolCallingModel`. The `langchain` package exports `FakeToolCallingModel` but its exact import path and API differ between patch releases. Deferred; add when a stable mock import path is confirmed for the installed version.

- **Storage Navigator client adapter for the new `api` backend type (Plan 006 spec, Section 11)**: The API service in `API/` is implemented (Plan 006 impl), but the Storage Navigator client (CLI + Electron) does not yet support the `api` backend type. Follow-up plan needed: introduce `src/core/backend/` abstraction with `direct-backend.ts` and `api-backend.ts`, OIDC client (PKCE for Electron, device-code for CLI), token store (Electron `safeStorage` / CLI chmod-600), discovery client. Add `add-api`, `shares`, `files`, `file-view` CLI commands. Add "Connect to Storage Navigator API" option in Electron "Add Storage" dialog.

- **API: 14 transitive npm vulns from `azurite` test dep**: `npm install --save-dev azurite` in `API/` pulls a vulnerable transitive tree (9 moderate, 4 high, 1 critical via `azurite → @azure/ms-rest-js → xml2js`). All confined to `devDependencies` — never bundled into `dist/` or the Docker image. Documented + accepted; revisit when Azurite ships a clean release. Baseline snapshot: `docs/reference/api-npm-audit-baseline-2026-04-23.json`.


- **Test coverage**: No automated tests exist yet for repo sync features. Tests needed for: GitHub/DevOps client URL parsing, sync engine SHA diffing, token CRUD operations, link registry CRUD, path filtering/mapping, migration logic.
- **Link dialog does not validate repo access before creating link**: The CLI commands (`link-github`, `link-devops`) validate that the repo is accessible by resolving the default branch, but the UI's `POST /api/links` endpoint only writes metadata without validating repo accessibility. The spec requires validation.
- **Git LFS files**: LFS-tracked files return pointer files, not actual content. Not handled in v1.
- **Duplicated content-type detection**: Three separate MIME-type maps exist in `blob-ops.ts`, `repo-utils.ts`, and `server.ts` with inconsistencies (`.md` maps to `text/plain` in one, `text/markdown` in another). Should consolidate to use `inferContentType()` from `repo-utils.ts` everywhere.
- **Dead code**: `promptSecret()` in `src/cli/commands/shared.ts` is defined but never called.
- **CredentialStore instantiated per request**: Every API request in `server.ts` creates a new `CredentialStore`, reading and decrypting from disk each time. Should use a singleton or request-scoped instance.
- **Registry race conditions**: `createLink()`, `removeLink()`, `cloneRepo()`, and `syncRepo()` all do read-modify-write on `.repo-links.json` with no locking. Concurrent CLI/UI operations can overwrite each other.
- **Diff All "Sync Now" button has no PAT retry**: In `attachDiffSyncHandlers()`, when sync fails with MISSING_PAT, `handleSyncError` is called with `null` as `retryAction`. After the user adds a token, the sync is not retried — they must manually click "Sync Now" again.
- **`findLinkByPrefix` unhandled throw in repo-sync.ts**: The same unhandled-throw pattern fixed in `diff-ops.ts` exists in `repo-sync.ts` line 193 and `link-ops.ts` line 148. If the prefix is not found or ambiguous, an uncaught exception is printed rather than a clean error message with exit code 2.
- **Express server coupled to Electron main process**: `src/electron/server.ts` is invoked from `src/electron/main.ts`. The same HTTP surface should be runnable as a standalone process to enable shared backend-server use cases. Extract into `src/api-server/` (or similar) with a thin Electron entry point that imports it. Prerequisite for any future hosted/RBAC API to reuse logic.
- **Token expiry warning surfaced only in CLI**: `list-tokens` warns about PATs expiring within 14 days. The Electron UI does not surface the same warning in the tokens panel. Add a visual badge / banner on tokens approaching expiry.

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
