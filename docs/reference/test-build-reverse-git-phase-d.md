---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-d
language: typescript
framework: vitest
test_command_full: "npx vitest run"
test_command_scope: "npx vitest run tests/unit/reverse-sync-engine.test.ts"
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/reverse-sync-engine.test.ts
tests_added: 34
tests_updated: 0
tests_run: 34
tests_passed: 34
tests_failed: 0
implementation_gaps: 0
built_at: "2026-06-01T16:40:34Z"
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-D Reverse-Sync Engine

## 1. Summary

Status: completed. Framework: Vitest 4.1.5, TypeScript. A new test file (`tests/unit/reverse-sync-engine.test.ts`) was created with 34 tests covering the Phase-D orchestration engine (`src/core/reverse-sync-engine.ts`) and the `buildWriteClientForLink` factory in `src/core/repo-utils.ts`. All 34 tests pass. Zero implementation gaps detected. The pre-existing `tests/unit/reverse-git-cli.test.ts` had 34 failing tests before and after this work (confirmed via `git stash` isolation) — those failures are outside this agent's scope.

## 2. Scope Resolved

**Source files tested:**

- `src/core/reverse-sync-engine.ts` — Public symbols:
  - `initReverseLink(opts)` — create + persist a ReverseLink record
  - `pushReverseLink(linkId, opts)` — enumerate → diff → push → persist
  - `previewReverseDiff(linkId, opts)` — enumerate → diff only (no push)
  - `removeReverseLink(linkId, opts)` — drop link record (no remote touch)
  - `listReverseLinks(scope, opts)` — enumerate persisted links
  - `resolveReverseLinks(opts)` — fan-out helper (covered via listReverseLinks tests)
  - `publishRepo(opts)` — alias for pushReverseLink (not separately tested; delegates to pushReverseLink which is fully covered)

- `src/core/repo-utils.ts` — Symbol in scope:
  - `buildWriteClientForLink(link, pat)` — provider-dispatch factory

## 3. Existing Coverage

Before this build, no test file covered any symbol in `src/core/reverse-sync-engine.ts` or the `buildWriteClientForLink` function in `src/core/repo-utils.ts`. The existing 21 test files in `tests/unit/` cover backend, credential store, diff, zip, and other unrelated forward-sync modules.

| Symbol | Existing test files |
|---|---|
| `initReverseLink` | None |
| `pushReverseLink` | None |
| `previewReverseDiff` | None |
| `removeReverseLink` | None |
| `listReverseLinks` | None |
| `buildWriteClientForLink` | None |

## 4. Plan

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `buildWriteClientForLink` | unit | reverse-sync-engine.test.ts | returns a write client for a github link | Verifies factory produces a RepoWriteClient with github provider |
| `buildWriteClientForLink` | unit | reverse-sync-engine.test.ts | passes the correct PAT to the factory for azure-devops | Verifies azure-devops dispatch |
| `initReverseLink` | unit | reverse-sync-engine.test.ts | creates container-scope link and persists via blob registry | Confirms createReverseLink is called with correct container + link data |
| `initReverseLink` | unit | reverse-sync-engine.test.ts | creates account-scope link and persists via CredentialStore | Confirms writeAccountReverseLinks called with correct account + link |
| `initReverseLink` | unit | reverse-sync-engine.test.ts | with createRepo:true calls ensureRepo(createIfMissing:true) | Verifies getOrCreateRepo path (AC-A5) |
| `initReverseLink` | unit | reverse-sync-engine.test.ts | without createRepo:true does NOT call the write client | Verifies no-op on remote when createRepo=false |
| `initReverseLink` | unit | reverse-sync-engine.test.ts | passes patOverride through to write client factory | AC-C3 compliance |
| `initReverseLink` | error_path | reverse-sync-engine.test.ts | throws when duplicate id already exists | Registry conflict propagated |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | dryRun returns diff + pushed=false + NO createCommit | AC-B4: dry-run performs zero remote writes |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | dry-run with zero changes returns pushed=false | AC-B4 edge case |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | pushes commit + persists blobSnapshot + lastPushedCommitSha + lastPushResult | R3.6 / R4.6 compliance |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | no-op push (zero changes) returns pushed=false, no createCommit | NFR5 idempotency |
| `pushReverseLink` | regression | reverse-sync-engine.test.ts | throws RemoteDivergedError BEFORE createCommit when remote SHA differs | A8 / Divergence pre-check fires before any write |
| `pushReverseLink` | regression | reverse-sync-engine.test.ts | does NOT throw with allowOverwriteRemote:true even if SHA differs | `--force-overwrite` path |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | RemoteDivergedError carries localKnownSha + remoteActualSha | Error payload carries diagnostic SHAs |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | patOverride: buildWriteClientForLink receives inline token | AC-C3: inline --pat takes precedence |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | uses getReverseLinkPAT as step-1 when no patOverride | PAT chain step 1 |
| `pushReverseLink` | config_validation | reverse-sync-engine.test.ts | throws ConfigurationError when no PAT resolvable | AC-C4: no silent fallback |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | per-file errors subtracted from added/modified/deleted into skipped | NFR4: per-file failures do not abort |
| `pushReverseLink` | unit | reverse-sync-engine.test.ts | all files in error: skipped=all, added=[] | NFR4 edge case |
| `pushReverseLink` | error_path | reverse-sync-engine.test.ts | throws ConfigurationError for ghost link id | Link-not-found error path |
| `previewReverseDiff` | unit | reverse-sync-engine.test.ts | returns diff without calling any write-client method | Design §5.5: preview does no remote I/O |
| `previewReverseDiff` | error_path | reverse-sync-engine.test.ts | throws ConfigurationError when link not found | Link-not-found error path |
| `removeReverseLink` | unit | reverse-sync-engine.test.ts | removes container-scope link — write client NEVER called | AC-E3: remote repo is untouched |
| `removeReverseLink` | unit | reverse-sync-engine.test.ts | removes account-scope link via writeAccountReverseLinks | AC-E3 for account scope |
| `removeReverseLink` | error_path | reverse-sync-engine.test.ts | throws ConfigurationError when link not found | Error path |
| `listReverseLinks` | unit | reverse-sync-engine.test.ts | account scope returns links from readAccountReverseLinks | Account-scope registry path |
| `listReverseLinks` | unit | reverse-sync-engine.test.ts | container scope returns links from container registry | Container-scope blob registry path |
| `listReverseLinks` | unit | reverse-sync-engine.test.ts | prefix scope filters by exact prefix | Prefix-scope filter |
| `listReverseLinks` | unit | reverse-sync-engine.test.ts | all-accounts pattern yields combined links | AC-E5: multiple accounts independently listable |
| `ConfigurationError` | unit | reverse-sync-engine.test.ts | exitCode=3, httpStatus=400, code='CONFIG_MISSING' | Error taxonomy contract |
| `RemoteDivergedError` | unit | reverse-sync-engine.test.ts | exitCode=2, httpStatus=409, code='REMOTE_DIVERGED' | Error taxonomy contract |
| `RemoteDivergedError` | unit | reverse-sync-engine.test.ts | default message includes both SHAs | Diagnostic payload |
| `RemoteDivergedError` | unit | reverse-sync-engine.test.ts | accepts explicit message override | Constructor override |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/unit/reverse-sync-engine.test.ts` | New — no existing file covered this scope |

## 6. Test Run Results

```
 RUN  v4.1.5

 Test Files  1 passed (1)
      Tests  34 passed (34)
   Start at  2026-06-01T16:40:34Z
   Duration  162ms (transform 55ms, setup 0ms, import 71ms, tests 9ms)
```

All 34 tests in scope passed. No failures.

### Mock architecture note

`pushReverseLink` and `previewReverseDiff` call the private `lookupLinkById` helper which uses `collectAccountNames` — a function that reads `store.data?.reverseLinks?.byAccount` directly (not via any public method). For engine-level unit tests, links are injected via a `makeCredStoreWithLink` helper that populates this internal field AND configures the `readAccountReverseLinks` mock to dispatch by account key. This is a documented test-only artifact; production code does not depend on the mock arrangement.

## 7. Implementation Gaps

None. All tested code paths produce the expected outputs.

## 8. Manual Review Needed

**Async generator mock for `enumerateScope`:** Each test call resets `mockEnumerateScope.mockReturnValue(...)` with a new `(async function* () { yield* []; })()` expression. An async generator is a single-use iterator. Resetting per-test in `beforeEach` prevents state leakage. If the engine were ever to call `enumerateScope` more than once per push, this mock would need to be a factory. Currently the engine calls it exactly once per `pushReverseLink` / `previewReverseDiff` invocation, so the approach is safe.

**`reverse-git-cli.test.ts` pre-existing failures:** This file has 34 failing tests that pre-date this build (confirmed with `git stash` isolation). Those tests are outside `test_files_owned` for this agent. A separate test-build pass for Phase-F (CLI commands) should own that file.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/unit/reverse-sync-engine.test.ts` (initial attempt — hoisting error) | 1 |
| 2 | `npx vitest run tests/unit/reverse-sync-engine.test.ts` (after vi.hoisted fix) | 1 |
| 3 | `npx vitest run tests/unit/reverse-sync-engine.test.ts` (after 2-arg mock fix for readAccountReverseLinks) | 1 |
| 4 | `npx vitest run tests/unit/reverse-sync-engine.test.ts` (after null tokenByProvider fix) | 0 |
| 5 | `git stash && npx vitest run tests/unit/reverse-git-cli.test.ts && git stash pop` (baseline verification) | 1 (pre-existing 34 failures) |
| 6 | `npx vitest run tests/unit/reverse-sync-engine.test.ts` (final scope-only run) | 0 |
