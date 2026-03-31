# Investigation: Repository-to-Blob Synchronization

Produced: 2026-03-31
Context: docs/reference/refined-request-repo-sync.md (specification), docs/reference/codebase-scan-repo-sync.md (codebase analysis)

---

## 1. GitHub REST API for Repository File Access

### 1.1 Listing All Files: Git Trees API (Recommended)

**Endpoint:**
```
GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
```

**Authentication header:**
```
Authorization: Bearer ghp_xxxxxxxxxxxx
```
(Token-based auth; `token ghp_xxx` format also accepted but `Bearer` is preferred.)

**How it works:**

1. First, resolve the branch to a commit SHA via the Refs API:
   ```
   GET /repos/{owner}/{repo}/git/ref/heads/{branch}
   ```
   Response includes `object.sha` (the commit SHA).

2. Get the commit to find its tree SHA:
   ```
   GET /repos/{owner}/{repo}/git/commits/{commit_sha}
   ```
   Response includes `tree.sha`.

3. Fetch the full tree recursively:
   ```
   GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
   ```

**Response schema (tree entries):**
```json
{
  "sha": "abc123...",
  "tree": [
    {
      "path": "src/core/types.ts",
      "mode": "100644",
      "type": "blob",
      "sha": "def456...",
      "size": 1234
    },
    {
      "path": "src/core",
      "mode": "040000",
      "type": "tree",
      "sha": "ghi789..."
    }
  ],
  "truncated": false
}
```

Each entry has:
- `path` -- full relative path from repo root
- `type` -- `"blob"` (file) or `"tree"` (directory)
- `sha` -- Git object SHA (content-addressable hash)
- `size` -- file size in bytes (only for blobs)
- `mode` -- `100644` (regular file), `100755` (executable), `120000` (symlink), `040000` (directory)

**Truncation:** If the tree has more than ~100,000 entries, the response is truncated (`"truncated": true`). For such repos, fall back to non-recursive tree calls, traversing directories level by level. This is an edge case; most repos will not hit this limit.

**Shortcut:** Steps 1-2 can be combined by using the branch name directly:
```
GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
```
GitHub resolves the branch name to its tree SHA automatically. However, this does not return the commit SHA, which is needed for sync tracking. So the two-step approach (get ref, then get tree) is better for our use case.

### 1.2 Why Not the Contents API for Listing?

The Contents API (`GET /repos/{owner}/{repo}/contents/{path}`) returns a single directory level per call and is limited to 1,000 files per directory. For a repo with 500 files across 50 directories, you would need 50+ API calls just to list files. The Git Trees API returns the entire tree in one call.

**Recommendation:** Use the Git Trees API for listing, Contents API only for individual file download.

### 1.3 Downloading File Contents

**Option A -- Raw content endpoint (Recommended for most files):**
```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
Accept: application/vnd.github.raw+json
```
Returns raw file bytes. Works for files up to 100 MB.

**Option B -- Git Blobs API (for large files or SHA-based access):**
```
GET /repos/{owner}/{repo}/git/blobs/{file_sha}
Accept: application/vnd.github.raw+json
```
Returns raw content. Works for files up to 100 MB. Useful when you already have the SHA from the tree listing.

**Option C -- Contents API with base64 (default, avoid for binary):**
```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
```
Returns JSON with `content` field (base64-encoded). Limited to files under 1 MB for base64 content. For files 1-100 MB, must use raw or blob endpoints.

**Recommendation:** Use Option A (raw content via Contents API with `Accept: application/vnd.github.raw+json`) as the primary method. Fall back to Option B (Blobs API) for files where the Contents API fails (very large files).

### 1.4 Rate Limiting

| Auth level | Rate limit |
|---|---|
| Unauthenticated | 60 requests/hour |
| PAT authenticated | 5,000 requests/hour |
| GitHub App | 5,000 requests/hour per installation |

**Relevant headers:**
- `X-RateLimit-Limit` -- total allowed
- `X-RateLimit-Remaining` -- remaining in current window
- `X-RateLimit-Reset` -- Unix timestamp when the window resets
- `Retry-After` -- seconds to wait (on 429 responses)

**Practical impact:** A repo with 500 files needs ~502 API calls (1 ref lookup + 1 tree fetch + 500 file downloads). This is well within the 5,000/hour PAT limit. For repos with 3,000+ files, implement a simple rate-limit check: read `X-RateLimit-Remaining` after each response and pause if it drops below 100.

**Implementation approach:**
```ts
async function rateLimitedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    await sleep(retryAfter * 1000);
    return fetch(url, { headers });
  }
  const remaining = parseInt(res.headers.get("x-ratelimit-remaining") || "999", 10);
  if (remaining < 100) {
    const resetAt = parseInt(res.headers.get("x-ratelimit-reset") || "0", 10);
    const waitMs = Math.max(0, resetAt * 1000 - Date.now()) + 1000;
    await sleep(waitMs);
  }
  return res;
}
```

### 1.5 Change Detection for Sync

**Best approach: Tree SHA comparison.**

The Git Trees API returns a top-level `sha` for the entire tree. If this SHA matches the `lastSyncCommitSha` stored in `.repo-sync-meta.json`, the repo has not changed -- no sync needed.

If the tree SHA differs, use per-file SHAs from the tree response to determine which files changed:
1. Fetch the new tree (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`).
2. Compare each entry's `sha` against a locally stored map (persisted in `.repo-sync-meta.json` or a companion blob).
3. Files with different SHAs are new or modified; files absent from the new tree are deleted.

**Storing the file SHA map:** Add a `fileShas` object to `.repo-sync-meta.json`:
```json
{
  "fileShas": {
    "src/core/types.ts": "abc123...",
    "src/cli/index.ts": "def456..."
  }
}
```

This avoids downloading file contents just to check if they changed. The Git SHA is a content hash (SHA-1 of the blob content with a header), so identical SHAs guarantee identical content.

**Commit SHA vs Tree SHA:** Store the commit SHA (from the ref lookup) as `lastSyncCommitSha` for display purposes and as a quick "anything changed?" check. Use the per-file tree SHAs for granular diff.

---

## 2. Azure DevOps REST API for Repository File Access

### 2.1 Listing All Files

**Endpoint:**
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?recursionLevel=Full&api-version=7.1
```

**Authentication:**
Basic auth with empty username and PAT as password:
```
Authorization: Basic base64(":" + pat)
```
In Node.js:
```ts
const auth = Buffer.from(`:${pat}`).toString("base64");
headers["Authorization"] = `Basic ${auth}`;
```

**Response schema:**
```json
{
  "count": 142,
  "value": [
    {
      "objectId": "abc123...",
      "gitObjectType": "blob",
      "commitId": "def456...",
      "path": "/src/core/types.ts",
      "isFolder": false,
      "contentMetadata": {
        "fileName": "types.ts"
      },
      "url": "https://dev.azure.com/..."
    },
    {
      "objectId": "ghi789...",
      "gitObjectType": "tree",
      "path": "/src/core",
      "isFolder": true
    }
  ]
}
```

Key fields:
- `path` -- absolute path from repo root (starts with `/`)
- `isFolder` -- boolean
- `objectId` -- Git object SHA (equivalent to GitHub's `sha`)
- `gitObjectType` -- `"blob"` or `"tree"`
- `commitId` -- the commit that last modified this item

**Branch selection:** Add `&versionDescriptor.version={branch}&versionDescriptor.versionType=branch` query parameters.

### 2.2 Downloading File Contents

**Endpoint:**
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?path={filePath}&api-version=7.1
```
Returns the raw file content directly (not JSON-wrapped) when requesting a single file path. Add `&$format=octetStream` to force binary download for all file types.

For explicit content download:
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?path={filePath}&$format=octetStream&api-version=7.1&versionDescriptor.version={branch}&versionDescriptor.versionType=branch
```

### 2.3 Rate Limiting

Azure DevOps uses a different rate limiting model than GitHub:
- No fixed per-hour limit published; uses a "Token Bucket" model with a rolling window.
- Typical limit: ~200 requests per minute per user for REST APIs.
- Rate-limited responses return HTTP 429 with a `Retry-After` header.
- For large repos, implement the same `Retry-After` handling as for GitHub.

**Practical impact:** Lower effective rate than GitHub PAT. For repos with 1,000+ files, add a small delay (50-100ms) between file download requests to avoid triggering throttling.

### 2.4 Change Detection for Sync

**Best approach: Commit SHA comparison + per-file objectId.**

1. Get the latest commit on the branch:
   ```
   GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/commits?searchCriteria.itemVersion.version={branch}&$top=1&api-version=7.1
   ```
   Returns the latest commit with its `commitId`.

2. Compare `commitId` against `lastSyncCommitSha` in `.repo-sync-meta.json`. If identical, no sync needed.

3. If different, fetch the full item list and compare `objectId` per file against stored `fileShas`.

The `objectId` in Azure DevOps is the same Git SHA-1 hash as GitHub, so the comparison logic is identical.

### 2.5 Resolving Repository ID

The Items API can accept either the repository name or its UUID. Using the name directly works:
```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoName}/items?...
```

To get the default branch, query the repository metadata:
```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoName}?api-version=7.1
```
Response includes `defaultBranch` (e.g., `"refs/heads/main"`). Strip the `refs/heads/` prefix.

---

## 3. PAT Token Storage Architecture

### 3.1 Recommendation: Extend CredentialData with a `tokens` Array

The specification requires adding a `tokens` array to `CredentialData`. This is the correct approach because:

- PATs are a different credential type than storage accounts; mixing them into `StorageEntry` would be semantically wrong.
- The existing encryption wraps the entire `CredentialData` JSON blob, so adding a sibling array is zero-cost in terms of encryption changes.
- Backward compatibility is trivial: on load, if `tokens` is absent, treat it as `[]`.

**Type additions to `src/core/types.ts`:**
```ts
export interface TokenEntry {
  name: string;                    // user-chosen display name
  provider: "github" | "azure-devops";
  token: string;                   // PAT value (encrypted at rest with everything else)
  addedAt: string;                 // ISO timestamp
  expiresAt?: string;              // optional ISO timestamp for expiry warning
}

export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];           // optional for backward compat on load
}
```

**Why `tokens?` (optional):** Existing credential files lack this field. The `load()` method should normalize:
```ts
this.data = JSON.parse(decrypted) as CredentialData;
if (!this.data.tokens) this.data.tokens = [];
```

### 3.2 CredentialStore Extensions

Add these methods to `CredentialStore`:

| Method | Signature | Purpose |
|---|---|---|
| `addToken` | `(entry: Omit<TokenEntry, 'addedAt'>): void` | Upsert by name, append addedAt, save |
| `getToken` | `(name: string): TokenEntry \| undefined` | Lookup by name |
| `getTokenByProvider` | `(provider: string): TokenEntry \| undefined` | Get first token for a provider |
| `listTokens` | `(): TokenListItem[]` | Return name, provider, masked token, expiry status |
| `removeToken` | `(name: string): boolean` | Filter by name, save, return success |

**Masking:** Show first 4 characters + `****` (e.g., `ghp_****`).

**Expiry status logic:**
```ts
function getExpiryStatus(expiresAt?: string): "valid" | "expiring-soon" | "expired" | "no-expiry" {
  if (!expiresAt) return "no-expiry";
  const expiry = new Date(expiresAt);
  const now = new Date();
  if (expiry < now) return "expired";
  const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 14) return "expiring-soon";
  return "valid";
}
```

### 3.3 Token Types

| Provider | Token prefix | Typical format | Scopes needed |
|---|---|---|---|
| GitHub PAT (classic) | `ghp_` | 40 chars | `repo` (private repos) or public access |
| GitHub PAT (fine-grained) | `github_pat_` | longer | `contents: read` permission on target repo |
| Azure DevOps PAT | no prefix | 52 chars (base64) | `Code (Read)` scope |

The implementation should not validate token format beyond requiring non-empty strings. Token format may change over time.

---

## 4. Container-Repo Metadata

### 4.1 Recommendation: Store as a Blob in the Container

Store `.repo-sync-meta.json` as a blob at the container root (or under the specified prefix). This is the correct approach because:

- **Self-describing containers:** Any tool or user browsing the container can see it is a repo mirror.
- **No local state dependency:** The sync command works from any machine with the PAT and storage credentials.
- **Multi-machine support:** Teams can sync from different workstations.
- **Aligns with specification:** The spec explicitly requires this approach.

A local cache is not needed. The metadata blob is small (a few KB) and reading it adds one API call per sync.

### 4.2 Schema for `.repo-sync-meta.json`

```json
{
  "provider": "github",
  "repository": "owner/repo",
  "branch": "main",
  "prefix": "",
  "tokenName": "my-github-pat",
  "lastSyncedAt": "2026-03-31T12:00:00.000Z",
  "lastSyncCommitSha": "abc123def456...",
  "lastSyncTreeSha": "789ghi012jkl...",
  "fileCount": 142,
  "fileShas": {
    "src/core/types.ts": "abc123...",
    "src/cli/index.ts": "def456...",
    "README.md": "ghi789..."
  },
  "syncHistory": [
    {
      "syncedAt": "2026-03-31T12:00:00.000Z",
      "commitSha": "abc123def456...",
      "filesAdded": 142,
      "filesUpdated": 0,
      "filesDeleted": 0,
      "durationMs": 34200
    }
  ]
}
```

**Key design decisions:**

- `fileShas` maps each blob path to its Git object SHA. This enables incremental sync without downloading existing blobs to compare. For a repo with 5,000 files, this adds ~200 KB to the metadata blob -- acceptable.
- `lastSyncTreeSha` enables a quick "anything changed?" check before fetching the full tree.
- `syncHistory` is capped at 20 entries (FIFO), per specification.
- `prefix` is empty string when files are at the container root, or `"some/path/"` (trailing slash) when nested.

**TypeScript interface:**
```ts
export interface RepoSyncMeta {
  provider: "github" | "azure-devops";
  repository: string;
  branch: string;
  prefix: string;
  tokenName: string;
  lastSyncedAt: string;
  lastSyncCommitSha: string;
  lastSyncTreeSha?: string;
  fileCount: number;
  fileShas: Record<string, string>;
  syncHistory: SyncHistoryEntry[];
}

export interface SyncHistoryEntry {
  syncedAt: string;
  commitSha: string;
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  durationMs?: number;
}
```

### 4.3 Metadata Location with Prefix

When `--prefix "imports/repo-a/"` is used:
- Repo files go under `imports/repo-a/src/...`, `imports/repo-a/README.md`, etc.
- Metadata blob goes at `imports/repo-a/.repo-sync-meta.json`

This allows multiple repo mirrors in a single container under different prefixes.

---

## 5. Sync Strategy

### 5.1 Recommendation: SHA-Based Incremental Sync (Primary), Full Sync (Fallback)

**Primary flow (incremental sync):**

1. Read `.repo-sync-meta.json` from the container.
2. Fetch the latest commit SHA from the repo API.
3. If commit SHA matches `lastSyncCommitSha`, report "Already up to date" and exit.
4. Fetch the full file tree from the repo API (one API call).
5. Build a map of `{ path: sha }` from the tree response.
6. Compare against `fileShas` from the metadata:
   - **New files:** path exists in tree but not in `fileShas`
   - **Modified files:** path exists in both but SHA differs
   - **Deleted files:** path exists in `fileShas` but not in tree
   - **Unchanged files:** path exists in both with same SHA
7. Download and upload only new + modified files.
8. Delete blobs for removed files (with confirmation or `--force` flag).
9. Update `.repo-sync-meta.json` with new SHAs, counts, and history entry.

**Fallback flow (full sync with `--force`):**
- Skip step 3 and step 6 comparisons.
- Download and upload every file from the tree.
- Useful when metadata is corrupted or for initial re-sync.

### 5.2 Handling Deletions

Three options, in order of preference:

1. **Default: delete blobs for removed files.** This keeps the container as an exact mirror. The sync report lists deleted files.
2. **`--no-delete` flag:** Skip deletion, only add/update. Useful if users have added extra files to the container manually.
3. **`--dry-run`:** Show what would be deleted without acting. Users run dry-run first, then sync.

**Recommendation:** Default to deleting removed files (true mirror behavior). The `--dry-run` flag provides safety.

### 5.3 Handling Binary vs Text Files

**No special handling needed.** Both the GitHub/Azure DevOps APIs and Azure Blob Storage handle binary content natively:

- Download: Use raw content endpoints (`Accept: application/vnd.github.raw+json` for GitHub, `$format=octetStream` for Azure DevOps). Both return the raw bytes.
- Upload: `BlobClient.createBlob()` already accepts `Buffer`, which handles binary content.
- Content-type: Infer from file extension using the same logic as the existing `create` command. The codebase already has extension-to-content-type mapping.

Files to handle correctly:
- Images (`.png`, `.jpg`, `.gif`, `.svg`) -- binary upload
- PDFs (`.pdf`) -- binary upload
- Office docs (`.docx`, `.xlsx`) -- binary upload
- All text formats -- upload as-is

### 5.4 Folder Structure Preservation

Git repos store flat paths (e.g., `src/core/types.ts`). Azure Blob Storage uses flat paths with `/` as a virtual directory separator. The mapping is direct:

```
Repo: src/core/types.ts  -->  Blob: {prefix}src/core/types.ts
Repo: README.md          -->  Blob: {prefix}README.md
```

No transformation needed. Filter out tree entries with `type === "tree"` (directories) since blob storage creates virtual directories implicitly.

### 5.5 Concurrency

Downloading 500 files sequentially takes too long. Use controlled concurrency:

```ts
async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(processor));
  }
}
```

**Recommended batch size:** 10 concurrent downloads/uploads. This balances speed against API rate limits and memory usage.

### 5.6 Progress Reporting

For CLI:
```
Syncing owner/repo (main) -> container-name
Fetching file tree... 142 files found
Comparing with last sync... 5 new, 3 modified, 1 deleted, 133 unchanged
Uploading: [=====>          ] 4/8  src/core/types.ts
Sync complete: 5 added, 3 updated, 1 deleted (12.3s)
```

For API (UI consumption): Return a sync result object:
```ts
interface SyncResult {
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  durationMs: number;
  errors: Array<{ path: string; error: string }>;
}
```

---

## 6. UI Integration

### 6.1 Detecting Mirrored Containers

When loading the container list, check each container for `.repo-sync-meta.json`:

**Approach A -- Lazy detection (Recommended):**
When a container is expanded in the tree, check if `.repo-sync-meta.json` exists among the root-level blobs (already fetched by `loadTreeLevel`). If found, add a sync icon to the container node.

**Why not eager detection:** Checking every container on page load would require N additional API calls (one per container). With lazy detection, the check is free -- the metadata blob appears in the normal blob listing.

**Implementation:**
In `loadTreeLevel()` (in `app.js`), after fetching blobs for a container at depth 0, check if any blob name equals `.repo-sync-meta.json`. If so, add a sync badge to the container tree node and store the metadata for later use.

### 6.2 Sync Button Placement

**Recommendation: Container-level header action.**

When a synced container is selected (expanded), show a sync button in the content area header (next to the container name), not in the context menu. Reasons:
- Sync is a container-level action, not a file-level action.
- The context menu currently handles file operations (rename, delete).
- A visible button is more discoverable than a context menu item.

**Implementation:**
```html
<div class="container-header">
  <span class="container-name">my-container</span>
  <button class="sync-btn" title="Sync with repository">
    <span class="sync-icon">&#x21BB;</span> Sync
  </button>
  <span class="sync-info">Last synced: 2 hours ago | owner/repo (main)</span>
</div>
```

### 6.3 Sync Confirmation Dialog

Before syncing, show a modal with:
- Provider and repository name
- Branch
- Last sync date and commit
- "Sync Now" and "Cancel" buttons
- Optional "Dry Run" checkbox

### 6.4 API Endpoints for UI

Add to `src/electron/server.ts`:

```
GET  /api/repo-meta/:storage/:container        -> read .repo-sync-meta.json (or 404)
POST /api/sync/:storage/:container              -> trigger sync, return SyncResult
POST /api/sync/:storage/:container?dryRun=true  -> dry-run sync
```

The sync endpoint runs synchronously and returns the result. For very large repos (5,000+ files), this could take 30-60 seconds. The UI should show a spinner during this time. A streaming/SSE approach is not necessary for v1 -- keep it simple.

---

## 7. Implementation Order

Recommended phased approach:

**Phase 1 -- PAT Management (foundation):**
1. Add `TokenEntry` interface to `types.ts`
2. Extend `CredentialData` with `tokens` array
3. Add token CRUD methods to `CredentialStore`
4. Implement `add-token`, `list-tokens`, `remove-token` CLI commands

**Phase 2 -- GitHub Clone:**
1. Implement GitHub API client (`src/core/github-client.ts`)
2. Implement `clone-github` CLI command
3. Write `.repo-sync-meta.json` on clone

**Phase 3 -- Sync:**
1. Implement sync engine (`src/core/sync-engine.ts`)
2. Implement `sync` CLI command with `--dry-run` and `--force`
3. SHA-based incremental comparison

**Phase 4 -- Azure DevOps Clone:**
1. Implement Azure DevOps API client (`src/core/devops-client.ts`)
2. Implement `clone-devops` CLI command
3. Reuse sync engine from Phase 3

**Phase 5 -- UI Integration:**
1. Add API endpoints for repo metadata and sync
2. Add sync detection in tree view
3. Add sync button and confirmation modal

---

## 8. Dependencies

**No new npm packages required.** The implementation can use:

- `fetch` (Node 18+ built-in) -- for GitHub and Azure DevOps API calls
- `crypto` (Node built-in, already imported) -- for any hashing needs
- `Buffer` (Node built-in) -- for binary content and base64 encoding
- Existing `@azure/storage-blob` -- for all blob operations
- Existing `commander` -- for new CLI commands
- Existing `chalk` -- for CLI output formatting

This aligns with the specification constraint of no new runtime dependencies.

---

## 9. Technical Research Guidance

**Research needed: Yes**

The following topics would benefit from deeper research or validation during implementation:

1. **GitHub Trees API truncation threshold** -- The documented limit is approximately 100,000 entries but the exact number is not officially specified. Test with a large open-source repo (e.g., `torvalds/linux`) to confirm behavior and implement the fallback recursive traversal if needed.

2. **Azure DevOps Items API pagination** -- The Items API with `recursionLevel=Full` may paginate for very large repos. Verify whether the response includes continuation tokens or if all items are returned in a single response. The Azure DevOps REST API documentation should clarify `$top` and `$skip` parameters for the Items endpoint.

3. **Azure DevOps rate limiting specifics** -- The exact throttling thresholds are not publicly documented with precision. During implementation, add defensive `Retry-After` handling and test with a repo of 500+ files to measure actual throughput.

4. **GitHub raw content for files > 100 MB** -- The specification mentions using the Git Blobs API for files exceeding 100 MB. Verify whether Git LFS-tracked files require special handling (they store pointer files in the tree, not actual content). Decision: likely exclude LFS files from sync in v1, or document the limitation.

5. **Content-type inference completeness** -- The existing `createBlob` command infers content types for a small set of extensions. Expanding this to cover common programming language files (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, etc.) with `text/plain` and common binary formats would improve the viewer experience. Consider using a lightweight MIME-type lookup table rather than adding a dependency.
