# Implementation Plan — GitHub App Authentication

**Plan ID:** 012  
**Created:** 2026-06-14  
**Status:** Ready for Design Review  
**Scope:** Add GitHub App authentication as an additional auth method alongside PAT for reverse-git publication

---

## Provenance Chain

This plan is derived from the following authoritative artifacts:

- **REFINED_REQUEST_FILE:** `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-github-app-auth.md`
- **CODEBASE_SCAN_FILE:** `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-github-app-auth.md`
- **INVESTIGATION_FILE:** `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/investigation-github-app-auth.md`
- **TECHNICAL_RESEARCH_FILES:**
  - `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/research/github-app-installation-auth-and-repo-scope.md`
  - `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/research/jose-rs256-github-app-jwt.md`

All open questions from the refined request were resolved by user confirmation on 2026-06-14.

---

## Goal

Add GitHub App installation-token authentication to storage-navigator's reverse-git feature, enabling scoped repository creation limited to exactly the repos the app creates, while maintaining full backward compatibility with the existing PAT-based authentication flow.

---

## Critical Design Decisions (Pre-Settled)

**These decisions are FINAL and must be baked into the implementation — no changes without user approval.**

1. **Additive, not replacement:** GitHub App auth is a NEW option alongside PAT. PAT flow remains unchanged. Missing `githubApps` field defaults to `[]` with no migration write on read.

2. **JWT library choice:** Use `jose@^6.2.3` (zero deps, Web Crypto API-based, vetted clean 2026-06-14). Must pass through dependency-validation skill before install.

3. **Auth abstraction pattern:** Token-provider resolver that returns a bearer token string. The existing `GitHubWriteClient` (raw fetch, takes bearer string) stays UNCHANGED. Installation tokens use the same `Authorization: Bearer <token>` header.

4. **CRITICAL boundary mechanism (from research):**
   - Installation tokens CREATE repos (org: `POST /orgs/{org}/repos` with Administration:write; user account creation: assumed working, needs empirical check).
   - Adding created repo to "select repositories" installation requires a **CLASSIC PAT with `repo` scope** — installation tokens CANNOT call `PUT /user/installations/{id}/repositories/{repo_id}`.
   - **Design:** Optional companion PAT reference stored in `GitHubAppEntry`. Attempt scope-add via PUT; if 403/404, warn user with manual GitHub-UI instructions. NO retry in v1 (per OQ4).
   - This graceful-degradation approach is consistent with user's "via additional tokens" intent.

5. **Token caching:** In-memory only, keyed by `installationId`, lifetime = single CLI command / UI action (per OQ6). Never persisted to disk (NFR1).

6. **Surfaces:** CLI + Electron desktop UI both required. Agent tools NOT required unless trivially free.

7. **Provider scope:** GitHub only. Azure DevOps later (out of scope now), but `authType` discriminator must be extensible (`"pat" | "github-app" | "ado-app"`).

8. **Credential storage:** New `GitHubAppEntry` stored in existing encrypted `~/.storage-navigator/credentials.json` (AES-256-GCM). Fields: `name`, `appId`, `privateKeyPem`, `installationId`, optional `clientId`/`clientSecret` (reserved for future OAuth), optional companion PAT token name for scope-add, optional `expiresAt`.

9. **Project rule:** NO fallback values for missing config — raise explicit errors (ConfigurationError exit 3).

---

## Phases & Tasks

### Phase 0: Dependency Vetting & Prerequisites (Blocking)

**Purpose:** Vet `jose` library and prepare build environment before any code changes.

#### Task 0.1: Dependency Validation for `jose`

**File:** N/A (validation only)

**Changes:**
1. Run dependency-validation skill (or manual vetting if skill unavailable):
   ```bash
   # Check latest stable version
   npm view jose versions --json | tail -10
   
   # Search GitHub Advisory Database
   # URL: https://github.com/advisories?query=jose
   
   # Verify zero transitive dependencies
   npm view jose@6.2.3 dependencies
   
   # Install candidate version
   npm install jose@6.2.3
   
   # Run audit
   npm audit
   
   # Confirm zero HIGH/CRITICAL advisories
   ```

2. Document vetting in `Issues - Pending Items.md` under "Dependency vetting log" section:
   ```markdown
   | 2026-06-14 | jose | ^6.2.3 | 0 (OSV, npm audit) | APPROVED | Zero deps, Web Crypto API, GitHub App JWT signing |
   ```

**Acceptance:**
- `jose@^6.2.3` added to `package.json` dependencies
- `npm audit` returns 0 HIGH+ advisories
- Vetting record exists in `Issues - Pending Items.md`

**Risk:** Low — research confirmed zero vulnerabilities in 6.2.3.

---

### Phase 1: Core Data Model & Type Definitions (Foundation)

**Purpose:** Extend type system and credential store schema without touching any logic.

#### Task 1.1: Extend Type Definitions

**File:** `src/core/reverse-git-types.ts`

**Changes:**
1. Add `GitHubAppEntry` interface (lines ~354–366, after existing types):
   ```typescript
   /**
    * GitHub App credential entry for installation-token authentication.
    * Stored encrypted in CredentialData.githubApps.
    */
   export interface GitHubAppEntry {
     /** User-defined name (unique within githubApps array) */
     name: string;
     /** GitHub App ID (from app settings) */
     appId: string;
     /** RSA private key in PKCS#1 or PKCS#8 PEM format (encrypted at rest) */
     privateKeyPem: string;
     /** Installation ID for the target account/org */
     installationId: string;
     /** Optional OAuth client ID (reserved for future user-to-server flows) */
     clientId?: string;
     /** Optional OAuth client secret (reserved for future) */
     clientSecret?: string;
     /** Optional stored PAT name for repo-scope addition (graceful degradation) */
     companionPatTokenName?: string;
     /** ISO 8601 timestamp when credential was added */
     addedAt: string;
     /** Optional ISO 8601 timestamp for private key rotation tracking */
     expiresAt?: string;
   }
   ```

2. Extend `ReverseLink` interface (lines ~66–103, add two optional fields):
   ```typescript
   export interface ReverseLink {
     // ... existing fields ...
     
     /** Auth method used for this link (default "pat" for backward compat) */
     authType?: "pat" | "github-app";
     
     /** Name of the credential (PAT or GitHub App) used for this link */
     authCredentialName?: string;
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes (no type errors)
- New types exported from module

**Risk:** None — pure type additions, no runtime changes.

---

#### Task 1.2: Extend Credential Store Schema

**File:** `src/core/types.ts`

**Changes:**
1. Import `GitHubAppEntry` from `reverse-git-types.ts` (line ~5):
   ```typescript
   export type {
     // ... existing exports ...
     GitHubAppEntry,
   } from "./reverse-git-types.js";
   ```

2. Extend `CredentialData` interface (lines ~180–195, add optional field):
   ```typescript
   export interface CredentialData {
     storages: StorageEntry[];
     tokens?: TokenEntry[];
     githubApps?: GitHubAppEntry[];  // NEW — defaults to [] when missing
     reverseLinks?: AccountScopeReverseLinksRegistry;
     reverseLinkPatBindings?: ReverseGitLinkPATBinding[];
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing code that reads `CredentialData` compiles unchanged (backward compatible)

**Risk:** None — optional field, no migration required.

---

### Phase 2: GitHub App Authentication Core (JWT + Token Generation)

**Purpose:** Implement installation token generation with in-memory caching.

#### Task 2.1: Create GitHub App Auth Module

**File:** `src/core/github-app-auth.ts` (NEW, ~250 lines)

**Changes:**
1. Create new file with imports:
   ```typescript
   import { SignJWT, importPKCS8 } from 'jose';
   import { createPrivateKey, KeyObject } from 'crypto';
   import { GitHubApiError, InvalidPATError } from './reverse-git-errors.js';
   ```

2. Implement PEM validation helper (~40 lines):
   ```typescript
   function validatePrivateKeyPem(pem: string): { format: 'pkcs1' | 'pkcs8' } {
     // Regex checks for PKCS#1, PKCS#8, common mistakes (public key, certificate, encrypted)
     // Throw descriptive errors with user-friendly messages
   }
   ```

3. Implement JWT generation (~50 lines):
   ```typescript
   async function generateGitHubAppJWT(
     appId: string,
     privateKeyPem: string
   ): Promise<string> {
     // 1. Validate appId is numeric string
     // 2. Import key via crypto.createPrivateKey (handles both PKCS#1 and PKCS#8)
     // 3. Sign JWT with jose.SignJWT:
     //    - alg: RS256, typ: JWT
     //    - iat: now - 60 (clock skew tolerance)
     //    - exp: now + 600 (GitHub max 10 minutes)
     //    - iss: appId
   }
   ```

4. Implement in-memory token cache (~30 lines):
   ```typescript
   // Module-level Map
   const installationTokenCache = new Map<string, {
     token: string;
     expiresAt: number;
   }>();
   
   // Helper to clear cache (for testing)
   export function clearInstallationTokenCache(): void {
     installationTokenCache.clear();
   }
   ```

5. Implement installation token generation (~80 lines):
   ```typescript
   export async function generateInstallationToken(
     appId: string,
     privateKeyPem: string,
     installationId: string
   ): Promise<string> {
     // 1. Check cache (keyed by installationId)
     //    - If cached and expiresAt > now + 60_000 (1-minute safety margin), return cached token
     // 2. Generate JWT via generateGitHubAppJWT
     // 3. Exchange JWT for installation token:
     //    POST https://api.github.com/app/installations/{installationId}/access_tokens
     //    Authorization: Bearer {jwt}
     // 4. Handle errors:
     //    - 401: InvalidPATError (JWT expired or malformed)
     //    - 403: InsufficientScopesError (installation suspended)
     //    - 404: GitHubApiError (installation not found or uninstalled)
     // 5. Cache token with expiresAt = now + 3600_000 (1 hour)
     // 6. Return token string
   }
   ```

6. Export types and functions:
   ```typescript
   export { validatePrivateKeyPem, generateGitHubAppJWT, generateInstallationToken };
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Module compiles without errors
- Unit tests (Phase 6) verify JWT structure and token caching

**Risk:** Medium — depends on `jose` library and GitHub API behavior.

---

### Phase 3: Credential Store CRUD Operations

**Purpose:** Add GitHub App credential management methods to `CredentialStore`.

#### Task 3.1: Extend CredentialStore with GitHub App CRUD

**File:** `src/core/credential-store.ts`

**Changes:**
1. Add methods after existing token CRUD (lines ~442+, ~120 new lines):
   ```typescript
   /** Add or update a GitHub App credential */
   addGitHubApp(entry: Omit<GitHubAppEntry, "addedAt">): void {
     if (!this.data.githubApps) this.data.githubApps = [];
     const existing = this.data.githubApps.findIndex((a) => a.name === entry.name);
     const full: GitHubAppEntry = { ...entry, addedAt: new Date().toISOString() };
     if (existing >= 0) {
       this.data.githubApps[existing] = full;
     } else {
       this.data.githubApps.push(full);
     }
     this.save();
   }

   /** Get a GitHub App by name */
   getGitHubApp(name: string): GitHubAppEntry | undefined {
     return this.data.githubApps?.find((a) => a.name === name);
   }

   /** List all GitHub Apps (no secrets exposed) */
   listGitHubApps(): Array<{
     name: string;
     appId: string;
     installationId: string;
     addedAt: string;
     expiresAt: string | null;
     isExpired: boolean;
     hasCompanionPat: boolean;
   }> {
     return (this.data.githubApps ?? []).map((a) => ({
       name: a.name,
       appId: a.appId,
       installationId: a.installationId,
       addedAt: a.addedAt,
       expiresAt: a.expiresAt ?? null,
       isExpired: a.expiresAt ? new Date(a.expiresAt) < new Date() : false,
       hasCompanionPat: !!a.companionPatTokenName,
     }));
   }

   /** Remove a GitHub App by name */
   removeGitHubApp(name: string): boolean {
     if (!this.data.githubApps) return false;
     const before = this.data.githubApps.length;
     this.data.githubApps = this.data.githubApps.filter((a) => a.name !== name);
     if (this.data.githubApps.length < before) {
       this.save();
       return true;
     }
     return false;
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing credential store tests pass (backward compatibility)
- New unit tests (Phase 6) verify CRUD operations

**Risk:** Low — follows existing token CRUD pattern.

---

### Phase 4: CLI Commands for GitHub App Management

**Purpose:** Add CLI subcommands for GitHub App credential CRUD.

#### Task 4.1: Create GitHub App CLI Command Module

**File:** `src/cli/commands/github-app-ops.ts` (NEW, ~80 lines)

**Changes:**
1. Create file with imports:
   ```typescript
   import { CredentialStore } from "../../core/credential-store.js";
   import { readFileSync } from "fs";
   import type { GitHubAppEntry } from "../../core/types.js";
   ```

2. Implement `addGitHubApp` command (~30 lines):
   ```typescript
   export async function addGitHubApp(opts: {
     name: string;
     appId: string;
     installationId: string;
     privateKeyFile: string;
     clientId?: string;
     clientSecret?: string;
     companionPatName?: string;
     expiresAt?: string;
   }): Promise<void> {
     const store = new CredentialStore();
     const privateKeyPem = readFileSync(opts.privateKeyFile, "utf-8");
     
     // Validate PEM format (basic check)
     if (!privateKeyPem.includes("-----BEGIN")) {
       throw new Error("Invalid private key file: PEM format not detected");
     }
     
     const entry: Omit<GitHubAppEntry, "addedAt"> = {
       name: opts.name,
       appId: opts.appId,
       installationId: opts.installationId,
       privateKeyPem,
       clientId: opts.clientId,
       clientSecret: opts.clientSecret,
       companionPatTokenName: opts.companionPatName,
       expiresAt: opts.expiresAt,
     };
     
     store.addGitHubApp(entry);
     console.log(`GitHub App '${opts.name}' added successfully.`);
   }
   ```

3. Implement `listGitHubApps` command (~20 lines):
   ```typescript
   export async function listGitHubApps(): Promise<void> {
     const store = new CredentialStore();
     const apps = store.listGitHubApps();
     
     if (apps.length === 0) {
       console.log("No GitHub Apps configured.");
       return;
     }
     
     console.log("\nGitHub Apps:");
     console.log("Name".padEnd(20), "App ID".padEnd(15), "Installation ID".padEnd(20), "Added", "Expires", "Has PAT");
     console.log("─".repeat(100));
     
     for (const app of apps) {
       const expires = app.expiresAt
         ? app.isExpired ? `${app.expiresAt} (EXPIRED)` : app.expiresAt
         : "N/A";
       console.log(
         app.name.padEnd(20),
         app.appId.padEnd(15),
         app.installationId.padEnd(20),
         app.addedAt.split("T")[0],
         expires.padEnd(25),
         app.hasCompanionPat ? "Yes" : "No"
       );
     }
   }
   ```

4. Implement `removeGitHubApp` command (~15 lines):
   ```typescript
   export async function removeGitHubApp(opts: { name: string }): Promise<void> {
     const store = new CredentialStore();
     const removed = store.removeGitHubApp(opts.name);
     
     if (removed) {
       console.log(`GitHub App '${opts.name}' removed.`);
     } else {
       console.error(`GitHub App '${opts.name}' not found.`);
       process.exit(1);
     }
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Commands compile without errors
- Integration tests (Phase 6) verify CLI output

**Risk:** Low — follows existing token-ops.ts pattern.

---

#### Task 4.2: Register GitHub App Commands in CLI Entry Point

**File:** `src/cli/index.ts`

**Changes:**
1. Import GitHub App commands (lines ~10–20):
   ```typescript
   import { addGitHubApp, listGitHubApps, removeGitHubApp } from "./commands/github-app-ops.js";
   ```

2. Register `add-github-app` subcommand (lines ~200+):
   ```typescript
   program
     .command("add-github-app")
     .description("Add a GitHub App credential for installation-token authentication")
     .requiredOption("--name <name>", "Credential name (user-defined)")
     .requiredOption("--app-id <id>", "GitHub App ID (from app settings)")
     .requiredOption("--installation-id <id>", "Installation ID for target account/org")
     .requiredOption("--private-key-file <path>", "Path to private key PEM file")
     .option("--client-id <id>", "OAuth client ID (optional, for future use)")
     .option("--client-secret <secret>", "OAuth client secret (optional)")
     .option("--companion-pat-name <name>", "Stored PAT name for repo-scope addition")
     .option("--expires-at <date>", "Private key expiration date (ISO 8601)")
     .action(addGitHubApp);
   ```

3. Register `list-github-apps` subcommand:
   ```typescript
   program
     .command("list-github-apps")
     .description("List all stored GitHub App credentials")
     .action(listGitHubApps);
   ```

4. Register `remove-github-app` subcommand:
   ```typescript
   program
     .command("remove-github-app")
     .description("Remove a GitHub App credential")
     .requiredOption("--name <name>", "GitHub App credential name")
     .action(removeGitHubApp);
   ```

**Acceptance:**
- `npm run build` succeeds
- `npx tsx src/cli/index.ts add-github-app --help` displays correct usage

**Risk:** None — registration only, no logic changes.

---

### Phase 5: Auth Resolution Chain & Reverse-Git Integration

**Purpose:** Integrate GitHub App auth into the reverse-git credential resolution chain.

#### Task 5.1: Extend CLI Shared Credential Resolver

**File:** `src/cli/commands/shared.ts`

**Changes:**
1. Import GitHub App auth functions (lines ~5–10):
   ```typescript
   import { generateInstallationToken } from "../../core/github-app-auth.js";
   import type { GitHubAppEntry } from "../../core/types.js";
   ```

2. Add `GitHubAppOpts` interface (lines ~30+):
   ```typescript
   export interface GitHubAppOpts {
     githubAppName?: string;
     githubAppInline?: string;  // JSON string
   }
   ```

3. Add `resolveGitHubCredential` function (~80 lines, after `resolvePatToken`):
   ```typescript
   /**
    * Resolve GitHub credential (PAT or GitHub App installation token).
    * Precedence: --github-app-name > --github-app-inline > --pat > --token-name > first stored PAT
    */
   export async function resolveGitHubCredential(
     store: CredentialStore,
     provider: "github" | "azure-devops",
     patOpts: PatOpts,
     appOpts: GitHubAppOpts
   ): Promise<{
     token: string;
     authType: "pat" | "github-app";
     credentialName: string;
   }> {
     // 1. GitHub App inline
     if (appOpts.githubAppInline) {
       try {
         const appEntry = JSON.parse(appOpts.githubAppInline) as GitHubAppEntry;
         if (!appEntry.appId || !appEntry.privateKeyPem || !appEntry.installationId) {
           throw new Error("Missing required fields: appId, privateKeyPem, installationId");
         }
         const token = await generateInstallationToken(
           appEntry.appId,
           appEntry.privateKeyPem,
           appEntry.installationId
         );
         return { token, authType: "github-app", credentialName: "(inline)" };
       } catch (err) {
         throw new Error(`Invalid --github-app-inline JSON: ${(err as Error).message}`);
       }
     }
     
     // 2. GitHub App by name
     if (appOpts.githubAppName) {
       const appEntry = store.getGitHubApp(appOpts.githubAppName);
       if (!appEntry) {
         console.error(`GitHub App '${appOpts.githubAppName}' not found.`);
         console.error(`Run 'storage-nav list-github-apps' to see available credentials.`);
         process.exit(3);  // ConfigurationError
       }
       const token = await generateInstallationToken(
         appEntry.appId,
         appEntry.privateKeyPem,
         appEntry.installationId
       );
       return { token, authType: "github-app", credentialName: appOpts.githubAppName };
     }
     
     // 3. PAT resolution (existing chain)
     const pat = await resolvePatToken(store, provider, patOpts);
     return { token: pat, authType: "pat", credentialName: patOpts.tokenName ?? "(first for provider)" };
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Function compiles without errors
- Unit tests (Phase 6) verify precedence chain

**Risk:** Low — extends existing pattern without breaking it.

---

#### Task 5.2: Update Reverse-Git Commands with GitHub App Flags

**File:** `src/cli/commands/reverse-git.ts`

**Changes:**
1. Import new resolver (lines ~5–10):
   ```typescript
   import { resolveGitHubCredential, type GitHubAppOpts } from "./shared.js";
   ```

2. Extend `publishGitHub` function signature (lines ~201+, add `appOpts` parameter):
   ```typescript
   export async function publishGitHub(
     opts: StorageOpts & PatOpts & GitHubAppOpts & ReverseScopeOpts & PublishTargetOpts
   ): Promise<void> {
     const { store, entry } = await resolveStorageEntry(opts);
     
     // NEW: resolve GitHub credential (PAT or GitHub App)
     const { token, authType, credentialName } = await resolveGitHubCredential(
       store,
       "github",
       opts,
       opts
     );
     
     // ... rest of existing logic, replace `resolvePatToken` with above
   }
   ```

3. Same changes for `reverseLinkGitHub` and `pushReverseLinkCmd` (~40 lines total across 3 functions).

4. Store `authType` and `authCredentialName` in reverse-link metadata (lines ~320+):
   ```typescript
   const result = await initReverseLink({
     store,
     provider: "github",
     repoUrl: opts.repo,
     branch: opts.branch ?? "main",
     scope,
     authType,           // NEW
     authCredentialName, // NEW
     // ... rest of options
   });
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing `publish-github` tests pass (backward compatibility with PAT)
- New tests (Phase 6) verify GitHub App flag precedence

**Risk:** Medium — touches critical reverse-git code paths.

---

#### Task 5.3: Extend Reverse-Sync Engine for GitHub App Auth

**File:** `src/core/reverse-sync-engine.ts`

**Changes:**
1. Import GitHub App types and functions (lines ~5–10):
   ```typescript
   import { generateInstallationToken } from "./github-app-auth.js";
   import type { GitHubAppEntry } from "./types.js";
   ```

2. Extend `InitReverseLinkOptions` interface (lines ~50+):
   ```typescript
   interface InitReverseLinkOptions {
     // ... existing fields ...
     authType?: "pat" | "github-app";
     authCredentialName?: string;
   }
   ```

3. Update `initReverseLink` to store auth metadata in link (lines ~487+):
   ```typescript
   async function initReverseLink(opts: InitReverseLinkOptions): Promise<ReverseLink> {
     // ... existing logic ...
     
     const link: ReverseLink = {
       // ... existing fields ...
       authType: opts.authType,             // NEW
       authCredentialName: opts.authCredentialName,  // NEW
     };
     
     return link;
   }
   ```

4. Update `pushReverseLink` to resolve GitHub App credentials when `link.authType === "github-app"` (lines ~600+, ~40 new lines):
   ```typescript
   async function pushReverseLink(opts: PushReverseLinkOptions): Promise<PushResult> {
     const { link, store, ... } = opts;
     
     let token: string;
     if (link.authType === "github-app") {
       const appEntry = store.getGitHubApp(link.authCredentialName ?? "");
       if (!appEntry) {
         throw new ConfigurationError(
           `GitHub App '${link.authCredentialName}' not found. ` +
           `Run 'storage-nav list-github-apps' to see available credentials.`
         );
       }
       token = await generateInstallationToken(
         appEntry.appId,
         appEntry.privateKeyPem,
         appEntry.installationId
       );
     } else {
       // Existing PAT resolution
       token = await resolvePatForLink(link, store, opts.patOverride);
     }
     
     // ... rest of existing logic, use `token` instead of PAT
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing reverse-sync tests pass
- New tests (Phase 6) verify GitHub App token resolution

**Risk:** Medium — touches engine core, but changes are additive.

---

### Phase 6: Repository Scope Addition (Graceful Degradation)

**Purpose:** Attempt to add created repos to installation scope via PUT endpoint; warn if fails.

#### Task 6.1: Extend GitHubWriteClient for Scope Addition

**File:** `src/core/github-write-client.ts`

**Changes:**
1. Extend constructor signature (lines ~230+):
   ```typescript
   export class GitHubWriteClient implements RepoWriteClient {
     private readonly pat: string;
     private readonly owner: string;
     private readonly repo: string;
     private readonly installationId?: string;  // NEW — optional
     
     constructor(
       pat: string,
       owner: string,
       repo: string,
       installationId?: string  // NEW
     ) {
       if (!pat) throw new Error("GitHubWriteClient: missing PAT");
       if (!owner) throw new Error("GitHubWriteClient: missing owner");
       if (!repo) throw new Error("GitHubWriteClient: missing repo");
       this.pat = pat;
       this.owner = owner;
       this.repo = repo;
       this.installationId = installationId;  // NEW
     }
     
     static fromRepoUrl(
       pat: string,
       repoUrl: string,
       installationId?: string  // NEW
     ): GitHubWriteClient {
       const { owner, repo } = parseGitHubRepoUrl(repoUrl);
       return new GitHubWriteClient(pat, owner, repo, installationId);
     }
   }
   ```

2. Extend `createRepo` method to attempt scope addition (lines ~450+, add ~50 lines after repo creation):
   ```typescript
   private async createRepo(opts: { visibility: RepoVisibility; name: string }): Promise<void> {
     // ... existing repo creation logic ...
     
     if (res.status === 201) {
       const repoData = (await res.json()) as { id?: number };
       const repositoryId = repoData.id;
       
       // NEW: Attempt to add repo to installation scope
       if (this.installationId && repositoryId) {
         await this.attemptScopeAddition(repositoryId);
       }
       
       return;
     }
     
     // ... existing error handling ...
   }
   
   /**
    * Attempt to add created repository to installation's "Only select repositories" set.
    * Per research: PUT /user/installations/{id}/repositories/{repo_id} ONLY works with
    * classic PAT with `repo` scope, NOT installation tokens. This method implements
    * graceful degradation: attempt the call, warn on failure, continue.
    */
   private async attemptScopeAddition(repositoryId: number): Promise<void> {
     const url = `${GITHUB_API_BASE}/user/installations/${this.installationId}/repositories/${repositoryId}`;
     
     try {
       const res = await ghRequest(url, this.pat, { method: "PUT" });
       
       if (res.status === 204) {
         console.log(
           `Repository added to GitHub App installation scope (installation ID: ${this.installationId}).`
         );
         return;
       }
       
       if (res.status === 304) {
         console.log(
           `Repository was already in GitHub App installation scope (installation ID: ${this.installationId}).`
         );
         return;
       }
       
       // 403 or 404: expected when using installation token (not PAT)
       if (res.status === 403 || res.status === 404) {
         console.warn(
           `\nWARNING: Repository created successfully, but could not be automatically added to the GitHub App installation's selected repositories.\n` +
           `This is expected when using installation tokens (GitHub API limitation).\n` +
           `\nTo grant the app access to this repository:\n` +
           `  1. Go to: https://github.com/settings/installations\n` +
           `  2. Click "Configure" next to your GitHub App\n` +
           `  3. Under "Repository access", click "Only select repositories"\n` +
           `  4. Add "${this.owner}/${this.repo}" to the selected repositories list\n`
         );
         return;
       }
       
       // Other errors: log but continue (repo creation succeeded)
       const body = await safeJson(res);
       console.warn(
         `WARNING: Failed to add repository to installation scope (${res.status}): ${body.message ?? res.statusText}`
       );
     } catch (err) {
       // Network error or other exception: log but continue
       console.warn(
         `WARNING: Exception while adding repository to installation scope: ${(err as Error).message}`
       );
     }
   }
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing `GitHubWriteClient` tests pass
- New tests (Phase 6) verify scope-addition attempt and warning on 403

**Risk:** Low — graceful degradation means failures don't break repo creation.

---

#### Task 6.2: Update buildWriteClientForLink to Pass installationId

**File:** `src/core/repo-utils.ts`

**Changes:**
1. Extend `buildWriteClientForLink` signature (lines ~67+):
   ```typescript
   export function buildWriteClientForLink(
     link: ReverseLink,
     token: string,
     installationId?: string  // NEW — passed when authType is "github-app"
   ): RepoWriteClient {
     if (!token) throw new Error("missing token");
     
     if (link.provider === "github") {
       return GitHubWriteClient.fromRepoUrl(token, link.repoUrl, installationId);
     }
     
     if (link.provider === "azure-devops") {
       return DevOpsWriteClient.fromRepoUrl(token, link.repoUrl);
     }
     
     throw new Error(`unsupported provider '${link.provider}'`);
   }
   ```

2. Update call sites in `reverse-sync-engine.ts` to pass `installationId` when `authType === "github-app"` (lines ~650+):
   ```typescript
   const writeClient = buildWriteClientForLink(
     link,
     token,
     link.authType === "github-app" ? appEntry.installationId : undefined
   );
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Existing tests pass (PAT flow unchanged)
- New tests verify `installationId` passed correctly

**Risk:** Low — additive change, backward compatible.

---

### Phase 7: Electron UI Extensions

**Purpose:** Add GitHub App credential management and selection to desktop UI.

#### Task 7.1: Add GitHub Apps Settings Modal (HTML)

**File:** `src/electron/public/index.html`

**Changes:**
1. Add GitHub Apps modal after existing modals (lines ~300+, ~80 new lines):
   ```html
   <!-- GitHub Apps Settings Modal -->
   <div id="github-apps-modal" class="modal hidden">
     <div class="modal-content" style="max-width: 600px;">
       <h3>GitHub Apps</h3>
       <p style="margin-bottom: 1rem;">
         Manage GitHub App credentials for installation-token authentication.
         <a href="https://docs.github.com/en/apps" target="_blank">Learn about GitHub Apps</a>
       </p>
       
       <div id="github-apps-list" style="margin-bottom: 1.5rem;">
         <!-- Populated by app.js -->
       </div>
       
       <button id="github-apps-add-btn" class="btn-primary">Add GitHub App</button>
       <button id="github-apps-close-btn" class="btn-secondary">Close</button>
     </div>
   </div>
   
   <!-- Add GitHub App Form Modal -->
   <div id="add-github-app-modal" class="modal hidden">
     <div class="modal-content" style="max-width: 500px;">
       <h3>Add GitHub App</h3>
       
       <label>Name (user-defined):
         <input type="text" id="github-app-name" placeholder="my-app-install-1" />
       </label>
       
       <label>App ID:
         <input type="text" id="github-app-id" placeholder="123456" />
       </label>
       
       <label>Installation ID:
         <input type="text" id="github-app-installation-id" placeholder="789012" />
       </label>
       
       <label>Private Key (PEM):
         <textarea id="github-app-pem" rows="10" placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQ...&#10;-----END PRIVATE KEY-----"></textarea>
       </label>
       
       <label>Expires At (optional):
         <input type="date" id="github-app-expires-at" />
       </label>
       
       <label>Companion PAT Name (optional, for repo-scope addition):
         <input type="text" id="github-app-companion-pat" placeholder="my-github-pat" />
       </label>
       
       <div style="margin-top: 1rem;">
         <button id="github-app-save-btn" class="btn-primary">Save</button>
         <button id="github-app-cancel-btn" class="btn-secondary">Cancel</button>
       </div>
     </div>
   </div>
   ```

2. Add "GitHub Apps" menu item to settings navigation (lines ~50+):
   ```html
   <nav>
     <button id="nav-tokens">Tokens</button>
     <button id="nav-github-apps">GitHub Apps</button>  <!-- NEW -->
     <button id="nav-storages">Storage Accounts</button>
   </nav>
   ```

**Acceptance:**
- HTML validates (no syntax errors)
- Modals render correctly in Electron

**Risk:** None — markup only, no behavior changes.

---

#### Task 7.2: Implement GitHub Apps UI Logic (JavaScript)

**File:** `src/electron/public/app.js`

**Changes:**
1. Add event listeners for GitHub Apps modal (lines ~2230+, ~200 new lines):
   ```javascript
   // GitHub Apps modal toggle
   const githubAppsModal = document.getElementById("github-apps-modal");
   const githubAppsBtn = document.getElementById("nav-github-apps");
   const githubAppsCloseBtn = document.getElementById("github-apps-close-btn");
   
   githubAppsBtn?.addEventListener("click", async () => {
     await loadGitHubApps();
     githubAppsModal.classList.remove("hidden");
   });
   
   githubAppsCloseBtn?.addEventListener("click", () => {
     githubAppsModal.classList.add("hidden");
   });
   
   // Load and render GitHub Apps list
   async function loadGitHubApps() {
     try {
       const res = await fetch("/api/github-apps");
       if (!res.ok) throw new Error(`HTTP ${res.status}`);
       const apps = await res.json();
       
       const listDiv = document.getElementById("github-apps-list");
       if (apps.length === 0) {
         listDiv.innerHTML = "<p><em>No GitHub Apps configured.</em></p>";
         return;
       }
       
       let html = '<table style="width: 100%;"><thead><tr>';
       html += '<th>Name</th><th>App ID</th><th>Installation ID</th><th>Expires</th><th>Actions</th>';
       html += '</tr></thead><tbody>';
       
       for (const app of apps) {
         const expires = app.expiresAt
           ? (app.isExpired ? `<span style="color: red;">${app.expiresAt} (EXPIRED)</span>` : app.expiresAt)
           : "N/A";
         html += `<tr>
           <td>${escapeHtml(app.name)}</td>
           <td>${escapeHtml(app.appId)}</td>
           <td>${escapeHtml(app.installationId)}</td>
           <td>${expires}</td>
           <td><button class="btn-danger" onclick="removeGitHubApp('${escapeHtml(app.name)}')">Remove</button></td>
         </tr>`;
       }
       
       html += '</tbody></table>';
       listDiv.innerHTML = html;
     } catch (err) {
       console.error("Failed to load GitHub Apps:", err);
       alert("Failed to load GitHub Apps.");
     }
   }
   
   // Add GitHub App modal
   const addGitHubAppModal = document.getElementById("add-github-app-modal");
   const addGitHubAppBtn = document.getElementById("github-apps-add-btn");
   const githubAppSaveBtn = document.getElementById("github-app-save-btn");
   const githubAppCancelBtn = document.getElementById("github-app-cancel-btn");
   
   addGitHubAppBtn?.addEventListener("click", () => {
     addGitHubAppModal.classList.remove("hidden");
   });
   
   githubAppCancelBtn?.addEventListener("click", () => {
     addGitHubAppModal.classList.add("hidden");
   });
   
   githubAppSaveBtn?.addEventListener("click", async () => {
     const name = document.getElementById("github-app-name").value.trim();
     const appId = document.getElementById("github-app-id").value.trim();
     const installationId = document.getElementById("github-app-installation-id").value.trim();
     const pem = document.getElementById("github-app-pem").value.trim();
     const expiresAt = document.getElementById("github-app-expires-at").value || undefined;
     const companionPat = document.getElementById("github-app-companion-pat").value.trim() || undefined;
     
     if (!name || !appId || !installationId || !pem) {
       alert("Name, App ID, Installation ID, and Private Key are required.");
       return;
     }
     
     // Basic PEM validation
     if (!pem.includes("-----BEGIN")) {
       alert("Invalid private key: PEM format not detected.");
       return;
     }
     
     try {
       const res = await fetch("/api/github-apps", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           name,
           appId,
           installationId,
           privateKeyPem: pem,
           expiresAt,
           companionPatTokenName: companionPat,
         }),
       });
       
       if (!res.ok) throw new Error(await res.text());
       
       alert(`GitHub App '${name}' added successfully.`);
       addGitHubAppModal.classList.add("hidden");
       await loadGitHubApps();
     } catch (err) {
       console.error("Failed to add GitHub App:", err);
       alert(`Failed to add GitHub App: ${err.message}`);
     }
   });
   
   // Remove GitHub App
   async function removeGitHubApp(name) {
     if (!confirm(`Remove GitHub App '${name}'?`)) return;
     
     try {
       const res = await fetch(`/api/github-apps/${encodeURIComponent(name)}`, {
         method: "DELETE",
       });
       
       if (!res.ok) throw new Error(await res.text());
       
       alert(`GitHub App '${name}' removed.`);
       await loadGitHubApps();
     } catch (err) {
       console.error("Failed to remove GitHub App:", err);
       alert(`Failed to remove GitHub App: ${err.message}`);
     }
   }
   ```

2. Extend publish modal credential selector (lines ~2177+, ~50 new lines):
   ```javascript
   // Load both PATs and GitHub Apps for publish modal
   async function loadPublishCredentials(provider) {
     try {
       // Load PATs
       const patsRes = await fetch(`/api/tokens?provider=${provider}`);
       const pats = await patsRes.json();
       
       // Load GitHub Apps (only for GitHub provider)
       let apps = [];
       if (provider === "github") {
         const appsRes = await fetch("/api/github-apps");
         apps = await appsRes.json();
       }
       
       const selector = document.getElementById("publish-credential");
       selector.innerHTML = "";
       
       // Add PATs optgroup
       if (pats.length > 0) {
         const patsGroup = document.createElement("optgroup");
         patsGroup.label = "Personal Access Tokens";
         for (const pat of pats) {
           const opt = document.createElement("option");
           opt.value = `pat:${pat.name}`;
           opt.textContent = `🔑 PAT: ${pat.name}`;
           patsGroup.appendChild(opt);
         }
         selector.appendChild(patsGroup);
       }
       
       // Add GitHub Apps optgroup
       if (apps.length > 0) {
         const appsGroup = document.createElement("optgroup");
         appsGroup.label = "GitHub Apps";
         for (const app of apps) {
           const opt = document.createElement("option");
           opt.value = `app:${app.name}`;
           opt.textContent = `⚙️ GitHub App: ${app.name}`;
           appsGroup.appendChild(opt);
         }
         selector.appendChild(appsGroup);
       }
       
       if (pats.length === 0 && apps.length === 0) {
         const opt = document.createElement("option");
         opt.value = "";
         opt.textContent = "(No credentials configured)";
         selector.appendChild(opt);
       }
     } catch (err) {
       console.error("Failed to load credentials:", err);
     }
   }
   ```

3. Update reverse-links panel to display `authType` and `authCredentialName` (lines ~1900+, ~20 new lines):
   ```javascript
   // In renderReverseLinks function, add Auth column to table
   html += `<th>Auth</th>`;
   
   // In table row loop
   const authType = link.authType === "github-app" ? "GitHub App" : "PAT";
   const authCred = link.authCredentialName ?? "(default)";
   html += `<td>${authType}: ${escapeHtml(authCred)}</td>`;
   ```

**Acceptance:**
- Electron UI launches without errors
- GitHub Apps modal opens/closes correctly
- Add/list/remove GitHub App flows work end-to-end
- Publish modal credential selector shows both PATs and GitHub Apps

**Risk:** Medium — substantial JavaScript changes, requires manual testing.

---

#### Task 7.3: Add Electron API Routes for GitHub Apps

**File:** `src/electron/site-routes.ts`

**Changes:**
1. Add GitHub Apps routes (lines ~1158+, ~80 new lines):
   ```typescript
   // GET /api/github-apps
   app.get("/api/github-apps", async (req, res) => {
     try {
       const store = new CredentialStore();
       const apps = store.listGitHubApps();
       res.json(apps);
     } catch (err) {
       console.error("GET /api/github-apps error:", err);
       res.status(500).send((err as Error).message);
     }
   });
   
   // POST /api/github-apps
   app.post("/api/github-apps", async (req, res) => {
     try {
       const {
         name,
         appId,
         installationId,
         privateKeyPem,
         clientId,
         clientSecret,
         companionPatTokenName,
         expiresAt,
       } = req.body;
       
       if (!name || !appId || !installationId || !privateKeyPem) {
         return res.status(400).send("Missing required fields");
       }
       
       const store = new CredentialStore();
       store.addGitHubApp({
         name,
         appId,
         installationId,
         privateKeyPem,
         clientId,
         clientSecret,
         companionPatTokenName,
         expiresAt,
       });
       
       res.status(201).send("GitHub App added");
     } catch (err) {
       console.error("POST /api/github-apps error:", err);
       res.status(500).send((err as Error).message);
     }
   });
   
   // DELETE /api/github-apps/:name
   app.delete("/api/github-apps/:name", async (req, res) => {
     try {
       const store = new CredentialStore();
       const removed = store.removeGitHubApp(req.params.name);
       
       if (removed) {
         res.send("GitHub App removed");
       } else {
         res.status(404).send("GitHub App not found");
       }
     } catch (err) {
       console.error("DELETE /api/github-apps error:", err);
       res.status(500).send((err as Error).message);
     }
   });
   ```

**Acceptance:**
- `npx tsc --noEmit` passes
- Electron server starts without errors
- API routes respond correctly (manual test via Electron UI)

**Risk:** Low — follows existing token route pattern.

---

### Phase 8: Testing & Validation

**Purpose:** Ensure backward compatibility, verify new functionality, and catch regressions.

#### Task 8.1: Unit Tests for GitHub App Auth Module

**File:** `tests/unit/github-app-auth.test.ts` (NEW, ~300 lines)

**Changes:**
1. Create test file with fixtures:
   ```typescript
   import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
   import { generateInstallationToken, clearInstallationTokenCache } from "../../src/core/github-app-auth.js";
   ```

2. Test JWT generation (~100 lines):
   - Valid PKCS#8 key → JWT structure correct (header, payload, signature)
   - Valid PKCS#1 key → JWT structure correct
   - Invalid key → descriptive error
   - Expired JWT → error on token exchange (401)
   - Invalid App ID (non-numeric) → error

3. Test installation token generation (~100 lines):
   - Mock successful token exchange → returns token string
   - Mock 401 response → InvalidPATError thrown
   - Mock 403 response → InsufficientScopesError thrown
   - Mock 404 response → GitHubApiError with "installation not found" message

4. Test token caching (~100 lines):
   - First call generates token
   - Second call (same installationId, <1hr later) returns cached token (no API call)
   - Third call (>1hr later) regenerates token
   - Fourth call (different installationId) generates new token

**Acceptance:**
- All tests pass
- Code coverage >80% for `github-app-auth.ts`

---

#### Task 8.2: Unit Tests for Credential Store GitHub App CRUD

**File:** `tests/unit/github-app-credential-store.test.ts` (NEW, ~200 lines)

**Changes:**
1. Test `addGitHubApp`:
   - Add new entry → persisted in credentials.json
   - Update existing entry → replaced, not duplicated

2. Test `getGitHubApp`:
   - Existing entry → returns full object
   - Non-existent entry → returns undefined

3. Test `listGitHubApps`:
   - Empty array when no apps configured
   - Expiry flag set correctly (past date = isExpired: true)
   - Private key PEM NOT exposed in list output

4. Test `removeGitHubApp`:
   - Existing entry → removed, returns true
   - Non-existent entry → returns false

**Acceptance:**
- All tests pass
- Backward compatibility verified (old credentials.json without `githubApps` loads successfully)

---

#### Task 8.3: Integration Tests for Reverse-Git with GitHub App

**File:** `tests/unit/github-app-reverse-git.test.ts` (NEW, ~400 lines)

**Changes:**
1. Test publish flow with GitHub App:
   - Mock installation token generation
   - Mock repo creation (201 response with repository ID)
   - Mock scope-addition attempt (403 response → warning logged)
   - Verify link metadata includes `authType: "github-app"` and `authCredentialName`

2. Test push flow with GitHub App:
   - Link has `authType: "github-app"`
   - Installation token resolved from stored GitHub App
   - Token used for commit push

3. Test precedence chain:
   - `--github-app-name` takes precedence over `--pat`
   - `--github-app-inline` takes precedence over `--github-app-name`

4. Test error cases:
   - GitHub App not found (name misspelled) → ConfigurationError (exit 3)
   - Installation revoked → GitHubApiError (exit 2)

**Acceptance:**
- All tests pass
- No regressions in existing PAT-based reverse-git tests

---

#### Task 8.4: Regression Testing

**File:** All existing test suites

**Changes:**
1. Run full test suite: `npm test`
2. Verify zero regressions:
   - Forward-sync tests pass (GitHub App auth not applicable)
   - Existing PAT-based reverse-git tests pass
   - Credential store migration tests pass (backward compatibility)

**Acceptance:**
- All existing tests pass
- `npm run build` succeeds
- `npx tsc --noEmit` passes

**Risk:** Medium — new code could introduce subtle regressions.

---

### Phase 9: Documentation

**Purpose:** Document GitHub App auth end-to-end for users and maintainers.

#### Task 9.1: Update Tools Documentation

**File:** `docs/tools/storage-nav.md`

**Changes:**
1. Add "GitHub App Authentication" section (lines ~500+, ~200 new lines):
   - Registration workflow (link to GitHub docs)
   - Installation setup ("Only select repositories" mode)
   - Credential storage (add-github-app CLI command, Electron UI)
   - Precedence rules (--github-app-name > --github-app-inline > --pat)
   - Scope model (auto-add created repos, manual add for existing)
   - Troubleshooting (insufficient permissions, revoked installation, expired private key)

**Acceptance:**
- Documentation is clear and actionable
- Examples are copy-pasteable
- Links to GitHub docs are valid

---

#### Task 9.2: Update Configuration Guide

**File:** `docs/design/configuration-guide.md`

**Changes:**
1. Add GitHub App credential fields section:
   - `appId`: GitHub App ID (from app settings)
   - `privateKeyPem`: RSA private key in PEM format
   - `installationId`: Installation ID for target account
   - Optional `clientId`/`clientSecret`: Reserved for future OAuth
   - Optional `companionPatTokenName`: Stored PAT name for scope-add
   - Optional `expiresAt`: Private key rotation tracking

2. Recommended practices:
   - Never commit private keys to Git
   - Rotate keys periodically
   - Use one app per organization
   - Use companion PAT for automatic scope addition

**Acceptance:**
- All fields documented
- Security best practices included

---

#### Task 9.3: Update Project Design & Functions

**Files:**
- `docs/design/project-design.md`
- `docs/design/project-functions.md`

**Changes:**
1. `project-design.md`: Add "GitHub App Authentication" section (~100 lines):
   - Architecture overview (token-provider abstraction)
   - Installation token lifecycle (generation, caching, expiry)
   - Scope-addition graceful degradation
   - Data model extensions (`GitHubAppEntry`, `ReverseLink.authType`)

2. `project-functions.md`: Add functional requirements:
   - FR-GA1: GitHub App credential storage
   - FR-GA2: Installation token generation
   - FR-GA3: Repository creation with scope addition
   - FR-GA4: Credential resolution chain
   - FR-GA5: CLI commands (add/list/remove)
   - FR-GA6: Electron UI extensions

**Acceptance:**
- Design doc updated with architecture decisions
- Functions doc reflects new capabilities

---

#### Task 9.4: Update Issues - Pending Items

**File:** `Issues - Pending Items.md`

**Changes:**
1. Add dependency vetting log entry (per Task 0.1)
2. Add any known limitations:
   - Personal account repo creation via installation token (assumed working, needs empirical verification)
   - Automatic scope addition only works with companion PAT (GitHub API limitation)

**Acceptance:**
- All open items from this plan tracked
- Dependency vetting logged

---

## Files to Modify

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `src/core/reverse-git-types.ts` | +30 | Add `GitHubAppEntry` interface, extend `ReverseLink` |
| `src/core/types.ts` | +5 | Extend `CredentialData` with `githubApps` |
| `src/core/credential-store.ts` | +120 | Add GitHub App CRUD methods |
| `src/core/github-app-auth.ts` | +250 (NEW) | JWT signing, installation token generation, caching |
| `src/cli/commands/github-app-ops.ts` | +80 (NEW) | CLI commands for GitHub App management |
| `src/cli/index.ts` | +40 | Register GitHub App CLI subcommands |
| `src/cli/commands/shared.ts` | +100 | Add `resolveGitHubCredential` helper |
| `src/cli/commands/reverse-git.ts` | +60 | Extend publish/link/push commands with GitHub App flags |
| `src/core/reverse-sync-engine.ts` | +80 | Resolve GitHub App credentials, store auth metadata |
| `src/core/github-write-client.ts` | +100 | Extend constructor, add scope-addition logic |
| `src/core/repo-utils.ts` | +20 | Pass `installationId` to write client |
| `src/electron/public/index.html` | +80 | GitHub Apps modal HTML |
| `src/electron/public/app.js` | +250 | GitHub Apps UI logic, credential selector |
| `src/electron/site-routes.ts` | +80 | GitHub Apps API routes |
| `tests/unit/github-app-auth.test.ts` | +300 (NEW) | Unit tests for JWT/token generation |
| `tests/unit/github-app-credential-store.test.ts` | +200 (NEW) | Unit tests for CRUD operations |
| `tests/unit/github-app-reverse-git.test.ts` | +400 (NEW) | Integration tests for reverse-git |
| `docs/tools/storage-nav.md` | +200 | GitHub App auth documentation |
| `docs/design/configuration-guide.md` | +100 | GitHub App credential fields |
| `docs/design/project-design.md` | +100 | Architecture documentation |
| `docs/design/project-functions.md` | +50 | Functional requirements |
| `Issues - Pending Items.md` | +10 | Dependency vetting log, known limitations |

**Total new code:** ~1,500 lines (implementation) + ~900 lines (tests) = ~2,400 lines  
**Total modifications:** ~500 lines across existing files

---

## New Files

- `src/core/github-app-auth.ts` — Installation token generation + caching
- `src/cli/commands/github-app-ops.ts` — CLI CRUD commands
- `tests/unit/github-app-auth.test.ts` — Unit tests for auth module
- `tests/unit/github-app-credential-store.test.ts` — Unit tests for CRUD
- `tests/unit/github-app-reverse-git.test.ts` — Integration tests

---

## Dependencies

### Task Dependencies

| Task | Blocks | Reason |
|------|--------|--------|
| 0.1 (Dependency vetting) | 2.1 (GitHub App auth module) | Cannot import `jose` before vetting |
| 1.1, 1.2 (Type definitions) | All other tasks | Types must exist before usage |
| 2.1 (Auth module) | 3.1, 5.1, 5.2, 5.3 | Token generation used by CLI/engine |
| 3.1 (Credential store CRUD) | 4.1, 4.2, 5.1, 7.2, 7.3 | CRUD methods used by CLI/UI |
| 4.1 (GitHub App CLI commands) | 4.2 | Commands must exist before registration |
| 5.1 (Credential resolver) | 5.2, 5.3 | Resolver used by CLI commands + engine |
| 7.1 (HTML modals) | 7.2 | JavaScript references HTML elements |
| 7.2 (UI logic) | 7.3 | UI calls API routes |
| All code phases (1–7) | 8 (Testing) | Tests verify implemented functionality |
| All phases (0–8) | 9 (Documentation) | Docs describe final implementation |

**Critical path:** 0.1 → 1.1 → 1.2 → 2.1 → 5.1 → 5.3 → 8.3 (longest chain)

---

## Validation Criteria

### Build & Type-Check

```bash
# Must pass after each phase
npm run build
npx tsc --noEmit
```

**Expected:** Zero errors, clean exit (code 0).

---

### Test Suite

```bash
# Full test suite (unit + integration)
npm test

# Unit tests only (faster feedback loop)
npm run test:unit
```

**Expected:**
- All existing tests pass (backward compatibility)
- New tests pass (GitHub App functionality)
- Code coverage >80% for new modules

---

### Manual Integration Tests

**Test 1: CLI — Add GitHub App**
```bash
npx tsx src/cli/index.ts add-github-app \
  --name my-app \
  --app-id 123456 \
  --installation-id 789012 \
  --private-key-file ~/Downloads/my-app.pem

# Expected: "GitHub App 'my-app' added successfully."
```

**Test 2: CLI — List GitHub Apps**
```bash
npx tsx src/cli/index.ts list-github-apps

# Expected: Table with my-app entry
```

**Test 3: CLI — Publish with GitHub App**
```bash
npx tsx src/cli/index.ts publish-github \
  --container my-docs \
  --repo myorg/my-docs \
  --github-app-name my-app \
  --create-repo

# Expected:
# - Repository created (201)
# - Warning: "could not be automatically added to installation scope" (403)
# - Link created with authType: "github-app"
```

**Test 4: Electron UI — Add GitHub App**
1. Launch Electron: `npm run ui`
2. Click "GitHub Apps" in settings
3. Click "Add GitHub App"
4. Fill form, click "Save"
5. Verify app appears in list

**Test 5: Electron UI — Publish with GitHub App**
1. Open publish modal
2. Select container
3. Select credential: "⚙️ GitHub App: my-app"
4. Publish
5. Verify link created with GitHub App auth

---

## Acceptance Criteria Mapping

This plan satisfies ALL acceptance criteria from the refined request. Mapping:

| Acceptance Group | Satisfied By | Notes |
|------------------|--------------|-------|
| **AC-GM1–GM5** (Credential Management) | Tasks 3.1, 4.1, 4.2, 7.1, 7.2, 7.3 | CLI + UI CRUD operations |
| **AC-AF1–AF5** (Authentication Flow) | Tasks 2.1, 5.1, 5.2, 5.3, 6.1, 6.2 | Token generation, resolution chain, error handling |
| **AC-CP1–CP4** (Credential Precedence) | Tasks 5.1, 5.2, 7.2 | Resolver implements precedence chain, UI selector shows both |
| **AC-RS1–RS4** (Repository Scope) | Tasks 6.1, 6.2 | Graceful degradation: attempt PUT, warn on 403, manual instructions |
| **AC-BC1–BC4** (Backward Compatibility) | Tasks 1.1, 1.2, 3.1, 8.4 | Optional fields, default to `[]`, all existing tests pass |
| **AC-DE1–DE4** (Documentation) | Tasks 9.1, 9.2, 9.3, 9.4 | Full docs with examples, troubleshooting, inline help |
| **AC-UX1–UX4** (UI/UX) | Tasks 7.1, 7.2 | Visual distinction (icons), separate modal, auth column in links panel |
| **AC-IR1–IR4** (Integration/Regression) | Tasks 8.1, 8.2, 8.3, 8.4 | End-to-end test, dependency vetting, zero regressions, type-check passes |

---

## Risks

### Risk 1: Personal Account Repo Creation (MEDIUM)

**Issue:** Research assumes `POST /user/repos` works with installation tokens for personal accounts, but GitHub docs do NOT explicitly confirm this.

**Mitigation:**
- Empirical testing in Phase 8 (create test GitHub App, install on personal account, attempt repo creation)
- Fallback: if creation fails with 403, surface error with guidance to use PAT or org-level installation

**Impact if unresolved:** Personal account users cannot create repos via GitHub App auth — would require PAT.

---

### Risk 2: Scope-Addition PUT Endpoint Fails (LOW)

**Issue:** Research confirms installation tokens CANNOT call `PUT /user/installations/{id}/repositories/{repo_id}` (only classic PATs work).

**Mitigation:**
- Graceful degradation implemented in Task 6.1 (attempt PUT, warn on 403, continue)
- Clear user instructions for manual scope addition via GitHub UI

**Impact:** Expected — handled by design. Users must manually add repos OR provide companion PAT.

---

### Risk 3: jose Library Regression (LOW)

**Issue:** Future `jose` version (6.3.0+) could introduce breaking changes within semver minor range.

**Mitigation:**
- Dependency vetting (Task 0.1) checks current version (6.2.3)
- Pin to caret range (`^6.2.3`) allows patches, not majors
- GitHub Advisory Database monitoring for future CVEs

**Impact:** Low — semver guarantees non-breaking changes within v6.x.

---

### Risk 4: Token Expiry Mid-Operation (LOW)

**Issue:** Installation tokens expire after 1 hour. Long-running operations (e.g., publish 100 containers) could span >1hr.

**Mitigation:**
- In-memory cache checks expiry before each API call (1-minute safety margin)
- If token expires, regenerate and retry (implemented in reverse-sync-engine)

**Impact:** Minimal — token regeneration adds ~200ms latency, transparently handled.

---

### Risk 5: Electron UI Testing Coverage (MEDIUM)

**Issue:** UI testing is manual (no automated Electron e2e tests in current project).

**Mitigation:**
- Comprehensive manual test plan (Validation Criteria section)
- Code review focused on UI event-handler correctness

**Impact if unresolved:** UI bugs could slip through to production — requires thorough manual QA.

---

## Handoff Instructions

### For the Implementation Worker

**Context:**
- You are implementing GitHub App authentication for storage-navigator's reverse-git feature.
- This is an ADDITIVE change — the existing PAT flow must remain unchanged and fully functional.
- Follow the task order strictly (Phase 0 → Phase 1 → … → Phase 9) to avoid dependency issues.

**Key Constraints:**
1. **NO fallback values** for missing config — raise ConfigurationError (exit 3) instead.
2. **NO disk persistence** of installation tokens — in-memory cache only.
3. **Graceful degradation** for scope-addition failures — warn user, do not fail the operation.
4. **Backward compatibility** mandatory — existing PAT tests must pass unchanged.

**Tools & Commands:**
```bash
# Build
npm run build

# Type-check (run after each phase)
npx tsc --noEmit

# Tests (run before final commit)
npm test

# CLI (for manual testing)
npx tsx src/cli/index.ts <subcommand>

# Electron UI (for manual testing)
npm run ui
```

**When Stuck:**
1. Re-read the technical research files (docs/research/*.md) for API details.
2. Check existing PAT implementation (src/cli/commands/token-ops.ts) for patterns.
3. Run unit tests in watch mode: `npm test -- --watch`.

**Before Marking Complete:**
- [ ] All phases 0–9 completed in order
- [ ] `npm run build` succeeds (zero errors)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (all tests, including existing ones)
- [ ] Manual integration tests (Validation Criteria) all pass
- [ ] Documentation updated (docs/tools/storage-nav.md, configuration-guide.md)
- [ ] Dependency vetting log entry added to Issues - Pending Items.md

---

### For Code Reviewers

**Focus Areas:**
1. **Security:** Private key PEM never logged/exposed; installation tokens never persisted to disk.
2. **Backward compatibility:** Existing PAT-based workflows unchanged; tests pass.
3. **Error handling:** Missing config → ConfigurationError (exit 3); API failures → GitHubApiError (exit 2); descriptive messages.
4. **Type safety:** `npx tsc --noEmit` passes; no `any` types; discriminated unions used correctly.
5. **Testing:** Code coverage >80% for new modules; integration test verifies end-to-end flow.

**Red Flags:**
- Installation tokens persisted to disk → REJECT (violates NFR1)
- Fallback values for missing config → REJECT (violates project rule)
- Changes to existing PAT logic → VERIFY backward compatibility
- `any` types or missing error handling → REQUEST fixes

**Review Checklist:**
- [ ] All tasks from Phase 0–9 implemented
- [ ] No regression in existing tests
- [ ] New tests cover happy path + error cases
- [ ] Documentation clear and actionable
- [ ] Security best practices followed (no secrets in logs)
- [ ] Type-check passes, no `any` types

---

### For QA / Manual Testers

**Test Scenarios:**

1. **Fresh install** (no existing credentials):
   - Add GitHub App via CLI → succeeds
   - List GitHub Apps → shows new entry
   - Publish container with GitHub App → repo created, warning shown

2. **Upgrade from PAT-only** (existing credentials.json):
   - Load credentials → no errors, `githubApps` defaults to `[]`
   - Add GitHub App → persisted alongside existing PATs
   - Publish with PAT → still works (backward compatibility)

3. **Multi-credential selection** (UI):
   - Add 2 PATs, 2 GitHub Apps
   - Publish modal credential selector → shows all 4 (visually distinct)
   - Select GitHub App → publish succeeds

4. **Error cases**:
   - Invalid PEM → clear error message
   - Revoked installation → "installation not found" error
   - Wrong App ID → "JWT claim does not match app ID" error
   - Missing --github-app-name → ConfigurationError (exit 3)

**Expected Outcomes:**
- All scenarios pass
- Error messages are actionable (tell user what to fix)
- UI is intuitive (icons distinguish PATs from GitHub Apps)

---

## Design-Approval Gate Questions

**Before implementation begins, the user must confirm:**

1. **Graceful degradation acceptable?**
   - The design attempts automatic repo-scope addition but WARNS (not fails) when the PUT endpoint returns 403.
   - Users see: "Repository created successfully, but could not be automatically added to installation scope. Add it manually via GitHub UI."
   - **Is this acceptable UX, or should it be a hard error?**

2. **Companion PAT optional or required?**
   - Current design: `companionPatTokenName` is optional on `GitHubAppEntry`.
   - If omitted, scope-addition always fails with warning.
   - **Should the CLI/UI prompt users to provide a companion PAT when adding a GitHub App?**

3. **Personal account empirical testing**:
   - Research assumes `POST /user/repos` works with installation tokens for personal accounts.
   - **Can the user provide a test GitHub App (App ID + private key) installed on a personal account for empirical verification during Phase 8?**
   - Alternatively: **Should we defer personal account support to a future phase?**

4. **Electron UI scope**:
   - Full GitHub App UI (settings modal + publish modal credential selector + reverse-links auth column) is ~330 lines of HTML/JS.
   - **Is this in-scope for v1, or should Electron UI be deferred to a follow-up phase?**

5. **OAuth flows (future)**:
   - The design includes optional `clientId`/`clientSecret` fields (reserved for future user-to-server OAuth flows).
   - **Confirm these are OUT OF SCOPE for v1 and will NOT be implemented now.**

**User approval required before proceeding to implementation.**

---

## Summary

This plan delivers GitHub App authentication for storage-navigator's reverse-git feature as an additive enhancement alongside the existing PAT flow. The implementation spans 9 phases, adds ~2,400 lines of code (including tests), and modifies 22 files. The critical design decision—graceful degradation for repo-scope addition—aligns with the user's "via additional tokens" intent and handles the GitHub API's installation-token limitation transparently.

**Next Steps:**
1. User reviews plan and answers design-approval gate questions.
2. Implementation worker executes phases 0–9 in order.
3. Code reviewer verifies security, backward compatibility, and test coverage.
4. QA manually tests CLI + Electron UI scenarios.
5. Final integration verification (Phase 11 from team-workflow, if applicable).

**Absolute Path to This Plan:** `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/design/plan-012-github-app-auth.md`
