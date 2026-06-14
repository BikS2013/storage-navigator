---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-f-express-endpoints
language: typescript
framework: vitest
test_command_full: "npx vitest run"
test_command_scope: "npx vitest run tests/unit/reverse-git-routes.test.ts"
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/reverse-git-routes.test.ts
tests_added: 44
tests_updated: 0
tests_run: 44
tests_passed: 44
tests_failed: 0
implementation_gaps: 0
built_at: 2026-06-01T19:35:00Z
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-F Reverse-Git Express Endpoints

## 1. Summary

Status: **completed**. All 44 new tests pass (0 failures, 0 implementation gaps). Framework: Vitest 4.1.5 with supertest 7.2.2. One new test file was created (`tests/unit/reverse-git-routes.test.ts`) covering all 6 Phase-F reverse-git Express routes registered in `src/electron/server.ts`. Engine imports are fully mocked so no real Azure or Git network calls occur. The only notable fix during test development was that Vitest 4 requires constructor mocks to be real `class` definitions rather than arrow-function stubs — `BlobClient` was mocked with a `class MockBlobClient` to satisfy `new BlobClient(entry)`.

## 2. Scope Resolved

**Scope files:**
- `src/electron/server.ts` — the 6 new Phase-F routes starting at line 1114

**In-scope symbols (route handlers):**
- `handleListReverseLinks` — `GET /api/reverse-links/:storage/:container?`
- `handleCreateReverseLink` — `POST /api/reverse-links/:storage/:container?`
- `handleDeleteReverseLink` — `DELETE /api/reverse-links/:storage/:container?/:linkId`
- `handlePushReverseLink` — `POST /api/push/:storage/:container?/:linkId`
- `handlePushAll` — `POST /api/push-all/:storage/:container?`
- `handleReverseDiff` — `GET /api/reverse-diff/:storage/:container?/:linkId`

**Supporting symbols tested indirectly:**
- `reverseGitContext()` — helper that resolves storage → BlobClient
- `scopeFromRequest()` — helper that builds `ReverseLinkScope` from URL params + body
- `sendReverseGitError()` — helper that maps typed errors to HTTP status codes
- `mapReverseGitErrorToHttp()` from `src/core/reverse-git-errors.ts`

## 3. Existing Coverage

Before this test build, no test file in `tests/unit/` covered any reverse-git route in `server.ts`. The codebase-scan file explicitly noted: "Vitest test suite covers the forward direction but has no reverse-git tests yet." The `tests/unit/` directory had 21 files; none referenced `reverse-sync-engine`, `reverse-git-errors`, `reverse-git-types`, or the Phase-F routes.

Symbol → existing test files: **none** for all 6 in-scope symbols.

## 4. Plan

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `handleListReverseLinks` | unit | `reverse-git-routes.test.ts` | responds 200 with { links: [...] } | Proves GET container route returns links array |
| `handleListReverseLinks` | unit | `reverse-git-routes.test.ts` | responds 200 with { links: [] } | Proves GET container route handles empty registry |
| `handleListReverseLinks` | error_path | `reverse-git-routes.test.ts` | responds 404 when storage not found | Proves missing storage returns 404 |
| `handleListReverseLinks` | unit | `reverse-git-routes.test.ts` | responds 200 for account-scope route | Proves GET /api/reverse-links/:storage (no container) also works |
| `handleCreateReverseLink` | unit | `reverse-git-routes.test.ts` | responds 201 with { link } on success | Proves POST creates link and returns 201 |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 400 — no provider | Proves required-field validation |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 400 — no tokenName | Proves required-field validation including error message |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 400 — invalid provider | Proves enum validation on provider field |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 400 — invalid visibility | Proves enum validation on visibility field |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 400 — non-array exclusionPatterns | Proves type validation on exclusionPatterns |
| `handleCreateReverseLink` | regression | `reverse-git-routes.test.ts` | responds 409 — duplicate scope+repoUrl | Proves pre-check stops duplicate links before engine call |
| `handleCreateReverseLink` | unit | `reverse-git-routes.test.ts` | does NOT 409 for different scope | Proves pre-check is scope-local |
| `handleCreateReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 404 — storage not found | Proves missing storage returns 404 |
| `handleCreateReverseLink` | unit | `reverse-git-routes.test.ts` | responds 201 account-scope route | Proves account-scope POST also works |
| `handleDeleteReverseLink` | unit | `reverse-git-routes.test.ts` | responds 200 { removed: true } | Proves DELETE returns the expected body |
| `handleDeleteReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 404 — storage not found | Proves missing storage returns 404 |
| `handleDeleteReverseLink` | unit | `reverse-git-routes.test.ts` | responds 200 account-scope route | Proves account-scope DELETE works |
| `handlePushReverseLink` | unit | `reverse-git-routes.test.ts` | responds 200 with { result } | Proves POST push returns result envelope |
| `handlePushReverseLink` | unit | `reverse-git-routes.test.ts` | passes dryRun=true to engine | Proves query param forwarding |
| `handlePushReverseLink` | unit | `reverse-git-routes.test.ts` | passes force=true to engine | Proves query param forwarding |
| `handlePushReverseLink` | error_path | `reverse-git-routes.test.ts` | responds 404 — storage not found | Proves missing storage returns 404 |
| `handlePushReverseLink` | unit | `reverse-git-routes.test.ts` | responds 200 account-scope route | Proves account-scope push works |
| `handlePushAll` | unit | `reverse-git-routes.test.ts` | responds 200 all-success | Proves 200 when all links succeed |
| `handlePushAll` | unit | `reverse-git-routes.test.ts` | responds 502 partial failure | Proves 502 when ≥1 link fails, with ok/not-ok result shape |
| `handlePushAll` | unit | `reverse-git-routes.test.ts` | responds 200 empty results | Proves 200 when no links in scope |
| `handlePushAll` | unit | `reverse-git-routes.test.ts` | 502 with failed link identified | Proves error envelope shape in results array |
| `handlePushAll` | error_path | `reverse-git-routes.test.ts` | responds 404 — storage not found | Proves missing storage returns 404 |
| `handlePushAll` | unit | `reverse-git-routes.test.ts` | responds 200 account-scope route | Proves account-scope push-all works |
| `handleReverseDiff` | unit | `reverse-git-routes.test.ts` | responds 200 with { diff } | Proves GET diff returns diff envelope with correct fields |
| `handleReverseDiff` | error_path | `reverse-git-routes.test.ts` | responds 404 — storage not found | Proves missing storage returns 404 |
| `handleReverseDiff` | unit | `reverse-git-routes.test.ts` | responds 200 account-scope route | Proves account-scope diff works |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | RemoteDivergedError → 409 | Proves REMOTE_DIVERGED code and 409 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | RepoNotFoundError → 404 | Proves REPO_NOT_FOUND code and 404 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | InvalidPATError → 401 | Proves INVALID_PAT code and 401 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | InsufficientScopesError → 403 | Proves INSUFFICIENT_SCOPES code and 403 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | PayloadTooLargeError → 413 | Proves PAYLOAD_TOO_LARGE code and 413 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | RateLimitExceededError → 503 | Proves RATE_LIMIT code and 503 status |
| `mapReverseGitErrorToHttp` | unit | `reverse-git-routes.test.ts` | ConfigurationError → 400 CONFIG_MISSING | Proves CONFIG_MISSING code and 400 status |
| `mapReverseGitErrorToHttp` | error_path | `reverse-git-routes.test.ts` | plain Error → 500, no code | Proves generic Error goes to 500 with no code key |
| `scopeFromRequest` | unit | `reverse-git-routes.test.ts` | container segment → container scope | Proves scope kind=container when :container present |
| `scopeFromRequest` | unit | `reverse-git-routes.test.ts` | no container segment → account scope | Proves scope kind=account when :container absent |
| `scopeFromRequest` | unit | `reverse-git-routes.test.ts` | prefix body field → prefix scope | Proves scope kind=prefix when body.prefix set |
| `scopeFromRequest` | unit | `reverse-git-routes.test.ts` | no container → account scope on POST | Proves POST account-scope routing |
| `scopeFromRequest` | unit | `reverse-git-routes.test.ts` | container without prefix → container scope | Proves POST container routing without prefix |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/unit/reverse-git-routes.test.ts` | **new** — created by this agent |

## 6. Test Run Results

Command: `npx vitest run tests/unit/reverse-git-routes.test.ts --reporter=verbose`
Exit code: **0**

All 44 tests passed. No failures.

```
Test Files  1 passed (1)
     Tests  44 passed (44)
  Start at  19:34:28
  Duration  465ms (transform 98ms, setup 0ms, import 61ms, tests 318ms, environment 0ms)
```

### Notable fix during development

Initial run produced 38 failures all reporting status 500 with body `{"error":"() => ({}) is not a constructor"}`. Root cause: Vitest 4.x does not treat `vi.fn(() => ({}))` as a constructor-compatible mock, so `new BlobClient(entry)` inside `reverseGitContext()` was throwing at runtime. Fix: replaced the arrow-function stub with:

```typescript
vi.doMock('../../src/core/blob-client.js', () => ({
  BlobClient: class MockBlobClient { constructor(_entry: unknown) {} },
}));
```

This is consistent with the Vitest 4 advisory warning seen in stderr on the first run. After the fix all 44 tests passed on first attempt.

## 7. Implementation Gaps

None. All 44 tests pass; the implementation satisfies every assertion.

## 8. Manual Review Needed

None. No shared test infrastructure was needed. The tests are self-contained and do not touch `conftest.py`-style shared fixtures (not applicable in this TypeScript project) or any Vitest config files.

One advisory item for future reference: every test calls `createServer(0)` which internally calls `app.listen(0, "127.0.0.1", ...)`. Supertest does not use the bound port, but the `listen` call does open a real OS socket per test. In a large parallel suite this could exhaust ephemeral ports. If that becomes a concern, `server.ts` could accept an optional `{ skipListen?: true }` flag for test mode — this would require a small production-code change and is therefore noted here rather than implemented.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/unit/reverse-git-routes.test.ts --reporter=verbose` (first run, before BlobClient fix) | 1 (38 failures) |
| 2 | `npx vitest run tests/unit/reverse-git-routes.test.ts --reporter=verbose` (after BlobClient mock fix) | 0 (44 passed) |
