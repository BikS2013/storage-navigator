---
status: clean
mode: fix
package_manager: npm 11.12.1
ecosystem: node
iterations_run: 2
deprecations_initial: 0
deprecations_final: 0
vulnerabilities_initial: 14
vulnerabilities_final: 0
target_path: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git
validated_at: 2026-06-01T16:27:51Z
last_validated_commit: f2f0f94c0a18b3ee86dfd601ae27b6d13c624ae2
---

# Dependency Validation — Storage Navigator (reverse-git branch)

## 1. Summary

Package manager is npm 11.12.1 with a `package-lock.json` lockfile. The initial scan found 0 deprecation warnings and 14 security advisories (10 moderate, 4 high) across the dependency tree. Two fix iterations were applied: first `npm audit fix` resolved 13 of 14 vulnerabilities by bumping transitive dependencies; second, an `overrides` entry for `brace-expansion@^5.0.6` resolved the final moderate advisory. The project is now clean — `npm audit` reports 0 vulnerabilities.

## 2. Initial State

No deprecation warnings were emitted by `npm install`. The install output was clean except for the advisory summary line.

### Security Advisories Found (14 total — 10 moderate, 4 high)

| Package | Current Version | Scope | Severity | Advisory | Fixed Version |
|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | 0.90.0 | transitive (via `@langchain/anthropic`) | moderate | GHSA-p7fg-763f-g4gf — Insecure Default File Permissions in Local Filesystem Memory Tool | >=0.91.1 |
| `@langchain/anthropic` | 1.3.27 | **direct** | moderate | Depends on vulnerable `@anthropic-ai/sdk` | 1.4.0 |
| `@langchain/langgraph` | 1.2.9 | **direct** | moderate | Depends on vulnerable `uuid` | 1.3.3 |
| `@langchain/langgraph-checkpoint` | 1.0.1 | transitive (via `@langchain/langgraph`) | moderate | Depends on vulnerable `uuid` | 1.0.4 |
| `@xmldom/xmldom` | 0.8.12 | transitive (via `mammoth`, `electron-builder`) | **high** | GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx, GHSA-j759-j44w-7fr8 — XML injection / DoS | >=0.8.13 |
| `brace-expansion` | 5.0.5 | transitive (via `electron-builder → minimatch@10`) | moderate | GHSA-jxxr-4gwj-5jf2 — Large numeric range bypasses DoS protection | >=5.0.6 |
| `fast-xml-builder` | 1.1.4 | transitive (via `@azure/storage-blob → @azure/core-xml → fast-xml-parser`) | **high** | GHSA-5wm8-gmm8-39j9 — Attribute value injection via unquoted attributes | >=1.1.7 |
| `fast-xml-parser` | 5.5.9 | transitive (via `@azure/storage-blob → @azure/core-xml`) | moderate | GHSA-gh4j-gqv2-49f6 — XML Comment and CDATA Injection | >=5.7.0 |
| `ip-address` | 10.1.0 | transitive (via `electron-builder → socks-proxy-agent`) | moderate | GHSA-v2v4-37r5-5v8g — XSS in Address6 HTML-emitting methods | >=10.2.0 |
| `langsmith` | 0.5.23 | transitive (via `@langchain/core`) | **high** | GHSA-3644-q5cj-c5c7 — Unsafe deserialization of public prompt manifests | >=0.6.0 |
| `qs` | 6.15.0 | transitive (via `express`, `supertest`) | moderate | GHSA-q8mj-m7cp-5q26 — DoS via `qs.stringify` null entries | >=6.15.2 |
| `tmp` | 0.2.5 | transitive (via `electron-builder → @malept/flatpak-bundler`) | **high** | GHSA-ph9p-34f9-6g65 — Path Traversal via unsanitized prefix/postfix | >=0.2.6 |
| `uuid` | 10.0.0, 11.1.0, 13.0.0 (multiple instances) | transitive (via `@langchain/langgraph`, `langsmith`, `@langchain/core`) | moderate | GHSA-w5hq-g745-h8pq — Missing buffer bounds check in v3/v5/v6 | >=11.1.1 or >=13.0.1 |
| `ws` | 8.20.0 | transitive (via `@langchain/core`, `@langchain/openai`, `happy-dom`) | moderate | GHSA-58qx-3vcg-4xpx — Uninitialized memory disclosure | >=8.20.1 |

## 3. Replacements Applied

### Iteration 1 — `npm audit fix`

Applied `npm audit fix` which resolved 13 of 14 vulnerabilities by bumping transitive packages (no direct manifest edits except indirect via lockfile). Key changes:

| Change | From | To |
|---|---|---|
| `@anthropic-ai/sdk` | 0.90.0 | 0.95.2 |
| `@langchain/anthropic` | 1.3.27 | 1.4.0 |
| `@langchain/core` | 1.1.41 | 1.1.48 |
| `@langchain/langgraph` | 1.2.9 | 1.3.3 |
| `@langchain/langgraph-checkpoint` | 1.0.1 | 1.0.4 |
| `@langchain/langgraph-sdk` | 1.8.9 | 1.9.11 |
| `@xmldom/xmldom` | 0.8.12 | 0.8.13 |
| `fast-xml-builder` | 1.1.4 | 1.2.0 |
| `fast-xml-parser` | 5.5.9 | 5.8.0 |
| `ip-address` | 10.1.0 | 10.2.0 |
| `langsmith` | 0.5.23 | 0.7.3 |
| `qs` | 6.15.0 | 6.15.2 |
| `tmp` | 0.2.5 | 0.2.7 |
| `uuid` (all instances) | 10.0.0, 11.1.0, 13.0.0 | 11.1.1, 14.0.0 |
| `ws` | 8.20.0 | 8.21.0 |

Residual after iteration 1: **1 moderate** (`brace-expansion@5.0.5`, still pulled by `electron-builder → app-builder-lib → minimatch@10.2.5`).

### Iteration 2 — `overrides` entry for `brace-expansion`

`brace-expansion@5.0.5` remained because `npm audit fix` cannot override a deeply pinned transitive path. Added override to `package.json`:

```json
"overrides": {
  "brace-expansion": "^5.0.6"
}
```

Then re-ran `npm install`. This forced `minimatch@10.2.5` to resolve `brace-expansion@5.0.6` instead of `5.0.5`.

Files modified: `package.json` (overrides section), `package-lock.json` (updated automatically by `npm install`).

Source files modified: none.

Residual after iteration 2: **0 vulnerabilities**.

## 4. Manual Review Needed

None. All 14 advisories have been resolved automatically via version bumps and one override. No deprecated packages were found. No API-incompatible replacements were required.

**Advisory note on `brace-expansion` override**: The override `"brace-expansion": "^5.0.6"` is scoped to the v5 family only. The v1 (`1.1.13`) and v2 (`2.0.3`) instances of `brace-expansion` pulled by `electron-builder` (via `minimatch@3` and `minimatch@9`) are not in the vulnerable range and were left untouched. Remove this override once `electron-builder` updates its `app-builder-lib → minimatch@10` dependency to `minimatch@10.3.0` or later (which will pull `brace-expansion@5.0.6+` natively).

**Major-version outdated packages (informational — not auto-fixed per policy):**

| Package | Current | Latest Major | Notes |
|---|---|---|---|
| `clipboardy` | 4.0.0 | 5.3.1 | Major-version jump — API may differ |
| `commander` | 14.0.3 | 15.0.0 | Major-version jump — CLI API review needed |
| `electron` | 41.1.1 | 42.3.0 | Electron major — verify renderer/main API compat |
| `electron-builder` | 26.8.2 | 26.13.0 | Minor jump available within `^26` — no security issue |
| `zod` | 3.25.76 | 4.4.3 | Major-version jump — widespread schema API changes |
| `marked` | 17.0.5 | 18.0.4 | Major-version jump |

These are informational only. None have current security advisories. Migration should be done deliberately with full regression testing.

## 5. Security Audit

Final audit result: **0 vulnerabilities**.

Initial audit summary: 10 moderate, 4 high, 0 critical.

All advisories resolved. Details of initial advisories are in Section 2 above.

## 6. Final State

The project is **clean**. `npm audit` reports 0 vulnerabilities across 569 audited packages (576 before fix, net -7 packages after removals). The `package.json` overrides section has one additional entry (`"brace-expansion": "^5.0.6"`) to pin the brace-expansion transitive fix. The lockfile was updated automatically. No source files were modified.

## 7. Commands Run

| # | Command | Exit Code |
|---|---|---|
| 1 | `npm install` (initial) | 0 |
| 2 | `npm audit --json` (initial scan) | 1 (14 vulnerabilities) |
| 3 | `npm outdated --json` (initial scan) | 1 (outdated packages found) |
| 4 | `npm audit fix --dry-run` | 1 (dry-run preview) |
| 5 | `npm audit fix` (iteration 1) | 1 (1 residual after fix) |
| 6 | `npm install` (after adding brace-expansion override, iteration 2) | 0 |
| 7 | `npm audit --json` (final verification) | 0 |
| 8 | `npm install` (final verification) | 0 |
| 9 | `npm outdated --json` (final state) | 1 (outdated-but-clean majors only) |

All commands run at target path `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git`.
