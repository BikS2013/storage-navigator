---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-a-write-clients
language: typescript
framework: vitest
test_command_full: "npx vitest run"
test_command_scope: "npx vitest run tests/unit/github-write-client.test.ts tests/unit/devops-write-client.test.ts --reporter=verbose"
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/github-write-client.test.ts
  - tests/unit/devops-write-client.test.ts
tests_added: 68
tests_updated: 0
tests_run: 68
tests_passed: 68
tests_failed: 0
implementation_gaps: 0
built_at: "2026-06-01T19:33:20Z"
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-A Reverse-Git Write Clients

## 1. Summary

Status: **completed**. Framework: vitest 4.1.5. Two new test files were created covering all `RepoWriteClient` methods on both `GitHubWriteClient` and `DevOpsWriteClient`. 68 tests were added; all 68 passed with zero failures and zero type-checking diagnostics. No production source was modified. No shared test infrastructure was touched.

## 2. Scope Resolved

Scope files:

- `src/core/github-write-client.ts` — `GitHubWriteClient`, `parseGitHubRepoUrl`
- `src/core/devops-write-client.ts` — `DevOpsWriteClient`, `parseDevOpsRepoUrl`

Public symbols exercised:

| File | Symbol |
|---|---|
| `github-write-client.ts` | `parseGitHubRepoUrl`, `GitHubWriteClient` (constructor, `fromRepoUrl`, `ensureRepo`, `getOrCreateRepo`, `getBranchTip`, `getCurrentRefSha`, `createCommit`, `pushChanges`, `listRepoFiles`, `bootstrapEmpty`) |
| `devops-write-client.ts` | `parseDevOpsRepoUrl`, `DevOpsWriteClient` (constructor, `fromRepoUrl`, `ensureRepo`, `getOrCreateRepo`, `getBranchTip`, `getCurrentRefSha`, `createCommit`, `pushChanges`, `listRepoFiles`, `bootstrapEmpty`, `getRepoId`) |

## 3. Existing Coverage

No prior test files reference `GitHubWriteClient` or `DevOpsWriteClient`. The `tests/unit/` directory contained 21 files covering forward-direction features (backend, credential store, diff, zip) — none touching reverse-git write clients.

Symbol → existing test files: *none for any in-scope symbol.*

## 4. Plan

### github-write-client.ts

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `parseGitHubRepoUrl` | unit | github-write-client.test.ts | parses https URL with .git suffix | Verifies HTTPS URL parsing strips .git |
| `parseGitHubRepoUrl` | unit | github-write-client.test.ts | parses https URL without .git suffix | Verifies HTTPS URL without extension |
| `parseGitHubRepoUrl` | unit | github-write-client.test.ts | parses SSH URL | Verifies git@ URL form |
| `parseGitHubRepoUrl` | unit | github-write-client.test.ts | parses bare owner/repo string | Verifies bare slug form |
| `parseGitHubRepoUrl` | error_path | github-write-client.test.ts | throws on invalid string | Verifies error on non-parseable input |
| `ensureRepo` | unit | github-write-client.test.ts | resolves when repo already exists (HTTP 200) | 200 → no-op |
| `ensureRepo` | error_path | github-write-client.test.ts | throws RepoNotFoundError on 404 when createIfMissing=false | 404 without create flag |
| `ensureRepo` | unit | github-write-client.test.ts | auto-creates via POST /user/repos with auto_init:true when 404 + createIfMissing=true | Verifies auto_init payload |
| `ensureRepo` | unit | github-write-client.test.ts | routes to /orgs/{org}/repos when authenticated user != owner | Org repo routing |
| `ensureRepo` | error_path | github-write-client.test.ts | throws InvalidPATError on 401 | PAT validation |
| `getOrCreateRepo` | unit | github-write-client.test.ts | getOrCreateRepo is an alias for ensureRepo | Alias delegation |
| `getBranchTip` | unit | github-write-client.test.ts | returns commitSha and treeSha on success | Happy path |
| `getBranchTip` | unit | github-write-client.test.ts | returns null when branch not found (404) | Missing branch |
| `getBranchTip` | unit | github-write-client.test.ts | returns null when repo is empty (409) | Empty repo sentinel |
| `getCurrentRefSha` | unit | github-write-client.test.ts | getCurrentRefSha returns commitSha when branch exists | Synonym delegation |
| `getCurrentRefSha` | unit | github-write-client.test.ts | getCurrentRefSha returns null when branch absent | Null propagation |
| `createCommit` | unit | github-write-client.test.ts | uploads blobs as base64 (encoding field) | base64 encoding assertion |
| `createCommit` | unit | github-write-client.test.ts | splits into 2 tree POST calls when 750 entries supplied | Tree chunk threshold = 700 |
| `createCommit` | regression | github-write-client.test.ts | throws RemoteDivergedError when PATCH /git/refs returns 422 not-fast-forward | Divergence → typed error |
| `createCommit` | unit | github-write-client.test.ts | POSTs a new ref when getBranchTip returns null (branch absent after commit) | POST vs PATCH ref routing |
| `createCommit` | error_path | github-write-client.test.ts | accumulates per-file 422 too-large errors without throwing | Non-fatal per-file blob error |
| `pushChanges` | unit | github-write-client.test.ts | pushChanges delegates to createCommit and returns same result | Alias delegation |
| `createCommit` | unit | github-write-client.test.ts | returns early with parentCommitSha when changes is empty | Empty changes short-circuit |
| `listRepoFiles` | unit | github-write-client.test.ts | returns only blob-type paths | Tree-type filtering |
| `listRepoFiles` | unit | github-write-client.test.ts | returns empty array when branch is absent (404) | Missing branch |
| `listRepoFiles` | unit | github-write-client.test.ts | returns empty array when repo is empty (409) | Empty repo |
| `listRepoFiles` | error_path | github-write-client.test.ts | throws GitHubApiError when tree is truncated | Truncation guard |
| `bootstrapEmpty` | unit | github-write-client.test.ts | is a no-op when branch already exists | Strategy A path |
| `bootstrapEmpty` | unit | github-write-client.test.ts | PUTs .gitkeep via Contents API when branch is absent | Strategy B fallback |
| Constructor | config_validation | github-write-client.test.ts | throws when PAT / owner / repo is empty | Missing config raises |
| Constructor | unit | github-write-client.test.ts | fromRepoUrl builds client from https URL | Static factory |
| auth header | unit | github-write-client.test.ts | sends Bearer token in Authorization header | Header shape |

### devops-write-client.ts

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `parseDevOpsRepoUrl` | unit | devops-write-client.test.ts | parses dev.azure.com URL | Standard URL form |
| `parseDevOpsRepoUrl` | unit | devops-write-client.test.ts | parses legacy visualstudio.com URL | Legacy URL form |
| `parseDevOpsRepoUrl` | error_path | devops-write-client.test.ts | throws on invalid URL | Error on non-ADO URL |
| `parseDevOpsRepoUrl` | unit | devops-write-client.test.ts | URL-decodes percent-encoded segments | Encoding correctness |
| `ensureRepo` | unit | devops-write-client.test.ts | resolves and stores repoId on 200 | UUID stored |
| `ensureRepo` | error_path | devops-write-client.test.ts | throws RepoNotFoundError on 404 when createIfMissing=false | 404 without create |
| `ensureRepo` | unit | devops-write-client.test.ts | auto-creates repo when 404 + createIfMissing=true | Auto-creation path |
| `ensureRepo` | error_path | devops-write-client.test.ts | throws InvalidPATError on 401 | PAT validation |
| `getOrCreateRepo` | unit | devops-write-client.test.ts | getOrCreateRepo is an alias for ensureRepo | Alias delegation |
| `getBranchTip` | unit | devops-write-client.test.ts | returns commitSha from matching ref entry | Happy path; treeSha always null |
| `getBranchTip` | unit | devops-write-client.test.ts | returns null when branch not in ref list | Missing branch |
| `getBranchTip` | unit | devops-write-client.test.ts | returns null on 404 | 404 sentinel |
| `getCurrentRefSha` | unit | devops-write-client.test.ts | getCurrentRefSha returns commitSha / null | Synonym delegation |
| `createCommit` | unit | devops-write-client.test.ts | sends a single POST /git/pushes with refUpdates + commits + changes | Single-shot payload shape |
| `createCommit` | unit | devops-write-client.test.ts | uses 40-zeros oldObjectId when parentCommitSha is null | Initial commit sentinel |
| `createCommit` | unit | devops-write-client.test.ts | splits into 2 pushes when 600 changes supplied (chunk=500) | Chunked push; chain newObjectId |
| `createCommit` | regression | devops-write-client.test.ts | throws RemoteDivergedError on 400 + GitRefUpdateNeedsForcePermissionException | Divergence → typed error |
| `createCommit` | regression | devops-write-client.test.ts | throws RemoteDivergedError on 400 with oldObjectId did not match message | Alternative divergence message |
| `createCommit` | unit | devops-write-client.test.ts | encodes all non-delete content as base64encoded | contentType field assertion |
| `createCommit` | unit | devops-write-client.test.ts | delete entry has changeType=delete and no newContent | Delete entry shape |
| `createCommit` | unit | devops-write-client.test.ts | returns early with parentCommitSha when changes is empty | Empty changes short-circuit |
| `pushChanges` | unit | devops-write-client.test.ts | pushChanges delegates to createCommit | Alias delegation |
| `listRepoFiles` | unit | devops-write-client.test.ts | returns blob paths with leading slashes stripped | Path normalisation |
| `listRepoFiles` | unit | devops-write-client.test.ts | returns empty array on 404 | Missing branch |
| `bootstrapEmpty` | unit | devops-write-client.test.ts | returns without making any fetch call | No-op contract |
| auth header | unit | devops-write-client.test.ts | sends Basic base64(':' + pat) on every request | Basic auth header shape |
| Constructor | config_validation | devops-write-client.test.ts | throws when PAT / org / project / repo is empty | Missing config raises |
| Constructor | unit | devops-write-client.test.ts | fromRepoUrl builds client from dev.azure.com URL | Static factory |
| requireRepoId guard | error_path | devops-write-client.test.ts | getBranchTip / listRepoFiles throw before ensureRepo | Guard correctness |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/unit/github-write-client.test.ts` | new — no prior coverage existed |
| `tests/unit/devops-write-client.test.ts` | new — no prior coverage existed |

## 6. Test Run Results

Run command: `npx vitest run tests/unit/github-write-client.test.ts tests/unit/devops-write-client.test.ts --reporter=verbose`

Exit code: 0

```
 Test Files  2 passed (2)
      Tests  68 passed (68)
   Start at  19:33:20
   Duration  7.68s (transform 81ms, setup 0ms, import 100ms, tests 7.57s)
```

All 68 tests passed. No failures.

Notable timing: the tree-chunking test for 750 entries took ~7.5 s because it synthesises 750 `fakeResponse` calls sequentially. The test carries `{ timeout: 15_000 }` to account for this on slower CI machines.

## 7. Implementation Gaps

None. All tests reflect the actual behaviour of the implementation. No acceptance-criterion violations were found.

## 8. Manual Review Needed

None. No shared infrastructure (`vitest.config.ts`, `tsconfig.json`, `tests/__init__`) was touched. All test isolation is achieved inside each test file using `vi.stubGlobal` / `vi.restoreAllMocks`.

**Note on vitest.config.ts**: The config's `test.include` pattern is `['tests/**/*.test.ts', ...]`. Both new files match `tests/unit/*.test.ts` and are therefore picked up automatically by both `vitest run` (full suite) and the scope-only invocation. No config change was needed or made.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/unit/github-write-client.test.ts tests/unit/devops-write-client.test.ts --reporter=verbose` | 0 |
