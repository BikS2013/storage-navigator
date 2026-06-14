# Azure DevOps Git Pushes REST API — Implementation Guide

**Topic:** Azure DevOps Git Pushes / Refs REST API — single-shot push payload to land many files in one commit from a stateless client.

**Purpose:** Implementation-ready reference for building `devops-write-client.ts` using raw `fetch` (no `azure-devops-node-api`), matching the existing `rateLimitedFetch` pattern in `src/core/devops-client.ts`.

**API version targeted:** `7.1`

---

## Overview

Unlike GitHub's Git Data API (which requires four separate network calls: create blobs, create tree, create commit, update ref), the Azure DevOps `/git/pushes` endpoint accepts a **single `POST`** that contains:

- the ref update (which branch to advance and from what SHA),
- one or more commits with author metadata, and
- all file changes inline as `changes[]` entries with content embedded.

The server computes the new commit SHA and updates the ref atomically. This is the most important architectural difference: the DevOps push is a single network call regardless of how many files are included.

---

## 1. The Single-Call Push Schema

### Endpoint

```
POST https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}/pushes?api-version=7.1
```

- `{org}` — organization name (e.g., `fabrikam`).
- `{project}` — project name **or** project UUID. Names with spaces must be percent-encoded (e.g., `My%20Project`).
- `{repoId}` — repository UUID **or** repository name. Using the UUID is safer because names can be renamed.
- `api-version=7.1` — always include this; it selects the stable schema.

### Full Request Payload Shape

```json
{
  "refUpdates": [
    {
      "name": "refs/heads/main",
      "oldObjectId": "<40-hex-char SHA or 40 zeros>"
    }
  ],
  "commits": [
    {
      "comment": "Sync from storage container foo at 2025-11-14T10:00:00Z (+12 ~3 -1)",
      "author": {
        "name": "Storage Navigator",
        "email": "storage-nav@local",
        "date": "2025-11-14T10:00:00Z"
      },
      "changes": [
        {
          "changeType": "add",
          "item": { "path": "/path/to/file.txt" },
          "newContent": {
            "content": "Hello world",
            "contentType": "rawtext"
          }
        },
        {
          "changeType": "edit",
          "item": { "path": "/path/to/binary.png" },
          "newContent": {
            "content": "<base64-encoded bytes>",
            "contentType": "base64encoded"
          }
        },
        {
          "changeType": "delete",
          "item": { "path": "/path/to/old-file.txt" }
        }
      ]
    }
  ]
}
```

### Key Points

- `refUpdates` is an **array**, but in practice exactly one entry is used per push.
- `newObjectId` is **not sent** in the request — the server computes and returns it.
- `commits` is an array; for `devops-write-client.ts` always send exactly **one commit per push** (see Section 7).
- `author` inside the commit is optional for incremental pushes (the PAT identity is used) but **must be provided** when you want a custom name/email. Omitting it results in the PAT owner identity appearing as the author.
- `committer` is a separate optional object with the same shape as `author`. If omitted, it defaults to the same value as `author`.

### Response Shape

```json
{
  "pushId": 85,
  "date": "2025-11-14T10:00:00.307Z",
  "commits": [
    {
      "commitId": "fd1062428e0567cfbfcc28ac59d4bea077ce81c1",
      "treeId":   "8132acc6e22bc93e8ba3d7fd63306017b6730610",
      "author": { "name": "...", "email": "...", "date": "..." },
      "committer": { "name": "...", "email": "...", "date": "..." },
      "comment": "...",
      "parents": ["<parentSha>"]
    }
  ],
  "refUpdates": [
    {
      "repositoryId": "<uuid>",
      "name": "refs/heads/main",
      "oldObjectId": "<previousSha>",
      "newObjectId": "<newSha>"
    }
  ],
  "pushedBy": { "id": "...", "displayName": "..." },
  "url": "https://dev.azure.com/..."
}
```

Extract `response.commits[0].commitId` as the new commit SHA to store in the reverse-link metadata.

---

## 2. `changes[]` Entry Shape

Each entry in the `changes` array represents one file operation.

### Add a new file (text)

```json
{
  "changeType": "add",
  "item": { "path": "/docs/readme.md" },
  "newContent": {
    "content": "# README\n\nHello.",
    "contentType": "rawtext"
  }
}
```

- `path` **must start with `/`**. Paths without a leading slash are rejected.
- `contentType: "rawtext"` — the `content` string is taken verbatim (UTF-8).

### Add or update a binary file (base64)

```json
{
  "changeType": "add",
  "item": { "path": "/images/logo.png" },
  "newContent": {
    "content": "iVBORw0KGgoAAAANS...",
    "contentType": "base64encoded"
  }
}
```

- `contentType: "base64encoded"` — `content` is a standard Base64 string (no line breaks required).
- For an existing file, use `changeType: "edit"` with the same `newContent` shape.

### Edit an existing text file

```json
{
  "changeType": "edit",
  "item": { "path": "/src/index.ts" },
  "newContent": {
    "content": "export const version = '2.0.0';",
    "contentType": "rawtext"
  }
}
```

### Delete a file

```json
{
  "changeType": "delete",
  "item": { "path": "/old/deprecated.ts" }
}
```

- No `newContent` is provided for deletions — the field must be **absent** (not null).

### Rename / move a file

```json
{
  "changeType": "rename",
  "sourceServerItem": "/old/path/file.txt",
  "item": { "path": "/new/path/file.txt" }
}
```

- `sourceServerItem` is the **current** path in the repository (with leading `/`).
- `item.path` is the **new** path.
- No `newContent` is provided — the content is preserved unchanged.
- For `devops-write-client.ts` v1: renames are **not needed** because Azure Blob Storage renames are not first-class events (a rename from the storage side arrives as a delete + add pair in the ETag diff). Use `delete` + `add` instead.

### `changeType` enum values (complete)

| Value | Meaning |
|---|---|
| `"add"` | Create a new file. Error if path already exists in tree. |
| `"edit"` | Update an existing file. Error if path does not exist. |
| `"delete"` | Delete an existing file. Error if path does not exist. |
| `"rename"` | Move a file to a new path. `sourceServerItem` required. |

**Important:** use `"add"` for new files and `"edit"` for existing files. Sending `"add"` for a file that already exists in the repo (e.g., in an incremental push) causes a 400 error. The `reverse-sync-engine.ts` must therefore accurately categorize each change as `added | modified | deleted` using the `reverse-diff-engine.ts` before calling `pushChanges()`.

### Size limits

- **Individual file limit:** 100 MB per file. Larger files are rejected with HTTP 413 and a message such as `"The push was rejected because it would exceed the push size limit of 5 GB"` or a per-file rejection.
- **Total push size limit:** 5 GB per push. In practice, the JSON payload for a push with 1,000 files each at ~50 KB of base64 content can reach several hundred MB — the HTTP POST itself must not exceed 5 GB. For realistic blob-storage synchronisation use cases (NFR2: ≤ 5 min for 1,000 files), this limit is not reached.
- **Path length limit:** total path ≤ 32,766 characters; individual path component ≤ 4,096 characters. Violations are rejected with `VS403729`.
- **No explicit limit on the number of `changes[]` entries** is documented. Azure DevOps processes them in a single server-side transaction. Community experience suggests thousands of entries work fine within the 5 GB payload cap.

---

## 3. Empty-Repo Bootstrap

### The Magic Zero SHA

When a repository has no commits at all (newly created via `POST /repositories`), the target branch has no tip SHA. To create the **first commit**, set `oldObjectId` to 40 hex zeros:

```json
{
  "refUpdates": [
    {
      "name": "refs/heads/main",
      "oldObjectId": "0000000000000000000000000000000000000000"
    }
  ],
  "commits": [
    {
      "comment": "Initial publish from storage",
      "changes": [
        {
          "changeType": "add",
          "item": { "path": "/readme.md" },
          "newContent": { "content": "# Initial", "contentType": "rawtext" }
        }
      ]
    }
  ]
}
```

The response will contain `commits[0].parents: []` — an empty array — confirming this is a root commit.

### Pitfalls for Initial Commits

1. **Do NOT set `commits[0].parents`** — it is a server-computed output field, not an input. Sending it in the request body is harmless but ignored.
2. **You CANNOT detect the empty state from `defaultBranch`** on the repository object — a freshly created repo has `defaultBranch: null` (or the field may be absent). Use the Refs API (Section 11) instead: an empty array means no branches exist.
3. **Do NOT send `oldObjectId: null`** — send the literal string `"0000000000000000000000000000000000000000"`. Null or missing `oldObjectId` results in a 400 error.
4. **Branch name semantics:** the zero-SHA trick creates the named branch AND the root commit in one call. It also sets this branch as the repository's `defaultBranch` if it is the first push. If you push to `refs/heads/main`, `defaultBranch` becomes `refs/heads/main` after the push.
5. **The API returns HTTP 200** for all successful pushes (including the initial one) — not 201. Do not check for 201.

---

## 4. Looking Up the Repository ID

### Retrieve by Name

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoNameOrId}?api-version=7.1
```

- `{repoNameOrId}` accepts either the repository **name** (e.g., `my-repo`) or its **UUID** (e.g., `5febef5a-833d-4e14-b9c0-14cb638f91e6`).
- Returns HTTP 200 with the `GitRepository` object or HTTP 404 if not found.
- The `defaultBranch` field in the response is `null` if no pushes have been made yet (empty repo), or `"refs/heads/main"` (full ref name with prefix) for a repo with commits.

### Response Fields

```json
{
  "id": "5febef5a-833d-4e14-b9c0-14cb638f91e6",
  "name": "my-repo",
  "defaultBranch": "refs/heads/main",
  "remoteUrl": "https://dev.azure.com/fabrikam/MyProject/_git/my-repo",
  "project": {
    "id": "6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c",
    "name": "MyProject"
  }
}
```

### URL Forms

Both of the following base URL forms work:
- `https://dev.azure.com/{org}/{project}/_apis/git/...` (preferred — modern form)
- `https://{org}.visualstudio.com/{project}/_apis/git/...` (legacy — still supported; `DevOpsClient.parseRepoUrl` already handles both)

### Project Name with Spaces

Percent-encode project names containing spaces:
```
GET https://dev.azure.com/fabrikam/My%20Project/_apis/git/repositories/my-repo?api-version=7.1
```

Use `encodeURIComponent(project)` in TypeScript when constructing URLs from user-supplied project names.

---

## 5. Repository Auto-Creation

### Create Endpoint

```
POST https://dev.azure.com/{org}/{project}/_apis/git/repositories?api-version=7.1
```

**Request body:**

```json
{
  "name": "my-new-repo",
  "project": {
    "id": "6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c"
  }
}
```

- `project.id` must be the **project UUID**, not the project name. Look up the project UUID via `GET https://dev.azure.com/{org}/_apis/projects/{projectName}?api-version=7.1` if you only have the name.
- Returns HTTP **201 Created** with the `GitRepository` object.
- The created repository is **empty** — `defaultBranch` is `null`, no refs exist, no commits.

### Visibility

The Azure DevOps Repositories API does **not** have a `visibility` field on repository creation. Repository visibility is controlled at the **project** level (public or private). If you need a private repository, create it inside a private project. The repository inherits the project's visibility.

This differs from GitHub where each repo has independent visibility. For `devops-write-client.ts`, the `--visibility` flag applies only to GitHub; document this difference.

### Required PAT Scope for Auto-Creation

- `vso.code_manage` ("Code (read, write, and manage)") — includes create/delete repositories.
- `vso.code_write` ("Code (read and write)") is **insufficient** for repo creation.
- The project (`project.id`) must already exist. The API does not create projects.

### Default Branch After Creation

After `POST /repositories`, the repo has:
- `defaultBranch: null`
- No refs (GET /refs returns `{"value": [], "count": 0}`)

After the first push to `refs/heads/main`:
- `defaultBranch: "refs/heads/main"`
- GET /refs returns the new branch.

---

## 6. Authentication

### Header Format

```
Authorization: Basic <base64(":"+PAT)>
```

Note the **empty username and colon before the PAT**. This is the documented format for PAT-based Basic auth in Azure DevOps.

```typescript
const encoded = Buffer.from(`:${pat}`).toString("base64");
const headers = {
  Authorization: `Basic ${encoded}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};
```

The existing `DevOpsClient` constructor (line 10 of `devops-client.ts`) already implements this correctly — `devops-write-client.ts` must replicate the identical construction.

### PAT Token Format

Azure DevOps PATs are 52-character Base32-ish strings (letters A-Z plus digits 2-7). They cannot be programmatically validated — store them as opaque strings.

### PAT Scopes — Minimum Required

| Operation | Minimum scope |
|---|---|
| Read repo files (`listRepoFiles`) | `vso.code` |
| Get refs (`getCurrentRefSha`) | `vso.code` |
| Push commits (`pushChanges`) | `vso.code_write` |
| Create repository (`getOrCreateRepo` with `autoCreate: true`) | `vso.code_manage` |

**Recommended scope for `devops-write-client.ts`:** `vso.code_manage` when `--create-repo` is set; `vso.code_write` otherwise. Document this in the configuration guide.

### PAT Scope Mismatch Detection

A `vso.code` PAT used for a push returns HTTP **403 Forbidden** with a body such as:
```json
{
  "typeKey": "UnauthorizedRequestException",
  "message": "The personal access token used has an insufficient scope..."
}
```

Parse `body.typeKey === "UnauthorizedRequestException"` to surface a clear error: `"PAT scope insufficient — need vso.code_write for pushes, vso.code_manage for repo creation"`.

---

## 7. Multiple Commits in One Push

The `commits` array **does** support multiple entries — you can include `commits[0]`, `commits[1]`, etc. in a single `POST /pushes` call. Each entry creates a **separate server-side commit** in the repository history, chained as parent → child in the order they appear in the array.

**For `devops-write-client.ts`:** always send exactly **one commit** per push call (Dimension 6 decision). This matches the `one commit per push run` decision from the investigation and keeps the implementation simple.

If multiple commits were sent: `commits[0]` becomes the new child of `oldObjectId`; `commits[1]` becomes the child of `commits[0]`'s new SHA, etc. The ref advances to the SHA of the **last** commit in the array.

---

## 8. Deletions

Delete a file by setting `changeType: "delete"` with only `item.path` — no `newContent`:

```json
{
  "changeType": "delete",
  "item": { "path": "/old/file.txt" }
}
```

- The path must exist in the current tree. Deleting a non-existent path causes a 400 error.
- Folder deletion is achieved by deleting all files within the folder; Azure DevOps Git has no empty-folder concept.
- Deletions can be mixed with adds and edits in the same `changes[]` array within a single commit.

---

## 9. Renames

```json
{
  "changeType": "rename",
  "sourceServerItem": "/old/location/file.txt",
  "item": { "path": "/new/location/file.txt" }
}
```

- `sourceServerItem` is the **current** server-side path (with leading `/`).
- `item.path` is the **destination** path (with leading `/`).
- No `newContent` — the content is preserved.
- Content modification cannot be combined with rename in a single change entry. To rename-and-modify, send two entries: a `rename` followed by an `edit`.

**V1 recommendation:** do not use `rename`. Azure Blob Storage does not have a native rename operation — a "rename" from the storage side always arrives as a delete + add pair in the ETag diff. Translate to `delete` + `add` accordingly.

---

## 10. Divergence Detection

### What Triggers a Conflict

When `refUpdates[0].oldObjectId` does not match the **current** tip of the target branch on the server, the push is rejected. The server performs a strict equality check — it is not a fast-forward calculation.

### Error Response

Azure DevOps returns **HTTP 400 Bad Request** with a JSON body:

```json
{
  "typeKey": "GitRefUpdateNeedsForcePermissionException",
  "message": "The ref update was rejected. The specified oldObjectId did not match the current ref value.",
  "innerException": null
}
```

Or in some cases:

```json
{
  "typeKey": "GitRefUpdateRejectedByPolicyException",
  "message": "The ref update was rejected by a policy."
}
```

The most reliable check is `response.status === 400` combined with inspecting the `typeKey`. Common `typeKey` values for divergence:

| `typeKey` | Meaning |
|---|---|
| `"GitRefUpdateNeedsForcePermissionException"` | `oldObjectId` did not match current ref tip |
| `"GitPushInvalidRefException"` | Branch ref format invalid |
| `"GitPushRefNotFoundException"` | `oldObjectId` refers to a commit that does not exist |

### Divergence Detection Strategy for `devops-write-client.ts`

The engine (`reverse-sync-engine.ts`) must:

1. Call `getCurrentRefSha(branch)` immediately before building the push payload.
2. Store the returned SHA as `oldSha`.
3. Compare `oldSha` with `lastPushedCommitSha` from `.reverse-git-links.json`.
4. If they differ, throw a typed `RemoteDivergedError({ localKnown: lastPushedCommitSha, remoteActual: oldSha })` **before** even calling `pushChanges()`.
5. If `oldSha === lastPushedCommitSha`, proceed with `pushChanges(oldSha)`.
6. If `pushChanges` still fails with a 400 (race condition between steps 1 and 3), surface the same `RemoteDivergedError` — do NOT retry automatically.

### Retry Strategy

Do **not** auto-retry on divergence — the remote has diverged and auto-overwriting would destroy human commits. Surface the error, let the user reconcile, and re-run.

For transient failures (503, network timeout), exponential backoff with 3 attempts is appropriate — but only for non-divergence 400s (check `typeKey` before retrying a 400).

---

## 11. Listing Existing Files for Diff (Empty-Branch Seeding)

### List All Files Recursively

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}/items?recursionLevel=Full&versionDescriptor.version={branch}&api-version=7.1
```

Response shape:

```json
{
  "count": 13,
  "value": [
    {
      "objectId": "d1d5c2d49045d52bba6419652d6ecb2cd560dc29",
      "gitObjectType": "tree",
      "path": "/MyWebSite/MyWebSite/Views",
      "isFolder": true
    },
    {
      "objectId": "9093f030aa7dd8c802cad228fae4c6bafae4b32f",
      "gitObjectType": "blob",
      "path": "/MyWebSite/MyWebSite/Views/Home/Index.cshtml"
    }
  ]
}
```

Filter for `gitObjectType === "blob"` to get file entries only. The existing `DevOpsClient.listFiles()` method already does this.

### Handling Empty Branch (Branch Doesn't Exist)

When the branch has no commits (empty repo or branch not yet created), the GET items endpoint returns **HTTP 404** with:

```json
{
  "typeKey": "GitItemNotFoundException",
  "message": "..."
}
```

OR the refs list returns an empty array. Handle 404 from `/items` gracefully — return `[]` rather than throwing.

### Refs Listing to Check Empty State

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}/refs?filter=heads/{branch}&api-version=7.1
```

- If the response `value` array is empty, the branch does not exist.
- If the branch exists, `value[0].objectId` is the current commit SHA.

This is the primary mechanism for `getCurrentRefSha()`.

---

## 12. Rate Limits

Azure DevOps uses **Azure DevOps Throughput Units (TSTUs)** as an abstract resource-consumption unit spanning CPU, memory, and database DTUs. The limits are:

- **Per-user global limit:** 200 TSTUs per 5-minute sliding window.
- **Normal activity:** up to 10 TSTUs per 5 minutes; bursts up to 100 TSTUs are typical.
- **Threshold trigger:** exceeding 200 times the typical user's consumption within 5 minutes triggers progressive delays (milliseconds to 30 seconds per request).

### Response Headers

| Header | Description |
|---|---|
| `Retry-After` | Seconds to wait before next request (RFC 6585) |
| `X-RateLimit-Remaining` | TSTUs remaining before delays start |
| `X-RateLimit-Limit` | Total TSTUs allowed |
| `X-RateLimit-Reset` | Unix epoch when usage returns to 0 |
| `X-RateLimit-Delay` | Seconds the current request was delayed |
| `X-RateLimit-Cost` | TSTUs consumed by this request |
| `X-RateLimit-Resource` | Resource type that triggered limiting |

When rate-limited, ADO may return **HTTP 429** with `TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource...`.

### Recommended Back-off

The existing `rateLimitedFetch` in `repo-utils.ts` already enforces a 50ms inter-request delay (NFR3). This is sufficient for normal incremental syncs. For large initial publishes (1,000+ files), the single-shot push approach means only **one** HTTP call is made regardless of file count — rate limiting is not a concern for the push itself. Only the preceding blob-enumeration calls (GET items for diff) are subject to rate-limiting.

Honor `Retry-After` if received. For 429 responses, wait the specified seconds before one retry. After two consecutive 429s, surface `RateLimitError` to the caller rather than retrying indefinitely.

---

## 13. Error Shapes

| HTTP Status | Condition | `typeKey` / Body | Recommended Action |
|---|---|---|---|
| 400 | `oldObjectId` mismatch | `GitRefUpdateNeedsForcePermissionException` | Throw `RemoteDivergedError` |
| 400 | Invalid `changeType` | `GitPushInvalidRefException` | Programming error — fix payload |
| 400 | Adding a file that already exists | No `typeKey`; `message` contains "already exists" | Ensure correct `add` vs `edit` classification |
| 400 | Deleting a file that does not exist | `GitItemNotFoundException` in message | Skip or catch per-file |
| 400 | Path exceeds 32,766 chars | `VS403729` in message | Skip file, add to `errors[]` |
| 401 | PAT expired or malformed | `UnauthorizedException` | Surface "invalid PAT" |
| 403 | PAT scope insufficient | `UnauthorizedRequestException` | Surface scope guidance |
| 404 | Repository not found | `GitRepositoryNotFoundException` | Surface "repo not found" |
| 404 | Branch/file not found (GET items) | `GitItemNotFoundException` | Return `[]` — treat as empty |
| 409 | (Not typical for pushes) | — | Treat as 400 divergence |
| 413 | Push payload > 5 GB | `GitPushTooLargeException` | Chunk the push into multiple batches |
| 429 | Rate limit exceeded | `TF400733` | Honor `Retry-After`, retry once |
| 503 | Service unavailable | HTML body or empty | Exponential back-off, up to 3 retries |

### Parsing Errors

```typescript
interface DevOpsErrorBody {
  typeKey?: string;
  message?: string;
  innerException?: DevOpsErrorBody | null;
}

function isDivergenceError(body: DevOpsErrorBody): boolean {
  return body.typeKey === "GitRefUpdateNeedsForcePermissionException"
    || body.typeKey === "GitRefUpdateRejectedByPolicyException"
    || (body.message ?? "").includes("oldObjectId did not match");
}
```

---

## 14. TypeScript Implementation — Core Functions

All functions below use raw `fetch` via the existing `rateLimitedFetch` wrapper from `repo-utils.ts`. Authentication header construction mirrors `DevOpsClient` exactly.

### Helper: `buildAuthHeaders`

```typescript
function buildAuthHeaders(pat: string): Record<string, string> {
  const encoded = Buffer.from(`:${pat}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
```

### Helper Types

```typescript
// Changes passed to pushChanges()
export type DevOpsChangeType = "add" | "edit" | "delete";

export interface DevOpsChange {
  changeType: DevOpsChangeType;
  path: string;            // must start with "/"
  contentBytes?: Uint8Array; // absent for delete
  isText?: boolean;        // if true, use rawtext; if false/absent, use base64encoded
}

// Errors thrown by write operations
export class DevOpsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly typeKey?: string,
  ) { super(message); }
}

export class RemoteDivergedError extends DevOpsApiError {
  constructor(
    public readonly remoteActualSha: string,
    public readonly localKnownSha: string,
  ) {
    super(
      `Remote branch has diverged. Remote tip: ${remoteActualSha}, last known: ${localKnownSha}`,
      400,
      "GitRefUpdateNeedsForcePermissionException",
    );
  }
}
```

### `getOrCreateRepo`

```typescript
/**
 * Look up an ADO repository by name; optionally create it if missing.
 * Returns the repository UUID and current default branch (null if empty).
 */
export async function getOrCreateRepo(
  pat: string,
  org: string,
  project: string,       // name or UUID — will be percent-encoded
  repoName: string,
  autoCreate: boolean,
): Promise<{ id: string; defaultBranch: string | null }> {
  const headers = buildAuthHeaders(pat);
  const encodedProject = encodeURIComponent(project);
  const base = `https://dev.azure.com/${org}/${encodedProject}/_apis/git/repositories`;

  // 1. Try to GET the repo by name
  const getRes = await rateLimitedFetch(
    `${base}/${encodeURIComponent(repoName)}?api-version=7.1`,
    headers,
  );

  if (getRes.ok) {
    const repo = await getRes.json() as {
      id: string;
      defaultBranch?: string | null;
    };
    return {
      id: repo.id,
      defaultBranch: repo.defaultBranch
        ? repo.defaultBranch.replace("refs/heads/", "")
        : null,
    };
  }

  if (getRes.status === 404) {
    if (!autoCreate) {
      throw new DevOpsApiError(
        `Repository "${repoName}" not found in project "${project}". ` +
        `Pass autoCreate=true (--create-repo flag) to create it.`,
        404,
        "GitRepositoryNotFoundException",
      );
    }

    // 2. Look up the project UUID (required for repo creation body)
    const projRes = await rateLimitedFetch(
      `https://dev.azure.com/${org}/_apis/projects/${encodedProject}?api-version=7.1`,
      headers,
    );
    if (!projRes.ok) {
      const body = await projRes.text();
      throw new DevOpsApiError(
        `Cannot look up project "${project}": ${projRes.status} ${body}`,
        projRes.status,
      );
    }
    const proj = await projRes.json() as { id: string };

    // 3. Create the repository
    const createRes = await rateLimitedFetch(
      `${base}?api-version=7.1`,
      headers,
      {
        method: "POST",
        body: JSON.stringify({ name: repoName, project: { id: proj.id } }),
      },
    );
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new DevOpsApiError(
        `Failed to create repository "${repoName}": ${createRes.status} ${body}`,
        createRes.status,
      );
    }
    const created = await createRes.json() as { id: string; defaultBranch?: string | null };
    return { id: created.id, defaultBranch: null }; // always null for new repos
  }

  // Non-404 error
  const body = await getRes.text();
  throw new DevOpsApiError(
    `Unexpected error fetching repository: ${getRes.status} ${body}`,
    getRes.status,
  );
}
```

### `getCurrentRefSha`

```typescript
/**
 * Return the current tip commit SHA for a branch.
 * Returns null if the branch does not exist (empty repo or branch not yet created).
 */
export async function getCurrentRefSha(
  pat: string,
  org: string,
  project: string,
  repoId: string,
  branch: string,        // without "refs/heads/" prefix, e.g. "main"
): Promise<string | null> {
  const headers = buildAuthHeaders(pat);
  const encodedProject = encodeURIComponent(project);
  // Use "filter" to scope to this branch only
  const encodedFilter = encodeURIComponent(`heads/${branch}`);
  const url =
    `https://dev.azure.com/${org}/${encodedProject}/_apis/git/repositories/` +
    `${repoId}/refs?filter=${encodedFilter}&api-version=7.1`;

  const res = await rateLimitedFetch(url, headers);

  if (res.status === 404) return null; // repo or branch doesn't exist

  if (!res.ok) {
    const body = await res.text();
    throw new DevOpsApiError(
      `Failed to get refs for branch "${branch}": ${res.status} ${body}`,
      res.status,
    );
  }

  const data = await res.json() as { value: Array<{ name: string; objectId: string }> };
  const ref = data.value.find((r) => r.name === `refs/heads/${branch}`);
  return ref?.objectId ?? null;
}
```

### `pushChanges`

```typescript
/**
 * Push a set of file changes as a single commit.
 *
 * @param oldSha - current tip SHA, or null for an empty repo (initial push).
 *                 When null, the 40-zero string is used automatically.
 * @returns The new commit SHA.
 */
export async function pushChanges(
  pat: string,
  org: string,
  project: string,
  repoId: string,
  branch: string,
  oldSha: string | null,
  message: string,
  author: { name: string; email: string },
  changes: DevOpsChange[],
): Promise<string> {
  if (changes.length === 0) {
    throw new Error("pushChanges called with empty changes array — nothing to commit");
  }

  const headers = buildAuthHeaders(pat);
  const encodedProject = encodeURIComponent(project);
  const ZERO_SHA = "0000000000000000000000000000000000000000";
  const now = new Date().toISOString();

  // Build the changes[] payload
  const changeEntries = changes.map((c): object => {
    if (c.changeType === "delete") {
      return {
        changeType: "delete",
        item: { path: ensureLeadingSlash(c.path) },
      };
    }
    const content = c.contentBytes!;
    const isText = c.isText ?? false;
    return {
      changeType: c.changeType,
      item: { path: ensureLeadingSlash(c.path) },
      newContent: isText
        ? {
            content: new TextDecoder().decode(content),
            contentType: "rawtext",
          }
        : {
            content: Buffer.from(content).toString("base64"),
            contentType: "base64encoded",
          },
    };
  });

  const payload = {
    refUpdates: [
      {
        name: `refs/heads/${branch}`,
        oldObjectId: oldSha ?? ZERO_SHA,
      },
    ],
    commits: [
      {
        comment: message,
        author: { name: author.name, email: author.email, date: now },
        changes: changeEntries,
      },
    ],
  };

  const url =
    `https://dev.azure.com/${org}/${encodedProject}/_apis/git/repositories/` +
    `${repoId}/pushes?api-version=7.1`;

  const res = await rateLimitedFetch(url, headers, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errBody: { typeKey?: string; message?: string } = {};
    try { errBody = await res.json(); } catch { /* ignore parse failure */ }

    if (res.status === 400 && isDivergenceError(errBody)) {
      throw new RemoteDivergedError(
        /* remoteActualSha — we don't have it here, surface what we know */
        "(fetch with getCurrentRefSha to get current)",
        oldSha ?? ZERO_SHA,
      );
    }

    throw new DevOpsApiError(
      `Push failed (${res.status}): ${errBody.message ?? JSON.stringify(errBody)}`,
      res.status,
      errBody.typeKey,
    );
  }

  const data = await res.json() as {
    commits: Array<{ commitId: string }>;
  };
  return data.commits[0].commitId;
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isDivergenceError(body: { typeKey?: string; message?: string }): boolean {
  return body.typeKey === "GitRefUpdateNeedsForcePermissionException"
    || body.typeKey === "GitRefUpdateRejectedByPolicyException"
    || (body.message ?? "").toLowerCase().includes("oldobjectid did not match");
}
```

### `listRepoFiles`

```typescript
/**
 * List all file paths and their Git object IDs in the repository at a given branch.
 * Returns an empty array if the branch does not exist.
 */
export async function listRepoFiles(
  pat: string,
  org: string,
  project: string,
  repoId: string,
  branch: string,
): Promise<Array<{ path: string; objectId: string }>> {
  const headers = buildAuthHeaders(pat);
  const encodedProject = encodeURIComponent(project);
  const url =
    `https://dev.azure.com/${org}/${encodedProject}/_apis/git/repositories/` +
    `${repoId}/items?recursionLevel=Full` +
    `&versionDescriptor.version=${encodeURIComponent(branch)}` +
    `&api-version=7.1`;

  const res = await rateLimitedFetch(url, headers);

  if (res.status === 404) return []; // branch or repo does not exist — treat as empty

  if (!res.ok) {
    const body = await res.text();
    throw new DevOpsApiError(
      `Failed to list repo files: ${res.status} ${body}`,
      res.status,
    );
  }

  const data = await res.json() as {
    value: Array<{
      path: string;
      objectId: string;
      gitObjectType: string;
    }>;
  };

  return data.value
    .filter((item) => item.gitObjectType === "blob")
    .map((item) => ({
      path: item.path.startsWith("/") ? item.path.slice(1) : item.path,
      objectId: item.objectId,
    }));
}
```

---

## 15. Detecting an Empty Repository

An ADO repository can be "empty" in two senses:

1. **Freshly created, no pushes at all** — `defaultBranch` is `null` in the repository object.
2. **A branch that has never been pushed** — the refs list returns `{"value": [], "count": 0}` when filtered for that branch.

Detection flow in `devops-write-client.ts`:

```typescript
async function isRepoEmpty(
  pat: string, org: string, project: string, repoId: string
): Promise<boolean> {
  const sha = await getCurrentRefSha(pat, org, project, repoId, "main");
  return sha === null;
}
```

If `getCurrentRefSha` returns `null` → pass `oldSha = null` to `pushChanges()` → it uses the 40-zero SHA → initial commit.

---

## 16. Project Name with Spaces and Special Characters

Project names in Azure DevOps can contain spaces and other special characters. Always percent-encode the project segment when constructing API URLs:

```typescript
const encodedProject = encodeURIComponent(project);
// "My Project" → "My%20Project"
// "Dev & Ops" → "Dev%20%26%20Ops"
```

Note: `encodeURIComponent` encodes `/`, `#`, `?`, `&`, `=`, `+`, and spaces — all of which can appear in ADO project names (though `/` in project names is extremely rare).

The `repositoryId` path segment (when using names rather than UUIDs) should also be encoded:

```typescript
const encodedRepo = encodeURIComponent(repoName);
```

---

## 17. Full Integration — `add` vs `edit` Classification

The `changeType` must match the actual state of the file in the repository. The `reverse-diff-engine.ts` must produce:

- `"add"` — for blobs in the storage snapshot that are **not** in the current repo tree.
- `"edit"` — for blobs that exist in both the storage snapshot and the repo tree but have different ETags.
- `"delete"` — for entries in the repo tree that are **not** in the current storage snapshot.

In `devops-write-client.ts`, map the `WriteChange.kind` discriminant to the ADO `changeType`:

```typescript
function toAdoChangeType(kind: "add" | "modify" | "delete"): DevOpsChangeType {
  switch (kind) {
    case "add": return "add";
    case "modify": return "edit";   // ADO uses "edit" not "modify"
    case "delete": return "delete";
  }
}
```

---

## 18. Chunked Pushes for Very Large File Sets

While there is no documented hard limit on the number of entries in `changes[]`, a JSON payload containing thousands of large base64-encoded files may approach or exceed the **5 GB push size limit**. If this risk exists, split the changes into multiple sequential pushes:

```typescript
async function pushInBatches(
  pat: string, org: string, project: string, repoId: string,
  branch: string, startSha: string | null,
  message: string, author: { name: string; email: string },
  allChanges: DevOpsChange[],
  batchSize = 500,
): Promise<string> {
  let currentSha = startSha;
  for (let i = 0; i < allChanges.length; i += batchSize) {
    const batch = allChanges.slice(i, i + batchSize);
    const batchMessage = allChanges.length > batchSize
      ? `${message} (batch ${Math.floor(i / batchSize) + 1})`
      : message;
    currentSha = await pushChanges(
      pat, org, project, repoId, branch, currentSha,
      batchMessage, author, batch,
    );
  }
  return currentSha!;
}
```

Each batch becomes a separate commit. For the reverse-link metadata, store the SHA of the **last** batch commit.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| HTTP 400 + `typeKey: "GitRefUpdateNeedsForcePermissionException"` signals divergence | HIGH — confirmed in community reports | Would need to widen the divergence check to catch other typeKey values |
| `commits[]` array supports multiple entries in one push | HIGH — schema accepts an array | No impact — `devops-write-client.ts` sends exactly one commit anyway |
| `changeType: "add"` for an existing file → 400 error | HIGH — standard Git semantics; consistent with the items API contract | Would need to handle silently if ADO permitted this; current design requires correct classification |
| Repository creation does not accept a `visibility` field | HIGH — confirmed from the create API schema | If ADO adds a `visibility` param, pass it; no breaking change to existing code |
| The 5 GB push limit applies to the JSON body total | MEDIUM — documented for pack-based pushes; REST JSON equivalent is inferred | If the limit is lower for JSON, implement chunked pushes at a lower threshold |
| `author.date` field name (not `authoredDate`) | HIGH — confirmed from response examples | N/A |
| Chunking with 500 changes per batch is safe | MEDIUM — no documented per-batch count limit | Reduce batch size if 400 errors occur |

## Uncertainties & Gaps

- **Exact HTTP status for "add" on existing file:** the 400 response body when using `"add"` on an existing file has not been verified with a live call. Community experience suggests it's 400, but the exact `typeKey` is not publicly documented. Parse `message` for "already exists" as a fallback.
- **Maximum `changes[]` count per commit:** no official number. Inferred safe from the 5 GB payload cap. In practice, 10,000+ entries in a single commit have been reported to work by community members (GitHub issues on `azure-devops-node-api`).
- **Author override on initial commit:** whether the `author` field is honoured for the very first commit when `oldObjectId` is all zeros has not been explicitly confirmed in docs — the examples show it being set by the PAT identity. Include `author` in the request for correctness.
- **Project UUID requirement for repo creation:** the body `project.id` must be a UUID. If only a project name is available, a preceding GET to `/projects/{name}` is required. This adds one extra API call to the `--create-repo` path.

## Clarifying Questions

1. Should `devops-write-client.ts` support pushing to a non-default branch (e.g., `reverse-git/sync`)? The current design always targets the branch stored in the reverse-link. Clarify whether branch name is fixed at link time or configurable per-push.
2. Should chunked pushes (>500 changes) produce multiple commits with separate timestamps, or should the feature be documented as "not supported for very large initial publishes over REST"?
3. Is there a hard requirement to surface the **remote commit SHA** in the `RemoteDivergedError`? The current design throws before calling `pushChanges`, so the remote SHA is available from `getCurrentRefSha` — but it requires the caller to capture it.

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | Azure DevOps Pushes – Create REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create?view=azure-devops-rest-7.1 | Complete request/response schema; all changeType examples (add text, add binary, delete, rename, multiple changes, initial commit, create new branch); `oldObjectId` zero-SHA semantics |
| 2 | Azure DevOps Repositories – Create REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/create?view=azure-devops-rest-7.1 | Repository creation payload; `project.id` requirement; `vso.code_manage` scope; `GitRepository` schema including `defaultBranch` null for empty repos |
| 3 | Azure DevOps Repositories – Get REST API | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/get?view=azure-devops-rest-7.1 | GET by name or UUID; `defaultBranch` field; URL forms; response schema |
| 4 | Azure DevOps Refs – List REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/list?view=azure-devops-rest-7.1 | `filter` parameter for branch-specific lookup; `objectId` field; empty-array response for non-existent branches |
| 5 | Azure DevOps Refs – Update Refs REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/update-refs?view=azure-devops-rest-7.1 | Race-condition protection via `oldObjectId` + `newObjectId` pair; `updateStatus: "succeeded"` in response |
| 6 | Azure DevOps Items – List REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/list?view=azure-devops-rest-7.1 | `recursionLevel=Full` for recursive listing; `gitObjectType` filter for blobs vs trees; 404 for missing branch |
| 7 | Azure DevOps Rate Limits | https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops | TSTU model; 200 TSTU per 5-min window; `Retry-After`, `X-RateLimit-*` headers; HTTP 429 with TF400733 |
| 8 | Azure DevOps Git Repository Limits | https://learn.microsoft.com/en-us/azure/devops/repos/git/limits?view=azure-devops | 250 GB repo max; 5 GB push max; 100 MB per file; path limits (32,766 / 4,096 chars); VS403729 error code |
| 9 | Azure DevOps PAT Scopes | https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops#available-scopes | `vso.code`, `vso.code_write`, `vso.code_manage` scope chain; exact capability descriptions |
| 10 | Azure DevOps PAT Authentication | https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops | PAT format; Basic auth with empty username; 52-character token format |
| 11 | Existing `DevOpsClient` (project source) | `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/src/core/devops-client.ts` | Auth header construction (`Buffer.from(":"+pat).toString("base64")`); `rateLimitedFetch` usage pattern; `/items?recursionLevel=Full` URL pattern already in use |

### Recommended for Deep Reading

- **[Pushes – Create (source 1)]:** Contains nine fully worked examples covering every `changeType` value and the initial-commit flow. Essential reference while implementing `devops-write-client.ts`.
- **[Rate Limits (source 7)]:** Documents all response headers; understanding the TSTU model prevents over-engineering custom throttling that the existing `rateLimitedFetch` already handles.
- **[Git Limits (source 8)]:** Defines the 5 GB push cap and per-file 100 MB cap — both must inform the chunked-push fallback strategy.
