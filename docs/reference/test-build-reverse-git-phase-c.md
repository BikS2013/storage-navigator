---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-c
language: typescript
framework: vitest
test_command_full: "vitest run"
test_command_scope: "npx vitest run tests/unit/reverse-git-errors.test.ts tests/unit/reverse-link-registry.test.ts tests/unit/credential-store-reverse-links.test.ts"
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/reverse-git-errors.test.ts
  - tests/unit/reverse-link-registry.test.ts
  - tests/unit/credential-store-reverse-links.test.ts
tests_added: 100
tests_updated: 0
tests_run: 100
tests_passed: 100
tests_failed: 0
implementation_gaps: 0
built_at: "2026-06-01T16:33:20Z"
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-C Reverse-Git Foundation (typed errors + link registry)

## 1. Summary

Status: completed. Framework: Vitest 4.1.5. Three new test files were created covering the typed error classes (`src/core/reverse-git-errors.ts`), the reverse-link registry CRUD (`src/core/reverse-link-registry.ts`), and the five new `CredentialStore` methods (`src/core/credential-store.ts`). All 100 tests passed with 0 failures and 0 implementation gaps. No production source was modified.

## 2. Scope Resolved

### `src/core/reverse-git-errors.ts`
- `ReverseGitError` (abstract base)
- `RepoNotFoundError` — exitCode 2, httpStatus 404
- `RemoteDivergedError` — exitCode 2, httpStatus 409, fields `localKnownSha` / `remoteActualSha`
- `InsufficientScopesError` — exitCode 2, httpStatus 403
- `PayloadTooLargeError` — exitCode 2, httpStatus 413
- `RateLimitExceededError` — exitCode 2, httpStatus 503
- `InvalidPATError` / `AuthenticationError` alias — exitCode 2, httpStatus 401
- `GitHubApiError` — exitCode 2, httpStatus 502, field `status`
- `GitHubEmptyRepoError` — code override `GITHUB_EMPTY_REPO`, inherits exitCode 2
- `GitHubBlobTooLargeError` — code override `GITHUB_BLOB_TOO_LARGE`, exitCode 1, httpStatus 200 (non-fatal)
- `DevOpsApiError` — exitCode 2, httpStatus 502, fields `status` / `typeKey`
- `PathCollisionError` — exitCode 2, httpStatus 422, field `collidingPaths`
- `ConfigurationError` — exitCode 3, httpStatus 400
- `mapReverseGitErrorToHttp` — translates any thrown value to `{ status, body }`

### `src/core/reverse-link-registry.ts`
- `readReverseLinks` — reads or defaults to empty registry
- `writeReverseLinks` — serialises to well-known blob name
- `createReverseLink` — appends, rejects duplicate IDs
- `removeReverseLink` — removes by ID, returns bool, no-op semantics
- `findReverseLink` — looks up by ID, returns null when absent
- `updateReverseLink` — replaces by ID, returns bool
- `readAccountReverseLinks` — delegates to `CredentialStore.getAccountReverseLinks`
- `writeAccountReverseLinks` — delegates to `CredentialStore.setAccountReverseLinks`

### `src/core/credential-store.ts` — new reverse-git methods
- `getAccountReverseLinks` — returns `[]` on missing field (backward compat)
- `setAccountReverseLinks` — lazy-initialises `reverseLinks`, disk-persists, account-isolated
- `getReverseLinkPAT` — returns `undefined` (no fallback) when binding or token is absent
- `addReverseLinkPATBinding` — idempotent rebind, no duplicates
- `removeReverseLinkPATBinding` — returns bool, graceful when field absent

## 3. Existing Coverage

None. Prior to this build, `tests/unit/` had 21 test files covering backend, credential store (migration, trust), diff, zip, and site routes — none touching any `reverse-git-*` symbol. The existing `credential-store.ts` tests (`credential-migration.test.ts`, `credential-trust.test.ts`) exercise unrelated methods and were not modified.

## 4. Plan

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `RepoNotFoundError` | unit | reverse-git-errors.test.ts | has correct code, exitCode, httpStatus | Proves constructing with a message yields expected code/exit/status triple |
| `RemoteDivergedError` | unit | reverse-git-errors.test.ts | stores localKnownSha and remoteActualSha | Proves diagnostic fields are preserved on the thrown object |
| `RemoteDivergedError` | unit | reverse-git-errors.test.ts | generates a default message when none supplied | Proves default message includes both SHAs |
| `GitHubBlobTooLargeError` | unit | reverse-git-errors.test.ts | overrides code, exitCode, and httpStatus | Proves the non-fatal specialisation overrides exitCode to 1 and httpStatus to 200 |
| `AuthenticationError` | unit | reverse-git-errors.test.ts | is exported as AuthenticationError alias | Proves alias is instanceof InvalidPATError with same code |
| `mapReverseGitErrorToHttp` | unit | reverse-git-errors.test.ts | returns error.httpStatus and code for ReverseGitError subclass | Proves per-class translation is consistent |
| `mapReverseGitErrorToHttp` | error_path | reverse-git-errors.test.ts | wraps a plain Error as 500 with no code field | Proves non-ReverseGitError errors produce a 500 without leaking a code |
| `mapReverseGitErrorToHttp` | error_path | reverse-git-errors.test.ts | body never leaks a code key for non-ReverseGitError | Structural assertion — no spurious code field |
| All classes | unit | reverse-git-errors.test.ts | prototype chain preservation (throw/catch) | Proves `instanceof ReverseGitError` survives throw/catch after `Object.setPrototypeOf` |
| `readReverseLinks` | unit | reverse-link-registry.test.ts | returns schemaVersion:1, links:[] when registry blob is absent | Proves "no metadata yet" === "empty metadata" semantics |
| `readReverseLinks` | error_path | reverse-link-registry.test.ts | returns empty registry on JSON parse error | Proves corrupt blob does not crash the caller |
| `readReverseLinks` | unit | reverse-link-registry.test.ts | heals a hand-edited blob missing links field | Proves defensive field healing |
| `writeReverseLinks` | unit | reverse-link-registry.test.ts | round-trips through readReverseLinks | Proves write → read produces identical data |
| `createReverseLink` | unit | reverse-link-registry.test.ts | adds a new link to an empty registry | Basic create behaviour |
| `createReverseLink` | error_path | reverse-link-registry.test.ts | throws when a link with the same id already exists | Proves ID collision detection |
| `removeReverseLink` | unit | reverse-link-registry.test.ts | returns true and removes the targeted link | Successful remove |
| `removeReverseLink` | unit | reverse-link-registry.test.ts | returns false when the id does not exist (no-op) | No-op semantics |
| `removeReverseLink` | unit | reverse-link-registry.test.ts | does NOT rewrite the blob on a no-op remove | Proves ETag churn avoidance |
| `findReverseLink` | unit | reverse-link-registry.test.ts | returns the link when found | Happy path |
| `findReverseLink` | unit | reverse-link-registry.test.ts | returns null when not found | Null-not-throw contract |
| `updateReverseLink` | unit | reverse-link-registry.test.ts | returns true and updates the stored link | Proves blobSnapshot/commitSha fields update |
| `updateReverseLink` | unit | reverse-link-registry.test.ts | does not add a new link when id is absent | Proves no phantom insertion |
| `readAccountReverseLinks` / `writeAccountReverseLinks` | unit | reverse-link-registry.test.ts | isolates different account names | Proves per-account key separation |
| `getAccountReverseLinks` | unit | credential-store-reverse-links.test.ts | returns [] on fresh store | Backward compat: missing field → empty, no crash |
| `getAccountReverseLinks` | unit | credential-store-reverse-links.test.ts | returns a copy — mutating result does not affect stored data | Proves defensive copy |
| `setAccountReverseLinks` | unit | credential-store-reverse-links.test.ts | round-trips through save/load (disk persistence) | Proves AES-256-GCM encrypt/decrypt cycle |
| `setAccountReverseLinks` | unit | credential-store-reverse-links.test.ts | does not disturb existing tokens when writing reverseLinks | Proves no clobber of adjacent data |
| `addReverseLinkPATBinding` | unit | credential-store-reverse-links.test.ts | rebinding the same linkId replaces previous tokenName (idempotent) | Proves no duplicate entries |
| `addReverseLinkPATBinding` | unit | credential-store-reverse-links.test.ts | does not create duplicate binding entries | Direct count assertion on private field |
| `getReverseLinkPAT` | config_validation | credential-store-reverse-links.test.ts | returns undefined when no binding exists (no fallback) | Proves the no-fallback rule: caller gets undefined, not a default |
| `getReverseLinkPAT` | config_validation | credential-store-reverse-links.test.ts | returns undefined when binding exists but tokenName resolves to nothing | Missing token → undefined (no crash) |
| `getReverseLinkPAT` | unit | credential-store-reverse-links.test.ts | returns undefined after the bound token is removed | Token removal properly invalidates existing binding |
| `removeReverseLinkPATBinding` | unit | credential-store-reverse-links.test.ts | returns false when no binding exists (graceful no-op) | Graceful when field is absent |
| `removeReverseLinkPATBinding` | unit | credential-store-reverse-links.test.ts | removes only the targeted binding, leaving others intact | Surgical removal |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/unit/reverse-git-errors.test.ts` | new — covers `reverse-git-errors.ts` (all 12 concrete classes + `mapReverseGitErrorToHttp`) |
| `tests/unit/reverse-link-registry.test.ts` | new — covers `reverse-link-registry.ts` CRUD with an in-memory stub BlobClient and StubCredentialStore |
| `tests/unit/credential-store-reverse-links.test.ts` | new — covers the 5 new `CredentialStore` methods with filesystem-isolated temp dirs |

## 6. Test Run Results

```
 RUN  v4.1.5 /Users/.../storage-navigator-reverse-git

 Test Files  3 passed (3)
      Tests  100 passed (100)
   Start at  19:33:15
   Duration  151ms (transform 84ms, setup 0ms, import 110ms, tests 25ms)
```

All 100 tests passed. Zero failures. Zero skipped.

## 7. Implementation Gaps

None. Every tested symbol behaves exactly as specified in `reverse-git-errors.ts`, `reverse-link-registry.ts`, and `credential-store.ts`.

## 8. Manual Review Needed

None. No shared test infrastructure (`vitest.config.ts`, `tsconfig.test.json`, `tsconfig.json`) was modified or needed modification. The existing `vitest.config.ts` already includes `tests/**/*.test.ts` so the three new files are picked up automatically without any config change.

Note: `vitest.config.ts` does not configure `dangerouslyIgnoreUnhandledErrors` or `onUnhandledRejection`. Async tests in these files all explicitly `await` every Promise, so unhandled rejections are not a concern for this scope. No action required.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/unit/reverse-git-errors.test.ts tests/unit/reverse-link-registry.test.ts tests/unit/credential-store-reverse-links.test.ts` | 0 |
