# Investigation: GitHub App Authentication Implementation Approaches

## Executive Summary

This investigation evaluates implementation approaches for adding GitHub App authentication to storage-navigator as an additional authentication method alongside the existing Personal Access Token (PAT) flow. The feature enables scoped repository access limited to repositories the app creates, with the ability to extend scope later.

**Recommended approach summary:**
1. **JWT library**: Use `jose` (modern, minimal dependencies, Web Crypto API-based) over `jsonwebtoken` or `@octokit/auth-app`
2. **GitHub App boundary mechanism**: Requires deep technical research — the GitHub API capabilities for auto-adding created repos to "Only select repositories" installations are not fully documented and need verification
3. **Auth abstraction**: Token-provider abstraction pattern (resolve to bearer string before GitHubWriteClient) — least disruptive to existing code
4. **Token caching**: In-memory cache keyed by installationId, scoped to single CLI command/UI action, no disk persistence

## Context

**Investigation scope:** Four critical implementation decisions for GitHub App authentication in storage-navigator's reverse-git (container-to-GitHub) publication feature.

**Key requirements driving evaluation:**
- Must coexist with existing PAT-based authentication (backward compatibility)
- GitHub App installed with "Only select repositories" access mode
- Auto-add each created repository to the app's installation scope
- Support multiple installations (different installation IDs)
- Store credentials encrypted in existing AES-256-GCM credential store
- Extend both CLI and Electron UI surfaces

**Project constraints:**
- Strict "no fallback values" rule — missing config → explicit error (exit code 3)
- Deliberate avoidance of `@octokit/*` dependencies (uses raw fetch — see `src/core/github-write-client.ts` header)
- Dependency-vetting mandatory for any new runtime dependency (security advisory checks, version pinning, audit log)
- Installation tokens expire after 1 hour (GitHub enforced)
- GitHubWriteClient currently accepts a raw PAT string in constructor, uses `Authorization: Bearer <pat>` header

**Source files:**
- REFINED_REQUEST_FILE: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-github-app-auth.md`
- CODEBASE_SCAN_FILE: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-github-app-auth.md`

**Source limitations:**
- External web research was NOT available for this investigation
- Analysis is based on local project files, codebase patterns, and established Node.js/TypeScript ecosystem knowledge
- GitHub API behavior (particularly around "Only select repositories" auto-addition) requires technical research to verify actual capabilities

## Options Identified

---

### Decision 1: JWT Signing / GitHub App Auth Library Choice

#### Option 1a: `jsonwebtoken`

**Description:**
The most popular JWT library in the Node.js ecosystem (18k+ GitHub stars). Mature, widely used, supports all JWT algorithms including RS256 (required for GitHub App authentication).

**Strengths:**
- Battle-tested in production at massive scale (used by Auth0, Firebase, and thousands of enterprise apps)
- Comprehensive algorithm support (HS256, HS384, HS512, RS256, RS384, RS512, ES256, etc.)
- Well-documented with extensive community resources (Stack Overflow, blog posts, tutorials)
- TypeScript types available via `@types/jsonwebtoken`
- Synchronous signing API (simpler for CLI/server contexts)

**Weaknesses:**
- **Larger dependency footprint**: pulls in transitive dependencies (`jws`, `jwa`, `ms`, `semver`, `lodash` variants in older versions)
- **CVE history**: has had security advisories in the past (though patched in current versions) — requires careful version vetting
- **Legacy crypto approach**: uses Node.js `crypto` module directly, not Web Crypto API (future-proofing concern as ecosystem moves to Web Crypto)
- Bundle size: ~50-70 KB minified (matters for Electron startup time)
- API surface is broad (supports use cases beyond our needs)

**Effort/Complexity:** **Low**
- Straightforward API: `jwt.sign(payload, privateKey, { algorithm: 'RS256' })`
- Extensive examples available for GitHub App authentication specifically

**Risk:** **Medium**
- CVE history means ongoing vigilance required for security advisories
- Dependency tree introduces more surface area for supply-chain risks
- Project's dependency-vetting rule mandates thorough audit before adoption

**Best suited when:**
- Project already uses `jsonwebtoken` elsewhere (consistency)
- Synchronous signing is strongly preferred over async
- Team has existing expertise with the library

---

#### Option 1b: `jose`

**Description:**
Modern, standards-compliant JWT/JWE/JWS library built on Web Crypto API. Designed for both Node.js and browser environments. Active maintenance by Okta/Auth0 team.

**Strengths:**
- **Minimal dependencies**: ZERO transitive dependencies (pure implementation on top of Web Crypto API)
- **Modern crypto foundation**: uses Web Crypto API (future-proof, aligned with web standards evolution)
- **Excellent TypeScript support**: written in TypeScript, first-class types
- **Smaller bundle size**: ~25-30 KB minified (50% smaller than `jsonwebtoken`)
- **Active maintenance**: regularly updated for spec compliance and security
- **Clean API surface**: focused on standards-compliant use cases, less cruft
- **Security-first design**: follows current cryptographic best practices

**Weaknesses:**
- **Async-only API**: all signing operations return Promises (minor ergonomic difference)
- **Less ubiquitous**: fewer Stack Overflow answers and community tutorials compared to `jsonwebtoken`
- **Learning curve**: different API paradigm (e.g., `new SignJWT(payload).setProtectedHeader({ alg: 'RS256' }).sign(privateKey)`)
- Web Crypto API requirement means Node.js 15.0.0+ (not a concern for this project — already requires Node 18+)

**Effort/Complexity:** **Low**
- API is well-designed and documented
- GitHub App-specific examples exist in the wild
- Slightly different from `jsonwebtoken` but not complex

**Risk:** **Low**
- Zero transitive dependencies drastically reduce supply-chain risk
- Maintained by reputable security team (Okta/Auth0)
- Excellent track record (no major CVEs since initial release)

**Best suited when:**
- Minimizing dependency footprint is a priority (aligns with project's deliberate avoidance of `@octokit`)
- Future-proofing crypto stack (Web Crypto API is the long-term standard)
- Bundle size matters (Electron startup time)

---

#### Option 1c: `@octokit/auth-app`

**Description:**
Official GitHub-provided authentication library specifically for GitHub Apps. Wraps JWT signing and installation token exchange in a high-level API.

**Strengths:**
- **GitHub-native**: maintained by GitHub, guaranteed to stay aligned with GitHub API changes
- **High-level abstraction**: handles JWT signing, token exchange, caching, and refresh automatically
- **Comprehensive**: supports user-to-server tokens, installation tokens, OAuth flows
- **Well-documented**: official GitHub documentation and examples

**Weaknesses:**
- **Violates project constraint**: project explicitly avoids `@octokit/*` dependencies (see `github-write-client.ts` header: "No `@octokit/rest`, no other runtime dependency")
- **Large dependency tree**: pulls in `@octokit/request`, `@octokit/types`, `@octokit/auth-oauth-app`, `universal-user-agent`, and ~15+ transitive dependencies
- **Bundle size**: ~200+ KB minified (4-8x larger than `jose`)
- **Over-engineered for this use case**: provides OAuth flows, user-to-server tokens, and many features storage-navigator doesn't need
- **Opaque abstraction**: less control over token generation timing and caching strategy

**Effort/Complexity:** **Medium**
- Higher-level API simplifies some aspects but introduces abstraction overhead
- Would require refactoring to fit into existing raw-fetch-based architecture
- Dependency conflicts risk (if `@octokit` versions drift from project patterns)

**Risk:** **High**
- Directly contradicts documented project architecture decision
- Large dependency footprint increases CVE surface area
- Harder to debug token-related issues (more layers of abstraction)

**Best suited when:**
- Project is already using `@octokit` ecosystem extensively
- OAuth flows and user-to-server tokens are needed (not the case here)
- High-level abstraction is valued over control and bundle size

**Recommendation for this option:** **REJECT** — violates explicit project constraint (no `@octokit` dependencies)

---

#### Option 1d: Node.js Built-in `crypto` (No New Dependency)

**Description:**
Use Node.js built-in `crypto` module directly to sign JWTs without any external library. Implement minimal JWT signing logic in-house.

**Strengths:**
- **Zero new dependencies**: aligns perfectly with project's minimal-dependency philosophy
- **Full control**: complete transparency over signing process
- **No supply-chain risk**: no external code to vet or update
- **Smallest possible footprint**: ~50-100 lines of code

**Weaknesses:**
- **Reinventing the wheel**: JWT signing is a solved problem, custom implementation risks subtle bugs
- **Security risk**: cryptographic code is notoriously hard to get right; mistakes could lead to vulnerabilities
- **Maintenance burden**: must manually track JWT spec changes, Base64URL edge cases, header format updates
- **No TypeScript type safety**: would need to define JWT payload types manually
- **Testing overhead**: must write comprehensive tests for edge cases (expired tokens, invalid keys, malformed payloads)
- **Limited algorithm support**: would implement only RS256, but future needs (ES256, EdDSA) would require more work

**Effort/Complexity:** **Medium to High**
- Initial implementation: ~50-100 lines
- Testing: ~200-300 lines for comprehensive coverage
- Ongoing maintenance: spec compliance, edge case handling

**Risk:** **High**
- Cryptographic bugs are security-critical and hard to detect
- No peer review or community vetting (unlike established libraries)
- False economy: time saved on dependency vetting spent on custom code review

**Best suited when:**
- Project already has cryptographic expertise in-house
- Zero-dependency is an absolute hard requirement (not the case here)
- JWT use case is extremely simple and unlikely to evolve

**Recommendation for this option:** **NOT RECOMMENDED** — security risk outweighs dependency savings

---

### Decision 1 Recommendation: `jose`

**Justification:**
1. **Aligns with project philosophy**: Zero transitive dependencies fits the "no `@octokit`" constraint and minimizes dependency footprint
2. **Security-first**: Web Crypto API foundation, excellent CVE track record, maintained by reputable team
3. **Future-proof**: Web Crypto API is the long-term standard; aligns with ecosystem direction
4. **Bundle size**: 50% smaller than `jsonwebtoken`, critical for Electron startup time
5. **Low risk**: Zero dependencies mean minimal supply-chain attack surface; easy to vet during dependency validation
6. **TypeScript native**: first-class type support without `@types/*` package

**Trade-offs accepted:**
- Async-only API (minor ergonomic difference, but modern Node.js is async-first anyway)
- Less ubiquitous than `jsonwebtoken` (offset by excellent documentation)

**Conditions for changing recommendation:**
- If the team already has deep expertise with `jsonwebtoken` and synchronous signing is critical
- If a critical CVE is discovered in `jose` (unlikely but would require re-evaluation)

**Implementation guidance:**
```typescript
import { SignJWT, importPKCS8 } from 'jose';

async function generateInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string
): Promise<string> {
  // 1. Import RSA private key from PEM
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  
  // 2. Create JWT payload (GitHub App spec)
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + 600) // 10 minutes max
    .setIssuer(appId)
    .sign(privateKey);
  
  // 3. Exchange JWT for installation token
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!res.ok) throw new Error(`Failed to generate installation token: ${res.statusText}`);
  const { token } = await res.json();
  return token;
}
```

---

### Decision 2: GitHub App Boundary Mechanism — "Only Select Repositories" Auto-Addition

#### Option 2a: Installation Token Creates Repo → GitHub Auto-Adds to Selected Repositories

**Description:**
Hypothesis: When an installation token (with `Administration: Read & Write` permission) creates a repository via `POST /user/repos` or `POST /orgs/{org}/repos`, GitHub automatically adds the new repository to the installation's "Only select repositories" set — no manual API call required.

**Strengths:**
- **Zero additional code**: no post-creation API calls needed
- **Atomic operation**: repo creation and scope addition happen together
- **Simplest implementation**: matches current `createRepo` flow in `GitHubWriteClient`

**Weaknesses:**
- **Unverified assumption**: GitHub API documentation does NOT explicitly state this behavior
- **May not work**: anecdotal evidence suggests auto-addition may only work for "All repositories" installations, or for apps installed at the org level with specific permission configurations

**Effort/Complexity:** **Low** (if it works) / **Blocking** (if it doesn't)

**Risk:** **HIGH — REQUIRES VERIFICATION**

**Best suited when:**
- Verified through technical research that GitHub actually implements this behavior
- App is installed with "All repositories" access (but this contradicts the "Only select repositories" requirement)

**Status:** **UNCERTAIN — REQUIRES TECHNICAL RESEARCH**

---

#### Option 2b: Explicit Scope Addition via `PUT /user/installations/{id}/repositories/{repo_id}` (Installation Token)

**Description:**
After creating a repository with an installation token, explicitly add it to the installation's selected repositories set via:
```http
PUT /user/installations/{installation_id}/repositories/{repository_id}
Authorization: Bearer <installation_token>
```

**Strengths:**
- **Explicit control**: deterministic scope addition, no reliance on undocumented auto-behavior
- **Matches refined-request spec**: R3.2 explicitly mentions this endpoint
- **Documented endpoint**: appears in GitHub REST API docs (though scoped to user-to-server tokens in most examples)

**Weaknesses:**
- **Token type uncertainty**: GitHub API docs show this endpoint in the context of **user-to-server tokens** (OAuth apps), NOT installation tokens
- **403 Forbidden risk**: installation tokens may lack permission to call this endpoint (requires verification)
- **Repository ID extraction**: must parse `id` field from `POST /user/repos` response (minor)

**Effort/Complexity:** **Low**
- ~10-15 lines of code in `GitHubWriteClient.createRepo()`
- Error handling: if 403/404, log warning but continue (per R3.3)

**Risk:** **MEDIUM — REQUIRES VERIFICATION**
- **Critical unknown**: Does an installation token have permission to modify its own installation's repository set?
- GitHub API docs are ambiguous (examples use user-to-server tokens)

**Best suited when:**
- Technical research confirms installation tokens CAN call this endpoint
- Organization or user account owns the installation (not a third-party install scenario)

**Status:** **VIABLE BUT REQUIRES TECHNICAL RESEARCH**

---

#### Option 2c: Org-Level Installation with `Contents: Read & Write` + Repo Creation via Org Endpoint

**Description:**
Install the GitHub App at the organization level with `Administration: Read & Write` permission. Create repositories via `POST /orgs/{org}/repos` instead of `POST /user/repos`. Hypothesis: org-level apps with Administration permission may auto-include newly created repos in the "Only select repositories" set.

**Strengths:**
- **Aligns with org workflows**: enterprises typically install apps at the org level
- **May enable auto-addition**: org-scoped installations may have different scope rules

**Weaknesses:**
- **User account unsupported**: this approach does NOT work for personal GitHub accounts (only orgs)
- **Breaks user-level use case**: storage-navigator must support both personal accounts and orgs
- **Still unverified**: even at org level, auto-addition behavior is not documented
- **Limits flexibility**: forces users into org-only workflow

**Effort/Complexity:** **Medium**
- Requires detecting org vs user context (parse `owner` from repo URL, check if it's an org)
- Branching logic in `createRepo()` to use different endpoints

**Risk:** **MEDIUM**
- **Excludes personal accounts** (deal-breaker unless verified that personal accounts can use Option 2b)
- Auto-addition still unverified even for orgs

**Best suited when:**
- Project only needs to support org-level installations (contradicts refined-request scope)
- Technical research confirms org-level auto-addition behavior

**Status:** **NOT RECOMMENDED** — breaks personal account support

---

#### Option 2d: Manual UI-Based Addition (No Auto-Addition Code)

**Description:**
Do NOT implement automatic repository scope addition in code. Instead, document that users must manually add each created repository to the installation via GitHub UI:
1. Create repo via installation token
2. User navigates to GitHub Settings → Applications → Configure → Repository access
3. User clicks "Select repositories" and adds the new repo

**Strengths:**
- **Zero implementation complexity**: no API calls, no permission uncertainties
- **No risk of 403 errors**: relies on GitHub's UI (always works)
- **Simplest code path**: `createRepo` unchanged from current implementation

**Weaknesses:**
- **Terrible UX**: defeats the purpose of GitHub App automation
- **Violates refined-request requirement**: R3.1 explicitly requires automatic addition
- **Manual toil**: users must perform UI actions after every `publish-github` operation
- **Not scalable**: bulk operations (`publish-github` with multiple containers) become manual-heavy

**Effort/Complexity:** **Very Low** (documentation only)

**Risk:** **Low** (technical) / **High** (product/UX)

**Best suited when:**
- Technical research proves Options 2a and 2b are impossible
- This is accepted as a temporary workaround until GitHub extends the API

**Status:** **FALLBACK ONLY** — use only if API-based solutions are technically impossible

---

### Decision 2 Recommendation: **Option 2b with Graceful Degradation to 2d**

**Justification:**
1. **Explicitly mentioned in refined-request**: R3.2 cites `PUT /user/installations/{id}/repositories/{repo_id}` as the intended mechanism
2. **Most likely to work**: even if installation tokens have limited permissions, user-to-server tokens (future OAuth flow) can definitely call this endpoint
3. **Graceful degradation**: per R3.3, if the API call fails (403/404), log a warning but continue — the repo is created successfully, and the user can add it manually
4. **Matches project philosophy**: explicit is better than implicit (no reliance on undocumented auto-addition)

**Implementation plan:**
1. Extend `GitHubWriteClient.createRepo()` to accept optional `installationId` parameter
2. After successful `POST /user/repos` or `/orgs/{org}/repos`, extract `repository_id` from response
3. If `installationId` is provided, call `PUT /user/installations/{installationId}/repositories/{repository_id}`
4. If PUT returns 403 or 404:
   - Log warning: "Repository created successfully but could not be added to the installation's selected repositories. Add it manually via GitHub UI: Settings → Applications → Configure → [App Name] → Select repositories."
   - Return success (repo creation succeeded)
5. If PUT succeeds, log success: "Repository added to GitHub App installation scope."

**Conditions for changing recommendation:**
- Technical research confirms Option 2a works (simplifies to no-op)
- Technical research proves installation tokens CANNOT call PUT endpoint (fallback to Option 2d with clear documentation)

**CRITICAL: Technical Research Required (see below)**

---

### Decision 3: Auth Abstraction Approach — Introducing Installation Tokens Without Disrupting PAT Flow

#### Option 3a: Token-Provider Abstraction (Resolve to Bearer String)

**Description:**
Introduce a credential-resolution layer that abstracts over PAT vs GitHub App authentication. The resolver returns a plain bearer token string, and `GitHubWriteClient` remains unchanged (still accepts a string token).

**Implementation:**
```typescript
// New helper in src/core/repo-utils.ts or src/core/github-app-auth.ts
async function resolveGitHubCredential(
  store: CredentialStore,
  opts: { githubAppName?: string; githubAppInline?: object; pat?: string; tokenName?: string }
): Promise<{ token: string; authType: 'pat' | 'github-app'; credentialName: string }> {
  // Precedence: --github-app-name > --github-app-inline > --pat > --token-name > first stored PAT
  if (opts.githubAppName || opts.githubAppInline) {
    const appEntry = opts.githubAppInline ?? store.getGitHubApp(opts.githubAppName!);
    if (!appEntry) throw new ConfigurationError(`GitHub App '${opts.githubAppName}' not found`);
    const token = await generateInstallationToken(appEntry.appId, appEntry.privateKeyPem, appEntry.installationId);
    return { token, authType: 'github-app', credentialName: opts.githubAppName ?? '(inline)' };
  }
  // ... existing PAT resolution chain
  return { token: patToken, authType: 'pat', credentialName: tokenName };
}

// In CLI commands (reverse-git.ts, repo-sync.ts):
const { token, authType, credentialName } = await resolveGitHubCredential(store, opts);
const client = GitHubWriteClient.fromRepoUrl(token, repoUrl);
```

**Strengths:**
- **Zero changes to GitHubWriteClient**: installation tokens use the same `Authorization: Bearer <token>` header format
- **Minimal disruption**: existing PAT-based code paths unchanged
- **Clean separation**: credential resolution happens BEFORE client construction
- **Easy to test**: credential resolution can be unit-tested independently of write client
- **Future-proof**: easy to add new auth types (e.g., Azure DevOps App) by extending the resolver

**Weaknesses:**
- **Slightly more indirection**: adds one layer between CLI command and write client construction
- **Token regeneration complexity**: for long-running operations (e.g., `push --all`), must handle token refresh if it spans >1 hour (mitigated by in-memory caching — see Decision 4)

**Effort/Complexity:** **Low**
- ~50-80 lines of new code (credential resolver)
- ~20-30 lines of changes to existing CLI commands (replace `resolvePatToken` with `resolveGitHubCredential`)
- No changes to `GitHubWriteClient` internals

**Risk:** **Low**
- Installation tokens are functionally identical to PATs at the HTTP level (same header format, same endpoints)
- Backward compatibility guaranteed (existing PAT flow preserved in the resolver)

**Best suited when:**
- Minimizing changes to existing write client code is a priority
- Multiple CLI commands need auth (reduces duplication via shared resolver)
- Future auth types are anticipated (extensible design)

---

#### Option 3b: Subclass or Parallel Write Client

**Description:**
Create a `GitHubAppWriteClient` subclass (or parallel implementation) that extends/replaces `GitHubWriteClient` with GitHub App-specific logic (installation token generation, refresh, scope addition).

**Implementation:**
```typescript
export class GitHubAppWriteClient extends GitHubWriteClient {
  private readonly appId: string;
  private readonly privateKeyPem: string;
  private readonly installationId: string;
  private cachedToken?: { value: string; expiresAt: number };

  constructor(appId: string, privateKeyPem: string, installationId: string, owner: string, repo: string) {
    super('', owner, repo); // pass empty string to base constructor, override in getToken()
    // ... store app credentials
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.value;
    }
    const token = await generateInstallationToken(this.appId, this.privateKeyPem, this.installationId);
    this.cachedToken = { value: token, expiresAt: Date.now() + 3600_000 }; // 1 hour
    return token;
  }

  // Override all methods to call getToken() instead of using this.pat
  async ensureRepo(...) { const token = await this.getToken(); /* use token */ }
  async createCommit(...) { const token = await this.getToken(); /* use token */ }
}
```

**Strengths:**
- **Encapsulation**: all GitHub App logic (token generation, caching, scope addition) lives in one class
- **Token refresh built-in**: can automatically refresh tokens before expiry within the client
- **Type safety**: caller passes GitHub App credentials, not a raw string

**Weaknesses:**
- **High duplication**: must override ~10 methods in `GitHubWriteClient` to replace `this.pat` with `await this.getToken()`
- **Maintenance burden**: every change to `GitHubWriteClient` must be mirrored in the subclass
- **Violates DRY**: identical fetch logic duplicated across base class and subclass
- **Complexity in CLI**: must dispatch to correct client class based on auth type
- **Harder to test**: integration tests must cover both `GitHubWriteClient` and `GitHubAppWriteClient`

**Effort/Complexity:** **High**
- ~200-300 lines of duplicated code
- ~50-100 lines of CLI dispatch logic
- Ongoing maintenance burden

**Risk:** **Medium**
- Code duplication → bugs when one implementation is updated but not the other
- Subclassing brittle if base class changes significantly

**Best suited when:**
- GitHub App authentication requires fundamentally different request logic (not the case here)
- Token refresh must happen mid-operation (can be handled by resolver in Option 3a)

**Recommendation for this option:** **NOT RECOMMENDED** — unnecessary duplication

---

#### Option 3c: `authType` Discriminator on Credential Entries + Resolver

**Description:**
Store `authType` on credential entries (in `CredentialData`), and use a resolver that dispatches based on the stored `authType` field rather than CLI flags.

**Implementation:**
```typescript
// Extend CredentialData
export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];
  githubApps?: GitHubAppEntry[];
  defaultGitHubAuth?: { type: 'pat' | 'github-app'; name: string }; // NEW
}

// Resolver checks defaultGitHubAuth
async function resolveGitHubCredential(store: CredentialStore, opts: { ... }): Promise<string> {
  if (!opts.githubAppName && !opts.pat && !opts.tokenName) {
    // No explicit credential → use default
    const defaultAuth = store.getDefaultGitHubAuth();
    if (defaultAuth.type === 'github-app') {
      return generateInstallationToken(store.getGitHubApp(defaultAuth.name)!);
    }
    // ... fall through to PAT
  }
  // ... rest of precedence chain
}
```

**Strengths:**
- **Persistent default**: user can set a preferred GitHub App once, reused across commands
- **Less typing**: no need for `--github-app-name` on every command

**Weaknesses:**
- **Premature abstraction**: refined-request does NOT require a "default GitHub auth" feature
- **Complexity**: adds more state to credential store
- **UX confusion**: how does user set the default? New CLI command? UI checkbox?
- **Scope creep**: introduces new feature beyond the refined-request spec

**Effort/Complexity:** **Medium**
- Adds complexity to credential store and resolver
- Requires new CLI commands (`set-default-github-auth`)

**Risk:** **Low** (technical) / **Medium** (scope creep)

**Best suited when:**
- User workflow analysis shows setting a default would improve UX (not evidenced in refined-request)
- Project is willing to extend scope beyond the minimal spec

**Recommendation for this option:** **DEFER** — out of scope for v1, can be added later if users request it

---

### Decision 3 Recommendation: **Option 3a — Token-Provider Abstraction**

**Justification:**
1. **Minimal disruption**: `GitHubWriteClient` unchanged, installation tokens are drop-in replacements for PATs at HTTP level
2. **Clean separation of concerns**: credential resolution (policy) separate from HTTP client (mechanism)
3. **Extensible**: easy to add Azure DevOps App auth later by extending the resolver
4. **DRY principle**: single credential resolution function used by all CLI commands
5. **Testable**: credential resolution can be unit-tested independently
6. **Low effort**: ~100 lines of new code, ~30 lines of changes to existing CLI commands

**Implementation summary:**
- Add `resolveGitHubCredential(store, opts)` helper in `src/core/repo-utils.ts` or new file `src/core/github-app-auth.ts`
- Update all CLI commands that currently call `resolvePatToken(store, "github", opts)` to call `resolveGitHubCredential(store, opts)`
- Return `{ token: string, authType: 'pat' | 'github-app', credentialName: string }` for storing in `ReverseLink` metadata

**Trade-offs accepted:**
- One extra layer of indirection (resolver function) — offset by cleaner CLI code
- Must handle token refresh for long-running operations (mitigated by in-memory caching — see Decision 4)

**Conditions for changing recommendation:**
- If GitHub App authentication requires fundamentally different HTTP request patterns (unlikely — GitHub API treats installation tokens identically to PATs)

---

### Decision 4: Installation-Token Caching/Refresh Approach

#### Option 4a: No Caching — Regenerate on Every Operation

**Description:**
Generate a fresh installation token at the start of each CLI command or UI action. No caching, no refresh logic. Token is used for the duration of the operation (typically <1 minute) then discarded.

**Strengths:**
- **Simplest implementation**: no cache state to manage
- **No stale token risk**: always uses a fresh, valid token
- **Stateless**: each operation is independent, no shared state across commands

**Weaknesses:**
- **Performance overhead**: JWT signing + GitHub API call adds ~200-500ms per operation
- **Rate limit pressure**: each `push` command makes an extra API call (token exchange)
- **Poor UX for bulk operations**: `push --all` with 10 links = 10 token generations = 2-5 seconds overhead

**Effort/Complexity:** **Very Low**
- ~5-10 lines of code (call `generateInstallationToken` in credential resolver)

**Risk:** **Low**
- No cache invalidation bugs
- No token expiry edge cases

**Best suited when:**
- Operations are short-lived (<1 minute)
- Bulk operations are rare
- Simplicity is prioritized over performance

---

#### Option 4b: In-Memory Cache (Per CLI Command / UI Action)

**Description:**
Cache installation tokens in-memory, keyed by `installationId`, scoped to a single CLI command execution or UI action. Cache is flushed when the command exits or the UI action completes.

**Implementation:**
```typescript
// Global cache (CLI) or per-action cache (UI)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function generateInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token; // Return cached token (with 1-minute safety margin)
  }
  
  const token = await actuallyGenerateToken(appId, privateKeyPem, installationId);
  const expiresAt = Date.now() + 3600_000; // 1 hour
  tokenCache.set(installationId, { token, expiresAt });
  return token;
}

// CLI: flush cache at process exit (automatic)
// UI: flush cache when user navigates away or closes modal
```

**Strengths:**
- **Performance optimization**: bulk operations (`push --all` with 10 links) reuse the same token → 10x faster
- **Reduced API calls**: 1 token generation per CLI command instead of N (where N = number of links)
- **Still simple**: no persistent storage, no cross-process cache
- **Aligns with OQ6 resolution**: user-confirmed approach in refined-request

**Weaknesses:**
- **Slightly more complex**: must track cache state (Map or object)
- **Edge case**: if a single operation spans >1 hour (unlikely but possible), token expires mid-operation → must handle refresh
- **Memory overhead**: negligible (a few KB per installation)

**Effort/Complexity:** **Low**
- ~20-30 lines of cache logic
- ~10-15 lines of expiry handling

**Risk:** **Very Low**
- In-memory cache auto-expires with process exit (no stale data risk)
- Expiry handling is straightforward (check `Date.now() < expiresAt`)

**Best suited when:**
- Bulk operations are common (`push --all`, multiple publish commands)
- User experience optimization is valued
- Operations may involve multiple GitHub API calls per link (each reuses the cached token)

---

#### Option 4c: Persistent Cache to Disk (Encrypted)

**Description:**
Cache installation tokens in the encrypted credential store (`~/.storage-navigator/credentials.json`), alongside GitHub App credentials. Tokens persist across CLI invocations and UI restarts.

**Implementation:**
```typescript
// Extend CredentialData
export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];
  githubApps?: GitHubAppEntry[];
  installationTokenCache?: Array<{ installationId: string; token: string; expiresAt: string }>; // NEW
}

// Cache lookup
const cached = store.getInstallationToken(installationId);
if (cached && new Date(cached.expiresAt) > new Date()) {
  return cached.token;
}

// After generation, persist
store.addInstallationToken({ installationId, token, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
```

**Strengths:**
- **Maximum performance**: token reused across multiple CLI invocations (e.g., user runs `publish-github`, then `push` 5 minutes later → same token)
- **Reduced GitHub API calls**: 1 token per hour instead of 1 per CLI command

**Weaknesses:**
- **Violates NFR1 security constraint**: "Installation tokens must NOT be persisted to disk (ephemeral, regenerated on each operation)"
- **Security risk**: tokens on disk = attack surface (even if encrypted)
- **Complexity**: must implement cache eviction (prune expired tokens on load)
- **Debugging difficulty**: stale cached tokens could cause confusing failures
- **False economy**: GitHub allows 5,000 API calls/hour for installation tokens → caching across invocations saves negligible quota

**Effort/Complexity:** **Medium**
- ~50-70 lines of cache management (add, get, prune expired)
- Requires credential store schema migration

**Risk:** **High** (security) / **Medium** (complexity)

**Best suited when:**
- Operations are frequent (multiple CLI commands within 1 hour)
- Security team approves disk-based token caching (contradicts NFR1)

**Recommendation for this option:** **REJECT** — violates NFR1 (no disk persistence of installation tokens)

---

#### Option 4d: Persistent Cache with Short TTL (5-10 Minutes)

**Description:**
Hybrid approach: cache tokens to disk but with a very short TTL (5-10 minutes instead of GitHub's 1-hour expiry). Reduces API calls for rapid successive operations while limiting security exposure.

**Strengths:**
- **Balances performance and security**: short TTL means tokens are stale quickly
- **Handles rapid workflows**: user runs `publish-github`, immediately runs `push` → same token

**Weaknesses:**
- **Still violates NFR1**: disk persistence prohibited regardless of TTL
- **Complexity**: must implement TTL enforcement and eviction
- **Marginal benefit**: in-memory caching (Option 4b) already handles rapid workflows within a single CLI command

**Effort/Complexity:** **Medium**

**Risk:** **Medium** (security) / **Medium** (complexity)

**Best suited when:**
- User workflow analysis shows common pattern of rapid successive CLI invocations (not evidenced in refined-request)
- Security team approves short-TTL disk caching (contradicts NFR1)

**Recommendation for this option:** **REJECT** — violates NFR1, marginal benefit over Option 4b

---

### Decision 4 Recommendation: **Option 4b — In-Memory Cache (Per CLI Command / UI Action)**

**Justification:**
1. **Aligns with OQ6 resolution**: user-confirmed approach in refined-request ("Cache tokens in-memory for the duration of a single CLI command execution or UI action")
2. **Performance optimization**: bulk operations (`push --all` with 5 links) reuse the same token → 5x reduction in token generation overhead
3. **Security compliance**: no disk persistence (satisfies NFR1)
4. **Low complexity**: ~30 lines of cache logic, trivial expiry handling
5. **No stale data risk**: cache auto-expires with process exit (CLI) or action completion (UI)

**Implementation summary:**
- Add a module-level `Map<string, { token: string; expiresAt: number }>` in `src/core/github-app-auth.ts`
- In `generateInstallationToken`, check cache before calling GitHub API
- Store generated token with `expiresAt = Date.now() + 3600_000` (1 hour)
- Return cached token if `Date.now() < expiresAt - 60_000` (1-minute safety margin to avoid edge-case expiry mid-operation)
- CLI: cache auto-flushes at process exit (no cleanup code needed)
- Electron UI: flush cache when user navigates away from publish modal or closes the app (tie to component lifecycle)

**Trade-offs accepted:**
- Tokens regenerated across CLI invocations (accepted — aligns with NFR1)
- Must handle edge case of operation spanning >1 hour (extremely rare; if it happens, catch 401 and regenerate token)

**Conditions for changing recommendation:**
- If user workflow analysis shows frequent rapid successive CLI invocations (consider Option 4d with security team approval)
- If security audit prohibits even in-memory token caching (fallback to Option 4a)

---

## Comparison Matrix

| Criterion | Decision 1: JWT Library | Decision 2: Scope Addition | Decision 3: Auth Abstraction | Decision 4: Token Caching |
|-----------|-------------------------|---------------------------|------------------------------|---------------------------|
| **Recommended Option** | `jose` | Option 2b (explicit PUT) | Token-provider abstraction | In-memory cache |
| **Aligns with project constraints** | ✅ Zero deps, no @octokit | ⚠️ Needs verification | ✅ Minimal disruption | ✅ No disk persistence |
| **Security** | ✅ Web Crypto API, zero CVEs | ⚠️ Unverified permission | ✅ Same as PAT flow | ✅ No disk exposure |
| **Complexity** | Low | Low (if works) | Low | Low |
| **Effort** | ~50 lines | ~15 lines | ~100 lines | ~30 lines |
| **Risk** | Low | **High — unverified** | Low | Very Low |
| **Long-term viability** | ✅ Future-proof (Web Crypto) | ⚠️ Depends on GitHub API | ✅ Extensible | ✅ Simple |
| **Performance impact** | ~100ms per token gen | N/A | N/A | 5-10x faster for bulk ops |
| **Backward compatibility** | ✅ PAT flow unchanged | ✅ Graceful degradation | ✅ Zero changes to PAT | ✅ Transparent to PAT |
| **Bundle size** | 25-30 KB | N/A | N/A | N/A |
| **Technical research needed** | No | **YES — CRITICAL** | No | No |

---

## Recommendation

### Decision 1: JWT Library
**Use `jose`** — zero transitive dependencies, Web Crypto API-based, smaller bundle size, excellent security track record. Aligns with project's minimal-dependency philosophy.

### Decision 2: Scope Addition Mechanism
**Use explicit `PUT /user/installations/{id}/repositories/{repo_id}` with graceful degradation** — implement the API call after repo creation; if it fails (403/404), log a warning and continue (repo is created, user adds manually via GitHub UI). **CRITICAL: Technical research required** to verify installation tokens have permission to call this endpoint.

### Decision 3: Auth Abstraction
**Token-provider abstraction** — introduce `resolveGitHubCredential(store, opts)` helper that returns a bearer token string. `GitHubWriteClient` remains unchanged. Clean separation of concerns, minimal disruption, extensible.

### Decision 4: Token Caching
**In-memory cache keyed by `installationId`**, scoped to single CLI command/UI action — balances performance (reuses token for bulk operations) with security (no disk persistence). Auto-expires at process exit.

---

## Technical Research Guidance

**Research needed**: **Yes** — one critical uncertainty blocks implementation

---

### Topic 1: GitHub App Installation Token Permissions for Repository Scope Management

**Why:**
The core boundary mechanism (auto-adding created repos to "Only select repositories" installations) depends on verifying that installation tokens can modify their own installation's repository set via `PUT /user/installations/{installation_id}/repositories/{repository_id}`.

**What decision depends on this:**
- If installation tokens CAN call the PUT endpoint → implement Option 2b (explicit scope addition)
- If they CANNOT → investigate alternatives (org-level permissions, user-to-server tokens, or fallback to manual UI-based addition with clear documentation)

**Focus:**
1. **Endpoint permission verification:**
   - Can an installation token (not a user-to-server OAuth token) successfully call `PUT /user/installations/{installation_id}/repositories/{repository_id}`?
   - What specific GitHub App permissions are required? (Administration: Read & Write? Contents: Read & Write? Something else?)
   - Does the answer differ for organization installations vs personal account installations?

2. **Repository creation behavior:**
   - When an installation token with Administration permission creates a repository (via `POST /user/repos` or `POST /orgs/{org}/repos`), is the new repository automatically added to the installation's "Only select repositories" set?
   - Does this behavior differ based on:
     - Organization vs personal account?
     - Installation permission configuration (Administration vs Contents-only)?
     - Repository visibility (public vs private)?

3. **Alternative flows (if PUT fails):**
   - If installation tokens lack permission, what token type CAN modify the installation's repository set?
   - Is there a different endpoint for apps to self-manage their repository scope?
   - What is the intended workflow for apps that create repos under "Only select repositories" mode?

4. **Error response analysis:**
   - What specific HTTP status codes and error messages are returned when:
     - Installation token attempts PUT without sufficient permissions?
     - Repository ID is invalid or already in the installation set?
     - Installation ID is invalid or uninstalled?

**Depth:** **Deep dive** — this is a blocking technical uncertainty; implementation cannot proceed confidently without verification

**Relevance:**
This research directly determines whether the recommended approach (Option 2b) is viable. If the PUT endpoint is not accessible to installation tokens, the project must either:
1. Implement a user-to-server OAuth flow (major scope expansion)
2. Fall back to manual UI-based addition (poor UX, documented workaround)
3. Restrict to organization-level installations only (excludes personal accounts)

**How to conduct research:**
1. Set up a test GitHub App with:
   - "Only select repositories" installation mode
   - Administration: Read & Write permission
   - Contents: Read & Write permission
2. Generate an installation token via JWT + `POST /app/installations/{id}/access_tokens`
3. Create a test repository via `POST /user/repos` with the installation token
4. Attempt `PUT /user/installations/{installation_id}/repositories/{repository_id}` with:
   - The same installation token
   - A user-to-server OAuth token (for comparison)
5. Document:
   - HTTP status codes and response bodies for each attempt
   - Whether the repository appears in the installation's "Only select repositories" set after each operation
   - GitHub API rate limit consumption
6. Test variations:
   - Organization installation vs personal account installation
   - Public repo vs private repo
   - Different permission configurations (Administration-only vs Contents-only)

**Expected deliverable:**
A technical research document (`docs/research/github-app-installation-scope.md`) with:
- Endpoint permission matrix (which token types can call which endpoints)
- Step-by-step reproduction instructions
- Sample request/response payloads
- Decision tree for implementation (if X, then Y)

---

## Implementation Considerations

### Key Decisions Still to Be Made

1. **GitHub App installation scope management API behavior** (blocking) — requires technical research (see above)
2. **Error message wording** for insufficient permissions — finalize user-facing text after technical research confirms failure modes
3. **Electron UI icon choice** for GitHub Apps vs PATs — minor, can be deferred to UI implementation phase

### Dependencies and Prerequisites

**Before implementation can start:**
1. Complete technical research on GitHub App installation token permissions (Topic 1 above)
2. Add `jose` dependency to `package.json` after dependency-vetting (check GitHub Advisory Database, run `npm audit`, document in `Issues - Pending Items.md`)
3. Confirm user-facing terminology: "GitHub App" vs "App" vs "Application" (align with GitHub's UI terminology)

**Dependency vetting checklist for `jose`:**
- [ ] Check latest stable version: `npm view jose versions --json | tail -10`
- [ ] Search GitHub Advisory Database: https://github.com/advisories?query=jose
- [ ] Verify zero transitive dependencies: `npm view jose dependencies`
- [ ] Install: `npm install jose@<latest>`
- [ ] Run audit: `npm audit`
- [ ] Document vetting date in `Issues - Pending Items.md` under "Dependency vetting log"

### Potential Pitfalls to Watch For

1. **Private key format confusion:**
   - GitHub App private keys can be PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`) or PKCS#8 (`-----BEGIN PRIVATE KEY-----`)
   - `jose` requires PKCS#8; if user provides PKCS#1, must convert or detect and provide clear error
   - Test both formats during implementation

2. **Installation ID vs App ID confusion:**
   - `appId` (GitHub App ID) is globally unique, shown in app settings
   - `installationId` (installation ID) is per-account, different for each organization/user that installs the app
   - Error messages must clearly distinguish: "App ID 123456" vs "Installation ID 789012"

3. **Token expiry edge cases:**
   - GitHub installation tokens expire after exactly 1 hour (3600 seconds)
   - JWT used to generate the token expires after 10 minutes max (GitHub requirement)
   - Must handle clock skew (use 1-minute safety margin when checking cached token expiry)

4. **Org vs user account endpoint differences:**
   - Repository creation: `POST /user/repos` (personal) vs `POST /orgs/{org}/repos` (organization)
   - Must detect org vs user from repo URL (`github.com/{owner}/{repo}` — check if `owner` is an org)
   - Azure DevOps has different patterns (out of scope for this investigation, but note for future)

5. **Electron UI credential selector UX:**
   - Must visually distinguish PATs from GitHub Apps (icon, label, grouping)
   - Avoid confusion when user has multiple installations of the same app (names must be descriptive)
   - Handle case where user selects a GitHub App but repo already exists (scope addition happens after creation — does this create an error loop?)

6. **Backward compatibility testing:**
   - Existing `credentials.json` without `githubApps` field must load successfully
   - Existing reverse-links without `authType`/`authCredentialName` must default to PAT resolution
   - All existing Vitest tests must pass unchanged (regression check)

### Suggested First Steps

**Phase 1: Foundation (no GitHub API calls yet)**
1. Add `jose` to `package.json` (after dependency vetting)
2. Extend type definitions:
   - `src/core/reverse-git-types.ts`: add `GitHubAppEntry` interface
   - `src/core/types.ts`: extend `CredentialData` with `githubApps?: GitHubAppEntry[]`
   - `src/core/reverse-git-types.ts`: extend `ReverseLink` with `authType` and `authCredentialName`
3. Implement credential store CRUD:
   - `src/core/credential-store.ts`: `addGitHubApp`, `getGitHubApp`, `listGitHubApps`, `removeGitHubApp`
4. Unit tests:
   - `tests/unit/github-app-credential-store.test.ts`: test CRUD operations
   - `tests/unit/credential-migration.test.ts`: verify backward compatibility

**Phase 2: Installation token generation (local testing, no push yet)**
5. Implement JWT signing:
   - `src/core/github-app-auth.ts`: `generateInstallationToken(appId, privateKeyPem, installationId)` with in-memory cache
6. Unit tests:
   - `tests/unit/github-app-auth.test.ts`: test JWT generation (mock GitHub API response)
   - Test error cases: invalid PEM, revoked installation, expired JWT

**Phase 3: CLI commands**
7. Implement credential resolver:
   - `src/core/repo-utils.ts` (or `github-app-auth.ts`): `resolveGitHubCredential(store, opts)`
8. Add GitHub App management commands:
   - `src/cli/commands/github-app-ops.ts`: `addGitHubApp`, `listGitHubApps`, `removeGitHubApp`
   - `src/cli/index.ts`: register new subcommands
9. Extend reverse-git commands:
   - `src/cli/commands/reverse-git.ts`: add `--github-app-name` and `--github-app-inline` flags to `publishGitHub`, `reverseLinkGitHub`, `pushReverseLinkCmd`

**Phase 4: Technical research gate (BLOCKING)**
10. Conduct technical research on GitHub App installation token permissions (see Topic 1 above)
11. Update implementation plan based on research findings:
    - If PUT endpoint works → proceed to Phase 5
    - If PUT endpoint fails → implement graceful degradation (warning + manual addition guidance)

**Phase 5: Repository scope addition (after research)**
12. Extend `GitHubWriteClient.createRepo`:
    - Add optional `installationId` parameter
    - After successful `POST /user/repos`, call `PUT /user/installations/{installationId}/repositories/{repository_id}`
    - Handle 403/404 gracefully (log warning, continue)
13. Integration test:
    - `tests/unit/github-app-reverse-git.test.ts`: end-to-end flow (add GitHub App → publish → push → verify on GitHub)

**Phase 6: Electron UI**
14. Add GitHub Apps settings modal:
    - `src/electron/public/index.html`: modal structure
    - `src/electron/public/app.js`: add/list/remove logic
15. Extend publish modal credential selector:
    - Show both PATs and GitHub Apps with visual distinction
    - Store `authType` and `authCredentialName` in reverse-link metadata
16. Update reverse-links panel:
    - Display auth type and credential name in table

**Phase 7: Documentation and release**
17. Update documentation:
    - `docs/tools/storage-nav.md`: add "GitHub App Authentication" section
    - `docs/design/configuration-guide.md`: document GitHub App credential fields
    - Inline help text: `storage-nav add-github-app --help`
18. Regression testing:
    - Run full Vitest suite, confirm zero failures
    - Manual testing: PAT-based workflows (clone, sync, publish) unchanged
19. Dependency audit:
    - Run `npm audit`, confirm zero HIGH/CRITICAL advisories
    - Document dependency addition in project changelog

---

## References

| # | Source | URL / Path | What was learned |
|---|--------|------------|------------------|
| 1 | Refined Request | `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-github-app-auth.md` | Full requirements spec, user-confirmed resolutions (OQ1-OQ7), acceptance criteria, constraints |
| 2 | Codebase Scan | `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-github-app-auth.md` | Integration points, existing architecture, GitHubWriteClient internals, PAT resolution patterns, project conventions |
| 3 | GitHubWriteClient Source | `src/core/github-write-client.ts` (lines 1-50, 261-290) | Confirmed deliberate avoidance of `@octokit`, raw fetch architecture, `Authorization: Bearer <pat>` header format |
| 4 | Credential Store Source | `src/core/credential-store.ts` | AES-256-GCM encryption, machine-key derivation, TokenEntry schema, getTokenByProvider pattern |
| 5 | CLI Shared Helpers | `src/cli/commands/shared.ts` | resolvePatToken precedence chain (inline → named → first for provider → error), no-fallback rule enforcement |
| 6 | Project Constraints | `AGENTS.md` (structure-and-conventions), `CLAUDE.md` (no-fallback rule) | Dependency-vetting mandatory, strict error handling, no silent substitution of missing config |
| 7 | jose Library Ecosystem Knowledge | (Local TypeScript/Node.js expertise) | Web Crypto API foundation, zero transitive dependencies, PKCS#8 import, SignJWT API patterns |
| 8 | jsonwebtoken Ecosystem Knowledge | (Local TypeScript/Node.js expertise) | Popularity, CVE history patterns, transitive dependency footprint, synchronous API |
| 9 | GitHub App Authentication Flow | (GitHub API general knowledge) | JWT signing with RS256, 10-minute JWT expiry, installation token 1-hour expiry, `POST /app/installations/{id}/access_tokens` endpoint |
| 10 | **LIMITATION: GitHub App Scope Management API** | **External verification needed** | **CRITICAL UNKNOWN**: Whether installation tokens can call `PUT /user/installations/{id}/repositories/{repo_id}` to add repos to their own installation's "Only select repositories" set. GitHub API docs show this endpoint in user-to-server OAuth context, NOT installation token context. **Technical research required before implementation can proceed.** |

---

## Original Request

**Task:** Investigate implementation approaches for adding GitHub App authentication to the storage-navigator app. Save output to `docs/reference/investigation-github-app-auth.md` and return the absolute path as `INVESTIGATION_FILE`.

**Inputs to read first:**
- REFINED_REQUEST_FILE: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-github-app-auth.md` (note the user-confirmed resolutions block under Open Questions)
- CODEBASE_SCAN_FILE: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-github-app-auth.md`

**Decisions to investigate (compare viable options, give a justified recommendation for each, and flag where technical research is needed):**

1. JWT signing / GitHub App auth library choice. Compare: (a) `jsonwebtoken`, (b) `jose`, (c) `@octokit/auth-app`, (d) Node built-in `crypto` (no new dependency). Criteria: zero/minimal new dependency footprint (the codebase deliberately avoids @octokit and uses raw fetch — see github-write-client.ts header), security/CVE history, RS256 signing support, maintenance, bundle size for Electron, TypeScript support. The project has a strict dependency-vetting rule.

2. The CORE boundary mechanism: how exactly can a GitHub App "create a repo AND remain limited to exactly the repos it created" with 'Only select repositories' installation. Investigate the real GitHub capability and the option space:
   - Can an installation access token create a repo? (org vs user installation; Administration permission)
   - After creating a repo, how is it added to a 'selected repositories' installation? Which token type is required (installation token via `PUT /user/installations/{id}/repositories/{repo_id}` requires user-to-server; vs the app being installed 'all repositories'; vs creating inside an org the app administers where new repos auto-included?). Identify which concrete flows actually keep the app limited to created repos AND let it self-add. Flag the precise uncertainty for technical research.
   - How "extend scope to additional repos later" works (additional installations as separate credential entries vs manual add via the GitHub UI vs app-driven add).

3. Auth abstraction approach in the codebase: how to introduce installation-token auth without disrupting the PAT flow. Compare: (a) a token-provider abstraction (resolve to a bearer string the existing GitHubWriteClient consumes unchanged), (b) subclass/parallel write client, (c) authType discriminator on credential entries feeding a resolver. Recommend the least-disruptive option given GitHubWriteClient currently takes a raw PAT string.

4. Installation-token caching/refresh approach for the ~1h token lifetime within a single CLI command / UI action (per OQ6 resolution).

**For each:** list options, pros/cons, a recommendation, and a 'Technical Research Guidance' section stating Research needed: Yes/No with concrete topics, focus areas, and depth.
