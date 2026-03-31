# Refined Request: Repository-to-Blob Synchronization

## 1. Objective

Extend Storage Navigator with the ability to replicate GitHub and Azure DevOps repositories into Azure Blob Storage containers, and keep them synchronized over time. Personal Access Tokens (PATs) for accessing repositories must be stored in the same encrypted credential store used for Azure Storage credentials. Containers that mirror a repository carry metadata enabling on-demand synchronization from both the CLI and the Electron UI.

---

## 2. Scope

### 2.1 New CLI Commands -- Repository Cloning & Sync

| Command | Purpose |
|---|---|
| `clone-github` | Clone (replicate) a GitHub repository's file tree into a target blob container |
| `clone-devops` | Clone (replicate) an Azure DevOps repository's file tree into a target blob container |
| `sync` | Re-synchronize a previously cloned container with its source repository |

### 2.2 New CLI Commands -- PAT Management

| Command | Purpose |
|---|---|
| `add-token` | Register a Personal Access Token (GitHub or Azure DevOps) in the encrypted credential store |
| `list-tokens` | List stored PATs (names, provider, masked token, added date, expiry status) |
| `remove-token` | Remove a stored PAT by name |

### 2.3 Container-Repo Mapping Metadata

Each container that is the image of a repository will contain a special metadata blob (`.repo-sync-meta.json`) at the container root. This blob records which repository the container mirrors, enabling the `sync` command and the UI sync button.

### 2.4 UI Enhancements

Containers that have a `.repo-sync-meta.json` blob display a sync icon/button in the Electron/web UI, allowing the user to trigger synchronization without the CLI.

---

## 3. Requirements

### 3.1 PAT Credential Storage

- PATs must be stored in the existing encrypted credential store (`~/.storage-navigator/credentials.json`), alongside `StorageEntry` objects.
- The `CredentialData` interface must be extended with a new `tokens` array (type `TokenEntry[]`).
- Each `TokenEntry` must contain:
  - `name` -- a user-chosen display name (e.g. `my-github-pat`)
  - `provider` -- `"github"` or `"azure-devops"`
  - `token` -- the PAT value (encrypted at rest with the same AES-256-GCM scheme)
  - `addedAt` -- ISO timestamp
  - `expiresAt` -- optional ISO timestamp for the PAT expiry date; used to warn users about upcoming expiration
- The `add-token` command must require `--name`, `--provider`, and `--token`. It should accept an optional `--expires-at` parameter to capture the PAT expiry date.
- `list-tokens` must show provider, name, masked token (first 4 chars + `****`), added date, and expiry status (valid / expiring soon / expired).
- `remove-token` must require `--name` and confirm before deletion.
- If a clone command is invoked without a matching PAT for the provider, the CLI must prompt the user to supply a PAT interactively and offer to store it.
- No fallback values: if a required PAT is missing and not provided interactively, the command must throw an error.

### 3.2 GitHub Repository Cloning (`clone-github`)

- Use the **GitHub REST API** (not `git clone`) to retrieve the repository file tree.
  - Endpoint: `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` to list all files.
  - Endpoint: `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` or raw content URL to download individual files.
- Command parameters:
  - `--repo <owner/repo>` (required) -- GitHub repository in `owner/repo` format
  - `--branch <branch>` (optional, default: repository's default branch)
  - `--container <name>` (required) -- target Azure Blob Storage container
  - `--prefix <path>` (optional) -- blob path prefix under which to place the repo files
  - `--storage <name>` (optional) -- storage account (uses first if omitted)
  - `--token-name <name>` (optional) -- name of the stored PAT to use; if omitted, use the first GitHub PAT or prompt
- The command must:
  1. Resolve the PAT (from store or interactive prompt).
  2. Fetch the full file tree from GitHub.
  3. Upload each file as a blob to the target container, preserving the directory structure as blob path prefixes.
  4. Write a `.repo-sync-meta.json` blob in the container (or under the prefix root) with the metadata described in section 3.4.
  5. Report progress: total files, uploaded count, skipped count, errors.

### 3.3 Azure DevOps Repository Cloning (`clone-devops`)

- Use the **Azure DevOps REST API** to retrieve the repository file tree.
  - Endpoint: `GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repo}/items?recursionLevel=Full&api-version=7.1`
  - Endpoint: `GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repo}/items?path={path}&api-version=7.1` for individual files.
- Command parameters:
  - `--org <organization>` (required) -- Azure DevOps organization name
  - `--project <project>` (required) -- Azure DevOps project name
  - `--repo <repo>` (required) -- Repository name
  - `--branch <branch>` (optional, default: repository's default branch)
  - `--container <name>` (required) -- target Azure Blob Storage container
  - `--prefix <path>` (optional) -- blob path prefix
  - `--storage <name>` (optional) -- storage account
  - `--token-name <name>` (optional) -- name of the stored PAT to use
- The command must follow the same workflow as `clone-github` (resolve PAT, fetch tree, upload, write metadata, report progress).

### 3.4 Container-Repo Metadata (`.repo-sync-meta.json`)

The metadata blob must contain:

```json
{
  "provider": "github" | "azure-devops",
  "repository": "owner/repo" | "org/project/repo",
  "branch": "main",
  "prefix": "" | "some/prefix/",
  "tokenName": "my-github-pat",
  "lastSyncedAt": "2026-03-31T12:00:00.000Z",
  "lastSyncCommitSha": "abc123...",
  "fileCount": 142,
  "syncHistory": [
    {
      "syncedAt": "2026-03-31T12:00:00.000Z",
      "commitSha": "abc123...",
      "filesAdded": 142,
      "filesUpdated": 0,
      "filesDeleted": 0
    }
  ]
}
```

- The `prefix` field indicates where in the container the repo files live. The `.repo-sync-meta.json` blob itself is placed at `{prefix}.repo-sync-meta.json`.
- `syncHistory` keeps the last 20 sync entries (FIFO).

### 3.5 Synchronization (`sync` Command)

- Command parameters:
  - `--container <name>` (required) -- container to sync
  - `--prefix <path>` (optional) -- if the container has multiple repo mirrors under different prefixes
  - `--storage <name>` (optional)
  - `--dry-run` (optional) -- show what would change without making changes
  - `--force` (optional) -- re-upload all files regardless of changes
- The command must:
  1. Read `.repo-sync-meta.json` from the container. If absent, throw an error ("Container is not a repository mirror").
  2. Resolve the PAT using `tokenName` from the metadata.
  3. Fetch the current file tree from the source repository.
  4. Compare against existing blobs to determine: new files, modified files (by commit SHA / content hash), deleted files.
  5. Upload new and modified files; optionally delete blobs for files removed from the repo.
  6. Update `.repo-sync-meta.json` with the new sync entry.
  7. Report: files added, updated, deleted, unchanged.

### 3.6 UI Sync Integration

- The Express API server must expose a new endpoint: `GET /api/containers/:container/repo-meta` that returns the `.repo-sync-meta.json` content (or 404 if not a mirror).
- The Express API server must expose: `POST /api/containers/:container/sync` to trigger synchronization.
- The UI container listing must check for repo metadata and display a sync icon (e.g. a refresh/arrows icon) for mirrored containers.
- Clicking the sync icon opens a confirmation dialog showing: provider, repository, branch, last sync date, and a "Sync Now" button.
- During sync, the UI must show progress feedback (spinner or progress text).
- After sync, the UI must refresh the container contents and show a summary toast (files added/updated/deleted).

---

## 4. Acceptance Criteria

### PAT Management
- [ ] `add-token --name ghpat --provider github --token ghp_xxx --expires-at 2026-12-31` stores the PAT encrypted in `credentials.json`.
- [ ] `list-tokens` displays all PATs with masked tokens, provider, and expiry status.
- [ ] `remove-token --name ghpat` removes the PAT after confirmation.
- [ ] PAT expiry warnings are shown when a PAT is within 14 days of expiration or already expired.
- [ ] If no PAT is found for a clone operation, the CLI prompts the user for one and offers to store it.
- [ ] Missing PAT without interactive input throws a clear error (no fallback).

### GitHub Cloning
- [ ] `clone-github --repo owner/repo --container target-container` downloads all files from the default branch and uploads them as blobs.
- [ ] Directory structure is preserved as blob path prefixes.
- [ ] `.repo-sync-meta.json` is written to the container with correct metadata.
- [ ] `--branch`, `--prefix`, `--token-name` options work as documented.
- [ ] Progress output shows file counts during the operation.
- [ ] Binary files (images, PDFs, etc.) are uploaded correctly.

### Azure DevOps Cloning
- [ ] `clone-devops --org myorg --project myproj --repo myrepo --container target-container` downloads all files and uploads them as blobs.
- [ ] Same structural and metadata requirements as GitHub cloning.
- [ ] `--branch`, `--prefix`, `--token-name` options work as documented.

### Synchronization
- [ ] `sync --container target-container` detects new, modified, and deleted files and applies changes.
- [ ] `--dry-run` shows pending changes without modifying blobs.
- [ ] `--force` re-uploads all files regardless of detected changes.
- [ ] `.repo-sync-meta.json` is updated with the new sync history entry.
- [ ] Sync on a non-mirror container throws a clear error.
- [ ] Works for both GitHub and Azure DevOps mirrors.

### UI Integration
- [ ] Containers with `.repo-sync-meta.json` show a sync icon in the container list.
- [ ] Clicking the sync icon displays repo metadata and offers a "Sync Now" action.
- [ ] Sync progress and results are shown in the UI.
- [ ] The container view refreshes after sync completes.

### General
- [ ] All code is TypeScript, following existing project patterns (Commander.js for CLI, Express for API, vanilla JS for UI).
- [ ] No configuration fallbacks: missing required parameters always raise errors.
- [ ] PATs are encrypted with the same AES-256-GCM scheme as storage credentials.
- [ ] The `CredentialStore` class is extended (not replaced) to manage PATs.

---

## 5. Constraints

- **Language**: TypeScript only. All new code follows the existing patterns in `src/core/`, `src/cli/`, and `src/electron/`.
- **No `git clone`**: Repository content must be fetched via REST APIs (GitHub REST API, Azure DevOps REST API). No dependency on `git` being installed on the user's machine.
- **No config fallbacks**: Per project rules, all required configuration parameters must be explicitly provided. Missing values must raise exceptions, never be substituted with defaults. The sole exception is `--branch` which defaults to the repository's own default branch (queried from the API), not a hardcoded value.
- **Encryption**: PATs reuse the existing AES-256-GCM encryption in `credential-store.ts`. No separate encryption scheme.
- **Credential store backward compatibility**: The extended `CredentialData` interface (adding `tokens`) must handle existing credential files that lack the `tokens` field (treat as empty array on load).
- **API rate limits**: GitHub API rate-limits unauthenticated requests to 60/hr. With a PAT, the limit is 5,000/hr. For large repos, the implementation must handle pagination and respect rate-limit headers (`X-RateLimit-Remaining`, `Retry-After`).
- **File size**: The GitHub Contents API returns base64-encoded content for files up to 100 MB. For files larger than 100 MB, the implementation must use the Git Blobs API (`GET /repos/{owner}/{repo}/git/blobs/{sha}`).
- **No new runtime dependencies** beyond what is strictly required. Prefer `fetch` (Node 18+ built-in) over adding HTTP client libraries.
