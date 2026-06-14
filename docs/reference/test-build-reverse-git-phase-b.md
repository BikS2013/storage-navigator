---
status: completed
mode: write-and-run
scope_slug: reverse-git-phase-b
language: typescript
framework: vitest
test_command_full: vitest run
test_command_scope: npx vitest run tests/unit/reverse-diff-engine.test.ts tests/unit/blob-enumerator.test.ts --no-coverage
test_dir: tests/unit
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
test_files_owned:
  - tests/unit/reverse-diff-engine.test.ts
  - tests/unit/blob-enumerator.test.ts
tests_added: 62
tests_updated: 0
tests_run: 62
tests_passed: 62
tests_failed: 0
implementation_gaps: 0
built_at: 2026-06-01T19:34:00Z
last_built_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Test Build — Phase-B reverse-git diff and enumeration

## 1. Summary

Status: completed. Framework: vitest v4.1.5 (TypeScript/Node16). Two new test files were created — `tests/unit/reverse-diff-engine.test.ts` (26 tests) and `tests/unit/blob-enumerator.test.ts` (36 tests). All 62 tests pass with no failures or implementation gaps. A minimal stub `BlobClient` replaces the real Azure client; no network I/O occurs. Neither production source file was modified.

## 2. Scope Resolved

**src/core/reverse-diff-engine.ts**
- `computeReverseDiff(linkId, currentSnapshot, lastSnapshot, options?)` — pure diff classifier
- `buildRepoChanges(diff, contentLoader)` — translates diff to `RepoChange[]`
- `collectSnapshot(blobs)` — drains `AsyncIterable<EnumeratedBlob>` into snapshot maps

**src/core/blob-enumerator.ts**
- `enumerateScope(blobClient, scope, opts)` — async generator; main public surface
- Internal: `enumerateContainerScope`, `mapToRepoPath`, `detectIllegalPath`, `isAlwaysExcludedBasename`, `matchesAnyPattern`, `matchesPattern`, `gitignoreToRegex`, `compileGitignore`, `loadGitignoreMatcher`

## 3. Existing Coverage

| Symbol | Existing test files |
|---|---|
| `computeReverseDiff` | None |
| `buildRepoChanges` | None |
| `collectSnapshot` | None |
| `enumerateScope` | None |

No prior coverage existed for any symbol in scope. Both test files are new.

## 4. Plan

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | classifies a path present only in current as added | Proves `added` receives paths absent from last snapshot |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | classifies a path present only in last as deleted | Proves `deleted` receives paths absent from current snapshot |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | classifies a path with the same ETag as unchanged | Proves identical ETags yield `unchanged` |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | classifies a path with a changed ETag as modified | Proves differing ETags yield `modified` |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | handles mixed added / modified / deleted / unchanged in one call | Proves all four categories can coexist in a single call |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | copies linkId into the result unchanged | Proves linkId passthrough |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | returns empty arrays and zero counts for identical empty snapshots | Proves no-op case |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | treats first publish (empty lastSnapshot) as all added | Proves first-publish semantics |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | promotes unchanged to modified when force=true | Proves `--force` semantics |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | does not affect added or deleted under force=true | Proves force only affects unchanged, not membership |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | defaults force to false when option omitted | Proves default behaviour |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | sorts added lexicographically | Proves deterministic add ordering |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | sorts modified lexicographically | Proves deterministic modified ordering |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | sorts deleted lexicographically | Proves deterministic deleted ordering |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | sorts unchanged lexicographically | Proves deterministic unchanged ordering |
| `computeReverseDiff` | unit | reverse-diff-engine.test.ts | produces identical output for same inputs on two consecutive calls | Proves pure-function stability |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | calls contentLoader for added paths | Proves loader invoked for `add` |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | calls contentLoader for modified paths | Proves loader invoked for `edit` |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | does NOT call contentLoader for deleted paths | Proves loader NOT invoked for `delete` |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | does NOT call contentLoader for unchanged paths | Proves unchanged paths are completely ignored |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | orders output: all adds first, then edits, then deletes | Proves deterministic change ordering |
| `buildRepoChanges` | unit | reverse-diff-engine.test.ts | returns empty array when diff has no changes | Proves no-op case |
| `collectSnapshot` | unit | reverse-diff-engine.test.ts | drains iterable into snapshot and repoPathToStoragePath maps | Proves snapshot accumulation |
| `collectSnapshot` | unit | reverse-diff-engine.test.ts | returns empty maps for empty iterable | Proves empty-input case |
| `collectSnapshot` | unit | reverse-diff-engine.test.ts | later blob overwrites earlier same repoPath | Proves last-writer-wins semantics |
| `enumerateScope` | unit | blob-enumerator.test.ts | maps each blob name directly to repoPath (container scope) | Proves 1:1 path mapping (R5.1) |
| `enumerateScope` | unit | blob-enumerator.test.ts | storagePath is container/blobName | Proves storagePath format |
| `enumerateScope` | unit | blob-enumerator.test.ts | includes etag and size from getBlobProperties | Proves HEAD metadata is used |
| `enumerateScope` | unit | blob-enumerator.test.ts | prepends repoSubPath when set | Proves repoSubPath prepending |
| `enumerateScope` | unit | blob-enumerator.test.ts | normalises leading/trailing slashes in repoSubPath | Proves path normalisation |
| `enumerateScope` | unit | blob-enumerator.test.ts | strips the prefix from repoPath (prefix scope) | Proves prefix-strip mapping (R5.2) |
| `enumerateScope` | unit | blob-enumerator.test.ts | strips prefix with trailing slash when provided | Proves prefix normalisation |
| `enumerateScope` | unit | blob-enumerator.test.ts | storagePath still includes full blob name in prefix scope | Proves storagePath is unstripped |
| `enumerateScope` | unit | blob-enumerator.test.ts | prepends container name to every repoPath (account scope) | Proves container-as-top-folder (R5.3) |
| `enumerateScope` | unit | blob-enumerator.test.ts | iterates over all listed containers | Proves account scope walks all containers |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes .repo-links.json unconditionally | Proves EXCLUDED_BLOB_NAMES filter (R6.3) |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes .reverse-git-links.json unconditionally | Proves EXCLUDED_BLOB_NAMES filter (R6.4) |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes .repo-sync-meta.json unconditionally | Proves EXCLUDED_BLOB_NAMES filter |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes metadata blobs nested inside subdirectories | Proves basename-based filter at any depth |
| `enumerateScope` | error_path | blob-enumerator.test.ts | skips blobs with backslash in name and emits onWarn | Proves R5.4 backslash detection |
| `enumerateScope` | error_path | blob-enumerator.test.ts | skips .git root blob and emits onWarn | Proves R5.4 .git segment detection |
| `enumerateScope` | error_path | blob-enumerator.test.ts | skips blobs with .git/ segment and emits onWarn | Proves R5.4 .git/ prefix detection |
| `enumerateScope` | error_path | blob-enumerator.test.ts | skips blobs with ASCII control characters and emits onWarn | Proves R5.4 control-char detection |
| `enumerateScope` | error_path | blob-enumerator.test.ts | throws PathCollisionError for case-insensitive collision | Proves R5.5 abort-policy |
| `enumerateScope` | unit | blob-enumerator.test.ts | does not throw for distinct lower-cased paths | Proves no false-positive collision |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching literal filename pattern | Proves exclusionPatterns filter (R6.1) |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching wildcard * pattern | Proves * glob support |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching directory-style trailing slash pattern | Proves trailing / pattern |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching rooted / pattern | Proves anchored / pattern |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching ** glob at any depth | Proves ** support |
| `enumerateScope` | unit | blob-enumerator.test.ts | excludes blobs matching ? wildcard pattern | Proves ? single-char support |
| `enumerateScope` | unit | blob-enumerator.test.ts | ignores blobs matched by .gitignore patterns | Proves R6.2 gitignore filtering |
| `enumerateScope` | unit | blob-enumerator.test.ts | .gitignore file itself never excluded by its own rules (AC-D6) | Proves .gitignore self-exclusion invariant |
| `enumerateScope` | unit | blob-enumerator.test.ts | honours negation (!) rules inside .gitignore | Proves last-rule-wins negation semantics |
| `enumerateScope` | unit | blob-enumerator.test.ts | skips gitignore evaluation when respectGitignore=false | Proves opt-out flag |
| `enumerateScope` | unit | blob-enumerator.test.ts | does not load .gitignore when respectGitignore=false | Proves no wasted I/O |
| `enumerateScope` | unit | blob-enumerator.test.ts | handles missing .gitignore gracefully | Proves 404 swallowed per design |
| `enumerateScope` | unit | blob-enumerator.test.ts | evaluates patterns relative to scope root | Proves OQ-11 scope-root-relative evaluation |
| `enumerateScope` | unit | blob-enumerator.test.ts | yields nothing for empty container | Proves empty-input case |
| `enumerateScope` | unit | blob-enumerator.test.ts | yields nothing for account with no containers | Proves empty-account case |
| `enumerateScope` | error_path | blob-enumerator.test.ts | skips blobs with no ETag and emits onWarn | Proves HEAD no-ETag warning path |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/unit/reverse-diff-engine.test.ts` | new — no prior tests existed |
| `tests/unit/blob-enumerator.test.ts` | new — no prior tests existed |

## 6. Test Run Results

All 62 tests passed in 142 ms. No failures.

```
 Test Files  2 passed (2)
      Tests  62 passed (62)
   Start at  19:33:16
   Duration  142ms
```

## 7. Implementation Gaps

None. All 62 tests passed against the existing implementation. No implementation defects were detected.

## 8. Manual Review Needed

None. No shared infrastructure modifications were needed. All tests are self-contained within `test_files_owned`.

Note: `vitest.config.ts` currently has `include: ['tests/**/*.test.ts', ...]` which covers the new files automatically. No config changes were needed or made.

## 9. Commands Run

| Command | Exit Code |
|---|---|
| `npx vitest run tests/unit/reverse-diff-engine.test.ts tests/unit/blob-enumerator.test.ts --no-coverage` | 0 |
| `npx vitest run tests/unit/blob-enumerator.test.ts --no-coverage --reporter=verbose` | 0 |
