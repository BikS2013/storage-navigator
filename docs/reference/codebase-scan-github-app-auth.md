---
language: TypeScript
framework: Node.js + Electron + Express
package_manager: npm
build_command: npm run build
test_command: npm test
lint_command: npx tsc --noEmit
entry_points:
  - src/cli/index.ts (CLI commands via Commander.js)
  - src/electron/main.ts (Electron desktop UI)
  - API/src/index.ts (HTTP API broker)
  - src/agent/index.ts (LangGraph ReAct agent)
last_scanned_commit: 9ac3b44c598764c3acc46086d57691f1f34f7866
scanned_for_request: github-app-auth
scanned_at: 2026-06-14T12:33:00Z
---

# Codebase Scan — storage-navigator (GitHub App Authentication)

**Scan purpose:** Identify integration points for adding GitHub App authentication as an additional authentication method alongside the existing Personal Access Token (PAT) flow for the reverse-git publication feature.

---

## 1. Project Overview

**storage-navigator** is a multi-surface Azure Storage browser and automation tool with four primary components:

1. **CLI** (`storage-nav`) — scriptable browse/view/edit/upload/download/sync via `src/cli/index.ts`
2. **Desktop UI** (Electron app) — tree explorer, text editor, ZIP downloader via `src/electron/main.ts`
3. **HTTP API** (`storage-nav-api`) — OIDC + RBAC broker for Azure Storage via `API/src/index.ts`
4. **LangGraph Agent** — ReAct agent wrapping CLI commands via `src/agent/index.ts`

The **reverse-git** feature enables publishing Azure Blob containers (or prefixes/accounts) to GitHub or Azure DevOps repositories. It currently uses **PAT-only authentication** and must be extended to support **GitHub App authentication** as an alternative while maintaining full backward compatibility.

---

## 2. Module Map

### 2.1 Core Authentication & Credential Layer

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `src/core/credential-store.ts` | Encrypted credential store (AES-256-GCM) for storage accounts, PATs, reverse-links | 442 | `CredentialStore` |
| `src/core/types.ts` | Re-exports reverse-git types + defines `StorageEntry`, `TokenEntry`, `CredentialData` | 215 | `TokenEntry`, `CredentialData`, `DirectStorageEntry`, `ApiBackendEntry` |
| `src/core/reverse-git-types.ts` | **PRIMARY SURFACE** — all reverse-git data models (`ReverseLink`, `RepoWriteClient`, etc.) | 353 | `ReverseLink`, `RepoWriteClient`, `CommitAuthor`, `RepoVisibility`, `AccountScopeReverseLinksRegistry`, `ReverseGitLinkPATBinding` |
| `src/core/reverse-git-errors.ts` | Typed error taxonomy for reverse-git operations | 198 | `GitHubApiError`, `InvalidPATError`, `InsufficientScopesError`, `RemoteDivergedError`, `ConfigurationError` |

**Credential store envelope:**
- Uses a **machine-derived key** (32-byte random persisted in `~/.storage-navigator/machine.key`, mode `0600`)
- Encrypts with **AES-256-GCM** (IV + ciphertext + auth tag stored in `credentials.json`)
- **Migration:** backward-compatible; missing fields default to `[]` (no write-on-read)
- **No fallback values** rule: missing config → `ConfigurationError` (exit code 3), never silent substitution

### 2.2 GitHub Integration — Read & Write Clients

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `src/core/github-client.ts` | **Read-only** GitHub REST API wrapper (PAT-based) | 68 | `GitHubClient` — `listFiles`, `downloadFile`, `parseRepoUrl` |
| `src/core/github-write-client.ts` | **Write-side** Git Data API client (PAT-based, Phase A reverse-git) | 667 | `GitHubWriteClient` (implements `RepoWriteClient`) — `ensureRepo`, `getBranchTip`, `createCommit`, `listRepoFiles`, `bootstrapEmpty` |
| `src/core/repo-utils.ts` | Factory helpers for building read/write clients from links | 181 | `buildProviderForLink`, `buildWriteClientForLink`, `rateLimitedFetch` |

**GitHub write client contract:**
- Accepts a **PAT string** in constructor: `new GitHubWriteClient(pat, owner, repo)`
- Uses `Authorization: Bearer <pat>` header for all REST calls
- **Installation token compatibility:** tokens use the SAME header format (Bearer), so GitHub App installation tokens are drop-in replacements at the HTTP level — NO changes required to `GitHubWriteClient` internals

### 2.3 Reverse-Git Engine & Registry

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `src/core/reverse-sync-engine.ts` | **CORE ENGINE** — `initReverseLink`, `pushReverseLink`, `removeReverseLink`, `listReverseLinks` | 842 | `initReverseLink`, `pushReverseLink` (both resolve PAT via credential store) |
| `src/core/reverse-link-registry.ts` | Persistence layer for container/account-scope reverse-links | 231 | `loadContainerReverseLinks`, `saveContainerReverseLinks`, `loadAccountReverseLinks`, `saveAccountReverseLinks` |
| `src/core/reverse-diff-engine.ts` | Diff computation between storage snapshot and last-pushed state | 184 | `computeReverseDiff` |

**PAT resolution chain (current):**
1. `reverse-sync-engine.ts` → `getReverseLinkPAT(linkId)` (from credential store)
2. If undefined → `getTokenByProvider(link.provider)` (first PAT for provider)
3. If undefined → `ConfigurationError` (no fallback)

**Extension point for GitHub App:**
- **R4.1 (credential resolution chain):** `--github-app-name <name>` → `--github-app-inline <json>` → `--pat <inline>` → `--token-name <name>` → first stored PAT
- **R5.1–R5.4 (reverse-link metadata):** add `authType?: "pat" | "github-app"` and `authCredentialName?: string` to `ReverseLink`
- **R8.2 (`buildWriteClientForLink`):** when `authType === "github-app"`, resolve GitHub App credentials, generate installation token, pass to `GitHubWriteClient` constructor

### 2.4 CLI Commands

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `src/cli/index.ts` | Commander.js entry point — registers all 50+ subcommands | 837 | N/A (side-effect: registers commands) |
| `src/cli/commands/reverse-git.ts` | **PRIMARY CLI SURFACE** — 7 reverse-git subcommands (`publish-github`, `reverse-link-github`, `push`, etc.) | 785 | `publishGitHub`, `reverseLinkGitHub`, `pushReverseLinkCmd`, `reverseUnlink`, `listReverseLinksCmd` |
| `src/cli/commands/token-ops.ts` | PAT management — `add-token`, `list-tokens`, `remove-token` | 44 | `addToken`, `listTokens`, `removeToken` |
| `src/cli/commands/shared.ts` | Shared resolution helpers for storage + PAT credentials | 148 | `resolveStorageEntry`, `resolvePatToken`, `promptYesNo` |

**CLI extension plan (R6.1–R6.5):**
- Add `add-github-app`, `list-github-apps`, `remove-github-app` subcommands (analogous to `token-ops.ts`)
- Extend all reverse-git publication commands with `--github-app-name <name>` and `--github-app-inline <json>` flags
- Error messages for missing/invalid GitHub App credentials must explicitly guide the user

### 2.5 Electron Desktop UI

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `src/electron/main.ts` | Electron main process — starts Express server, opens BrowserWindow, handles IPC | 224 | N/A (side-effect: launches Electron) |
| `src/electron/public/app.js` | **PRIMARY UI LOGIC** — tree explorer, token modal, publish modal, reverse-links panel | 2765 | N/A (self-contained IIFE) |
| `src/electron/public/index.html` | UI structure — modals for token/publish/link management | 1 file | N/A |
| `src/electron/server.ts` | Express server exposing `/api/*` endpoints for renderer | 146 | `createServer` |
| `src/electron/site-routes.ts` | Route handlers for forward-sync, reverse-git, tokens | 1158 | N/A (Express middleware) |

**Electron UI token management (lines 2083–2225 of `app.js`):**
- **Add Token Modal:** `addTokenModal` (lines 123, 2083–2118) — user provides `name`, `provider`, `token`, optional `expiresAt`
- **Publish Modal Token Selector:** `publishToken` dropdown (line 96) — populated from `/api/tokens?provider=<provider>` (lines 2177–2191)
- **Publish Add Token Button:** `publishAddToken` (line 97) — opens `addTokenModal` with provider pre-selected, auto-populates new token into selector (line 2118)

**UI extension plan (R7.1–R7.4):**
- Add "GitHub Apps" section to settings modal (analogous to token panel)
- GitHub Apps section: add (form with `name`, `appId`, `installationId`, private key PEM textarea), list (table with metadata + "Remove" button), remove (confirmation dialog)
- Publish modal credential selector: extend to show BOTH PATs and GitHub Apps (visually distinct — e.g., PAT icon 🔑 vs App icon ⚙️)
- Reverse-links panel: display `authType` and `authCredentialName` for each link (new column: "Auth: GitHub App (my-app)")

### 2.6 API Backend (HTTP Broker)

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `API/src/routes/blobs.ts` | Blob enumeration, download, upload routes | 374 | N/A (Express middleware) |
| `API/src/routes/storages.ts` | Storage account listing, token CRUD | 178 | N/A (Express middleware) |
| `API/src/app.ts` | Express app setup, OIDC middleware, RBAC enforcement | 212 | `buildApp` |

**Note:** The API backend does NOT implement reverse-git operations (those are CLI/UI-only). GitHub App credential management WILL surface via the API's `/api/tokens` endpoints (extended to handle `GitHubAppEntry` alongside `TokenEntry`).

---

## 3. Integration Points — Request-Driven Analysis

**Scope:** Files directly touched by GitHub App authentication implementation, classified as **In-Scope** (must be modified), **Out-of-Scope** (untouched by this feature), or **New Integration Point** (new files to be created).

### 3.1 In-Scope — Core Data Model & Credential Store

| File | Reason | Change Summary |
|------|--------|----------------|
| `src/core/types.ts` | **R1.1** — extend `CredentialData` type | Add optional `githubApps?: GitHubAppEntry[]` field (backward compatible, defaults to `[]`) |
| `src/core/reverse-git-types.ts` | **R1.2, R5.1–R5.2** — new types + extend `ReverseLink` | Add `GitHubAppEntry` interface, extend `ReverseLink` with `authType?: "pat" \| "github-app"` and `authCredentialName?: string` |
| `src/core/credential-store.ts` | **R1.3, R1.4, R6.1–R6.3** — storage + CRUD methods | Add `addGitHubApp`, `listGitHubApps`, `removeGitHubApp`, `getGitHubApp` methods; `githubApps` encrypted alongside `tokens` in AES-256-GCM envelope |

**Backward compatibility verification:**
- Existing `credentials.json` without `githubApps` → loads successfully, `listGitHubApps()` returns `[]`
- Private key PEM encrypted in same envelope as PATs (same `deriveKey()` mechanism)
- **AC-BC1:** tested via migration test in `tests/unit/credential-migration.test.ts`

### 3.2 In-Scope — PAT Resolution & Write Client Factory

| File | Reason | Change Summary |
|------|--------|----------------|
| `src/core/repo-utils.ts` | **R8.2, R8.3** — extend `buildWriteClientForLink` | When `link.authType === "github-app"`: (1) resolve `GitHubAppEntry` via `authCredentialName`, (2) generate installation token via new `generateInstallationToken` helper, (3) pass token to `GitHubWriteClient` constructor. **No changes** to `GitHubWriteClient` internals — installation tokens use same Bearer header format. |
| `src/cli/commands/shared.ts` | **R4.1** — new credential resolution helper | Add `resolveGitHubAppToken(store, opts: { githubAppName?, githubAppInline? })` analogous to `resolvePatToken`, returns ephemeral installation token string |

**New helper (to be added in `repo-utils.ts` or new file `src/core/github-app-auth.ts`):**
```typescript
async function generateInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string
): Promise<string>
```
- **R2.1–R2.4:** signs JWT with RSA private key, exchanges for installation token via `POST /app/installations/{id}/access_tokens`
- **NFR4:** ephemeral token (never persisted), regenerated on each operation
- **C1:** requires new JWT library dependency (e.g., `jsonwebtoken@9.x`) — subject to dependency-vetting

### 3.3 In-Scope — Reverse-Git Engine & CLI

| File | Reason | Change Summary |
|------|--------|----------------|
| `src/core/reverse-sync-engine.ts` | **R4.3, R5.3, R8.1** — credential resolution branch | Extend PAT resolution chain: check `link.authType`; if `"github-app"` → resolve via `authCredentialName` + generate installation token; if `"pat"` or undefined → existing PAT chain. Pass resolved token (PAT or installation) to `buildWriteClientForLink`. |
| `src/cli/commands/reverse-git.ts` | **R4.1, R4.2, R6.4** — extend all publication commands | Add `--github-app-name <name>` and `--github-app-inline <json>` flags to `publish-github`, `reverse-link-github`, `push`. Precedence: `--github-app-name` > `--github-app-inline` > `--pat` > `--token-name` > first stored PAT. |
| `src/cli/commands/token-ops.ts` | **R6.1–R6.3** — new CLI subcommands | Add `addGitHubApp`, `listGitHubApps`, `removeGitHubApp` (analogous to `addToken`, `listTokens`, `removeToken`). NO secrets printed in `listGitHubApps` output. |
| `src/cli/index.ts` | **R6.1–R6.3** — register new subcommands | Register `add-github-app`, `list-github-apps`, `remove-github-app` with Commander.js |

**Error handling (R6.5, NFR3):**
- Missing/invalid GitHub App credentials → `ConfigurationError` (exit code 3)
- Installation token generation failures → `GitHubApiError` (exit code 2) with GitHub API error message
- Repository not in installation's selected repositories → `InsufficientScopesError` (exit code 2) with guidance: "Add repo via GitHub UI or switch to PAT"

### 3.4 In-Scope — Electron UI & API Routes

| File | Reason | Change Summary |
|------|--------|----------------|
| `src/electron/public/app.js` | **R7.1–R7.4** — new UI modals + credential selector | Add GitHub Apps settings modal (analogous to token modal at lines 2083–2225); extend publish modal credential selector to show both PATs and GitHub Apps with visual distinction; display `authType` + `authCredentialName` in reverse-links panel table. |
| `src/electron/public/index.html` | **R7.1, R7.2** — new modal structure | Add `<div id="github-apps-modal">` with form fields: `name`, `appId`, `installationId`, `privateKeyPem` (textarea), optional `expiresAt`; add table for listing GitHub Apps with "Remove" buttons. |
| `src/electron/site-routes.ts` | **R7.1–R7.4** — new API endpoints | Add `GET /api/github-apps`, `POST /api/github-apps`, `DELETE /api/github-apps/:name` (mirror existing `/api/tokens` endpoints). Publish modal populates credential selector from both `/api/tokens` and `/api/github-apps`. |

**UI/UX (AC-UX1–UX4):**
- GitHub Apps visually distinct from PATs (different icon, separate settings section)
- Publish modal credential selector shows: "PAT: my-github-token" vs "GitHub App: my-app-install-1"
- Reverse-links panel new column: "Auth: GitHub App (my-app)" or "Auth: PAT (my-token)"
- Private key PEM textarea validates format (basic check: starts with `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----`)

### 3.5 In-Scope — Repository Creation & Scope Addition

| File | Reason | Change Summary |
|------|--------|----------------|
| `src/core/github-write-client.ts` | **R3.1–R3.4** — extend `createRepo` method | After successful `POST /user/repos` or `/orgs/{org}/repos`, extract `repository_id` from response, call `PUT /user/installations/{installation_id}/repositories/{repository_id}` to add repo to installation's selected repositories. If API call fails (403/404), log warning but do NOT fail overall operation. **NOTE:** This addition ONLY applies when creating a repo via GitHub App auth (detected via token type or explicit flag). |

**Scope addition API call (R3.1–R3.4):**
```http
PUT /user/installations/{installation_id}/repositories/{repository_id}
Authorization: Bearer <installation_token>
```
- **R3.3:** failure (403/404) → warning logged/displayed ("Repository created but could not be added to installation's selected repositories. Add manually via GitHub UI."), operation succeeds (exit code 0 or 1)
- **R9.3:** when pushing to a repo NOT in installation scope → `InsufficientScopesError` with guidance

**Open question:** How does `GitHubWriteClient` know which `installationId` to use for the scope-addition call?
- **Proposed solution:** extend `GitHubWriteClient` constructor with optional `installationId?: string` parameter; when set, `createRepo` performs the scope-addition call after repo creation; when undefined (PAT auth), skip the call.

### 3.6 Out-of-Scope — Forward-Sync (Repo → Container)

| Files | Reason |
|-------|--------|
| `src/core/sync-engine.ts` | Forward-sync uses READ-ONLY GitHub Client (`GitHubClient`) — no write operations, no PAT needed for public repos, GitHub App auth not applicable (AC-BC3) |
| `src/core/diff-engine.ts` | Diff computation (forward-sync) — read-only, no auth changes |
| `src/cli/commands/repo-sync.ts` | `clone-github`, `sync` commands — read-only, out of scope |
| `src/cli/commands/link-ops.ts` | `link-github`, `list-links` — read-only, out of scope |
| `src/cli/commands/diff-ops.ts` | `diff-container` — read-only, out of scope |

**Regression testing (AC-IR3):** all existing Vitest tests for forward-sync MUST pass unchanged after GitHub App implementation.

### 3.7 Out-of-Scope — Azure DevOps

| Files | Reason |
|-------|--------|
| `src/core/devops-client.ts` | Azure DevOps read client — out of scope (A7, OQ7) |
| `src/core/devops-write-client.ts` | Azure DevOps write client — out of scope; equivalent "Azure DevOps App" auth deferred to future phase |
| `src/cli/commands/reverse-git.ts` (`publishDevOps`, `reverseLinkDevOps`) | ADO publication commands — out of scope |

**Design note:** `authType` enum is future-proof (`"pat" | "github-app" | "ado-app"`), but ADO app auth NOT implemented in this phase (OQ7).

### 3.8 New Integration Points — Files to Create

| New File | Purpose | Estimated Lines |
|----------|---------|-----------------|
| `src/core/github-app-auth.ts` | **R2.1–R2.4** — Installation token generation helper | 150–200 |
| `src/cli/commands/github-app-ops.ts` | **R6.1–R6.3** — CLI subcommands for GitHub App CRUD (analogous to `token-ops.ts`) | 60–80 |
| `tests/unit/github-app-auth.test.ts` | Unit tests for installation token generation (JWT signing, API exchange, error handling) | 200–300 |
| `tests/unit/github-app-credential-store.test.ts` | Unit tests for `CredentialStore` GitHub App CRUD methods | 150–200 |
| `tests/unit/github-app-reverse-git.test.ts` | Integration test for GitHub App-based publish/push (full workflow: add credentials → publish → push → verify) | 300–400 |

**Total new code estimate:** ~1,200–1,500 lines (including tests)

---

## 4. Build, Test, and Lint Commands

| Task | Command | Notes |
|------|---------|-------|
| **Build** | `npm run build` | Compiles TypeScript to `dist/` (target: ES2022, module: Node16) |
| **Test (all)** | `npm test` | Runs Vitest test suite (`tests/unit/**/*.test.ts`) |
| **Test (unit only)** | `npm run test:unit` | Subset of tests for core modules |
| **Lint (TypeScript)** | `npx tsc --noEmit` | Type-check without emitting JS (strict mode) |
| **CLI (dev)** | `npm run cli` | Runs CLI via `npx tsx src/cli/index.ts` (no build step) |
| **Desktop UI (dev)** | `npm run ui` | Launches Electron UI via `npx tsx src/cli/index.ts ui` |

**No ESLint/Prettier config detected** — lint surface is TypeScript compiler (`tsc --noEmit`) only.

**Test framework:** Vitest 4.1.5 (happy-dom for DOM tests)

**Entry points:**
- CLI: `src/cli/index.ts` → `bin/storage-nav.mjs` (shebang: `#!/usr/bin/env node`)
- Electron: `src/electron/main.ts` → bundled to `.electron-main.mjs` via esbuild
- API: `API/src/index.ts` → standalone Express server
- Agent: `src/agent/index.ts` → LangGraph ReAct agent (CLI subcommand `agent`)

---

## 5. Conventions & Rules

### 5.1 Error Handling — No Fallback Values (Critical)

**Project rule (from CLAUDE.md):**
> "You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value."

**Applied to GitHub App auth:**
- Missing `appId`, `privateKeyPem`, or `installationId` → `ConfigurationError` (exit code 3), NEVER substitute defaults
- Invalid private key (crypto check fails during JWT signing) → `GitHubApiError` (exit code 2) with clear message: "Private key is malformed or does not match the GitHub App's registered key"
- Revoked/uninstalled GitHub App → `GitHubApiError` (exit code 2): "GitHub App installation is revoked or uninstalled. Verify the app is still installed on the target account."

**Exit codes (plan-011 §R10.11):**
- `0` = success / no-op
- `1` = changes pushed (or would be pushed under `--dry-run`)
- `2` = fatal error (auth, divergence, rate-limit, network)
- `3` = configuration error (missing required value, invalid format)

### 5.2 Encryption & Security

**Credential store encryption (credential-store.ts lines 30–52):**
- **Algorithm:** AES-256-GCM (authenticated encryption, protects against tampering)
- **Key derivation:** 32-byte random key persisted in `~/.storage-navigator/machine.key` (mode `0600`, owner-only read)
- **Payload structure:** `{ iv: string, data: string, tag: string }` (all hex-encoded)
- **Migration:** supports one-time migration from old hostname-based key derivation (macOS hostname instability fix)

**Security rules (NFR1):**
- Private key PEM MUST NEVER be logged, printed to console, or exposed in API responses (same treatment as PATs)
- Installation tokens MUST NOT be persisted to disk (ephemeral, regenerated on each operation)
- `listGitHubApps` CLI output MUST NOT print `privateKeyPem` (only metadata: `name`, `appId`, `installationId`, `addedAt`, `expiresAt`, `isExpired`)

### 5.3 Type System Conventions

**Discriminated unions (types.ts lines 5–56):**
- `StorageEntry = DirectStorageEntry | ApiBackendEntry` (discriminator: `kind: 'direct' | 'api'`)
- `RepoChange = { kind: "add" | "edit" | "delete", ... }` (reverse-git-types.ts lines 180–182)
- **Future-proof extension:** `authType: "pat" | "github-app" | "ado-app"` (ADO app NOT implemented in this phase)

**Backward compatibility (migration.test.ts):**
- New optional fields default to `[]` or `undefined` when absent in old config files
- No automatic migration writes — only on user-initiated save operations

### 5.4 Reverse-Git Metadata Persistence

**Container/prefix-scope links (reverse-link-registry.ts):**
- Stored in `.reverse-git-links.json` blob at container root
- Schema: `{ schemaVersion: 1, links: ReverseLink[] }`
- **Extension for GitHub App:** `ReverseLink.authType` and `ReverseLink.authCredentialName` fields

**Account-scope links (credential-store.ts lines 376–403):**
- Stored in `CredentialData.reverseLinks` (encrypted alongside credentials)
- Schema: `{ schemaVersion: 1, byAccount: Record<string, ReverseLink[]> }`
- Same extension as container-scope

---

## 6. Dependency Notes

### 6.1 Existing Dependencies (Relevant)

| Package | Version | Purpose | Impact on GitHub App Auth |
|---------|---------|---------|---------------------------|
| `@azure/storage-blob` | ^12.31.0 | Azure Blob SDK | None (storage layer, untouched) |
| `commander` | ^14.0.3 | CLI framework | Used for new GitHub App subcommands |
| `express` | ^5.2.1 | HTTP server (Electron UI + API) | Used for new `/api/github-apps` endpoints |
| `electron` | ^41.1.1 | Desktop UI framework | Used for GitHub App settings modal |
| `vitest` | ^4.1.5 | Test framework | Used for new GitHub App test suites |
| `typescript` | ^6.0.2 | Type system | Strict mode enforced, new types for `GitHubAppEntry` |

**No ESLint detected** — lint surface is `tsc --noEmit` only.

### 6.2 New Dependency Required

**JWT library for GitHub App authentication (R2.1–R2.2, C1):**
- **Candidate:** `jsonwebtoken@9.x` (widely used, actively maintained, supports RSA signing)
- **Purpose:** Sign JWTs with GitHub App private key for installation token exchange
- **Vetting requirement (per AGENTS.md dependency-vetting rule):**
  1. Check GitHub Advisory Database for known CVEs at version `9.x`
  2. Verify latest stable patch has no HIGH/CRITICAL advisories
  3. Pin to caret range (e.g., `"jsonwebtoken": "^9.0.2"`)
  4. Run `npm audit` after installation, confirm zero advisories
  5. Document vetting date in `Issues - Pending Items.md` under "Dependency vetting log"

**Alternative:** `jose@5.x` (modern, smaller footprint, Web Crypto API-based) — evaluate both before final selection.

---

## 7. Test Coverage — Existing Relevant Tests

| Test File | Purpose | Lines | Relevance to GitHub App |
|-----------|---------|-------|-------------------------|
| `tests/unit/credential-store-reverse-links.test.ts` | Tests reverse-link CRUD in credential store | 312 | **HIGH** — must extend to test `GitHubAppEntry` storage + retrieval |
| `tests/unit/github-write-client.test.ts` | Unit tests for `GitHubWriteClient` (mocked fetch) | 632 | **MEDIUM** — verify installation tokens work same as PATs (no client changes needed) |
| `tests/unit/reverse-sync-engine.test.ts` | Integration tests for push/pull engine | 487 | **HIGH** — must extend to test GitHub App credential resolution chain |
| `tests/unit/reverse-git-cli.test.ts` | CLI command tests (publish/push) | 294 | **HIGH** — must extend to test new `--github-app-name` flags |
| `tests/unit/token-store.test.ts` | OIDC token store (Electron UI) | 98 | **LOW** — unrelated (OIDC for API backend, not reverse-git) |
| `tests/unit/credential-migration.test.ts` | Backward-compatibility migration tests | 156 | **HIGH** — must verify old `credentials.json` without `githubApps` loads successfully |

**New tests required (AC-IR1–IR4):**
- `tests/unit/github-app-auth.test.ts` — installation token generation (JWT signing, API exchange, error handling)
- `tests/unit/github-app-credential-store.test.ts` — CRUD operations for `GitHubAppEntry`
- `tests/unit/github-app-reverse-git.test.ts` — end-to-end publish/push with GitHub App credentials

**Regression testing (AC-IR3):** ALL existing tests MUST pass after GitHub App implementation (no breakage of PAT-based workflows).

---

## 8. Documentation Gaps

**Current documentation:**
- `docs/design/plan-011-reverse-git.md` — reverse-git design (PAT-only)
- `docs/design/configuration-guide.md` — credential configuration (PAT + storage)
- `docs/tools/storage-nav.md` — CLI reference (PAT-based reverse-git)
- `docs/research/github-git-data-api.md` — GitHub Git Data API research (tree chunking, blob upload, ref update)

**Required updates (AC-DE1–DE4):**
- `docs/tools/storage-nav.md` — add "GitHub App Authentication" section with:
  - Registration workflow (link to GitHub's docs: Settings → Developer settings → GitHub Apps)
  - Installation setup (install app, select "Only select repositories")
  - Credential storage (`add-github-app` CLI command)
  - Precedence rules (CLI flag chain)
  - Scope model (auto-add created repos, manual add for existing repos)
  - Troubleshooting (insufficient permissions, revoked installation, expired private key)
- `docs/design/configuration-guide.md` — add GitHub App credential fields:
  - `appId` (GitHub App ID as string)
  - `privateKeyPem` (RSA private key in PEM format)
  - `installationId` (installation ID for target account)
  - Optional `clientId`/`clientSecret` (reserved for future OAuth flows)
  - Optional `expiresAt` (private key rotation tracking)
  - Recommended storage practices (never commit private keys to Git, rotate keys periodically, one app per organization)
- `docs/design/plan-011-reverse-git.md` — extend §"Authentication" section to document GitHub App as alternative to PAT
- Inline help text — `storage-nav add-github-app --help` output with example usage and metadata source guidance

---

## 9. Key Integration Points Summary

### 9.1 Files Requiring Modification (Prioritized)

**Tier 1 — Core Data Model (blocking):**
1. `src/core/reverse-git-types.ts` — add `GitHubAppEntry` interface, extend `ReverseLink` with `authType`/`authCredentialName`
2. `src/core/types.ts` — extend `CredentialData` with `githubApps?: GitHubAppEntry[]`
3. `src/core/credential-store.ts` — add `addGitHubApp`, `listGitHubApps`, `removeGitHubApp`, `getGitHubApp`

**Tier 2 — Authentication & Write Client (core logic):**
4. `src/core/github-app-auth.ts` (NEW) — installation token generation helper
5. `src/core/repo-utils.ts` — extend `buildWriteClientForLink` to handle GitHub App credentials
6. `src/cli/commands/shared.ts` — add `resolveGitHubAppToken` helper

**Tier 3 — Engine & CLI (orchestration):**
7. `src/core/reverse-sync-engine.ts` — extend PAT resolution chain to branch on `authType`
8. `src/cli/commands/github-app-ops.ts` (NEW) — CLI CRUD subcommands
9. `src/cli/commands/reverse-git.ts` — add `--github-app-name`/`--github-app-inline` flags to all publication commands
10. `src/cli/index.ts` — register new GitHub App subcommands

**Tier 4 — UI & API (presentation):**
11. `src/electron/public/app.js` — GitHub Apps settings modal + publish modal credential selector
12. `src/electron/public/index.html` — modal HTML structure
13. `src/electron/site-routes.ts` — `/api/github-apps` endpoints

**Tier 5 — Repository Creation Enhancement (optional but recommended):**
14. `src/core/github-write-client.ts` — extend `createRepo` to add repo to installation's selected repositories

### 9.2 Unmodified Files (Out-of-Scope Confirmation)

**Forward-sync (read-only, no auth changes):**
- `src/core/sync-engine.ts`
- `src/core/diff-engine.ts`
- `src/cli/commands/repo-sync.ts`
- `src/cli/commands/link-ops.ts`
- `src/cli/commands/diff-ops.ts`

**Azure DevOps (future phase):**
- `src/core/devops-client.ts`
- `src/core/devops-write-client.ts`

**API backend (no reverse-git operations):**
- `API/src/routes/blobs.ts`
- `API/src/routes/containers.ts`
- (except `API/src/routes/storages.ts` for token/GitHub App CRUD)

---

## 10. Open Questions & Decisions

**Resolved (per refined-request OQ1–OQ7):**
- **OQ1 (client ID/secret):** optional fields on `GitHubAppEntry`, reserved for future OAuth flows, not implemented in this phase
- **OQ2 (multiple installations):** one credential entry per installation with user-defined names (e.g., "my-app-personal", "my-app-work")
- **OQ3 (installation health check):** no background checks; token generation failure surfaces error at operation time
- **OQ4 (scope addition retry):** no retry in v1; fail fast with warning; repository is created, user adds manually
- **OQ5 (key format validation):** basic validation (starts with `-----BEGIN`), defer cryptographic check to JWT signing attempt
- **OQ6 (token caching):** in-memory cache per CLI command/UI action, keyed by `installationId`, flushed at command exit
- **OQ7 (Azure DevOps equivalence):** `authType` is future-proof (`"pat" | "github-app" | "ado-app"`), but ADO app auth NOT implemented in this phase

**Remaining (for implementation phase):**
- **IQ1 (installation ID in `GitHubWriteClient`):** extend constructor with optional `installationId?: string` parameter, or pass as context via options object?
- **IQ2 (JWT library choice):** `jsonwebtoken@9.x` vs `jose@5.x` — evaluate bundle size, API ergonomics, crypto backend (Node.js crypto vs Web Crypto)
- **IQ3 (token cache location):** in-memory only (per NFR4) OR persist encrypted cache with 1-hour TTL for CLI performance optimization?

---

## Appendix A: File-by-File Detailed Analysis

### A.1 `src/core/credential-store.ts` (442 lines)

**Current structure:**
- `CredentialData` schema: `{ storages: StorageEntry[], tokens?: TokenEntry[], reverseLinks?: AccountScopeReverseLinksRegistry, reverseLinkPatBindings?: ReverseGitLinkPATBinding[] }`
- AES-256-GCM encryption with machine-derived key (`~/.storage-navigator/machine.key`)
- PAT CRUD: `addToken`, `getToken`, `getTokenByProvider`, `listTokens`, `removeToken`

**Required changes (R1.1–R1.4, R6.1–R6.3):**
1. Extend `CredentialData` type with `githubApps?: GitHubAppEntry[]` (backward compatible)
2. Add CRUD methods:
   ```typescript
   addGitHubApp(entry: Omit<GitHubAppEntry, "addedAt">): void
   getGitHubApp(name: string): GitHubAppEntry | undefined
   listGitHubApps(): Array<{ name, appId, installationId, addedAt, expiresAt, isExpired }>
   removeGitHubApp(name: string): boolean
   ```
3. Encryption: private key PEM encrypted in same AES-256-GCM envelope (no changes to encryption logic)

**Migration (backward compatibility):**
- Missing `githubApps` field → default to `[]` (no migration write on read)
- Test: `tests/unit/credential-migration.test.ts` — verify old config loads successfully

---

### A.2 `src/core/reverse-git-types.ts` (353 lines)

**Current structure:**
- `ReverseLink` interface (lines 66–103): `id`, `scope`, `provider`, `repoUrl`, `branch`, `tokenName`, `author`, `exclusionPatterns`, `respectGitignore`, `createRepo`, `visibility`, `lastPushedAt`, `lastPushedCommitSha`, `lastPushedTreeSha`, `blobSnapshot`, `createdAt`, `lastPushResult`
- `RepoWriteClient` interface (lines 167–253): `ensureRepo`, `getBranchTip`, `createCommit`, `getOrCreateRepo`, `getCurrentRefSha`, `listRepoFiles`, `pushChanges`, `bootstrapEmpty`

**Required changes (R1.2, R5.1–R5.2):**
1. Add `GitHubAppEntry` interface:
   ```typescript
   export interface GitHubAppEntry {
     name: string;
     appId: string;
     privateKeyPem: string;
     installationId: string;
     clientId?: string;
     clientSecret?: string;
     addedAt: string;
     expiresAt?: string;
   }
   ```
2. Extend `ReverseLink`:
   ```typescript
   authType?: "pat" | "github-app";
   authCredentialName?: string;
   ```
3. Default behavior (backward compatibility): when `authType` is undefined, default to `"pat"` resolution

---

### A.3 `src/core/repo-utils.ts` (181 lines)

**Current structure (line 67):**
```typescript
export function buildWriteClientForLink(
  link: ReverseLink,
  pat: string,
): RepoWriteClient {
  if (!pat) throw new Error("missing PAT");
  if (link.provider === "github") return GitHubWriteClient.fromRepoUrl(pat, link.repoUrl);
  if (link.provider === "azure-devops") return DevOpsWriteClient.fromRepoUrl(pat, link.repoUrl);
  throw new Error(`unsupported provider '${link.provider}'`);
}
```

**Required changes (R8.2):**
1. Rename parameter `pat` → `token` (can be PAT or installation token)
2. When `link.provider === "github"`:
   - Pass `token` to `GitHubWriteClient.fromRepoUrl(token, link.repoUrl)`
   - If `link.authType === "github-app"` AND repo creation is needed, extend `GitHubWriteClient` constructor to accept `installationId` for scope-addition call
3. No changes to `DevOpsWriteClient` (ADO out of scope)

**Alternative design (cleaner):**
- Keep `buildWriteClientForLink` signature unchanged (accepts `token: string`)
- Credential resolution (PAT vs GitHub App → installation token) happens in `reverse-sync-engine.ts` BEFORE calling `buildWriteClientForLink`
- This file remains provider-agnostic (no GitHub App-specific logic)

---

### A.4 `src/core/reverse-sync-engine.ts` (842 lines)

**Current PAT resolution (lines 487–512):**
```typescript
async function initReverseLink(opts: InitReverseLinkOptions): Promise<ReverseLink> {
  const { store, provider, repoUrl, branch, tokenName, ... } = opts;
  const token = tokenName
    ? store.getToken(tokenName)?.token
    : store.getTokenByProvider(provider)?.token;
  if (!token) throw new ConfigurationError(`No ${provider} token available`);
  // ... use token to build write client
}
```

**Required changes (R4.3, R5.3):**
1. Extend `InitReverseLinkOptions` with `githubAppName?: string`, `githubAppInline?: object`
2. Credential resolution precedence:
   ```typescript
   let token: string;
   let authType: "pat" | "github-app" | undefined;
   let authCredentialName: string | undefined;

   if (opts.githubAppName || opts.githubAppInline) {
     // GitHub App auth
     const appEntry = opts.githubAppInline
       ? opts.githubAppInline
       : store.getGitHubApp(opts.githubAppName!);
     if (!appEntry) throw new ConfigurationError(`GitHub App '${opts.githubAppName}' not found`);
     token = await generateInstallationToken(appEntry.appId, appEntry.privateKeyPem, appEntry.installationId);
     authType = "github-app";
     authCredentialName = opts.githubAppName ?? "(inline)";
   } else {
     // PAT auth (existing chain)
     token = tokenName ? store.getToken(tokenName)?.token : store.getTokenByProvider(provider)?.token;
     if (!token) throw new ConfigurationError(`No ${provider} token available`);
     authType = "pat";
     authCredentialName = tokenName ?? "(first for provider)";
   }
   ```
3. Save `authType` and `authCredentialName` in `ReverseLink` record

---

### A.5 `src/cli/commands/reverse-git.ts` (785 lines)

**Current publication command (lines 201–250):**
```typescript
export async function publishGitHub(opts: StorageOpts & PatOpts & ReverseScopeOpts & PublishTargetOpts): Promise<void> {
  const { store, entry } = await resolveStorageEntry(opts);
  const token = await resolvePatToken(store, "github", opts);
  const scope = buildScope(entry as DirectStorageEntry, opts);
  const result = await initReverseLink({
    store,
    provider: "github",
    repoUrl: opts.repo,
    branch: opts.branch ?? "main",
    tokenName: opts.tokenName,
    scope,
    ...
  });
  // ... render result
}
```

**Required changes (R4.1, R4.2, R6.4):**
1. Extend option interfaces:
   ```typescript
   export interface PublishTargetOpts {
     ...
     githubAppName?: string;
     githubAppInline?: string; // JSON string
   }
   ```
2. Commander.js flag registration (in `src/cli/index.ts`):
   ```javascript
   program.command("publish-github")
     .option("--github-app-name <name>", "GitHub App credential name")
     .option("--github-app-inline <json>", "Inline GitHub App credentials (JSON)")
     ...
   ```
3. Credential resolution chain (replace `resolvePatToken` call):
   ```typescript
   let token: string;
   if (opts.githubAppName || opts.githubAppInline) {
     const resolved = await resolveGitHubAppToken(store, opts);
     token = resolved.token;
   } else {
     token = await resolvePatToken(store, "github", opts);
   }
   ```
4. Same changes for `reverseLinkGitHub`, `pushReverseLinkCmd`

---

### A.6 `src/electron/public/app.js` (2765 lines)

**Current token modal (lines 2083–2118):**
```javascript
publishAddToken.addEventListener("click", () => {
  addTokenMessage.textContent = "Add a new GitHub or Azure DevOps personal access token.";
  addTokenProvider.value = publishProvider.value || "github";
  addTokenModal.classList.remove("hidden");
});

addTokenSave.addEventListener("click", async () => {
  const name = addTokenName.value.trim();
  const provider = addTokenProvider.value;
  const token = addTokenValue.value.trim();
  if (!name || !token) { alert("Name and token are required."); return; }
  try {
    await apiJson("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, provider, token }) });
    alert(`Token '${name}' added.`);
    addTokenModal.classList.add("hidden");
    publishToken.value = name; // auto-select the new token
  } catch (err) { alert(`Failed to add token: ${err.message}`); }
});
```

**Required changes (R7.1–R7.4):**
1. **Add GitHub Apps modal** (new HTML + JS, lines ~2230–2330):
   ```html
   <div id="github-apps-modal" class="modal hidden">
     <h3>Add GitHub App</h3>
     <label>Name: <input id="github-app-name" /></label>
     <label>App ID: <input id="github-app-id" /></label>
     <label>Installation ID: <input id="github-app-installation-id" /></label>
     <label>Private Key (PEM): <textarea id="github-app-pem"></textarea></label>
     <label>Expires At (optional): <input id="github-app-expires-at" type="date" /></label>
     <button id="github-app-save">Save</button>
     <button id="github-app-cancel">Cancel</button>
   </div>
   ```
2. **Extend publish modal credential selector** (lines ~2177–2191):
   - Fetch both `/api/tokens?provider=github` AND `/api/github-apps`
   - Render dropdown with sections: `<optgroup label="PATs">` and `<optgroup label="GitHub Apps">`
   - Option format: `PAT: my-token` vs `GitHub App: my-app`
3. **Reverse-links panel auth column** (lines ~1800–1900):
   - Add column: `Auth: ${link.authType === "github-app" ? "GitHub App" : "PAT"} (${link.authCredentialName})`

---

## Appendix B: Test Suite Coverage Plan

**Existing tests to extend:**
1. `tests/unit/credential-store-reverse-links.test.ts` → add GitHub App CRUD tests
2. `tests/unit/reverse-sync-engine.test.ts` → add GitHub App credential resolution tests
3. `tests/unit/reverse-git-cli.test.ts` → add `--github-app-name` flag tests
4. `tests/unit/credential-migration.test.ts` → verify backward compatibility (old config without `githubApps`)

**New test files:**
1. `tests/unit/github-app-auth.test.ts` — installation token generation (mock fetch)
2. `tests/unit/github-app-credential-store.test.ts` — CRUD operations for `GitHubAppEntry`
3. `tests/unit/github-app-reverse-git.test.ts` — end-to-end publish/push with GitHub App (integration test)

**Total test coverage estimate:** +800–1,000 lines of test code

---

## Appendix C: Dependency Vetting Checklist

**New dependency:** `jsonwebtoken@9.x` (or `jose@5.x` as alternative)

**Vetting procedure (per AGENTS.md dependency-vetting rule):**
1. ☐ Identify latest stable version (e.g., `npm view jsonwebtoken versions --json | tail -10`)
2. ☐ Check GitHub Advisory Database for known CVEs at latest version
3. ☐ If HIGH/CRITICAL advisories exist, bump to next non-vulnerable version
4. ☐ Pin to caret range in `package.json`: `"jsonwebtoken": "^9.0.2"`
5. ☐ Install and run `npm audit`, confirm zero HIGH/CRITICAL advisories
6. ☐ Document vetting date in `Issues - Pending Items.md` under "Dependency vetting log"

**Evaluation criteria (if choosing between libraries):**
- Bundle size (smaller preferred for CLI startup time)
- API ergonomics (RSA signing with PEM input)
- Crypto backend (Node.js crypto vs Web Crypto API)
- Maintenance status (last release date, open issues, GitHub stars)

---

**END OF CODEBASE SCAN**
