# Plan 011 — Reverse Git (Storage → Repository)

## Provenance

- **REFINED_REQUEST_FILE**: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/refined-request-reverse-git.md`
- **INVESTIGATION_FILE**: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/investigation-reverse-git.md`
- **TECHNICAL_RESEARCH_FILES**:
  - `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/research/github-git-data-api.md`
  - `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/research/azure-devops-git-pushes-api.md`
- **CODEBASE_SCAN_FILE**: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/codebase-scan-reverse-git.md`
- **Branch**: `reverse-git-integration` (per Assumption A10)
- **Project design**: `docs/design/project-design.md` — append a new "Reverse Git Publication" section at completion.

---

## Open clarifications

The investigation resolved all 12 open questions from the refined request. The only items left for coders to surface during implementation are:

1. **Empty-directory policy** (research §14): default is "silently skip" empty Azure storage prefixes (Git does not track them). The opt-in `--preserve-empty-dirs` is **deferred to v2** unless an acceptance criterion fails because of it.
2. **`.gitkeep` cleanup after empty-repo bootstrap** (research §7): if `auto_init: true` is used on GitHub repo creation, the README is inherited via `base_tree`. The first-publish coder must decide whether to delete that README in the same commit (recommend: keep it unless storage contains a real `README.md`, in which case it is overwritten naturally by the same path entry).
3. **`storage-account` context menu in Electron UI** (codebase scan §5): no context menu exists on the top-level storage-account tree node today. Phase G must add one. No ambiguity, just a note for the UI coder.

Everything else is locked by the investigation. See "Decisions confirmed from investigation" below.

---

## Decisions confirmed from investigation

Restated here so coders never second-guess. All twelve OQs resolved.

| # | Open question | Confirmed decision |
|---|---|---|
| OQ-1 | Repo auto-creation policy | **Opt-in** via `--create-repo` flag. Default visibility `private`. Without flag, missing repo → fail with `RepoNotFoundError` and exit 2. |
| OQ-2 | Storage-account-scope metadata location | **Hybrid**: container/prefix scope → `.reverse-git-links.json` blob at container root. Storage-account scope → new `reverseLinks` field on `CredentialData` (local config). |
| OQ-3 | Extend read clients vs. sibling write clients | **Sibling write clients**: `src/core/github-write-client.ts` and `src/core/devops-write-client.ts`. Existing `GitHubClient` / `DevOpsClient` remain read-only and untouched. |
| OQ-4 | Commit granularity | **One commit per push** (batched). Matches forward-sync semantics. |
| OQ-5 | Branch divergence handling | **Fail closed** by default with typed `RemoteDivergedError`. Opt-in `--allow-overwrite-remote` flag enables force-push (separate from `--force` which re-pushes every file). |
| OQ-6 | Event-driven monitoring | **Out of scope for v1**. On-demand push only (CLI + UI button). Document as v2 enhancement in `Issues - Pending Items.md`. |
| OQ-7 | Provider extensibility | **`RepoWriteClient` interface** in `src/core/types.ts`. Engine layer is provider-agnostic. New providers = new file implementing the interface. |
| OQ-8 | Naming | **Accept refined-request names as-is**: `publish-github`, `publish-devops`, `push`, `reverse-link-github`, `reverse-link-devops`, `reverse-unlink`, `list-reverse-links`. Metadata file: `.reverse-git-links.json`. |
| OQ-9 | Commit author identity | **Configurable per-reverse-link** with default `"Storage Navigator <storage-nav@local>"`. CLI flags `--author-name`, `--author-email`. No API call to look up PAT identity. |
| OQ-10 | Storage-account scope iteration cost | **Document as "use sparingly"** in `docs/tools/storage-nav.md`. Engine is unchanged; performance optimisation deferred to v2. |
| OQ-11 | `.gitignore` semantics | Patterns evaluated **relative to source scope root** (per-container root for storage-account scope; prefix root for prefix scope). Not re-evaluated against mapped repo path. |
| OQ-12 | Forward × reverse coexistence | **Allow both independently, no implicit chaining**. Forward sync writing into a container does NOT auto-trigger a reverse push. |

Additional architectural decisions from the investigation:

- **Git interaction strategy**: Pure REST — no `simple-git`, no `isomorphic-git`, no local working tree.
- **Change detection**: ETag-based (`path → etag` snapshot) via new `reverse-diff-engine.ts`. Forward `diff-engine.ts` is NOT touched.
- **Library choice**: Raw `fetch` via existing `rateLimitedFetch`. **Zero new runtime dependencies.**
- **GitHub empty-repo handling**: Always use `auto_init: true` on `createRepo`. Fallback path via Contents API `.gitkeep` bootstrap stays in code for repos created externally.
- **GitHub large trees**: chunk at ≤ 700 entries per `POST /git/trees`, chain via `base_tree`.
- **GitHub blob concurrency**: ≤ 10 in-flight uploads, 100 ms pause between batches (secondary rate-limit safety).
- **ADO push model**: single-shot `POST /git/pushes` with `refUpdates[0].oldObjectId = "0"*40` for initial commit.
- **ADO `add` vs `edit`**: must match repo state — `reverse-diff-engine` produces accurate classification.

---

## Cross-cutting concerns

These touch multiple phases; coders MUST honour them consistently.

### Credential reuse

- All PATs flow through `CredentialStore.getToken()` / `getTokenByProvider()` (from plan-002).
- Reverse-git introduces **zero new PAT storage**. The same `TokenEntry.provider` discriminant (`github` | `azure-devops`) is reused.
- CLI flag chain: `--pat <inline>` → `--token-name <name>` → provider default (first matching `TokenEntry`). Identical to plan-005.
- Token-expiry warning (per `TokenEntry.expiresAt`) uses the same helper that forward-sync uses. Do not duplicate.

### `.reverse-git-links.json` schema (container/prefix scope)

Stored as a blob at the container root of the container that owns the scope. UTF-8 JSON, pretty-printed for diff-friendliness.

```jsonc
{
  "version": 1,
  "links": [
    {
      "id": "<uuid-v4>",
      "scope": {
        "kind": "container" | "prefix",
        "container": "my-container",
        "prefix": "docs/"               // omitted for kind:"container"
      },
      "provider": "github" | "azure-devops",
      "repoUrl": "owner/repo" | "https://dev.azure.com/org/project/_git/repo",
      "branch": "main",
      "repoSubPath": "",                // default empty
      "tokenName": "my-pat",
      "author": {
        "name": "Storage Navigator",
        "email": "storage-nav@local"
      },
      "exclusionPatterns": ["*.log", "tmp/"],
      "respectGitignore": true,
      "createRepo": false,
      "visibility": "private",          // only honoured on first publish when createRepo=true
      "lastPushedAt": "2026-06-01T12:00:00Z",
      "lastPushedCommitSha": "...",
      "lastPushedTreeSha": "...",        // null for ADO (server-side)
      "blobSnapshot": {
        "foo/bar.txt": "0x8DBA...etag",
        "images/logo.png": "0x8DBA...etag"
      },
      "createdAt": "2026-06-01T11:55:00Z",
      "lastPushResult": {
        "added": 12, "modified": 3, "deleted": 1, "errors": []
      }
    }
  ]
}
```

### `reverseLinks` field on `CredentialData` (storage-account scope)

`src/core/credential-store.ts` extends `CredentialData` with a new optional field. **Backward-compatible**: missing field on existing config files = empty array.

```typescript
export interface CredentialData {
  storages: StorageEntry[];
  tokens: TokenEntry[];
  /** NEW: storage-account-scope reverse-links keyed by storage account name */
  reverseLinks?: AccountScopeReverseLinksRegistry;
}

export interface AccountScopeReverseLinksRegistry {
  version: 1;
  /** key = storage account name */
  byAccount: Record<string, ReverseLink[]>;
}
```

Two new methods on `CredentialStore`:
- `getAccountReverseLinks(account: string): ReverseLink[]`
- `setAccountReverseLinks(account: string, links: ReverseLink[]): Promise<void>`

The encryption envelope is unchanged — the new field rides along inside the existing AES-256-GCM blob.

### `RepoWriteClient` interface (in `src/core/types.ts`)

```typescript
export type WriteChange =
  | { kind: "add" | "modify"; path: string; contentBytes: Uint8Array }
  | { kind: "delete"; path: string };

export interface RepoWriteClientCommitInput {
  branch: string;
  parentCommitSha: string | null;   // null → root commit / empty repo
  parentTreeSha: string | null;     // unused by ADO; GitHub uses for base_tree
  message: string;
  author: { name: string; email: string };
  changes: WriteChange[];
  /** force ref update past divergence (--allow-overwrite-remote) */
  allowForce?: boolean;
}

export interface RepoWriteClientCommitResult {
  commitSha: string;
  treeSha: string | null;           // ADO returns tree id; null if not exposed
  perFileErrors: Array<{ path: string; reason: string }>;
}

export interface RepoWriteClient {
  ensureRepo(opts: {
    name: string;                    // owner/repo for GitHub; repo name for ADO
    visibility: "public" | "private";
    createIfMissing: boolean;
  }): Promise<void>;

  getBranchTip(branch: string): Promise<{ commitSha: string; treeSha: string | null } | null>;

  createCommit(input: RepoWriteClientCommitInput): Promise<RepoWriteClientCommitResult>;
}
```

### Error type taxonomy (single source of truth)

All errors below live in `src/core/reverse-git-errors.ts` so phases share them.

| Error class | When thrown | Exit code (CLI) | HTTP status (server) |
|---|---|---|---|
| `RepoNotFoundError` | `ensureRepo` finds 404 and `createIfMissing=false` | 2 | 404 |
| `RemoteDivergedError` | `getBranchTip().commitSha !== lastPushedCommitSha`, or PATCH-422/POST-400 divergence | 2 | 409 |
| `GitHubApiError` | Any GitHub status code not specifically classified | 2 | 502 |
| `GitHubEmptyRepoError` | GitHub 409 on Git Data API call (extends `GitHubApiError`) | 2 | 502 |
| `GitHubBlobTooLargeError` | GitHub 422 "file too large" (extends `GitHubApiError`) | per-file accumulated, not fatal | n/a |
| `DevOpsApiError` | Any ADO status code not specifically classified | 2 | 502 |
| `AuthenticationError` | 401/403 from either provider | 2 | 401 |
| `RateLimitError` | Persistent 429 after retries exhausted | 2 | 503 |
| `PathCollisionError` | Two storage paths map to colliding repo paths (R5.5) | 2 | 422 |
| `ConfigurationError` | Missing required config (no fallbacks — per project rule) | 3 | 400 |

CLI exit codes follow plan-005's tri-state: 0 = success/no-op, 1 = changes pushed (or would be pushed in `--dry-run`), 2 = fatal error.

---

## Phase DAG

```
        ┌──────────────────────────────────────┐
        │ Phase C: Types + Link Registry +     │
        │           Credential extension       │
        │           (blocker for everyone)     │
        └──────────────┬───────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌────────────┐  ┌────────────────┐  ┌─────────────────┐
│ Phase A:   │  │ Phase B:       │  │ (no others run  │
│ Write      │  │ Reverse-diff + │  │  in parallel    │
│ clients    │  │ Blob enumerator│  │  with C)        │
│ GH + ADO   │  │                │  │                 │
└─────┬──────┘  └────────┬───────┘  └─────────────────┘
      └────────┬─────────┘
               ▼
       ┌────────────────────────┐
       │ Phase D: Reverse-sync  │
       │           engine        │
       └─────────┬──────────────┘
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Phase E: │ │ Phase F: │ │ (Phase G │
│ CLI      │ │ Server   │ │  waits   │
│ commands │ │ API      │ │  for F)  │
└──────────┘ └────┬─────┘ └──────────┘
                  ▼
            ┌──────────┐
            │ Phase G: │
            │ Electron │
            │ UI       │
            └──────────┘
```

**Parallel-safe groups**:
- After C lands: A and B run in parallel (independent files).
- After D lands: E and F run in parallel (independent files).
- G must wait for F (UI hits the new endpoints).

---

## Phase C — Types, Link Registry, Credential Store extension

**Why first**: every other phase imports types from this phase. Smallest blast radius lands first.

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/src/core/reverse-git-errors.ts` | All typed error classes from the "Error type taxonomy" table above. |
| `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/src/core/reverse-link-registry.ts` | Container-scope CRUD on `.reverse-git-links.json`. Functions: `readReverseLinks(blobClient, container)`, `writeReverseLinks(blobClient, container, registry)`, `createReverseLink(blobClient, container, link)`, `removeReverseLink(blobClient, container, linkId)`, `findReverseLink(blobClient, container, linkId)`. Constant `REVERSE_LINKS_BLOB = ".reverse-git-links.json"`. |
| `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/tests/unit/reverse-link-registry.test.ts` | Vitest unit tests using fake `BlobClient`. |
| `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/tests/unit/credential-store-reverse-links.test.ts` | Tests for `getAccountReverseLinks` / `setAccountReverseLinks`. |

### Files to MODIFY (with symbols)

| Path | Symbols | Change |
|---|---|---|
| `src/core/types.ts` | (append after line 106) | Add `ReverseLink`, `ReverseLinksRegistry`, `AccountScopeReverseLinksRegistry`, `PushResult`, `PushError`, `WriteChange`, `RepoWriteClient`, `RepoWriteClientCommitInput`, `RepoWriteClientCommitResult`, `ReverseLinkScope`. Extend `CredentialData` with optional `reverseLinks?: AccountScopeReverseLinksRegistry`. |
| `src/core/credential-store.ts` | `CredentialStore` class | Add `getAccountReverseLinks(account: string): ReverseLink[]` and `setAccountReverseLinks(account: string, links: ReverseLink[]): Promise<void>`. Ensure load/save preserves the new field for older config files (missing field → empty registry, no migration write). |

### Files explicitly OUT-OF-SCOPE for Phase C

- `src/core/blob-client.ts`, `src/core/github-client.ts`, `src/core/devops-client.ts`, `src/core/sync-engine.ts`, `src/core/diff-engine.ts`, `src/core/repo-utils.ts`, `src/cli/**`, `src/electron/**`, `src/agent/**`, anything under `src/core/backend/`.

### Dependencies (DAG)

- **Depends on**: nothing.
- **Blocks**: A, B, D, E, F, G.

### Parallel-safety

Phase C runs alone (it's a blocker). Subsequent phases may run partially in parallel.

### Acceptance criteria mapping

- AC-G3 (project-functions.md updated for R9), AC-H1 (`tsc --noEmit` clean), AC-H3 (existing metadata blobs unaffected).
- Implicit: every later phase compiles because its types now exist.

### Verification

```bash
cd /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
npx tsc --noEmit
npx vitest run tests/unit/reverse-link-registry.test.ts tests/unit/credential-store-reverse-links.test.ts
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Older `credentials.json` files lack `reverseLinks` → JSON.parse error or undefined access | `getAccountReverseLinks` returns `[]` when field missing; `setAccountReverseLinks` initialises field on first write. No migration. |
| Type bloat in `types.ts` makes the file hard to read | Group reverse-git types under a clear `// === Reverse Git (plan-011) ===` banner; keep forward-direction types untouched. |
| Concurrent writes to `.reverse-git-links.json` from CLI and UI | Each writer reads the latest blob, applies its mutation, writes. Conflicts are vanishingly rare for a single-user tool; document as known limitation. Same posture as existing `LINKS_BLOB`. |

---

## Phase A — Write clients (GitHub + ADO)

**Why parallel with B**: both depend only on Phase C types; they touch completely disjoint files.

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `src/core/github-write-client.ts` | Implements `RepoWriteClient` for GitHub via Git Data API. Exposes `GitHubWriteClient` class plus internal helpers `uploadBlob`, `createTree`, `createTreeChunked`, `createCommit`, `updateRef`, `createRef`, `getBranchTip`, `bootstrapEmptyRepo`, `createRepo`. Per research §15. |
| `src/core/devops-write-client.ts` | Implements `RepoWriteClient` for Azure DevOps via `/git/pushes`. Exposes `DevOpsWriteClient` class plus helpers `getOrCreateRepo`, `getCurrentRefSha`, `pushChanges`, `listRepoFiles`, `pushInBatches`. Per ADO research §14. |
| `tests/unit/github-write-client.test.ts` | Vitest unit tests with `vi.fn()`-mocked `fetch`. Cover: blob upload (success, 422 too-large, 409 empty-repo), tree chunking (700-boundary, base_tree chaining), commit creation, ref update (200, 422 divergence), bootstrap, createRepo (201, 422 name taken). |
| `tests/unit/devops-write-client.test.ts` | Same coverage for ADO: getOrCreateRepo (200, 404+autoCreate, 404+no autoCreate→RepoNotFoundError), getCurrentRefSha (200, 404, empty branch), pushChanges (success, 400 divergence→RemoteDivergedError, zero-SHA initial push). |

### Files to MODIFY

None. **No changes to `src/core/github-client.ts` or `src/core/devops-client.ts`** (sibling-write-client decision, OQ-3).

### Files explicitly OUT-OF-SCOPE for Phase A

- `src/core/github-client.ts` (read client — untouched)
- `src/core/devops-client.ts` (read client — untouched)
- `src/core/repo-utils.ts` (consumed read-only via `rateLimitedFetch` import)
- Everything in `src/cli/**`, `src/electron/**`, `src/core/sync-engine.ts`, `src/core/diff-engine.ts`.

### Dependencies

- **Depends on**: C (for `RepoWriteClient`, `WriteChange`, error types).
- **Blocks**: D.
- **Runs parallel with**: B.

### Acceptance criteria mapping

- AC-A1 / AC-A4 (initial publish round-trip for GitHub / ADO).
- AC-A5 (`--create-repo` honoured; without it → `RepoNotFoundError`).
- AC-A8 (auth failure surfaces clear error).
- AC-D3 (per-file > 100 MB → accumulated error, push continues).
- AC-H1.

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/github-write-client.test.ts tests/unit/devops-write-client.test.ts
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| GitHub secondary rate-limit on initial publish of 1k files (5000 points) | Cap concurrent blob uploads at 10; 100 ms inter-batch pause; honour `Retry-After`. Per research §12. |
| `POST /git/trees` 422 on > 700 entries | `createTreeChunked` with `TREE_CHUNK_SIZE = 700`, base_tree chaining per research §11. |
| Empty repo 409 cascade | `auto_init: true` on `createRepo` is the primary path; `bootstrapEmptyRepo` via Contents API `.gitkeep` is the fallback. Per research §7. |
| ADO `add` vs `edit` mismatch → 400 | Engine (Phase D) must classify accurately. Document in `devops-write-client.ts` JSDoc. |
| 404 ambiguity on GitHub private repos | Error message text says "not found OR PAT lacks permission" per research §13. |
| ADO 5 GB push limit on large initial publish | `pushInBatches` with default 500-change batches; first push creates root commit, subsequent batches use returned SHA as next `oldSha`. |

---

## Phase B — Reverse-diff engine + Blob enumerator

**Why parallel with A**: only depends on Phase C types; works against in-memory fixtures, no network.

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `src/core/blob-enumerator.ts` | Enumerates blobs for the three source granularities. Exposes `enumerateScope(blobClient, scope, opts): AsyncIterable<EnumeratedBlob>` where `EnumeratedBlob = { storagePath: string; repoPath: string; etag: string; size: number }`. Applies path-mapping rules R5.1–R5.5, exclusion patterns (R6), and `.gitignore` (R6.2, scope-root-relative per OQ-11). Special-cases excluded blobs: `META_BLOB`, `LINKS_BLOB`, `REVERSE_LINKS_BLOB` (R6.3, R6.4). Surfaces `PathCollisionError` (R5.5) and warnings for illegal paths (R5.4). |
| `src/core/reverse-diff-engine.ts` | Compares current blob snapshot vs. stored `lastPushedBlobSnapshot`. Exposes `computeReverseDiff(currentSnapshot, lastSnapshot): ReverseDiffReport` with categories `added | modified | deleted | unchanged`. Shares `DiffCategory` type with forward `diff-engine.ts` via `types.ts` only (no engine import). |
| `tests/unit/blob-enumerator.test.ts` | Fixtures: container scope, prefix scope, account scope. Test path-mapping for each, exclusion patterns, `.gitignore`, path-collision detection, illegal-path filter. |
| `tests/unit/reverse-diff-engine.test.ts` | Fixtures: added/modified/deleted/unchanged classifications; empty current snapshot (everything deleted); empty last snapshot (everything added). |

### Files to MODIFY

None. The forward `diff-engine.ts` is **not** touched (investigation Dimension 10).

### Files explicitly OUT-OF-SCOPE for Phase B

- `src/core/diff-engine.ts`
- `src/core/sync-engine.ts`
- Everything in `src/cli/**`, `src/electron/**`.
- Phase A write clients (no dependency).

### Dependencies

- **Depends on**: C.
- **Blocks**: D.
- **Runs parallel with**: A.

### Acceptance criteria mapping

- AC-B7 (unchanged blob detected, not re-uploaded).
- AC-D1 (`.git/config` excluded with warning).
- AC-D2 (case-only collision → `PathCollisionError`).
- AC-D5 (exclusion-list `*.log` semantics).
- AC-D6 (storage-side `.gitignore` honoured, file itself published).
- AC-D7 (metadata blobs never published).
- AC-A2 (prefix stripping — R5.2).
- AC-A3 (storage-account-scope container→top-level mapping — R5.3).

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/blob-enumerator.test.ts tests/unit/reverse-diff-engine.test.ts
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| `.gitignore` semantics confusion | Document explicitly in JSDoc: patterns are scope-root-relative (OQ-11). Test fixture pinning this rule. |
| Account-scope iteration cost on large accounts | Use existing `processInBatches` from `repo-utils.ts` (concurrency 5 across containers). Document "use sparingly" in `docs/tools/storage-nav.md` during Phase E. |
| Path-mapping bug on Windows-style backslash in blob names | R5.4 flags and excludes; never silently translate `\` → `/`. |

---

## Phase D — Reverse-sync engine

**Why now**: glues Phase A's write clients to Phase B's enumerator + diff. First phase with end-to-end behaviour.

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `src/core/reverse-sync-engine.ts` | Orchestration engine. Exposes: `publishRepo(opts): Promise<PushResult>` (initial publish — analogous to `cloneRepo`), `pushReverseLink(opts): Promise<PushResult>` (incremental — analogous to `syncRepo`), `resolveReverseLinks(blobClient, container, idOrPrefix)` helper. Wires: `BlobEnumerator → ReverseDiffEngine → RepoWriteClient.createCommit → persist updated ReverseLink`. Honours `onProgress?: (msg: string) => void` callback (NFR7). Pre-flight divergence check via `getBranchTip()`. |
| `tests/unit/reverse-sync-engine.test.ts` | Mocked `RepoWriteClient` + mocked `BlobClient`. Cover initial publish, incremental no-op (NFR5), incremental with added/modified/deleted, `--dry-run` short-circuit, `--force` (re-classify all as modify), divergence error path, per-file failure accumulation in `PushResult.errors` (NFR4). |

### Files to MODIFY

| Path | Symbols | Change |
|---|---|---|
| `src/core/repo-utils.ts` | (append after `buildProviderForLink` at line 17) | Add `buildWriteClientForLink(link: ReverseLink, pat: string): RepoWriteClient` factory. GitHub branch → `new GitHubWriteClient(...)`; `azure-devops` branch → `new DevOpsWriteClient(...)`. |

### Files explicitly OUT-OF-SCOPE for Phase D

- `src/core/sync-engine.ts` (forward engine — untouched, NFR6).
- `src/core/diff-engine.ts` (forward diff — untouched).
- `src/core/github-client.ts`, `src/core/devops-client.ts` (read clients — untouched).
- Everything in `src/cli/**` and `src/electron/**`.

### Dependencies

- **Depends on**: A, B, C.
- **Blocks**: E, F, G.

### Parallel-safety

Phase D runs alone (it's a synthesis layer).

### Acceptance criteria mapping

- AC-A1, AC-A2, AC-A3, AC-A4 (full initial publish semantics).
- AC-A6 (metadata persisted after success).
- AC-A7 (re-run with no changes → zero new commits).
- AC-B1, AC-B2, AC-B3 (add/modify/delete incremental).
- AC-B4 (`--dry-run` short-circuits before write).
- AC-B5 (`--force` re-pushes everything).
- AC-B7 (unchanged blob skipped, NFR5 idempotency).
- AC-E5 (multiple reverse-links coexist per account).

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/reverse-sync-engine.test.ts
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Divergence detected mid-push (TOCTOU between pre-check and PATCH) | `RepoWriteClient.createCommit` already maps PATCH-422/POST-400 to `RemoteDivergedError`. Engine surfaces it unchanged. |
| Storage-account scope iteration: blob listing across many containers may be slow | Stream-process via `enumerateScope` async iterable; do NOT materialise all blobs in memory. |
| `lastPushedTreeSha` is null for ADO (server-side) | Engine never depends on `treeSha` for diff (diff uses `blobSnapshot`); `treeSha` is informational metadata only. |
| Partial failure mid-push (some blobs uploaded, then 401) | Provider-side state may be inconsistent but local `ReverseLink` is **only** persisted after a successful `createCommit` returns. Re-run resumes from last good snapshot. |

---

## Phase E — CLI commands

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `src/cli/commands/reverse-git.ts` | Handler functions: `publishGitHub`, `publishDevOps`, `reverseLinkGitHub`, `reverseLinkDevOps`, `pushReverseLink`, `reverseUnlink`, `listReverseLinks`. Each handler resolves storage + PAT via `resolveStorageEntry` / `resolvePatToken` (unchanged), instantiates `BlobClient`, dispatches to `reverse-sync-engine.ts`, formats output. Tri-state exit codes (0/1/2) per AC-B4 / R10.11. |
| `tests/unit/reverse-git-cli.test.ts` | Smoke tests on argument parsing + exit codes. End-to-end behaviour tested in Phase D's engine tests. |

### Files to MODIFY

| Path | Symbols | Change |
|---|---|---|
| `src/cli/index.ts` | (after `list-links` and `diff` registrations, around line 405+) | Register 7 new Commander subcommands per R10: `publish-github`, `publish-devops`, `reverse-link-github`, `reverse-link-devops`, `push`, `reverse-unlink`, `list-reverse-links`. Each wires to a handler in `reverse-git.ts`. Common options: `--storage`, `--account`, `--account-key`, `--sas-token`, `--token-name`, `--pat`. `publish-*` adds: `--container`, `--prefix`, `--repo`, `--branch`, `--commit-message`, `--exclude <pattern>` (repeatable, `[]` accumulator), `--respect-gitignore` (default true), `--repo-sub-path`, `--visibility public\|private`, `--create-repo`, `--author-name`, `--author-email`. `publish-devops` additionally: `--org`, `--project`. `push` adds: `--dry-run`, `--force`, `--allow-overwrite-remote`, `--all`, `--link-id`, `--container`, `--prefix`. |
| `docs/tools/storage-nav.md` | (existing CLI surface table + new "Reverse Git" subsection) | Document every new subcommand with: synopsis, options, exit codes, examples. Add a "Reverse Git Publication" subsection covering the metadata schema, path-mapping rules, change detection, auto-repo-creation behaviour, security stance, and an explicit "use sparingly" note for storage-account scope (OQ-10). |
| `CLAUDE.md` (project root) | "Tools" section | Update the `storage-nav` entry's high-level description to mention reverse-git publication. No new `<toolName>` block — reverse-git is an extension of `storage-nav`, not a new tool. |
| `Issues - Pending Items.md` (project root) | (add entries) | Register known v1 limitations: Git LFS unsupported; conflict on diverged remote requires manual reconciliation; no event-driven monitoring; storage-account scope is "use sparingly". |

### Files explicitly OUT-OF-SCOPE for Phase E

- `src/cli/commands/repo-sync.ts` (forward clone/sync — untouched).
- `src/cli/commands/link-ops.ts` (forward link CRUD — untouched).
- `src/cli/commands/shared.ts` is **read-only** — reuse `resolveStorageEntry` / `resolvePatToken` / `StorageOpts` / `PatOpts` without modification.
- `src/electron/**`.

### Dependencies

- **Depends on**: D.
- **Blocks**: nothing.
- **Runs parallel with**: F.

### Acceptance criteria mapping

- AC-A1..A8 (publish-github / publish-devops surface).
- AC-B1..B7 (push surface).
- AC-C1..C5 (PAT resolution chain).
- AC-E1..E5 (reverse-link lifecycle commands).
- AC-G1 (`docs/tools/storage-nav.md` documents every new subcommand).
- AC-G4 (`Issues - Pending Items.md` updated).
- AC-H2 (existing CLI subcommands unaffected).

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/reverse-git-cli.test.ts

# Manual smoke (test_scripts):
node dist/cli/index.js publish-github --help
node dist/cli/index.js push --help
node dist/cli/index.js list-reverse-links --help
# Existing commands still register:
node dist/cli/index.js clone-github --help
node dist/cli/index.js sync --help
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| `--exclude <pattern>` repeatable flag conflicts with Commander variadic parsing | Use Commander's `(value, accum) => [...accum, value]` reducer with default `[]`. |
| Storage-account scope handlers must skip `--container` requirement | Handler validates: scope precedence is `--prefix > --container > --storage` (account scope when only `--storage`). |
| User accidentally sets both `--force` and `--allow-overwrite-remote` | Flags are independent (per investigation Dimension 9). Document semantics in `--help` text and `docs/tools/storage-nav.md`. |

---

## Phase F — Server API endpoints

### Files to MODIFY

| Path | Symbols | Change |
|---|---|---|
| `src/electron/server.ts` | (append after the existing "Link Registry API" + "Sync / Links / Diff" sections, ~line 990+) | Add 6 new endpoints per R12: `GET /api/reverse-links/:storage/:container?`, `POST /api/reverse-links/:storage/:container?`, `DELETE /api/reverse-links/:storage/:container?/:linkId`, `POST /api/push/:storage/:container?/:linkId`, `POST /api/push-all/:storage/:container?`, `GET /api/reverse-diff/:storage/:container?/:linkId`. Use `buildWriteClientForLink()` from Phase D's `repo-utils.ts` change. Map error types to HTTP statuses per the error-taxonomy table. Stream progress via `text/event-stream` for `POST /api/push*` endpoints (consistent with existing forward-sync streaming, if any; otherwise plain JSON response is acceptable for v1). |

### Files to CREATE

| Absolute path | Purpose |
|---|---|
| `tests/unit/server-reverse-links.test.ts` | Vitest + supertest-style harness against `createServer`. Cover: list (empty + populated), POST creates + persists, DELETE removes, POST push happy path, POST push divergence → 409, GET reverse-diff returns categorised counts. Mock `reverse-sync-engine.ts` at module boundary. |

### Files explicitly OUT-OF-SCOPE for Phase F

- The existing forward-sync endpoints in `src/electron/server.ts` (untouched).
- OIDC/auth middleware in `src/core/backend/auth/` (untouched).
- `src/electron/site-routes.ts`, `src/electron/zip-download.ts`, `src/electron/oidc-loopback.ts`.

### Dependencies

- **Depends on**: D.
- **Blocks**: G.
- **Runs parallel with**: E.

### Acceptance criteria mapping

- AC-F4 (CLI-written links readable by API, vice versa — same `.reverse-git-links.json`).
- AC-B6 (`--all` push via `/api/push-all`).
- AC-H2 (existing endpoints unaffected).
- AC-G3 (project-functions.md updated).

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/server-reverse-links.test.ts
node -e "import('./dist/electron/server.js').then(m => m.createServer()).then(s => console.log('server ok'))"
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Error-type → HTTP status mapping must be consistent with CLI exit codes | Single helper `mapReverseGitErrorToHttp(err)` co-located with the new endpoint block; cite the taxonomy table from this plan. |
| Long-running pushes time out the HTTP request | For v1 the `POST /api/push` returns when done (typical 1k files ≤ 5 min, NFR2). If timeout becomes a problem in practice, defer streaming to v1.1 (already a known TODO in `Issues - Pending Items.md`). |
| Server endpoints duplicate logic from CLI handlers | Keep handlers thin — they only adapt HTTP I/O and call `reverse-sync-engine.ts`. No business logic in `server.ts`. |

---

## Phase G — Electron UI

### Files to MODIFY

| Path | Sections | Change |
|---|---|---|
| `src/electron/public/index.html` | `#container-context-menu` (line 261), `#folder-context-menu` (line 253) | Add menu items: `ctx-publish-container`, `ctx-view-reverse-links` (on container); `ctx-publish-folder` (on folder). Add new storage-account context menu `#storage-account-context-menu` with `ctx-publish-storage-account`. |
| `src/electron/public/index.html` | (append after `#links-panel-modal` line 222) | Add two new modals: `#publish-modal` (per R11.2: provider select, repo input, branch, repoSubPath, exclusion textarea, respect-gitignore checkbox, visibility radio, token selector, commit message override, "Publish Only" / "Publish & Push Now" / "Cancel" buttons); `#reverse-links-panel-modal` (per R11.4: table of reverse-links with per-row "Push Now", "Dry-Run Diff", "Unlink" actions; push-progress indicator; results summary). |
| `src/electron/public/app.js` | `openLinksPanel()` (line 1645) sibling | Add `openReverseLinksPanel()` mirroring the forward panel. Add `openPublishModal()` to drive the publish wizard. Wire all new context-menu items. Add token-selector population (calls existing `/api/tokens?provider=github`/`azure-devops`). Errors surfaced inline (no `alert()`). |
| `src/electron/public/app.js` | `.sync-badge` / `.link-badge` rendering (lines 564–578) | Add `.reverse-link-badge` rendering on storage-account / container / folder nodes that have ≥1 reverse-link. Visually distinct from forward `.link-badge` (different icon/colour — e.g., outbound arrow vs inbound). |
| `src/electron/public/styles.css` (if exists) | (append) | `.reverse-link-badge` styles. |

### Files to CREATE

None — UI is JS-only, no new modules.

### Files explicitly OUT-OF-SCOPE for Phase G

- `src/electron/main.ts` (Electron shell — untouched).
- `src/electron/oidc-loopback.ts`, `src/electron/site-routes.ts`, `src/electron/zip-download.ts`.
- Existing forward-direction UI (Links Panel, sync modal) — untouched (NFR6, AC-H2).

### Dependencies

- **Depends on**: F.
- **Blocks**: nothing.

### Parallel-safety

Phase G runs alone (final phase).

### Acceptance criteria mapping

- AC-F1 (CLI ↔ UI parity).
- AC-F2 (visual indicator distinct from forward).
- AC-F3 (inline errors, success toasts).
- AC-G2 (project-design.md updated with "Reverse Git Publication" section — do this at completion of Phase G).

### Verification

```bash
# Build and launch:
npm run build
npx electron .

# Manual UI walkthrough (in test_scripts/, document as 011-reverse-git-ui-smoke.md):
# 1. Right-click container → "Publish to Git Repository…" → fill modal → "Publish & Push Now" → toast shows added/modified/deleted counts.
# 2. Right-click container → "Reverse Links…" → see populated table.
# 3. Per-link "Dry-Run Diff" shows counts without pushing.
# 4. Per-link "Push Now" pushes and updates the indicator.
# 5. Per-link "Unlink" removes from table.
# 6. Verify storage-account node now shows the reverse-link badge.
# 7. Existing forward Links Panel still works (open Links Panel from container menu).
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| No existing context menu on storage-account tree node | Create a new menu `#storage-account-context-menu`. Wire via `contextmenu` listener on the storage-account tree node element. |
| Token-selector population race (modal opens before `/api/tokens` returns) | Fetch tokens on modal-open, show "loading…" placeholder, then populate. Disable "Publish" button until at least one token exists. |
| Large modal form on small Electron windows | Use existing modal-scrolling pattern from the forward Link modal. |
| `alert()` slipping in during error handling | Lint check during Phase G review: `grep -n "alert(" src/electron/public/app.js` must show only pre-existing call sites, none added by this plan. |

---

## Cross-phase verification (final integration)

Run AFTER all 7 phases land:

```bash
cd /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git

# AC-H1: compilation
npx tsc --noEmit

# Full test suite
npx vitest run

# AC-H2 regression: forward-sync commands still work
node dist/cli/index.js clone-github --help
node dist/cli/index.js sync --help
node dist/cli/index.js link-github --help
node dist/cli/index.js diff --help

# AC-H3: existing metadata blobs untouched
# (manual — run an existing forward link, confirm .repo-links.json still readable)

# Dependency-vetting audit (should be zero new deps; report should be unchanged)
npm audit --omit=dev
```

Update `docs/design/project-design.md` with a new "Reverse Git Publication" section citing this plan and the four provenance files.

Mark plan-011 done in `Issues - Pending Items.md` when all of the above pass.

---

## Out-of-scope reminders (project-wide)

Per refined-request §"Out of scope":

- Bidirectional sync (no pulling repo → storage in the reverse direction beyond what forward-sync already does).
- Continuous background monitoring / Event Grid / blob change feed.
- Branch management beyond the configured branch per reverse-link.
- Conflict resolution on diverged remote (fail-closed only).
- Git LFS.
- GPG-signed commits.
- SSH-based remote Git providers for reverse direction.
- Blob metadata preservation (content-type, custom metadata, tier) inside the repo.
- Blob snapshot / version history.

Track each in `Issues - Pending Items.md` as a "v2 enhancement".
