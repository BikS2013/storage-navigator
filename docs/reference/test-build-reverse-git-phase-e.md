---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-e-cli-commands
language: typescript
framework: vitest
test_command_full: "vitest run"
test_command_scope: "npx vitest run tests/unit/reverse-git-cli.test.ts"
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/reverse-git-cli.test.ts
tests_added: 57
tests_updated: 0
tests_run: 57
tests_passed: 57
tests_failed: 0
implementation_gaps: 0
built_at: 2026-06-01T19:43:00Z
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-E reverse-git CLI commands

## 1. Summary

Status: **completed** — all 57 tests pass. Framework is Vitest 4.1.5 on TypeScript/Node 16 ESM. A new test file `tests/unit/reverse-git-cli.test.ts` was created covering all seven Phase-E CLI handler functions (`publishGitHub`, `publishDevOps`, `reverseLinkGitHub`, `reverseLinkDevOps`, `pushReverseLinkCmd`, `reverseUnlink`, `listReverseLinksCmd`) with the engine and shared-resolver mocked out. No implementation gaps were detected. No production source was modified.

## 2. Scope Resolved

**Scope file:** `src/cli/commands/reverse-git.ts`

In-scope symbols (exported handler functions):

- `publishGitHub(scope, target, storageOpts, patOpts): Promise<void>`
- `publishDevOps(scope, target, storageOpts, patOpts): Promise<void>`
- `reverseLinkGitHub(scope, target, storageOpts, patOpts): Promise<void>`
- `reverseLinkDevOps(scope, target, storageOpts, patOpts): Promise<void>`
- `pushReverseLinkCmd(scope, op, storageOpts, patOpts): Promise<void>`
- `reverseUnlink(scope, linkId, storageOpts, assumeYes): Promise<void>`
- `listReverseLinksCmd(scope, storageOpts): Promise<void>`

Internal helper symbols exercised indirectly (not tested directly per the scope contract):

- `buildScope` — via scope opt combinations in `publishGitHub` and `listReverseLinksCmd` tests
- `parseVisibility` — via `--visibility public/protected` tests in `publishGitHub`
- `buildAuthor` — via `--author-name/--author-email` tests in `reverseLinkGitHub`
- `buildDevOpsRepoUrl` — via bare-repo-name and full-URL tests in `publishDevOps` / `reverseLinkDevOps`
- `reportPushResult` — via exit-code assertions on push results
- `reportError` — via error taxonomy tests

## 3. Existing Coverage

Before this build:

| Symbol | Existing test files |
|---|---|
| `publishGitHub` | None |
| `publishDevOps` | None |
| `reverseLinkGitHub` | None |
| `reverseLinkDevOps` | None |
| `pushReverseLinkCmd` | None |
| `reverseUnlink` | None |
| `listReverseLinksCmd` | None |

No prior test coverage existed for `src/cli/commands/reverse-git.ts`. All 21 existing test files under `tests/unit/` cover forward-sync, backend, credential, and server concerns; none reference the reverse-git CLI.

## 4. Plan

The following test categories were implemented:

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `publishGitHub` | unit | reverse-git-cli.test.ts | calls initReverseLink with provider=github and the resolved PAT as patOverride | Engine receives correct provider and AC-C3 patOverride |
| `publishGitHub` | unit | reverse-git-cli.test.ts | also passes patOverride to the subsequent pushReverseLink call | AC-C3: push call also receives inline PAT |
| `publishGitHub` | unit | reverse-git-cli.test.ts | exits 0 when push result has no changes | Correct exit code for no-op |
| `publishGitHub` | unit | reverse-git-cli.test.ts | exits 1 when push result contains added files | Correct exit code when changes exist |
| `publishGitHub` | error_path | reverse-git-cli.test.ts | exits 3 when --repo is missing | ConfigurationError → exit 3 |
| `publishGitHub` | error_path | reverse-git-cli.test.ts | exits 3 when storage kind is not direct | Non-direct storage entry → exit 3 |
| `publishGitHub` | error_path | reverse-git-cli.test.ts | exits 2 on RemoteDivergedError from engine | RemoteDivergedError → exit 2 |
| `publishGitHub` | unit | reverse-git-cli.test.ts | maps --visibility public to initReverseLink correctly | Visibility flag is threaded |
| `publishGitHub` | error_path | reverse-git-cli.test.ts | throws ConfigurationError for invalid --visibility | Invalid visibility → exit 3 |
| `publishGitHub` | unit | reverse-git-cli.test.ts | builds prefix scope when --prefix and --container both supplied | Prefix scope wiring is correct |
| `publishGitHub` | error_path | reverse-git-cli.test.ts | throws ConfigurationError when --prefix without --container | Missing container with prefix → exit 3 |
| `publishDevOps` | unit | reverse-git-cli.test.ts | calls initReverseLink with provider=azure-devops and patOverride | Engine gets correct provider + AC-C3 |
| `publishDevOps` | unit | reverse-git-cli.test.ts | accepts a full ADO URL as --repo directly | Full URL bypasses --org/--project |
| `publishDevOps` | error_path | reverse-git-cli.test.ts | throws ConfigurationError for bare repo name without --org/--project | Missing org/project → exit 3 |
| `publishDevOps` | unit | reverse-git-cli.test.ts | exits 1 when push has changes | Correct exit code |
| `publishDevOps` | error_path | reverse-git-cli.test.ts | exits 2 on InsufficientScopesError | InsufficientScopesError → exit 2 |
| `publishDevOps` | unit | reverse-git-cli.test.ts | also passes patOverride to pushReverseLink | AC-C3: push call also gets inline PAT |
| `reverseLinkGitHub` | unit | reverse-git-cli.test.ts | calls initReverseLink but NOT pushReverseLink | Link-only creation does not push |
| `reverseLinkGitHub` | unit | reverse-git-cli.test.ts | passes patOverride to initReverseLink (AC-C3) | Inline PAT is threaded correctly |
| `reverseLinkGitHub` | unit | reverse-git-cli.test.ts | exits 0 on success | Correct exit code |
| `reverseLinkGitHub` | error_path | reverse-git-cli.test.ts | exits 3 when --repo is missing | Missing repo → exit 3 |
| `reverseLinkGitHub` | unit | reverse-git-cli.test.ts | maps --author-name/--author-email to CommitAuthor | Author fields threaded |
| `reverseLinkGitHub` | error_path | reverse-git-cli.test.ts | exits 3 when only --author-name is set | Partial author → exit 3 |
| `reverseLinkGitHub` | error_path | reverse-git-cli.test.ts | exits 2 on generic Error | Non-typed error → exit 2 |
| `reverseLinkDevOps` | unit | reverse-git-cli.test.ts | calls initReverseLink with provider=azure-devops, no push | ADO link creation is push-free |
| `reverseLinkDevOps` | unit | reverse-git-cli.test.ts | synthesises ADO URL from --org/--project/--repo | URL construction from triple |
| `reverseLinkDevOps` | unit | reverse-git-cli.test.ts | passes patOverride to initReverseLink (AC-C3) | ADO inline PAT threaded |
| `reverseLinkDevOps` | error_path | reverse-git-cli.test.ts | exits 3 when --repo is missing | Missing repo → exit 3 |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | resolves link by linkId and calls pushReverseLink | Engine receives correct linkId |
| `pushReverseLinkCmd` | regression | reverse-git-cli.test.ts | passes inline --pat as patOverride (Phase-7 fix) | AC-C3 regression: inline PAT is patOverride |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | passes dryRun=true when --dry-run is set | dryRun flag reaches engine |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | exits 1 on dry-run when changes pending | Dry-run with changes → exit 1 |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | exits 0 on dry-run when no changes | Dry-run no-op → exit 0 |
| `pushReverseLinkCmd` | error_path | reverse-git-cli.test.ts | exits 2 when no matching links found | Empty resolve result → exit 2 |
| `pushReverseLinkCmd` | error_path | reverse-git-cli.test.ts | exits 3 when --all and --link-id are both set | Mutually exclusive flags → exit 3 |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | --all: pushes all links, aggregates to exit 1 if any changed | Multi-link push with one active → exit 1 |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | --all: exits 0 when all links report no changes | All no-op → exit 0 |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | --all: same --pat threaded to every push call | AC-C3 applies across all --all links |
| `pushReverseLinkCmd` | error_path | reverse-git-cli.test.ts | exits 2 on RemoteDivergedError (REMOTE_DIVERGED in stderr) | RemoteDivergedError code logged |
| `pushReverseLinkCmd` | unit | reverse-git-cli.test.ts | resolves patOverride from --token-name via store.getToken | Token name lookup threads correctly |
| `pushReverseLinkCmd` | error_path | reverse-git-cli.test.ts | exits 3 when --token-name not in store | Unknown token name → exit 3 |
| `reverseUnlink` | error_path | reverse-git-cli.test.ts | exits 3 when --link-id is missing | Missing linkId → exit 3 |
| `reverseUnlink` | error_path | reverse-git-cli.test.ts | exits 2 when link not found | Unresolvable linkId → exit 2 |
| `reverseUnlink` | unit | reverse-git-cli.test.ts | prompts and removes when user confirms | Confirmation flow → remove |
| `reverseUnlink` | unit | reverse-git-cli.test.ts | cancels without removing when user denies | Denial cancels operation |
| `reverseUnlink` | unit | reverse-git-cli.test.ts | --yes bypasses prompt and removes immediately | assumeYes skips promptYesNo |
| `reverseUnlink` | error_path | reverse-git-cli.test.ts | exits 3 when storage is api-backend | Non-direct entry → exit 3 |
| `listReverseLinksCmd` | unit | reverse-git-cli.test.ts | exits 0 and prints 'No reverse-links found' when empty | Empty registry output |
| `listReverseLinksCmd` | unit | reverse-git-cli.test.ts | exits 0 and prints a table row for each link | Table rendering |
| `listReverseLinksCmd` | unit | reverse-git-cli.test.ts | routes container scope to listReverseLinks | Scope routing — container |
| `listReverseLinksCmd` | unit | reverse-git-cli.test.ts | routes to account scope when no container given | Scope routing — account |
| `listReverseLinksCmd` | unit | reverse-git-cli.test.ts | routes to prefix scope with --prefix + --container | Scope routing — prefix |
| `listReverseLinksCmd` | error_path | reverse-git-cli.test.ts | exits 2 on fatal engine error | Engine failure → exit 2 |
| (error taxonomy) | unit | reverse-git-cli.test.ts | RemoteDivergedError → exit 2 | exitCode field = 2 |
| (error taxonomy) | unit | reverse-git-cli.test.ts | ConfigurationError → exit 3 | exitCode field = 3 |
| (error taxonomy) | unit | reverse-git-cli.test.ts | InsufficientScopesError → exit 2 | exitCode field = 2 |
| (error taxonomy) | unit | reverse-git-cli.test.ts | plain Error → exit 2 | Generic errors → exit 2 |

## 5. Files Owned

| File | Status | Reason |
|---|---|---|
| `tests/unit/reverse-git-cli.test.ts` | new | No prior tests existed for this scope |

## 6. Test Run Results

**Command:** `npx vitest run tests/unit/reverse-git-cli.test.ts`

```
Test Files  1 passed (1)
     Tests  57 passed (57)
  Start at  19:43:00
  Duration  151ms
```

All 57 tests passed on the first clean run (after fixing two categories of test-bug):

**Test-bug diagnosis (no implementation gaps):**

1. **Exit-code re-routing via try/catch**: The handler functions wrap their entire body in `try/catch(err) { reportError(err) }`. Throwing from a `process.exit` spy caused the thrown error to be caught by the handler's `catch` block, which called `reportError(thrownError)` and then `process.exit(2)`. Fixed by using a `TestExitSignal` class that subclasses `ReverseGitError` — when `reportError` catches it, it takes the typed branch and re-exits with the same code, propagating the intended exit code.

2. **Mock call accumulation across tests**: The `vi.mock` stubs accumulated call history across `describe` blocks because `vi.clearAllMocks()` was absent in `beforeEach`. Fixed by adding `vi.clearAllMocks()` as the first statement in `beforeEach`.

3. **resolvePatToken mock override**: Tests asserting per-test PAT values (e.g., `"my-inline-pat"`, `"ado-pat"`) did not re-configure `resolvePatToken`'s mock return value, so the `beforeEach` default (`"inline-pat-value"`) was returned instead. Fixed by adding explicit `vi.mocked(shared.resolvePatToken).mockResolvedValue(...)` calls in the two affected tests.

## 7. Implementation Gaps

None. All 57 tests pass against the current implementation.

## 8. Manual Review Needed

None. No shared test infrastructure was required to be modified. All mocking was done at the test-file level.

**Note on async/promise leakage**: The `reverse-git.ts` handlers use `process.exit` at the end of each async success/error path. The test runner (Vitest 4.1.5) is configured with `globals: false` and `environment: node`. Unhandled promise rejections would produce test failures in this environment, so no additional configuration is needed.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/unit/reverse-git-cli.test.ts` (initial run — 34 failures diagnosed as test bugs) | 1 |
| 2 | `npx vitest run tests/unit/reverse-git-cli.test.ts` (after TestExitSignal fix — 19 failures remaining) | 1 |
| 3 | `npx vitest run tests/unit/reverse-git-cli.test.ts` (after clearAllMocks — 2 failures remaining) | 1 |
| 4 | `npx vitest run tests/unit/reverse-git-cli.test.ts` (after resolvePatToken mock fix — all pass) | 0 |
| 5 | `npx vitest run tests/unit/` (full unit suite — no regressions) | 0 |
