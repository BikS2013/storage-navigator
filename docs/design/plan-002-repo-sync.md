# Plan 002: Repository-to-Container Synchronization

**Date:** 2026-03-31
**Status:** Draft
**References:**
- `docs/reference/refined-request-repo-sync.md` (requirements)
- `docs/reference/investigation-repo-sync.md` (technical approach)
- `docs/reference/codebase-scan-repo-sync.md` (codebase analysis)

---

## Overview

Add the ability to replicate GitHub and Azure DevOps repositories into Azure Blob Storage containers, and keep them synchronized over time. PATs for repository access are stored in the same encrypted credential store used for Azure Storage credentials. Containers that mirror a repository carry a `.repo-sync-meta.json` metadata blob enabling on-demand synchronization from both the CLI and the Electron UI.

**No new npm dependencies required.** The implementation uses Node 18+ built-in `fetch`, existing `@azure/storage-blob`, `commander`, `chalk`, and `crypto`.

---

## Phase 1: Core Types and Token Store

**Files modified:** `src/core/types.ts`, `src/core/credential-store.ts`
**Estimated effort:** Small
**Dependencies:** None (foundation for all subsequent phases)

### 1.1 New Interfaces in `src/core/types.ts`

Add the following interfaces after the existing `BlobContent` interface:

```ts
/** A stored Personal Access Token for repository access */
export interface TokenEntry {
  name: string;                          // user-chosen display name (e.g. "my-github-pat")
  provider: "github" | "azure-devops";   // which service this PAT authenticates against
  token: string;                         // PAT value (encrypted at rest with everything else)
  addedAt: string;                       // ISO timestamp of when the token was stored
  expiresAt?: string;                    // optional ISO timestamp for PAT expiry warning
}

/** Expiry status for a token */
export type TokenExpiryStatus = "valid" | "expiring-soon" | "expired" | "no-expiry";

/** Display-safe token info (no raw token) */
export interface TokenListItem {
  name: string;
  provider: "github" | "azure-devops";
  maskedToken: string;                   // first 4 chars + "****"
  addedAt: string;
  expiresAt?: string;
  expiryStatus: TokenExpiryStatus;
}

/** A single sync history entry */
export interface SyncHistoryEntry {
  syncedAt: string;                      // ISO timestamp
  commitSha: string;                     // commit SHA at time of sync
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  durationMs?: number;
}

/** Metadata blob stored at {prefix}.repo-sync-meta.json in mirrored containers */
export interface RepoSyncMeta {
  provider: "github" | "azure-devops";
  repository: string;                    // "owner/repo" or "org/project/repo"
  branch: string;
  prefix: string;                        // "" or "some/path/" (trailing slash)
  tokenName: string;                     // name of the PAT used for sync
  lastSyncedAt: string;                  // ISO timestamp
  lastSyncCommitSha: string;             // commit SHA of last sync
  lastSyncTreeSha?: string;              // tree SHA for quick "anything changed?" check
  fileCount: number;
  fileShas: Record<string, string>;      // blob-path -> git-object-SHA map
  syncHistory: SyncHistoryEntry[];       // last 20 entries (FIFO)
}

/** Result object returned by sync operations */
export interface SyncResult {
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  durationMs: number;
  errors: Array<{ path: string; error: string }>;
}

/** File entry from a repository tree listing */
export interface RepoFileEntry {
  path: string;        // relative path from repo root
  sha: string;         // git object SHA (content hash)
  size?: number;       // file size in bytes
}
```

### 1.2 Extend `CredentialData`

Modify the existing `CredentialData` interface:

```ts
export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];        // optional for backward compat on load
}
```

The `tokens` field is optional (`tokens?`) so that existing credential files without it still deserialize correctly.

### 1.3 Token CRUD Methods in `CredentialStore`

Add the following methods to the `CredentialStore` class in `src/core/credential-store.ts`:

| Method | Signature | Behavior |
|---|---|---|
| `addToken` | `(entry: Omit<TokenEntry, "addedAt">): void` | Upsert by `name`. Sets `addedAt` to current ISO timestamp. Calls `save()`. |
| `getToken` | `(name: string): TokenEntry \| undefined` | Lookup by name in `this.data.tokens`. |
| `getTokenByProvider` | `(provider: "github" \| "azure-devops"): TokenEntry \| undefined` | Return the first token matching the provider. |
| `listTokens` | `(): TokenListItem[]` | Return display-safe list with masked tokens and expiry status. |
| `removeToken` | `(name: string): boolean` | Filter by name, save, return true if removed. |
| `hasTokens` | `(): boolean` | Check if any tokens are configured. |

**Backward compatibility in `load()`:** After deserializing `CredentialData`, normalize:

```ts
if (!this.data.tokens) this.data.tokens = [];
```

This single line, added at the end of the existing `load()` method (after `this.data = JSON.parse(decrypted)` and after the migration block), ensures old credential files work seamlessly.

**Token expiry logic** (used in `listTokens`):

```ts
function getExpiryStatus(expiresAt?: string): TokenExpiryStatus {
  if (!expiresAt) return "no-expiry";
  const expiry = new Date(expiresAt);
  const now = new Date();
  if (expiry < now) return "expired";
  const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 14) return "expiring-soon";
  return "valid";
}
```

**Token masking** (used in `listTokens`): `token.substring(0, 4) + "****"`.

### 1.4 Validation Rules

- `addToken` must throw if `name` is empty or `token` is empty (no fallback values).
- `addToken` must throw if `provider` is not `"github"` or `"azure-devops"`.
- `removeToken` returns false if name not found (caller decides behavior).

### 1.5 Acceptance Criteria

- [ ] `TokenEntry`, `RepoSyncMeta`, `SyncResult`, `SyncHistoryEntry`, `RepoFileEntry` interfaces compile and export from `types.ts`
- [ ] `CredentialData` includes optional `tokens` field
- [ ] `CredentialStore.addToken()` upserts a token and persists
- [ ] `CredentialStore.getToken()` retrieves by name
- [ ] `CredentialStore.getTokenByProvider()` retrieves first token for a provider
- [ ] `CredentialStore.listTokens()` returns masked, expiry-aware list
- [ ] `CredentialStore.removeToken()` removes and persists
- [ ] Existing credential files without `tokens` field load without error
- [ ] Tokens are encrypted at rest via the same AES-256-GCM scheme (inherent -- the entire `CredentialData` blob is encrypted)

---

## Phase 2: Repository Clients

**New files:** `src/core/github-client.ts`, `src/core/devops-client.ts`
**Estimated effort:** Medium
**Dependencies:** Phase 1 (for `RepoFileEntry` type)

### 2.1 Shared Utilities: `src/core/repo-utils.ts`

Create a shared utility file with:

```ts
/** Rate-limited fetch with Retry-After handling */
export async function rateLimitedFetch(
  url: string,
  headers: Record<string, string>
): Promise<Response>

/** Process items in batches with controlled concurrency */
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>
): Promise<void>

/** Infer content-type from file extension */
export function inferContentType(filePath: string): string

/** Sleep helper */
export function sleep(ms: number): Promise<void>
```

**`rateLimitedFetch` behavior:**
1. Execute `fetch(url, { headers })`.
2. If response status is 429, read `Retry-After` header, sleep for that duration, then retry once.
3. After any successful response, check `X-RateLimit-Remaining`. If below 100, compute wait time from `X-RateLimit-Reset` header and sleep.
4. Return the response.

**`inferContentType` expansion:** Extend beyond the current 5-extension mapping in `blob-ops.ts` to cover common programming files (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.yaml`, `.yml`, `.xml`, `.css`, `.scss`, `.svg`, `.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.woff2`, etc.). Use `text/plain` for source code, appropriate MIME types for known binary formats, and `application/octet-stream` as the default.

**Batch size:** Default 10 concurrent operations. This balances speed against API rate limits.

### 2.2 GitHub Client: `src/core/github-client.ts`

```ts
export class GitHubClient {
  private pat: string;
  private baseUrl = "https://api.github.com";

  constructor(pat: string)

  /** Get the default branch name for a repository */
  async getDefaultBranch(owner: string, repo: string): Promise<string>

  /** Get the latest commit SHA for a branch */
  async getCommitSha(owner: string, repo: string, branch: string): Promise<string>

  /** Get the tree SHA for a commit */
  async getTreeSha(owner: string, repo: string, commitSha: string): Promise<string>

  /** List all files in a repository branch (recursive tree) */
  async listFiles(owner: string, repo: string, branch: string): Promise<{
    commitSha: string;
    treeSha: string;
    files: RepoFileEntry[];
  }>

  /** Download raw file content by path */
  async downloadFile(owner: string, repo: string, path: string, ref: string): Promise<Buffer>

  /** Download raw file content by blob SHA (fallback for large files) */
  async downloadBlobBySha(owner: string, repo: string, sha: string): Promise<Buffer>
}
```

**API flow for `listFiles`:**

1. Resolve branch to commit SHA:
   `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` -> `object.sha`
2. Get commit tree SHA:
   `GET /repos/{owner}/{repo}/git/commits/{commitSha}` -> `tree.sha`
3. Fetch full recursive tree:
   `GET /repos/{owner}/{repo}/git/trees/{treeSha}?recursive=1`
4. Filter to `type === "blob"` entries only (skip directories).
5. Return `{ commitSha, treeSha, files }`.

**Truncation handling:** If `response.truncated === true` (repos with >100k files), log a warning. For v1, this is documented as a known limitation. A future enhancement could implement recursive non-truncated traversal.

**Download strategy:**
- Primary: `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` with `Accept: application/vnd.github.raw+json` header. Works for files up to 100 MB.
- Fallback: `GET /repos/{owner}/{repo}/git/blobs/{sha}` with `Accept: application/vnd.github.raw+json`. Used when the Contents API returns an error (e.g., file too large).

**Authentication header:** `Authorization: Bearer {pat}` on every request.

**Error handling:**
- 401: Throw "GitHub PAT is invalid or expired"
- 403: Throw "GitHub PAT lacks required permissions (needs 'repo' or 'contents:read')"
- 404: Throw "Repository not found or PAT has no access"
- 429: Handled by `rateLimitedFetch`

### 2.3 Azure DevOps Client: `src/core/devops-client.ts`

```ts
export class DevOpsClient {
  private pat: string;
  private org: string;
  private baseUrl: string; // https://dev.azure.com/{org}

  constructor(pat: string, org: string)

  /** Get the default branch name for a repository */
  async getDefaultBranch(project: string, repo: string): Promise<string>

  /** Get the latest commit SHA for a branch */
  async getCommitSha(project: string, repo: string, branch: string): Promise<string>

  /** List all files in a repository branch */
  async listFiles(project: string, repo: string, branch: string): Promise<{
    commitSha: string;
    files: RepoFileEntry[];
  }>

  /** Download raw file content */
  async downloadFile(
    project: string, repo: string, path: string, branch: string
  ): Promise<Buffer>
}
```

**API flow for `listFiles`:**

1. Get latest commit:
   `GET /{project}/_apis/git/repositories/{repo}/commits?searchCriteria.itemVersion.version={branch}&$top=1&api-version=7.1`
2. List all items recursively:
   `GET /{project}/_apis/git/repositories/{repo}/items?recursionLevel=Full&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&api-version=7.1`
3. Filter to entries where `isFolder === false`.
4. Map `objectId` to `sha`, strip leading `/` from `path`.
5. Return `{ commitSha, files }`.

**Authentication:** Basic auth with empty username:
```ts
const auth = Buffer.from(`:${this.pat}`).toString("base64");
headers["Authorization"] = `Basic ${auth}`;
```

**Download:**
`GET /{project}/_apis/git/repositories/{repo}/items?path={filePath}&$format=octetStream&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&api-version=7.1`

**Default branch resolution:**
`GET /{project}/_apis/git/repositories/{repo}?api-version=7.1` -> `defaultBranch` field (strip `refs/heads/` prefix).

**Throttling:** Add a 50ms delay between file download requests to avoid triggering Azure DevOps rate limits (~200 req/min). This is implemented inside `downloadFile` rather than globally.

**Error handling:**
- 401: Throw "Azure DevOps PAT is invalid or expired"
- 403: Throw "Azure DevOps PAT lacks Code (Read) scope"
- 404: Throw "Repository not found (check org/project/repo)"
- 429: Handled by `rateLimitedFetch`

### 2.4 Parallelization Note

`github-client.ts` and `devops-client.ts` can be implemented in parallel since they share only the `RepoFileEntry` type and `repo-utils.ts` utilities. Neither depends on the other.

### 2.5 Acceptance Criteria

- [ ] `GitHubClient.listFiles()` returns all files with SHAs from a public and private GitHub repo
- [ ] `GitHubClient.downloadFile()` returns correct content for text and binary files
- [ ] `GitHubClient.getDefaultBranch()` returns the repo's default branch
- [ ] `DevOpsClient.listFiles()` returns all files with SHAs from an Azure DevOps repo
- [ ] `DevOpsClient.downloadFile()` returns correct content for text and binary files
- [ ] `DevOpsClient.getDefaultBranch()` returns the repo's default branch
- [ ] Rate limiting is handled (429 retries, X-RateLimit-Remaining check)
- [ ] Authentication errors produce clear, actionable error messages
- [ ] No new npm dependencies added -- uses built-in `fetch`

---

## Phase 3: Sync Engine

**New file:** `src/core/sync-engine.ts`
**Estimated effort:** Medium-Large
**Dependencies:** Phase 1 (types, credential store), Phase 2 (repository clients)

### 3.1 SyncEngine Class

```ts
export class SyncEngine {
  /**
   * Clone (full initial copy) a repository into a blob container.
   * Downloads all files and creates .repo-sync-meta.json.
   */
  async clone(params: {
    blobClient: BlobClient;
    container: string;
    prefix: string;
    provider: "github" | "azure-devops";
    repository: string;         // "owner/repo" or "org/project/repo"
    branch: string;
    tokenName: string;
    repoFiles: { commitSha: string; treeSha?: string; files: RepoFileEntry[] };
    downloadFile: (path: string) => Promise<Buffer>;
    onProgress?: (msg: string) => void;
  }): Promise<SyncResult>

  /**
   * Incremental sync: read metadata, diff SHAs, upload changes, delete removals.
   */
  async sync(params: {
    blobClient: BlobClient;
    container: string;
    prefix: string;
    meta: RepoSyncMeta;
    repoFiles: { commitSha: string; treeSha?: string; files: RepoFileEntry[] };
    downloadFile: (path: string) => Promise<Buffer>;
    force?: boolean;
    dryRun?: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<SyncResult>

  /**
   * Read .repo-sync-meta.json from a container. Returns null if not found.
   */
  async readMeta(
    blobClient: BlobClient,
    container: string,
    prefix: string
  ): Promise<RepoSyncMeta | null>

  /**
   * Write .repo-sync-meta.json to a container.
   */
  async writeMeta(
    blobClient: BlobClient,
    container: string,
    prefix: string,
    meta: RepoSyncMeta
  ): Promise<void>
}
```

### 3.2 Clone Flow

1. Receive the full file tree (already fetched by the CLI command handler).
2. Report progress: `"Uploading {total} files..."`.
3. For each file in batches of 10:
   a. Download content via the provided `downloadFile` callback.
   b. Determine blob path: `{prefix}{file.path}`.
   c. Infer content-type from extension via `inferContentType`.
   d. Upload to blob storage via `blobClient.createBlob()`.
   e. Report progress: `"[{current}/{total}] {file.path}"`.
   f. On error: log the error, add to `errors` array, continue with next file.
4. Build `RepoSyncMeta` object with `fileShas`, `fileCount`, and initial `syncHistory` entry.
5. Write `.repo-sync-meta.json` to `{prefix}.repo-sync-meta.json`.
6. Return `SyncResult`.

### 3.3 Incremental Sync Flow

1. Receive the current file tree and existing `RepoSyncMeta`.
2. **Quick check:** If `meta.lastSyncCommitSha === repoFiles.commitSha` and `!force`, report "Already up to date" and return early.
3. **Diff calculation:**
   - Build `newShas: Record<string, string>` from current tree.
   - Compare against `meta.fileShas`:
     - **Added:** path in `newShas` but not in `meta.fileShas`
     - **Modified:** path in both but SHA differs
     - **Deleted:** path in `meta.fileShas` but not in `newShas`
     - **Unchanged:** path in both with same SHA
   - If `force`: treat all files as "modified" (re-upload everything).
4. **Dry-run mode:** If `dryRun`, report the diff summary and return without making changes.
5. **Apply changes** in batches of 10:
   a. Download and upload added + modified files.
   b. Delete blobs for removed files.
   c. Report progress for each operation.
6. **Update metadata:**
   - Update `fileShas` with new SHA map.
   - Update `lastSyncedAt`, `lastSyncCommitSha`, `lastSyncTreeSha`, `fileCount`.
   - Append entry to `syncHistory` (cap at 20 entries -- drop oldest if over limit).
   - Write updated `.repo-sync-meta.json`.
7. Return `SyncResult`.

### 3.4 Metadata Location

The `.repo-sync-meta.json` blob is located at:
- No prefix: `/.repo-sync-meta.json` (container root)
- With prefix `"imports/repo-a/"`: `imports/repo-a/.repo-sync-meta.json`

### 3.5 Design Decisions

- **The sync engine is provider-agnostic.** It receives file lists and a download callback -- it does not know whether files come from GitHub or Azure DevOps. This keeps the engine testable and reusable.
- **The `downloadFile` callback** is provided by the CLI command handler, which has already instantiated the appropriate repository client. This avoids the sync engine needing to know about PATs or API URLs.
- **Progress reporting** uses a simple callback `onProgress?: (msg: string) => void`. The CLI passes `console.log`; the server API can collect messages for the response.
- **Error handling is non-fatal per file.** If one file fails to download or upload, the error is recorded and processing continues. The final `SyncResult.errors` array shows all failures.

### 3.6 Recursive Blob Listing Helper

The existing `BlobClient.listBlobs()` uses hierarchical listing (one level at a time). The sync engine needs a flat listing of all blobs under a prefix to detect deletions. Add a helper method to `BlobClient`:

```ts
/** List all blobs recursively under a prefix (flat listing, no delimiter) */
async listBlobsFlat(containerName: string, prefix?: string): Promise<BlobItem[]>
```

This uses `containerClient.listBlobsFlat({ prefix })` from the Azure SDK instead of `listBlobsByHierarchy`.

### 3.7 Acceptance Criteria

- [ ] `clone()` downloads all files and uploads them to the container with correct paths
- [ ] `clone()` writes `.repo-sync-meta.json` with complete metadata including `fileShas`
- [ ] `sync()` detects added, modified, deleted, and unchanged files via SHA comparison
- [ ] `sync()` with `--dry-run` reports changes without modifying blobs
- [ ] `sync()` with `--force` re-uploads all files
- [ ] `sync()` appends to `syncHistory` and caps at 20 entries
- [ ] `sync()` returns early with "up to date" when commit SHA matches
- [ ] `readMeta()` returns null for non-mirrored containers (no `.repo-sync-meta.json`)
- [ ] Errors on individual files are non-fatal and reported in `SyncResult.errors`
- [ ] Files are processed in batches of 10 for controlled concurrency
- [ ] Binary files (images, PDFs, etc.) are handled correctly

---

## Phase 4: CLI Commands

**New files:** `src/cli/commands/token-ops.ts`, `src/cli/commands/repo-sync.ts`
**Modified:** `src/cli/index.ts`
**Estimated effort:** Medium
**Dependencies:** Phase 1 (token store), Phase 3 (sync engine)

### 4.1 Shared Helper: Extract `resolveStorage`

Currently, `resolveStorage()` is duplicated in `blob-ops.ts` and `view.ts`. Extract it to a shared location:

**New file:** `src/cli/commands/shared.ts`

```ts
export function resolveStorage(storageName?: string): StorageEntry { ... }
export function confirm(question: string): Promise<boolean> { ... }
```

Update `blob-ops.ts` and `view.ts` to import from `shared.ts`. The new command files will also import from here.

### 4.2 Token Operations: `src/cli/commands/token-ops.ts`

**`add-token` command:**

```
storage-nav add-token --name <name> --provider <github|azure-devops> --token <pat> [--expires-at <date>]
```

- Validates that `--name`, `--provider`, and `--token` are provided.
- Validates `--provider` is one of `"github"` or `"azure-devops"`.
- If `--expires-at` is provided, validates it parses as a valid date.
- Calls `CredentialStore.addToken()`.
- On success, prints confirmation with masked token.
- If the token is already expired or expiring within 14 days, prints a warning.

**`list-tokens` command:**

```
storage-nav list-tokens
```

- Calls `CredentialStore.listTokens()`.
- Displays a table with columns: Name, Provider, Token (masked), Added, Expires, Status.
- Uses chalk for color coding: green for valid, yellow for expiring-soon, red for expired, gray for no-expiry.

**`remove-token` command:**

```
storage-nav remove-token --name <name>
```

- Confirms before deletion (reuses the `confirm()` helper).
- Calls `CredentialStore.removeToken()`.
- Reports success or "not found".

### 4.3 Token Resolution Helper

Create a helper function used by clone/sync commands:

```ts
export async function resolveToken(
  store: CredentialStore,
  provider: "github" | "azure-devops",
  tokenName?: string
): Promise<TokenEntry>
```

**Resolution order:**
1. If `--token-name` is provided, look up by name. Throw if not found.
2. Otherwise, look up the first token for the given provider. Throw if none found.
3. Before returning, check expiry status. If expired, print a warning. If expiring-soon, print a warning.
4. If no token is found and stdin is a TTY, prompt the user interactively for a PAT and offer to store it.
5. If no token is found and stdin is not a TTY, throw: `"No {provider} PAT found. Use 'add-token' to register one."`.

### 4.4 Repository Sync Commands: `src/cli/commands/repo-sync.ts`

**`clone-github` command:**

```
storage-nav clone-github --repo <owner/repo> --container <name> [--branch <branch>] [--prefix <path>] [--storage <name>] [--token-name <name>]
```

Flow:
1. Resolve storage account via `resolveStorage()`.
2. Resolve GitHub PAT via `resolveToken()`.
3. Parse `--repo` into `owner` and `repo` (split on `/`; throw if format invalid).
4. Instantiate `GitHubClient` with PAT.
5. If `--branch` not provided, call `client.getDefaultBranch()`.
6. Call `client.listFiles()` to get the full tree.
7. Report: `"Found {n} files in {owner}/{repo} ({branch})"`.
8. Instantiate `BlobClient` and `SyncEngine`.
9. Call `syncEngine.clone()` with a `downloadFile` callback that calls `client.downloadFile()`.
10. Report `SyncResult` summary.

**`clone-devops` command:**

```
storage-nav clone-devops --org <org> --project <project> --repo <repo> --container <name> [--branch <branch>] [--prefix <path>] [--storage <name>] [--token-name <name>]
```

Flow: Same as `clone-github` but uses `DevOpsClient` and takes `--org`, `--project`, `--repo` separately.

**`sync` command:**

```
storage-nav sync --container <name> [--prefix <path>] [--storage <name>] [--dry-run] [--force]
```

Flow:
1. Resolve storage account.
2. Instantiate `BlobClient` and `SyncEngine`.
3. Call `syncEngine.readMeta()`. If null, throw: `"Container is not a repository mirror (no .repo-sync-meta.json found)"`.
4. Resolve PAT using `meta.tokenName` from metadata.
5. Based on `meta.provider`, instantiate the appropriate repository client.
6. Parse `meta.repository` to extract owner/repo or org/project/repo.
7. Call `client.listFiles()` to get the current tree.
8. Call `syncEngine.sync()` with `dryRun` and `force` options.
9. Report `SyncResult` summary.

### 4.5 CLI Registration in `src/cli/index.ts`

Add the following commands to the Commander program:

```ts
import { addToken, listTokens, removeToken } from "./commands/token-ops.js";
import { cloneGithub, cloneDevops, syncContainer } from "./commands/repo-sync.js";

// Token management
program.command("add-token")...
program.command("list-tokens")...
program.command("remove-token")...

// Repository sync
program.command("clone-github")...
program.command("clone-devops")...
program.command("sync")...
```

### 4.6 Progress Output Format

```
Cloning owner/repo (main) -> container-name
Fetching file tree... 142 files found
Uploading: [========>       ] 56/142  src/core/types.ts
Clone complete: 142 added, 0 errors (34.2s)
```

```
Syncing owner/repo (main) -> container-name
Fetching file tree... 142 files found
Comparing with last sync... 5 new, 3 modified, 1 deleted, 133 unchanged
Uploading: [=====>          ] 4/8  src/core/types.ts
Sync complete: 5 added, 3 updated, 1 deleted (12.3s)
```

For `--dry-run`:

```
Dry run: owner/repo (main) -> container-name
5 files to add, 3 to update, 1 to delete, 133 unchanged
  + src/new-file.ts
  ~ src/core/types.ts
  - old/removed-file.ts
No changes applied (dry run).
```

### 4.7 Acceptance Criteria

- [ ] `add-token --name ghpat --provider github --token ghp_xxx --expires-at 2026-12-31` stores the token
- [ ] `list-tokens` shows all tokens with masked values and expiry status
- [ ] `remove-token --name ghpat` confirms and removes
- [ ] PAT expiry warnings are printed when token is within 14 days of expiration or already expired
- [ ] Missing PAT without interactive input throws a clear error
- [ ] `clone-github --repo owner/repo --container target` downloads and uploads all files
- [ ] `clone-devops --org myorg --project myproj --repo myrepo --container target` works similarly
- [ ] `sync --container target` performs incremental sync based on SHA comparison
- [ ] `sync --dry-run` shows changes without applying them
- [ ] `sync --force` re-uploads all files
- [ ] `sync` on a non-mirror container throws a clear error
- [ ] Progress output shows file counts and current file during operations
- [ ] `resolveStorage()` is shared across all command files (no duplication)

---

## Phase 5: Server API and UI Integration

**Modified files:** `src/electron/server.ts`, `src/electron/public/app.js`, `src/electron/public/style.css`, `src/electron/public/index.html`
**Estimated effort:** Medium
**Dependencies:** Phase 3 (sync engine), Phase 4 (CLI commands prove end-to-end flow)

### 5.1 New API Endpoints in `src/electron/server.ts`

**`GET /api/repo-meta/:storage/:container`**

- Query params: `?prefix=` (optional)
- Reads `.repo-sync-meta.json` from the container (at `{prefix}.repo-sync-meta.json`).
- Returns 200 with `RepoSyncMeta` JSON, or 404 if not a mirror.
- Used by the UI to detect mirrored containers and show metadata.

**`POST /api/sync/:storage/:container`**

- Query params: `?prefix=`, `?dryRun=true`, `?force=true`
- Body: none (reads config from `.repo-sync-meta.json`).
- Flow:
  1. Read `RepoSyncMeta` from container.
  2. Resolve PAT from credential store using `meta.tokenName`.
  3. Instantiate the appropriate repo client based on `meta.provider`.
  4. Fetch current tree from the repo.
  5. Run `SyncEngine.sync()`.
  6. Return `SyncResult` JSON.
- Returns 200 with `SyncResult`, 404 if not a mirror, 500 on error.
- This is a synchronous endpoint. For large repos (5,000+ files) it may take 30-60 seconds. The UI shows a spinner.

**`GET /api/tokens`**

- Returns the token list (masked, no raw tokens) for the UI to show sync configuration status.

### 5.2 UI: Container Sync Detection

**In `app.js`, `loadTreeLevel()` function:**

When loading blobs for a container at the root level (depth 0), check if any blob is named `.repo-sync-meta.json` (or `{prefix}.repo-sync-meta.json`). If found:

1. Add a CSS class `synced-container` to the container tree node.
2. Add a sync icon (refresh arrows Unicode character, or a small SVG) next to the container name.
3. Fetch the metadata via `GET /api/repo-meta/:storage/:container` and cache it in a JS variable.

This is lazy detection -- no extra API calls needed since the metadata blob appears in the normal listing.

### 5.3 UI: Sync Button and Info Bar

When a synced container is expanded, show a header bar above the content area:

```html
<div class="repo-sync-bar" id="repo-sync-bar" style="display: none;">
  <span class="sync-provider-icon"></span>
  <span class="sync-repo-name"></span>
  <span class="sync-branch"></span>
  <span class="sync-last-time"></span>
  <button class="sync-btn" id="sync-now-btn">&#x21BB; Sync</button>
</div>
```

Clicking "Sync" opens a confirmation modal.

### 5.4 UI: Sync Confirmation Modal

Add a new modal to `index.html`:

```html
<div class="modal" id="sync-modal" style="display: none;">
  <div class="modal-content">
    <h3>Sync with Repository</h3>
    <div class="sync-details">
      <p><strong>Provider:</strong> <span id="sync-provider"></span></p>
      <p><strong>Repository:</strong> <span id="sync-repository"></span></p>
      <p><strong>Branch:</strong> <span id="sync-branch"></span></p>
      <p><strong>Last Synced:</strong> <span id="sync-last-time"></span></p>
      <p><strong>Commit:</strong> <span id="sync-last-commit"></span></p>
    </div>
    <label><input type="checkbox" id="sync-dry-run"> Dry run (preview changes only)</label>
    <div class="modal-actions">
      <button id="sync-confirm-btn">Sync Now</button>
      <button id="sync-cancel-btn" class="secondary">Cancel</button>
    </div>
  </div>
</div>
```

### 5.5 UI: Sync Progress and Results

During sync:
1. Disable the "Sync Now" button and show a spinner/loading text.
2. After completion, show a toast notification with the summary: "Sync complete: 5 added, 3 updated, 1 deleted".
3. Refresh the container's blob listing by re-calling `loadTreeLevel()`.
4. If errors occurred, show them in an expandable section.

### 5.6 CSS Additions in `style.css`

- `.synced-container .tree-item::after` -- small sync icon badge
- `.repo-sync-bar` -- info bar styling (horizontal layout, muted background)
- `.sync-btn` -- button styling consistent with existing modals
- `#sync-modal` -- modal styling matching existing modals (add-storage, rename, delete)
- Toast notification animation

### 5.7 Acceptance Criteria

- [ ] `GET /api/repo-meta/:storage/:container` returns metadata or 404
- [ ] `POST /api/sync/:storage/:container` triggers sync and returns result
- [ ] `GET /api/tokens` returns masked token list
- [ ] Containers with `.repo-sync-meta.json` show a sync icon in the tree view
- [ ] Clicking the sync icon opens the confirmation modal with correct metadata
- [ ] Dry-run checkbox works (shows preview without changes)
- [ ] Sync progress spinner displays during operation
- [ ] Results toast shows files added/updated/deleted
- [ ] Container listing refreshes after sync
- [ ] Errors are displayed if sync fails or individual files error

---

## Phase 6: Documentation and Cleanup

**Modified files:** `CLAUDE.md`, `docs/design/project-design.md`, `docs/design/project-functions.md`, `Issues - Pending Items.md`
**Estimated effort:** Small
**Dependencies:** All previous phases

### 6.1 CLAUDE.md Updates

Add the following command entries to the `<storage-nav>` tool documentation:

- `add-token` -- with all options and examples
- `list-tokens` -- with output format description
- `remove-token` -- with confirmation behavior
- `clone-github` -- with all options, flow description, and examples
- `clone-devops` -- with all options and examples
- `sync` -- with all options including `--dry-run` and `--force`, and examples

### 6.2 project-design.md Updates

Add new sections:
- PAT Token Storage Architecture (extending credential store)
- Repository Client Architecture (GitHub + Azure DevOps REST API clients)
- Sync Engine Design (SHA-based incremental sync)
- `.repo-sync-meta.json` schema and placement
- Server API endpoints for sync
- UI sync integration

### 6.3 project-functions.md Updates

Register new functions:
- PAT credential management (add, list, remove)
- GitHub repository cloning
- Azure DevOps repository cloning
- Container synchronization (incremental, force, dry-run)
- UI sync detection and trigger

### 6.4 Issues - Pending Items.md

Review and update:
- Remove any items resolved during implementation
- Add any new known limitations (e.g., GitHub tree truncation for 100k+ file repos, Git LFS not supported in v1)

---

## Dependency Graph and Parallelization

```
Phase 1: Core Types + Token Store
    |
    +---> Phase 2a: GitHub Client  ---|
    |                                  |---> Phase 3: Sync Engine ---> Phase 4: CLI Commands ---> Phase 5: UI
    +---> Phase 2b: DevOps Client ----|
                                                                                                     |
                                                                                              Phase 6: Docs
```

| Phase | Depends on | Can run parallel with |
|---|---|---|
| Phase 1 | None | -- |
| Phase 2a (GitHub Client) | Phase 1 | Phase 2b |
| Phase 2b (DevOps Client) | Phase 1 | Phase 2a |
| Phase 3 (Sync Engine) | Phase 1, Phase 2a, Phase 2b | -- |
| Phase 4 (CLI Commands) | Phase 1, Phase 3 | -- |
| Phase 5 (Server API + UI) | Phase 3, Phase 4 | -- |
| Phase 6 (Documentation) | All | -- |

**Critical path:** Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6

---

## New Files Summary

| File | Phase | Purpose |
|---|---|---|
| `src/core/repo-utils.ts` | 2 | Shared utilities (rate-limited fetch, batch processing, content-type inference) |
| `src/core/github-client.ts` | 2 | GitHub REST API client |
| `src/core/devops-client.ts` | 2 | Azure DevOps REST API client |
| `src/core/sync-engine.ts` | 3 | Provider-agnostic sync logic (clone + incremental sync) |
| `src/cli/commands/shared.ts` | 4 | Shared CLI helpers (resolveStorage, confirm) |
| `src/cli/commands/token-ops.ts` | 4 | add-token, list-tokens, remove-token CLI commands |
| `src/cli/commands/repo-sync.ts` | 4 | clone-github, clone-devops, sync CLI commands |

## Modified Files Summary

| File | Phase | Changes |
|---|---|---|
| `src/core/types.ts` | 1 | Add TokenEntry, RepoSyncMeta, SyncResult, SyncHistoryEntry, RepoFileEntry interfaces |
| `src/core/credential-store.ts` | 1 | Add token CRUD methods, backward-compat normalization |
| `src/core/blob-client.ts` | 3 | Add `listBlobsFlat()` method for recursive flat listing |
| `src/cli/index.ts` | 4 | Register 6 new commands |
| `src/cli/commands/blob-ops.ts` | 4 | Import resolveStorage from shared.ts (minor refactor) |
| `src/cli/commands/view.ts` | 4 | Import resolveStorage from shared.ts (minor refactor) |
| `src/electron/server.ts` | 5 | Add 3 new API endpoints |
| `src/electron/public/app.js` | 5 | Add sync detection, sync bar, sync modal, progress/toast |
| `src/electron/public/index.html` | 5 | Add sync modal HTML and sync bar markup |
| `src/electron/public/style.css` | 5 | Add sync-related styles |
| `CLAUDE.md` | 6 | Document new commands |
| `docs/design/project-design.md` | 6 | Document new architecture |
| `docs/design/project-functions.md` | 6 | Register new functions |

---

## Known Limitations (v1)

1. **GitHub tree truncation:** Repos with >100,000 files may return truncated trees. A warning is logged but recursive traversal is not implemented in v1.
2. **Git LFS files:** LFS-tracked files store pointer files in the Git tree, not actual content. LFS files will be synced as pointer files. Full LFS support is deferred.
3. **Large file handling:** Files over 100 MB use the Git Blobs API fallback. Files over GitHub's 100 MB limit or Azure DevOps size limits will fail with an error in `SyncResult.errors`.
4. **Sync is synchronous:** The server API endpoint blocks until sync completes. For repos with 5,000+ files this could take 30-60 seconds. SSE/WebSocket streaming is deferred to a future enhancement.
5. **No automatic scheduling:** Sync is on-demand only (CLI or UI button). Scheduled/periodic sync is out of scope for v1.
6. **Single-prefix per sync command:** The `sync` command operates on one prefix at a time. Containers with multiple repo mirrors under different prefixes require separate `sync` invocations.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub API rate limit hit during large clone | Sync stalls or fails mid-operation | Rate-limit checking in `rateLimitedFetch`; batch concurrency of 10; partial progress is saved |
| Azure DevOps throttling (200 req/min) | Slow clone for large repos | 50ms inter-request delay; Retry-After handling |
| PAT expires mid-sync | Sync fails partway | Check expiry before starting; warn if within 14 days; partial state is recoverable via re-sync |
| Credential store format change breaks existing users | Users lose storage configs | `tokens` field is optional; `load()` normalizes missing field to empty array |
| Large `.repo-sync-meta.json` for repos with 5,000+ files | Slow read/write of metadata blob | ~200 KB for 5,000 files is acceptable; metadata is JSON, compresses well in transit |
