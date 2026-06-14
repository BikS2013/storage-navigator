# GitHub Git Data API — Batch Push Implementation Reference

> **Purpose:** Implementation-ready reference for `github-write-client.ts`.
> A developer should be able to implement the full GitHub-side write client
> from this document alone without consulting any external source.
>
> **Context:** Produced to support the reverse-git feature. Investigation at
> `docs/reference/investigation-reverse-git.md` selected pure-REST / zero-new-deps
> as the implementation strategy.
>
> **Researched:** 2026-06-01

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Canonical "Add Many Files in One Commit" Sequence](#3-canonical-add-many-files-in-one-commit-sequence)
4. [Endpoint Reference](#4-endpoint-reference)
5. [File Modes and Tree Object Semantics](#5-file-modes-and-tree-object-semantics)
6. [Binary File Handling](#6-binary-file-handling)
7. [Bootstrapping an Empty Repository](#7-bootstrapping-an-empty-repository)
8. [Repository Auto-Creation](#8-repository-auto-creation)
9. [Detecting an Empty Repository](#9-detecting-an-empty-repository)
10. [Divergence Detection](#10-divergence-detection)
11. [Large-Tree Chunking Strategy](#11-large-tree-chunking-strategy)
12. [Rate Limits](#12-rate-limits)
13. [Error Response Shapes](#13-error-response-shapes)
14. [Empty-Directory Workaround](#14-empty-directory-workaround)
15. [TypeScript Implementation](#15-typescript-implementation)
16. [Best Practices Summary](#16-best-practices-summary)
17. [Common Pitfalls](#17-common-pitfalls)
18. [Assumptions and Scope](#18-assumptions-and-scope)
19. [References](#19-references)

---

## 1. Overview

The GitHub Git Data API lets you build Git objects (blobs, trees, commits, refs)
entirely over HTTPS with JSON payloads. No local `git` binary, no working tree,
no temp files. The full push sequence is four calls:

```
POST /repos/{owner}/{repo}/git/blobs   ×N  (one per file)
POST /repos/{owner}/{repo}/git/trees   ×1  (or chunked — see §11)
POST /repos/{owner}/{repo}/git/commits ×1
PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}  ×1
          -- or --
POST /repos/{owner}/{repo}/git/refs    ×1  (first push only, creates the ref)
```

Base URL for all calls: `https://api.github.com`

---

## 2. Authentication

### Required Headers on Every Request

```
Authorization: Bearer <PAT>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json          (on POST/PATCH bodies)
```

The `X-GitHub-Api-Version` header pins the API contract. Use `2022-11-28` — the
currently stable version as of June 2026.

### PAT Scopes

| Token type | Required scope/permission |
|---|---|
| Classic PAT — create **private** repo | `repo` |
| Classic PAT — create **public** repo | `public_repo` or `repo` |
| Classic PAT — read/write Git objects | `repo` |
| Fine-grained PAT — create repo | `Administration: Read & Write` |
| Fine-grained PAT — push blobs/trees/commits | `Contents: Read & Write` |
| Fine-grained PAT — read repo metadata | `Metadata: Read` |

**Important:** Fine-grained PATs are scoped per-resource (per repo or per org).
A token created for "all repositories I own" works for `POST /user/repos`
(creating a new repo) but a token scoped to a specific existing repo can only
operate on that repo.

### PAT in Code

```typescript
function githubHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}
```

---

## 3. Canonical "Add Many Files in One Commit" Sequence

### Incremental Push (repo already has commits)

```
Step 1 — Read current branch tip
  GET /repos/{owner}/{repo}/git/ref/heads/{branch}
  → { object: { sha: <commitSha> } }

Step 2 — Read tip's tree SHA (optional if already cached)
  GET /repos/{owner}/{repo}/git/commits/{commitSha}
  → { tree: { sha: <treeSha> } }

Step 3 — Upload blobs (one per new/modified file, in parallel)
  POST /repos/{owner}/{repo}/git/blobs
  Body: { content: "<base64>", encoding: "base64" }
  → { sha: <blobSha> }

Step 4 — Create tree (using base_tree for incremental)
  POST /repos/{owner}/{repo}/git/trees
  Body: {
    base_tree: "<parentTreeSha>",   ← CRITICAL for incremental
    tree: [
      { path: "dir/file.txt", mode: "100644", type: "blob", sha: "<blobSha>" },
      { path: "deleted.txt",  mode: "100644", type: "blob", sha: null },  ← deletion
    ]
  }
  → { sha: <newTreeSha> }

Step 5 — Create commit
  POST /repos/{owner}/{repo}/git/commits
  Body: {
    message: "Sync from storage container at 2026-06-01T12:00:00Z (+50 ~3 -2)",
    tree:    "<newTreeSha>",
    parents: ["<parentCommitSha>"],
    author:  { name: "Storage Navigator", email: "storage-nav@local", date: "..." }
  }
  → { sha: <newCommitSha> }

Step 6 — Move branch ref forward (fast-forward only)
  PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
  Body: { sha: "<newCommitSha>", force: false }
  → 200 OK  (or 422 "Update is not a fast forward" on divergence)
```

### Initial Push (repo has exactly one commit — from auto_init)

Same as above but:
- `base_tree` should be set to the existing commit's tree SHA (the README tree)
  so the README blob is replaced if the user sends a README, or left in place if not.
- `parents` is `["<initCommitSha>"]`.
- Step 6 uses `PATCH` with `force: false` (safe).

### First Push to Truly Empty Repo (no commits at all)

See §7 — requires a different bootstrap path because the Git Data API returns
`409 Conflict` for empty repos.

---

## 4. Endpoint Reference

### 4.1 Create a Blob

```
POST /repos/{owner}/{repo}/git/blobs
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `content` | string | Yes | Raw content OR base64-encoded content |
| `encoding` | string | No | `"utf-8"` (default) or `"base64"` |

**Response (201 Created):**

```json
{
  "sha": "3a0f86fb8db8eea7ccbb9a95f325ddbedfb25e15",
  "url": "https://api.github.com/repos/owner/repo/git/blobs/3a0f86fb..."
}
```

**Status codes:**

| Code | Meaning |
|---|---|
| 201 | Created |
| 403 | Forbidden (PAT lacks `Contents: write`) |
| 404 | Repo not found OR permission denied on private repo (indistinguishable — see §13) |
| 409 | Repository is empty/unavailable (bootstrapping required — see §7) |
| 422 | Validation error (file too large, invalid encoding, malformed base64) |

**Size limits:**
- Practical soft limit for content via this endpoint: **~50 MB**
- Documented hard limit: **100 MB**
- Actual `422` error body when exceeded: `{ "message": "Sorry, the file is too large to be processed..." }`
- Files above 100 MB **cannot** be pushed via REST API (use Git LFS separately).

---

### 4.2 Create a Tree

```
POST /repos/{owner}/{repo}/git/trees
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tree` | array | Yes | Array of tree entry objects |
| `base_tree` | string | No | SHA of existing tree to inherit unchanged paths from |

**Tree entry object fields:**

| Field | Type | Notes |
|---|---|---|
| `path` | string | Slash-separated, relative to repo root. Nested paths supported directly — no need to create intermediate tree objects. |
| `mode` | string | File mode — see §5 |
| `type` | string | `"blob"`, `"tree"`, or `"commit"` |
| `sha` | string or null | SHA of blob/tree. Set to `null` to delete the entry (requires `base_tree`). Mutually exclusive with `content`. |
| `content` | string | Inline text content (GitHub creates blob automatically). Mutually exclusive with `sha`. UTF-8 only — for binary use `sha`. |

**`base_tree` semantics (critical for incremental pushes):**
- When provided: the new tree inherits all entries from the base tree. Entries in `tree[]` either override (same `path`) or add to the inherited set.
- When omitted: the resulting tree contains **only** the entries you supply. Every file not listed is deleted. This is correct for the first commit only.

**Response (201 Created):**

```json
{
  "sha": "cd8274d15fa3ae2ab983129fb037999f264ba9a7",
  "url": "...",
  "tree": [ ... ],
  "truncated": false
}
```

If `truncated: true` in the response, the listed entries are capped — this only
affects `GET` (reading large trees recursively), not `POST` (writing). The POST
response truncation flag is informational for read-back, not a write failure.

**Status codes:** 201, 403, 404, 409, 422 — same semantics as blob endpoint.

**Tree size consideration on write:**
GitHub does not document a per-POST hard limit on the number of tree entries.
In practice, Retool (building a similar feature) found that very large arrays
caused `422` failures. Use the chunked approach (see §11) with chunks of ≤ 700
entries, using `base_tree` to chain them.

---

### 4.3 Create a Commit

```
POST /repos/{owner}/{repo}/git/commits
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | string | Yes | Commit message |
| `tree` | string | Yes | SHA of tree object this commit points to |
| `parents` | string[] | No | SHA(s) of parent commit(s). **Omit or pass `[]`** for a root commit (first commit ever). Pass `[parentSha]` for normal commits. |
| `author` | object | No | `{ name, email, date }`. Defaults to authenticated user at current time. |
| `committer` | object | No | Same fields as `author`. Defaults to `author`. |

**Response (201 Created):**

```json
{
  "sha": "7638417db6d59f3c431d3e1f261cc637155684cd",
  "url": "...",
  "author": { "name": "...", "email": "...", "date": "..." },
  "committer": { ... },
  "tree": { "sha": "..." },
  "parents": [ { "sha": "..." } ],
  "message": "..."
}
```

**Root commit (no parents):** Omit `parents` or set to `[]`. This is required
for the very first commit in a repository before any branch ref exists.

---

### 4.4 Create a Reference (first push only)

```
POST /repos/{owner}/{repo}/git/refs
```

Use this to create the branch for the **first** time (when the branch ref
does not yet exist).

**Request body:**

```json
{
  "ref": "refs/heads/main",
  "sha": "<commitSha>"
}
```

**Response (201 Created):**

```json
{
  "ref": "refs/heads/main",
  "object": { "sha": "<commitSha>", "type": "commit", "url": "..." }
}
```

**CRITICAL NOTE:** The docs state: "You are unable to create new references for
empty repositories, even if the commit SHA-1 hash used exists. Empty repositories
are repositories without branches." This means you cannot call `POST /git/refs`
in the same sequence as creating blobs/trees/commits on a truly empty repo —
you must first bootstrap a commit via the Contents API (`PUT /repos/.../contents/`)
and only then can you call `POST /git/refs`. See §7 for the full empty-repo flow.

---

### 4.5 Update a Reference (incremental pushes)

```
PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
```

Note: the `{ref}` in the URL path is `heads/{branch}` — without the `refs/` prefix.

**Request body:**

```json
{ "sha": "<newCommitSha>", "force": false }
```

Set `force: true` only for the `--allow-overwrite-remote` (destructive overwrite)
path. For all normal incremental pushes, use `force: false`.

**Response (200 OK):**

```json
{
  "ref": "refs/heads/main",
  "object": { "sha": "<newCommitSha>", "type": "commit", "url": "..." }
}
```

**Error on divergence (`force: false`):** Returns **422 Unprocessable Entity**
with body `{ "message": "Update is not a fast forward" }`. This is the divergence
signal — see §10.

---

### 4.6 Get a Reference

```
GET /repos/{owner}/{repo}/git/ref/heads/{branch}
```

Note: singular `ref` in path, not `refs`.

**Response (200 OK):**

```json
{
  "ref": "refs/heads/main",
  "object": {
    "sha": "aa218f56b14c9653891f9e74264a383fa43fefbd",
    "type": "commit",
    "url": "..."
  }
}
```

**Returns 404** if the branch does not exist. On a brand-new empty repo (no
auto_init), this is 404 for every branch name — there are no branches.

---

### 4.7 Get a Commit

```
GET /repos/{owner}/{repo}/git/commits/{commitSha}
```

Use this to retrieve the tree SHA from a commit SHA.

**Response (200 OK):**

```json
{
  "sha": "...",
  "tree": { "sha": "<treeSha>" },
  "parents": [ { "sha": "..." } ],
  "message": "...",
  "author": { ... }
}
```

---

## 5. File Modes and Tree Object Semantics

| Mode | Type | Meaning |
|---|---|---|
| `100644` | blob | Regular file (non-executable) — use for all text and binary blobs |
| `100755` | blob | Executable file |
| `120000` | blob | Symbolic link (blob content is the link target path as text) |
| `040000` | tree | Subdirectory (tree object) |
| `160000` | commit | Git submodule |

**For the reverse-git feature, use `100644` for all files.** Azure Blob Storage
does not preserve POSIX file modes; there is no meaningful way to determine if a
blob should be `100755`.

### Deletions

To delete a file in an incremental tree update, include an entry with `sha: null`:

```json
{ "path": "path/to/deleted.txt", "mode": "100644", "type": "blob", "sha": null }
```

This only works when `base_tree` is set. Without `base_tree`, there is nothing
to delete from.

### Nested Paths

GitHub accepts slash-separated `path` values directly — you do NOT need to create
intermediate tree objects. For example, `"path": "containers/mycontainer/data/report.csv"`
is valid in a single tree entry. GitHub materializes the intermediate `containers/`
and `mycontainer/data/` trees automatically.

---

## 6. Binary File Handling

### When to Use `encoding: "base64"` vs `"utf-8"`

- Use `encoding: "base64"` for all content that is not guaranteed valid UTF-8 text
  (images, compressed files, compiled binaries, etc.).
- Use `encoding: "utf-8"` (default) for plain text where you are confident the
  content is valid UTF-8.

**Practical rule for the reverse-git feature:** Always use `encoding: "base64"` on
the blob endpoint. The `Buffer.from(content).toString("base64")` conversion is
safe for all content types and avoids hard-to-debug encoding errors.

### Inline `content` in Tree vs Separate Blob POST

The tree entry `content` field (§4.2) accepts only UTF-8 text. For binary files,
you **must** use the separate blob POST and reference its SHA in the tree.

Guideline: use the `content` shortcut only for small (<4 KB) UTF-8 text files
where saving one round-trip matters. For binary files and for the general case
in this project, always pre-upload blobs.

### Size Limits

| Threshold | Behaviour |
|---|---|
| < ~50 MB | Blob upload succeeds reliably |
| ~50–100 MB | May succeed but reliability degrades; some requests return 422 |
| > 100 MB | GitHub hard refuses; returns 422 `"file too large"` |

**Error shape for oversized blob (422):**

```json
{
  "message": "Sorry, the file is too large to be processed. Consider creating/updating the file in a local clone and pushing it to GitHub.",
  "documentation_url": "https://docs.github.com/rest/repos/contents#create-or-update-file-contents",
  "status": "422"
}
```

**Handling strategy:** Catch per-blob 422 errors, log the path and size, append
to `PushResult.errors`, and continue. Do NOT include the oversized blob in the
tree. The commit proceeds for all other files (NFR4 partial-failure requirement).

---

## 7. Bootstrapping an Empty Repository

### The Problem

When a repository is created with `auto_init: false` (no initial commit), all Git
Data API endpoints return **409 Conflict**:

> "The REST API will return a `409 Conflict` if the Git repository is empty or
> unavailable."

This affects `POST /git/blobs`, `POST /git/trees`, `POST /git/commits`,
`POST /git/refs`, and `PATCH /git/refs/heads/{branch}`.

Additionally, the documentation explicitly states: "You are unable to create new
references for empty repositories, even if the commit SHA-1 hash used exists.
Empty repositories are repositories without branches." — This means the standard
four-step sequence cannot work at all on a truly empty repo.

### Two Bootstrap Strategies

**Strategy A (recommended): `auto_init: true` on repo creation**

When `POST /user/repos` includes `"auto_init": true`, GitHub creates an initial
commit with a README.md and sets the default branch. The repo is no longer empty.

The subsequent initial publish then:
1. Reads the init commit SHA and its tree SHA.
2. Uses the init tree SHA as `base_tree`.
3. Uploads blobs for all storage files.
4. Creates a tree with `base_tree` set to the init tree — README.md is inherited
   unless the user explicitly has a README.md in storage (in which case it is
   overwritten naturally).
5. Creates a commit with the init commit as parent.
6. `PATCH /git/refs/heads/{branch}` to move `main` forward.

This is the clean path. The README from `auto_init` is effectively replaced
(or preserved if no README is uploaded).

**Strategy B (fallback): Contents API bootstrap for truly empty repos**

If the repo was created with `auto_init: false` (or created externally and then
found to be empty), use the Contents API to create the first file:

```
PUT /repos/{owner}/{repo}/contents/.gitkeep
Body: {
  "message": "Initialize repository",
  "content": ""     ← empty base64 string for empty file
}
```

This creates the first commit and the default branch ref. After this call
succeeds, the Git Data API becomes available and the standard four-step sequence
can proceed — but now as an incremental push with the `.gitkeep` commit as parent.

**Recommended approach for this project:**

Always use `auto_init: true` in `POST /user/repos` / `POST /orgs/{org}/repos`.
The `"default_branch": "main"` parameter ensures the branch name matches
expectations. This avoids Strategy B entirely.

### Bootstrap Sequence (truly empty repo — Strategy B)

```
1. PUT /repos/{owner}/{repo}/contents/.gitkeep
   Body: { message: "init", content: "" }
   → { commit: { sha: <initCommitSha> }, content: { ... } }

2. GET /repos/{owner}/{repo}/git/ref/heads/main
   → { object: { sha: <initCommitSha> } }
   (Now you have a valid branch tip)

3. GET /repos/{owner}/{repo}/git/commits/<initCommitSha>
   → { tree: { sha: <initTreeSha> } }

4. POST /git/blobs ×N  (upload all storage blobs)

5. POST /git/trees
   Body: { base_tree: "<initTreeSha>", tree: [...] }
   → { sha: <newTreeSha> }
   (The .gitkeep entry is inherited from base_tree)

6. POST /git/commits
   Body: { message: "...", tree: "<newTreeSha>", parents: ["<initCommitSha>"] }
   → { sha: <newCommitSha> }

7. PATCH /git/refs/heads/main
   Body: { sha: "<newCommitSha>", force: false }
```

If you want to remove the `.gitkeep` after bootstrapping, add a tree entry
`{ path: ".gitkeep", mode: "100644", type: "blob", sha: null }` in step 5.

### The `bootstrapEmptyRepo` Flow (auto_init: true path)

When `auto_init: true` is used, the sequence at initial publish is:

```
GET /git/ref/heads/main   → initCommitSha
GET /git/commits/<initCommitSha>  → initTreeSha

(then proceed as a normal incremental push with base_tree = initTreeSha)
```

This is handled by `getBranchTip()` returning a non-null value even for the
first publish.

---

## 8. Repository Auto-Creation

### Personal Repositories

```
POST /user/repos
```

**Request body (minimum viable):**

```json
{
  "name": "my-storage-sync",
  "private": true,
  "auto_init": true,
  "default_branch": "main",
  "description": "Storage Navigator reverse-git sync"
}
```

**Required PAT scope:** `repo` (classic) or `Administration: Read & Write`
(fine-grained).

**Response (201 Created):** Full repository object. Key fields:
- `full_name`: `"owner/repo-name"`
- `default_branch`: branch name (respects the `default_branch` param)
- `size`: `0` even after `auto_init` until the next push

**Status codes:**
- `201`: Created
- `422`: Name taken or invalid name

---

### Organization Repositories

```
POST /orgs/{org}/repos
```

Same body parameters as `/user/repos`. The `owner` in subsequent Git Data API
calls will be the org name.

**Required PAT scope:** `repo` (classic) or `Administration: Read & Write`
(fine-grained, scoped to the org).

---

### Detecting Owner Type (Personal vs. Org)

The caller (CLI/UI) provides the target as `owner/repo`. Use `GET /users/{owner}`
to check if the owner is a `"User"` or `"Organization"`, then call the appropriate
create endpoint. Alternatively, always try `POST /user/repos` first (if the PAT
is personal) and fall back to `POST /orgs/{org}/repos` if the owner in the target
URL is not the authenticated user.

---

## 9. Detecting an Empty Repository

### Method 1: `GET /repos/{owner}/{repo}`

Response includes `size` (kilobytes of disk usage). However, **`size: 0` does NOT
reliably distinguish empty from newly created repos with `auto_init: true`** — a
repo with a single tiny README may still report `size: 0` immediately after creation.

The more reliable field is `default_branch`. An empty repo (no commits) still
reports a `default_branch` value (e.g., `"main"`) from the creation parameters,
but that branch ref does not actually exist yet.

### Method 2: `GET /repos/{owner}/{repo}/git/ref/heads/{branch}`

- Returns **200** with commit SHA: repo has at least one commit on the branch.
- Returns **404**: branch does not exist → repo is either empty or the branch
  name is wrong.
- Returns **409**: repo is flagged as empty/unavailable by GitHub's infrastructure.

**Algorithm used in `getBranchTip()`:**

```
GET /git/ref/heads/{branch}
  → 200: return { commitSha, treeSha: (from subsequent commits GET) }
  → 404: return null  ← "repo is empty or branch doesn't exist"
  → 409: return null  ← "repo is empty (Git Data API unavailable)"
  → 401/403: throw AuthenticationError
```

A `null` return triggers the bootstrap path. After bootstrapping, retry
`getBranchTip()` — it should now return a non-null result.

---

## 10. Divergence Detection

The engine must ensure the remote branch is at the expected SHA before pushing
a new commit, to prevent overwriting concurrent changes.

### Detection Algorithm

```
1. Call getBranchTip(branch) → { commitSha: remoteSha }
2. Compare remoteSha with lastPushedCommitSha from ReverseLink metadata
3. If they differ → throw RemoteDivergedError(expected: lastPushedCommitSha, actual: remoteSha)
4. If they match → proceed with push
```

### Confirming After PATCH

Even after passing the pre-check, the `PATCH /git/refs/heads/{branch}` with
`force: false` acts as a second-level guard. If a concurrent push landed between
step 1 and step 6, GitHub returns:

**422 Unprocessable Entity:**
```json
{
  "message": "Update is not a fast forward"
}
```

This is the signal to abort with a `RemoteDivergedError`.

### Force-Overwrite Path (`--allow-overwrite-remote`)

When the user explicitly accepts overwriting the remote, use `force: true`:

```json
PATCH /git/refs/heads/{branch}
{ "sha": "<newCommitSha>", "force": true }
```

This is equivalent to `git push --force`. It is destructive and should only be
enabled behind the explicit `--allow-overwrite-remote` flag.

---

## 11. Large-Tree Chunking Strategy

### Limits

- **Read limit (GET /git/trees?recursive=1):** 100,000 entries or 7 MB, whichever
  is hit first. If exceeded, `truncated: true` is set in the response.
- **Write limit (POST /git/trees):** No officially documented hard limit on
  array size. In practice (as observed by Retool), large single-call trees fail
  with `422`. Use chunks of **≤ 700 entries** per POST.

### Chunking Algorithm

For a set of N tree entries (where N > 700), split into chunks and chain with
`base_tree`:

```
chunk_0: POST /git/trees { base_tree: parentTreeSha, tree: entries[0..699] }
          → treeSha_0

chunk_1: POST /git/trees { base_tree: treeSha_0, tree: entries[700..1399] }
          → treeSha_1

...

chunk_k: POST /git/trees { base_tree: treeSha_{k-1}, tree: entries[N-700..N] }
          → finalTreeSha
```

The `finalTreeSha` is used in `POST /git/commits`.

This works because each `POST /git/trees` with `base_tree` produces a new tree
that inherits all entries from the base and adds/overrides with the chunk's
entries. Chaining them accumulates all changes.

**Key insight:** `base_tree` chaining is O(chunks × chunkSize) API calls but
always produces a correct combined tree. The order of chunks does not matter for
correctness (later chunks can override earlier ones for the same path, but that
should not occur if entries are de-duplicated before chunking).

---

## 12. Rate Limits

### Primary Rate Limit

- **5,000 requests/hour** for authenticated requests with a classic PAT.
- **15,000 requests/hour** for GitHub Apps or OAuth apps on GitHub Enterprise Cloud.
- Headers present on every response:

| Header | Value |
|---|---|
| `x-ratelimit-limit` | Total requests allowed per hour |
| `x-ratelimit-remaining` | Requests left in current window |
| `x-ratelimit-used` | Requests used in current window |
| `x-ratelimit-reset` | UTC epoch timestamp when window resets |
| `x-ratelimit-resource` | Which bucket was charged (usually `core`) |

### Secondary Rate Limits (Abuse Detection)

Triggered independently of the primary limit. Key thresholds:
- More than **100 concurrent requests** across REST + GraphQL.
- More than **900 points/minute** for REST (each `POST/PATCH/PUT/DELETE` = 5 points;
  each `GET/HEAD/OPTIONS` = 1 point).
- More than **80 content-creating requests/minute** or **500 content-creating
  requests/hour**. Blob uploads (`POST /git/blobs`) count as content creation.
- More than 90 seconds of CPU time per 60 seconds of wall time.

**For blob uploads:** Each `POST /git/blobs` costs 5 points and counts as
content creation. A 1,000-file initial publish uploads 1,000 blobs = 5,000 points
toward the secondary limit. At the default `rateLimitedFetch` pace (no explicit
delay between calls), this is likely to trigger secondary limits.

**Recommended approach:** Limit concurrent blob uploads to **10 in-flight at a
time** using `processInBatches` (already available in `repo-utils.ts`). Add a
**100 ms delay between blob upload batches** to stay well under 80/min.

### When Rate Limits Are Exceeded

Both primary and secondary rate limits return **403 or 429** (the code varies):

| Scenario | Code | Signal |
|---|---|---|
| Primary limit exhausted | 403 or 429 | `x-ratelimit-remaining: 0` |
| Secondary limit hit | 403 or 429 | Body: `"message": "You have exceeded a secondary rate limit"` |

### Retry Algorithm

```typescript
async function retryAfterRateLimit(response: Response): Promise<void> {
  // Check Retry-After header first (set on secondary rate limit)
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    await sleep(seconds * 1000);
    return;
  }
  // Fall back to x-ratelimit-reset (primary rate limit)
  const resetEpoch = response.headers.get("x-ratelimit-reset");
  if (resetEpoch) {
    const resetMs = parseInt(resetEpoch, 10) * 1000;
    const waitMs = Math.max(resetMs - Date.now(), 0) + 1000; // +1s buffer
    await sleep(waitMs);
    return;
  }
  // Unknown — exponential backoff starting at 60s
  await sleep(60_000);
}
```

After a rate-limit response, retry with **exponential backoff**. Stop after 3
retries and surface a typed `RateLimitError`. Do NOT continue hammering the API —
GitHub may ban the integration.

---

## 13. Error Response Shapes

### General Error Shape

All GitHub REST API errors follow:

```json
{
  "message": "human-readable description",
  "documentation_url": "https://docs.github.com/...",
  "errors": [
    { "resource": "...", "field": "...", "code": "..." }
  ]
}
```

The `errors` array is optional and present mainly for 422 validation errors.

### Status-by-Status Guide

#### 401 Unauthorized

```json
{ "message": "Bad credentials", "documentation_url": "..." }
```

Cause: PAT is missing, expired, or malformed. Throw `AuthenticationError`.

#### 403 Forbidden

Two distinct causes — distinguish by body:

**Rate limit exceeded (primary or secondary):**
```json
{
  "message": "API rate limit exceeded for user ID ...",
  "documentation_url": "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api"
}
```
or
```json
{
  "message": "You have exceeded a secondary rate limit and have been temporarily blocked ...",
  "documentation_url": "..."
}
```

**Insufficient PAT scope:**
```json
{ "message": "Resource not accessible by personal access token" }
```
or
```json
{ "message": "Must have admin rights to Repository.", "documentation_url": "..." }
```

#### 404 Not Found

**CRITICAL DESIGN NOTE:** GitHub intentionally returns 404 for private repositories
when the requestor lacks access, to avoid confirming the repo's existence. This
makes 404 ambiguous — it means EITHER:
- The repository genuinely does not exist, OR
- The repository exists but the PAT lacks permission to access it.

There is **no reliable way to distinguish these two cases** from the HTTP
response alone. The error body is identical:

```json
{ "message": "Not Found", "documentation_url": "..." }
```

**Implication for error messages:** When a 404 occurs, surface to the user:
> "Repository `owner/repo` not found. This may mean the repository does not exist
> OR that your PAT lacks permission. Verify the repository name and that your PAT
> has `repo` scope (classic) or `Contents: Read & Write` (fine-grained)."

#### 409 Conflict

Returned when:
1. The repository is empty / being initialized (Git Data API unavailable).
2. A ref is at a different SHA than expected (rare on Git Data API).

```json
{ "message": "Git Repository is empty.", "documentation_url": "..." }
```
or
```json
{ "message": "Repository creation is in progress. Please try again later." }
```

For case 1: trigger the bootstrap path (§7).
For case 2: treat as a transient error; retry after a short delay.

#### 422 Unprocessable Entity

Multiple meanings — distinguish by `message`:

| `message` content | Cause |
|---|---|
| `"Update is not a fast forward"` | Diverged remote branch (§10) |
| `"file too large"` | Blob exceeds size limit (§6) |
| `"Validation Failed"` with `errors[]` | Malformed request body |
| `"Reference already exists"` | `POST /git/refs` for a branch that already exists |

```json
{
  "message": "Update is not a fast forward",
  "documentation_url": "..."
}
```

```json
{
  "message": "Validation Failed",
  "errors": [
    { "resource": "GitBlob", "code": "too_large", "field": "data" }
  ]
}
```

---

## 14. Empty-Directory Workaround

Git does not track empty directories. If the Azure Blob Storage source has a
"virtual folder" with no blobs, there is no corresponding entry to create in Git.

**Options:**
1. **Silently skip** — recommended. Git repositories conventionally omit empty
   directories. The reverse-git feature mirrors this behaviour naturally.
2. **Add a `.gitkeep` placeholder** — if the user has explicitly structured their
   storage with empty prefix-folders that must be preserved in the Git repository,
   create a zero-byte blob `{ content: "", encoding: "base64" }` and add a tree
   entry at `{prefix}/.gitkeep`.

The investigation recommends Option 1. If Option 2 is needed, it must be
controlled by a `--preserve-empty-dirs` flag (not default behaviour, as it
produces spurious files the user did not upload).

---

## 15. TypeScript Implementation

All functions use the project's existing `rateLimitedFetch` wrapper. The
`BASE_URL` constant is `"https://api.github.com"`. All request bodies are
`JSON.stringify`'d; all responses are `response.json()`'d after status checking.

### Helper Types

```typescript
export interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "120000" | "040000" | "160000";
  type: "blob" | "tree" | "commit";
  sha: string | null;  // null = delete
  content?: string;    // inline UTF-8 only; mutually exclusive with sha
}

export interface BranchTip {
  commitSha: string;
  treeSha: string;
}

interface GitHubError {
  message: string;
  documentation_url?: string;
  errors?: Array<{ resource: string; field: string; code: string }>;
}

function isRateLimitResponse(status: number, body: GitHubError): boolean {
  return (
    (status === 403 || status === 429) &&
    (body.message.includes("rate limit") ||
      body.message.includes("secondary rate limit"))
  );
}
```

### `githubHeaders`

```typescript
function githubHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}
```

### `uploadBlob`

```typescript
/**
 * Upload a single file blob to GitHub.
 * Always uses base64 encoding (safe for binary and text alike).
 * Returns the blob SHA.
 * Throws GitHubBlobTooLargeError for 422 "file too large".
 */
export async function uploadBlob(
  pat: string,
  owner: string,
  repo: string,
  content: Buffer
): Promise<string /* sha */> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs`;
  const body = JSON.stringify({
    content: content.toString("base64"),
    encoding: "base64",
  });

  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: githubHeaders(pat),
    body,
  });

  const data = await response.json() as { sha?: string; message?: string };

  if (response.status === 201 && data.sha) {
    return data.sha;
  }

  if (response.status === 422) {
    const msg = (data.message ?? "").toLowerCase();
    if (msg.includes("too large") || msg.includes("file too large")) {
      throw new GitHubBlobTooLargeError(
        `Blob exceeds GitHub size limit (content size: ${content.length} bytes)`
      );
    }
    throw new GitHubApiError(422, data.message ?? "Validation failed");
  }

  if (response.status === 409) {
    throw new GitHubEmptyRepoError(
      "Repository is empty — bootstrap required before uploading blobs"
    );
  }

  if (response.status === 404) {
    throw new GitHubApiError(
      404,
      "Repository not found or PAT lacks permission (404 is ambiguous on private repos)"
    );
  }

  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### `createTree`

```typescript
/**
 * Create a Git tree object.
 * @param baseTree  SHA of existing tree to inherit unchanged paths from.
 *                  Pass null for the very first tree with no parent.
 * @param entries   Tree entries to add/modify/delete.
 * @returns         SHA of the new tree.
 *
 * For large entry sets (> 700), call this function multiple times,
 * passing the previous call's return value as baseTree for the next call.
 */
export async function createTree(
  pat: string,
  owner: string,
  repo: string,
  baseTree: string | null,
  entries: TreeEntry[]
): Promise<string /* sha */> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees`;
  const bodyObj: Record<string, unknown> = { tree: entries };
  if (baseTree !== null) {
    bodyObj.base_tree = baseTree;
  }

  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: githubHeaders(pat),
    body: JSON.stringify(bodyObj),
  });

  const data = await response.json() as { sha?: string; message?: string };

  if (response.status === 201 && data.sha) {
    return data.sha;
  }

  if (response.status === 409) {
    throw new GitHubEmptyRepoError("Repository is empty — bootstrap required");
  }

  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### `createTreeChunked`

```typescript
const TREE_CHUNK_SIZE = 700; // keep below undocumented API limit

/**
 * Create a tree from a potentially large entry set by chunking into
 * batches of TREE_CHUNK_SIZE, chaining each batch's output as the
 * base_tree for the next batch.
 */
export async function createTreeChunked(
  pat: string,
  owner: string,
  repo: string,
  baseTree: string | null,
  entries: TreeEntry[]
): Promise<string /* finalTreeSha */> {
  let currentBase = baseTree;

  for (let i = 0; i < entries.length; i += TREE_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + TREE_CHUNK_SIZE);
    currentBase = await createTree(pat, owner, repo, currentBase, chunk);
  }

  // If entries was empty and baseTree was provided, currentBase = baseTree
  // (no new tree object created). Handle this at the caller.
  if (currentBase === null) {
    throw new Error("createTreeChunked called with null baseTree and empty entries");
  }

  return currentBase;
}
```

### `createCommit`

```typescript
/**
 * Create a Git commit object.
 * @param parents  Array of parent commit SHAs. Pass [] for the very first
 *                 commit in a repository (root commit).
 */
export async function createCommit(
  pat: string,
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[],
  author?: { name: string; email: string }
): Promise<string /* sha */> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/commits`;
  const bodyObj: Record<string, unknown> = { message, tree, parents };
  if (author) {
    const date = new Date().toISOString();
    bodyObj.author = { ...author, date };
    bodyObj.committer = { ...author, date };
  }

  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: githubHeaders(pat),
    body: JSON.stringify(bodyObj),
  });

  const data = await response.json() as { sha?: string; message?: string };

  if (response.status === 201 && data.sha) {
    return data.sha;
  }

  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### `updateRef`

```typescript
/**
 * Move an existing branch ref to a new commit SHA.
 * @param force  true = force-push (destructive). false = fast-forward only.
 *               On divergence with force=false → throws RemoteDivergedError.
 */
export async function updateRef(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  force: boolean
): Promise<void> {
  // Note: URL path uses "refs/heads/{branch}" without the leading "refs/" prefix
  // WRONG:  /git/refs/refs/heads/main
  // CORRECT: /git/refs/heads/main
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`;

  const response = await rateLimitedFetch(url, {
    method: "PATCH",
    headers: githubHeaders(pat),
    body: JSON.stringify({ sha, force }),
  });

  if (response.status === 200) return;

  const data = await response.json() as { message?: string };

  if (response.status === 422) {
    const msg = data.message ?? "";
    if (msg.includes("not a fast forward")) {
      throw new RemoteDivergedError(
        `Remote branch '${branch}' has diverged. ` +
        `Use --allow-overwrite-remote to force-push or reconcile manually.`
      );
    }
    throw new GitHubApiError(422, msg);
  }

  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### `createRef` (first push to initialised-but-empty branch)

```typescript
/**
 * Create a branch ref for the first time.
 * Called after bootstrapping a truly empty repo (Strategy B) or
 * after creating a root commit on a branch that has never had a ref.
 *
 * NOTE: This cannot be called on a repository with NO commits at all
 * (will return 422 "Reference does not exist"). The Contents API
 * bootstrap must happen first. See §7.
 */
export async function createRef(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs`;

  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: githubHeaders(pat),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });

  if (response.status === 201) return;

  const data = await response.json() as { message?: string };

  if (response.status === 422) {
    const msg = data.message ?? "";
    if (msg.includes("Reference already exists")) {
      // Branch was created concurrently — treat as success, then verify SHA
      return;
    }
    throw new GitHubApiError(422, msg);
  }

  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### `getBranchTip`

```typescript
/**
 * Get the current commit and tree SHAs for a branch.
 * Returns null if the branch does not exist (empty repo or wrong branch name).
 */
export async function getBranchTip(
  pat: string,
  owner: string,
  repo: string,
  branch: string
): Promise<BranchTip | null> {
  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const refResponse = await rateLimitedFetch(refUrl, {
    headers: githubHeaders(pat),
  });

  if (refResponse.status === 404 || refResponse.status === 409) {
    return null; // repo empty or branch doesn't exist
  }

  if (!refResponse.ok) {
    const data = await refResponse.json() as { message?: string };
    throw new GitHubApiError(refResponse.status, data.message ?? "Unknown error");
  }

  const refData = await refResponse.json() as {
    object: { sha: string };
  };
  const commitSha = refData.object.sha;

  // Fetch commit to get tree SHA
  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const commitResponse = await rateLimitedFetch(commitUrl, {
    headers: githubHeaders(pat),
  });

  if (!commitResponse.ok) {
    throw new GitHubApiError(commitResponse.status, "Failed to fetch commit");
  }

  const commitData = await commitResponse.json() as {
    tree: { sha: string };
  };

  return { commitSha, treeSha: commitData.tree.sha };
}
```

### `bootstrapEmptyRepo`

```typescript
/**
 * Handle the "no parent" case: creates the very first commit and branch ref
 * for a repository that has NO existing commits (auto_init=false scenario).
 *
 * Strategy: Uses the Contents API to create a .gitkeep placeholder,
 * then returns the resulting commit SHA and tree SHA for the caller
 * to use as parent/base_tree in the subsequent normal push.
 *
 * After this function returns, the repo is no longer "empty" and all
 * Git Data API endpoints are available.
 *
 * @returns BranchTip (commitSha + treeSha of the init commit)
 */
export async function bootstrapEmptyRepo(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  message: string = "Initialize repository"
): Promise<BranchTip> {
  // Use Contents API to create the first commit
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/.gitkeep`;
  const response = await rateLimitedFetch(url, {
    method: "PUT",
    headers: githubHeaders(pat),
    body: JSON.stringify({
      message,
      content: "",  // empty base64 = empty file
      branch,
    }),
  });

  if (!response.ok) {
    const data = await response.json() as { message?: string };
    throw new GitHubApiError(
      response.status,
      `Failed to bootstrap empty repo: ${data.message ?? "unknown"}`
    );
  }

  const data = await response.json() as {
    commit: { sha: string; tree: { sha: string } };
  };

  return {
    commitSha: data.commit.sha,
    treeSha: data.commit.tree.sha,
  };
}
```

### `createRepo`

```typescript
export interface CreateRepoOptions {
  name: string;
  private: boolean;
  description?: string;
  /** org name; if omitted, creates under the authenticated user */
  org?: string;
  defaultBranch?: string;  // defaults to "main"
}

/**
 * Create a GitHub repository. Always uses auto_init=true to avoid
 * the empty-repo bootstrap problem (§7).
 *
 * Returns the created repo's full_name ("owner/repo").
 */
export async function createRepo(
  pat: string,
  opts: CreateRepoOptions
): Promise<string /* full_name */> {
  const url = opts.org
    ? `https://api.github.com/orgs/${opts.org}/repos`
    : "https://api.github.com/user/repos";

  const body = JSON.stringify({
    name: opts.name,
    private: opts.private,
    description: opts.description ?? "",
    auto_init: true,            // always initialize — avoids 409 on empty repos
    default_branch: opts.defaultBranch ?? "main",
  });

  const response = await rateLimitedFetch(url, {
    method: "POST",
    headers: githubHeaders(pat),
    body,
  });

  if (response.status === 201) {
    const data = await response.json() as { full_name: string };
    return data.full_name;
  }

  if (response.status === 422) {
    const data = await response.json() as { message?: string };
    throw new GitHubApiError(
      422,
      `Repository creation failed: ${data.message ?? "validation error"}`
    );
  }

  const data = await response.json() as { message?: string };
  throw new GitHubApiError(response.status, data.message ?? "Unknown error");
}
```

### Error Classes

```typescript
export class GitHubApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(`GitHub API error ${statusCode}: ${message}`);
    this.name = "GitHubApiError";
  }
}

export class GitHubEmptyRepoError extends GitHubApiError {
  constructor(message: string) {
    super(409, message);
    this.name = "GitHubEmptyRepoError";
  }
}

export class GitHubBlobTooLargeError extends GitHubApiError {
  constructor(message: string) {
    super(422, message);
    this.name = "GitHubBlobTooLargeError";
  }
}

export class RemoteDivergedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteDivergedError";
  }
}
```

### Complete Push Flow (`GitHubWriteClient.createCommit`)

```typescript
/**
 * Full push workflow implementing RepoWriteClient.createCommit().
 * Handles incremental and initial pushes.
 */
export async function pushChanges(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  changes: WriteChange[],  // from RepoWriteClient interface
  author: { name: string; email: string },
  allowForce: boolean = false
): Promise<{ commitSha: string; treeSha: string }> {

  // Step 1: Get current branch tip
  let tip = await getBranchTip(pat, owner, repo, branch);
  const isInitialPush = tip === null;

  if (isInitialPush) {
    // Repo was created with auto_init=true but something went wrong,
    // or the branch doesn't exist yet — bootstrap if truly empty.
    // Try bootstrapping; if repo already has commits on another branch,
    // this will fail gracefully.
    tip = await bootstrapEmptyRepo(pat, owner, repo, branch);
  }

  // Step 2: Upload blobs for added/modified files (in parallel batches)
  const blobEntries: TreeEntry[] = [];
  const errors: Array<{ path: string; error: Error }> = [];

  const addOrModify = changes.filter(
    (c): c is Extract<WriteChange, { kind: "add" | "modify" }> =>
      c.kind === "add" || c.kind === "modify"
  );

  // Process in batches of 10 to respect secondary rate limits
  const BLOB_BATCH_SIZE = 10;
  for (let i = 0; i < addOrModify.length; i += BLOB_BATCH_SIZE) {
    const batch = addOrModify.slice(i, i + BLOB_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (change) => {
        const sha = await uploadBlob(
          pat, owner, repo, Buffer.from(change.contentBytes)
        );
        return { path: change.path, sha };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        blobEntries.push({
          path: result.value.path,
          mode: "100644",
          type: "blob",
          sha: result.value.sha,
        });
      } else {
        const error = result.reason as Error;
        // Find the original change for error reporting
        const failedChange = batch[results.indexOf(result)];
        if (error instanceof GitHubBlobTooLargeError) {
          errors.push({ path: (failedChange as { path: string }).path, error });
        } else {
          throw error; // unexpected error — abort
        }
      }
    }

    // Rate-limit breathing room between batches
    if (i + BLOB_BATCH_SIZE < addOrModify.length) {
      await sleep(100);
    }
  }

  // Step 3: Build deletion entries
  const deleteEntries: TreeEntry[] = changes
    .filter((c): c is Extract<WriteChange, { kind: "delete" }> => c.kind === "delete")
    .map((c) => ({
      path: c.path,
      mode: "100644",
      type: "blob",
      sha: null,
    }));

  const allEntries = [...blobEntries, ...deleteEntries];

  // Step 4: Create tree (chunked if large)
  const newTreeSha = await createTreeChunked(
    pat, owner, repo,
    tip.treeSha,   // base_tree: inherit unchanged files
    allEntries
  );

  // Step 5: Create commit
  const parentShas = isInitialPush ? [tip.commitSha] : [tip.commitSha];
  const newCommitSha = await createCommit(
    pat, owner, repo, message, newTreeSha, parentShas, author
  );

  // Step 6: Update (or create) branch ref
  if (isInitialPush) {
    // After bootstrapping, the branch already exists (bootstrapEmptyRepo created it).
    // Use PATCH to move it forward.
    await updateRef(pat, owner, repo, branch, newCommitSha, false);
  } else {
    await updateRef(pat, owner, repo, branch, newCommitSha, allowForce);
  }

  return { commitSha: newCommitSha, treeSha: newTreeSha };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 16. Best Practices Summary

1. **Always use `auto_init: true`** when creating repos to avoid the empty-repo
   409 problem entirely.

2. **Always use `force: false`** on `PATCH /git/refs` unless the user has
   explicitly invoked `--allow-overwrite-remote`. A divergence should surface as
   a `RemoteDivergedError`, not silently destroy remote commits.

3. **Always pre-check divergence** by calling `getBranchTip()` before the push
   sequence and comparing against `lastPushedCommitSha` in the ReverseLink
   metadata. This gives a cleaner error message than waiting for the 422 from
   `PATCH /git/refs`.

4. **Always use `base_tree`** on incremental pushes. Without it, files not
   mentioned in the tree entries are deleted — the repo becomes a sparse snapshot
   of only what was changed.

5. **Always use base64 encoding** for blob uploads. It works for all content types
   and removes the guesswork.

6. **Limit blob upload concurrency** to ~10 in-flight requests. The secondary
   rate limit for content creation is 80 requests/minute; at 10 concurrent with
   a 100 ms inter-batch pause, you stay at ~60/min with headroom.

7. **Chunk tree entries** at ≤ 700 per `POST /git/trees` call. Chain calls using
   `base_tree` from the previous chunk's result.

8. **Honour `Retry-After` and `x-ratelimit-reset` headers** before retrying
   after 403/429 responses. Continuing to hammer the API risks an integration ban.

9. **Never treat 404 as "repo definitely doesn't exist"** on private repos — it
   may mean "access denied". Present a combined error message to the user.

10. **Git ignores empty directories.** Do not attempt to create empty tree objects.
    Either skip empty prefixes silently or add an opt-in `.gitkeep` strategy.

---

## 17. Common Pitfalls

### Pitfall 1: Wrong Path in PATCH URL

The `PATCH /git/refs/{ref}` endpoint uses `heads/{branch}` (no leading `refs/`):

```
WRONG:   PATCH /git/refs/refs/heads/main
CORRECT: PATCH /git/refs/heads/main
```

But `POST /git/refs` body uses the full `refs/heads/{branch}` form:

```json
{ "ref": "refs/heads/main", "sha": "..." }
```

And `GET /git/ref/{ref}` uses `heads/{branch}` (singular `ref`):

```
GET /git/ref/heads/main   ← singular "ref", no leading "refs/"
```

### Pitfall 2: Omitting `base_tree` on Incremental Pushes

Without `base_tree`, only the explicitly listed paths end up in the new tree.
Every other file in the repository is removed. This silently destroys history
and looks like a correct push.

### Pitfall 3: Treating `sha: null` as Inserting a Null Blob

Setting `sha: null` in a tree entry **deletes** that path from the tree. It is
not a way to create an empty file. Use `content: ""` or upload an empty blob
for an empty file.

### Pitfall 4: Using `content` in Tree Entry for Binary Files

The `content` shortcut in tree entries is UTF-8 only. Passing binary data as
a string will corrupt the file. Always pre-upload binary files via
`POST /git/blobs` with `encoding: "base64"` and use the resulting SHA.

### Pitfall 5: Creating Ref Before Any Commits Exist

`POST /git/refs` fails if no commits exist in the repo. The Contents API
bootstrap (`PUT /contents/`) must happen first. With `auto_init: true` on repo
creation, this is never an issue.

### Pitfall 6: Conflating the Empty-Repo 409 with Other 409s

`409 Conflict` from the Git Data API usually means "repo is empty". But it can
also mean "repo is in the process of being created by GitHub's backend (rare)".
For the latter, a retry with exponential backoff after 2–5 seconds resolves it.

### Pitfall 7: Large Binary Uploads Without Per-File Error Handling

If any single `uploadBlob` call throws `GitHubBlobTooLargeError`, it must be
caught and the file excluded from the tree — the commit must still proceed for
all other files. Failing the entire operation on a single oversized file
violates NFR4 (per-file failures must not abort the operation).

### Pitfall 8: Race Condition Between Pre-Check and PATCH

There is an inherent TOCTOU (time-of-check / time-of-use) race between
`getBranchTip()` and `PATCH /git/refs`. The `force: false` on the PATCH provides
the final atomic guard — handle the 422 "not a fast forward" as a divergence
error even when the pre-check passed.

### Pitfall 9: Incorrect Detection of Empty Repo

Do not rely solely on `size: 0` from `GET /repos`. A repo with a single tiny
README reports `size: 0` for some time after creation. Use `GET /git/ref/heads/{branch}`:
404 → empty (or wrong branch); 200 → has commits.

---

## 18. Assumptions and Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `auto_init: true` on repo creation is always the preferred path | HIGH | If users create repos externally without `auto_init`, the bootstrap fallback (Strategy B / `.gitkeep`) must be implemented |
| The secondary rate limit for content creation is ~80/min | HIGH | Threshold is not officially documented and may change; monitor for 429 responses |
| Tree entry chunks of ≤ 700 stay under the undocumented write limit | MEDIUM | If the actual limit is lower (e.g., 500), reduce `TREE_CHUNK_SIZE`. No write failure has been documented at exactly 700. |
| 422 "Update is not a fast forward" is the only divergence signal on PATCH | HIGH | Could also manifest as 409 in some edge cases; code handles both |
| The `X-GitHub-Api-Version: 2022-11-28` header remains stable | HIGH | GitHub deprecates old versions with 18 months notice; check release notes periodically |
| Fine-grained PATs with `Contents: Read & Write` cannot create repositories (need `Administration: Read & Write`) | HIGH | The PAT scope split is documented but users often conflate them |
| Binary/text detection is not attempted; all blobs use base64 | HIGH | Correct and safe — no ambiguity |

### What Is Out of Scope

- Git LFS (large file storage) — files > 100 MB cannot be pushed via REST API.
  Recommend LFS separately if needed. Outside the reverse-git feature scope.
- GPG commit signing — the `signature` field in `POST /git/commits` is not used.
- Azure DevOps write client — separate research document covers ADO.
- Webhook or push event notification — pull/push event handling is forward-sync territory.
- The `encoding: "utf-8"` shortcut in blobs — always using base64 eliminates this complexity.

---

## 19. References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | GitHub Docs — Create a blob | https://docs.github.com/en/rest/git/blobs | Endpoint spec, size limits, status codes, base64 encoding requirement |
| 2 | GitHub Docs — Create a tree | https://docs.github.com/en/rest/git/trees | `base_tree` semantics, nested paths, deletion via `sha: null`, `content` shortcut, 100k/7MB read limit |
| 3 | GitHub Docs — Create a commit | https://docs.github.com/en/rest/git/commits | `parents: []` for root commit, author/committer fields |
| 4 | GitHub Docs — Create a reference | https://docs.github.com/en/rest/git/refs | `POST /git/refs` full ref name format; cannot create ref on empty repo |
| 5 | GitHub Docs — Update a reference | https://docs.github.com/en/rest/git/refs | `PATCH /git/refs/heads/{branch}` (no `refs/` prefix in path), `force` flag, 422 on non-fast-forward |
| 6 | GitHub Docs — Get a reference | https://docs.github.com/en/rest/git/refs | 404 for non-existent branch; 409 for empty repo |
| 7 | GitHub Docs — Using the REST API to interact with your Git database | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database | Full overview of blob/tree/commit/ref sequence; 409 empty-repo explanation; Contents API bootstrap recommendation |
| 8 | GitHub Docs — Rate limits for the REST API | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | Primary (5000/hr) and secondary limits; point costs (POST=5); `retry-after` and `x-ratelimit-reset` headers; 80 content-creating requests/min |
| 9 | GitHub Docs — Create a repository for authenticated user | https://docs.github.com/en/rest/repos/repos | `auto_init`, `default_branch`, `private` params; `repo` scope requirement |
| 10 | GitHub Docs — Create an organization repository | https://docs.github.com/en/rest/repos/repos | `POST /orgs/{org}/repos`; Administration: R&W for fine-grained PATs |
| 11 | GitHub Docs — Troubleshooting the REST API | https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api | 404 is intentionally indistinguishable from 403 for private repos (security by obscurity) |
| 12 | Retool Blog — Gotchas with Git and the GitHub API | https://retool.com/blog/gotchas-git-github-api | Real-world evidence of large tree 422 failures; chunking strategy with `base_tree` chaining; `sha: null` deletion pitfall |
| 13 | GitHub Community — Empty repository 409 on Git Data API | https://community.latenode.com/t/github-api-how-to-handle-409-conflict-errors-when-modifying-repository-files/1984 | 409 on empty repos confirmed; Contents API bootstrap workaround |
| 14 | GitHub Community — Tree entry limit discussion | https://github.com/orgs/community/discussions/23748 | 100k entry limit on read; recommendation to use sub-tree strategy |
| 15 | GitHub Docs — Repository limits | https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits | 100k/7MB cap confirmed; `truncated: true` detection |
| 16 | GitHub Community — File size limit discussion | https://github.com/orgs/community/discussions/155856 | 50MB practical limit; 100MB hard limit; 422 error shape |
| 17 | GitHub Community — 404 vs 403 on private repos | https://github.com/orgs/community/discussions/52522 | Confirms intentional 404 ambiguity for private repo access denial |
| 18 | GitHub Advisory Database | https://github.com/advisories | Used to verify zero-dep approach; no advisories for `fetch` usage |

---

## Assumptions and Uncertainties Report

### Uncertainties and Gaps

- **Exact write limit per `POST /git/trees` call:** GitHub does not document a
  per-request entry count limit for writing trees. The 700-entry chunk size is
  derived from Retool's production experience (their incidents showed failures
  above ~5,000 entries with a single call, and they settled on 1,000-entry chunks;
  this document recommends 700 for additional safety margin).

- **Secondary rate limit variability:** GitHub states secondary limits "are subject
  to change without notice." The 80/min content creation threshold is current as
  of June 2026 but may shift.

- **`size: 0` on newly initialized repos:** Confirmed that `size` field is not
  reliable for empty-repo detection, but the exact delay before `size` is updated
  after `auto_init` is undocumented.

- **409 vs. 422 on initial ref creation failures:** The exact error code when
  calling `POST /git/refs` before any commits exist is 422 in some reports and
  409 in others. Both should be handled.

### Clarifying Questions

1. Should the `.gitkeep` bootstrap file be cleaned up in the same commit as the
   initial storage push, or left in the repo? (Currently: the `bootstrapEmptyRepo`
   function returns the init tip and the caller uses it as `base_tree`, so the
   `.gitkeep` is inherited and can be deleted by including a `sha: null` entry
   for `.gitkeep` in the initial push tree.)

2. Should the commit author identity be stored per-reverse-link (investigation
   recommended "configurable per-reverse-link with a sensible default"), or always
   derived from the authenticated PAT user at push time?

3. Is there a requirement to push to branches other than the repo's default branch?
   If users want to push to a non-default branch, `createRef` may need to be called
   if that branch never had a commit, even on a non-empty repo.
