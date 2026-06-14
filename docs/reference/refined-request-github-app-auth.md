# Refined Request — GitHub App Authentication

---

## Metadata

- **Category**: Enhancement / Feature Addition
- **Created**: 2026-06-14
- **Request ID**: `github-app-auth`
- **Related Plans**: plan-011 (reverse-git), plan-002 (credential-store)
- **Affects**: CLI, Electron UI, credential storage, GitHub integration

---

## Objective

Add GitHub App authentication as an **additional authentication method** for the storage-navigator application, enabling scoped repository access limited to exactly the repositories the app creates, while maintaining backward compatibility with the existing Personal Access Token (PAT) flow.

The GitHub App authentication must support:
- Creating new GitHub repositories through the app's identity
- Automatically adding each created repository to the app's installation's selected-repository set
- Extending scope to additional repositories later (via explicit operations or additional installations)
- Coexisting seamlessly with the current PAT-based authentication

---

## Scope

### In Scope

**Authentication Method Addition**
- GitHub App authentication as a NEW authentication option alongside PAT
- Storage of GitHub App credentials (App ID, private key PEM, installation ID, client ID/secret if needed) in the existing encrypted credential store (`~/.storage-navigator/credentials.json`, AES-256-GCM)
- Installation token generation and refresh logic (GitHub App installation tokens expire after 1 hour)

**Repository Access Model**
- GitHub App installed with "Only select repositories" access mode
- Automatic addition of each created repository to the app's installation repository set via GitHub API
- Ability to manually extend the app's scope to additional repositories (not created by the app)
- Support for multiple installations of the same app (different installation IDs for different organization/user accounts)

**Surface Support**
- CLI commands: all reverse-git publication commands (`publish-github`, `reverse-link-github`, `push`) must accept GitHub App credentials as an alternative to PAT
- Electron UI: publish modal and reverse-links panel must support GitHub App credential selection
- Credential management: commands/UI for storing, listing, and removing GitHub App credentials

**GitHub Provider Only**
- GitHub App authentication for GitHub.com repositories only
- No GitHub Enterprise Server (GHES) support in this phase (can be added later if needed)
- Azure DevOps explicitly OUT of scope (will get equivalent "Azure DevOps App" treatment in a future phase)

**Backward Compatibility**
- Existing PAT-based authentication continues to work unchanged
- No migration required for existing users
- Both authentication methods coexist without conflict
- Existing stored PATs remain functional and are the default when GitHub App credentials are not provided

### Out of Scope

**Other Providers**
- Azure DevOps App authentication (future phase)
- GitLab OAuth apps
- Bitbucket app passwords

**Advanced GitHub App Features**
- Webhooks for event-driven synchronization
- GitHub App webhook secret validation
- GitHub App permission request escalation UI
- OAuth device flow or web application flow (user registers the app externally and provides credentials)
- Automatic GitHub App registration (user must register the app manually in GitHub settings)

**Repository Management Beyond Creation**
- Deleting repositories through the app
- Transferring repository ownership
- Managing repository settings (visibility changes, branch protection, webhooks) beyond initial creation
- Repository template support

**Multi-Installation Orchestration**
- Automatic discovery of multiple installations
- Cross-installation repository access coordination
- Installation health monitoring or automatic re-authorization

**User Interface Enhancements**
- GitHub App registration wizard (user registers externally)
- Visual indication of which repositories are accessible via which app installation
- Installation permission scope viewer

---

## Requirements

### Functional Requirements

**R1. GitHub App Credential Storage**
- **R1.1**: Extend `CredentialData` type with a new optional `githubApps?: GitHubAppEntry[]` field
- **R1.2**: `GitHubAppEntry` must contain: `name` (user-friendly identifier), `appId` (GitHub App ID as string), `privateKeyPem` (RSA private key in PEM format), `installationId` (installation ID for the target account), optional `clientId`/`clientSecret` (for OAuth flows if needed later), `addedAt` (ISO 8601 timestamp), optional `expiresAt` (for private key rotation tracking)
- **R1.3**: Private key PEM must be encrypted alongside other credentials in the AES-256-GCM envelope
- **R1.4**: Support multiple GitHub App entries (one per installation, or multiple installations of the same app)

**R2. Installation Token Generation**
- **R2.1**: Generate installation access tokens on-demand using the stored App ID and private key
- **R2.2**: Token generation must use the JWT-based authentication flow: create JWT signed with private key, exchange JWT for installation token via `POST /app/installations/{installation_id}/access_tokens`
- **R2.3**: Respect the 1-hour token lifetime (no automatic refresh — regenerate on each operation, or cache for the duration of a single CLI command / UI action)
- **R2.4**: Handle token generation failures (invalid key, revoked installation, insufficient permissions) with clear error messages mapped to `GitHubApiError` or `InvalidCredentialsError`

**R3. Repository Creation with Scope Addition**
- **R3.1**: When creating a repository via GitHub App authentication, the repository must be automatically added to the app's installation repository set
- **R3.2**: Use `PUT /user/installations/{installation_id}/repositories/{repository_id}` after repository creation to add the repo to the installation's selected repositories
- **R3.3**: If the repository addition fails (403, 404, or other error), surface a warning but do NOT fail the overall operation — the repo is created and the user can manually add it via GitHub UI
- **R3.4**: Repository creation via GitHub App uses `POST /app/installations/{installation_id}/repositories` (NOT `/user/repos` or `/orgs/{org}/repos`)

**R4. Credential Resolution Chain**
- **R4.1**: CLI flag precedence: `--github-app-name <name>` → `--github-app-inline` (JSON) → `--pat <inline>` → `--token-name <name>` → first stored PAT with provider=github → error
- **R4.2**: `--github-app-inline` accepts a JSON object with fields: `appId`, `privateKeyPem`, `installationId`
- **R4.3**: When both GitHub App credentials and PAT are available, GitHub App takes precedence ONLY if explicitly specified via `--github-app-name` or `--github-app-inline`
- **R4.4**: Electron UI credential selector shows both PATs and GitHub Apps; user selects one; selection is persisted in the reverse-link metadata (`authType: "pat" | "github-app"`, `authCredentialName: string`)

**R5. Reverse-Link Metadata Extension**
- **R5.1**: Extend `ReverseLink` type with optional `authType?: "pat" | "github-app"` (default "pat" for backward compatibility)
- **R5.2**: Extend `ReverseLink` type with optional `authCredentialName?: string` (name of the PAT or GitHub App entry)
- **R5.3**: When `authType: "github-app"`, the `push` operation resolves the GitHub App credentials via `authCredentialName`, generates an installation token, and uses it for the push
- **R5.4**: Existing links without `authType` field default to PAT-based resolution (backward compatibility)

**R6. CLI Command Extensions**
- **R6.1**: Add `add-github-app` subcommand: `storage-nav add-github-app --name <name> --app-id <id> --installation-id <id> --private-key-file <path> [--expires-at <ISO-date>]`
- **R6.2**: Add `list-github-apps` subcommand: lists all stored GitHub Apps with metadata (name, appId, installationId, addedAt, expiresAt, isExpired) — NO secrets printed
- **R6.3**: Add `remove-github-app` subcommand: `storage-nav remove-github-app --name <name>`
- **R6.4**: Extend all reverse-git publication commands with `--github-app-name <name>` and `--github-app-inline <json>` flags
- **R6.5**: Error message when required GitHub App credentials are missing or invalid must explicitly state: "GitHub App credentials are invalid, revoked, or the installation was uninstalled. Verify the app is installed and has access to the target organization/user account."

**R7. Electron UI Extensions**
- **R7.1**: Add "GitHub Apps" section to the settings/credentials modal (analogous to "Personal Access Tokens")
- **R7.2**: GitHub Apps section allows: add (form with name, appId, installationId, private key PEM paste), list (table with name, appId, installationId, addedAt, expiresAt, "Remove" button), remove (confirmation dialog)
- **R7.3**: Publish modal's credential selector shows both PATs and GitHub Apps (visually distinct — e.g., PAT icon vs App icon)
- **R7.4**: Reverse-links panel displays the auth type and credential name for each link (e.g., "Auth: GitHub App (my-app-install-1)")

**R8. Write Client Adaptation**
- **R8.1**: `GitHubWriteClient` must accept EITHER a PAT OR a GitHub App installation token in its constructor (same header format: `Authorization: Bearer <token>`)
- **R8.2**: `buildWriteClientForLink()` in `repo-utils.ts` must be extended to resolve GitHub App credentials when `authType: "github-app"`, generate an installation token, and pass it to `GitHubWriteClient`
- **R8.3**: No changes to `GitHubWriteClient`'s internal request logic — installation tokens are used identically to PATs for REST API calls

**R9. Scope Extension Operations**
- **R9.1**: Add `add-repo-to-installation` helper command (optional, low priority): `storage-nav add-repo-to-installation --github-app-name <name> --repo <owner/repo>` — calls `PUT /user/installations/{installation_id}/repositories/{repository_id}` directly
- **R9.2**: Document that repositories can be added to the installation manually via GitHub UI (Settings → Applications → Configure → Repository access)
- **R9.3**: If a reverse-link's target repository is NOT in the installation's selected repositories, the push operation fails with `InsufficientScopesError` — the error message must guide the user to either add the repo to the installation or switch to PAT authentication

---

### Non-Functional Requirements

**NFR1. Security**
- Private key PEM must NEVER be logged, printed to console, or exposed in API responses (same treatment as PATs)
- Installation tokens must NOT be persisted to disk (ephemeral, regenerated on each operation)
- Encryption key derivation remains unchanged (existing `machine.key` mechanism from `credential-store.ts`)

**NFR2. Backward Compatibility**
- Existing `credentials.json` files without `githubApps` field load without error (field defaults to `[]`)
- Existing reverse-links without `authType` / `authCredentialName` continue to resolve PATs via the existing chain
- No migration script required

**NFR3. Error Handling**
- All errors follow the project's "no fallback values" rule — missing or invalid GitHub App credentials surface an explicit `ConfigurationError` (exit code 3)
- Token generation failures (JWT signing, installation token request) surface `GitHubApiError` (exit code 2) with the underlying GitHub API error message
- Repository scope addition failures surface a warning (logged to console / UI toast) but do not fail the overall operation

**NFR4. Performance**
- Installation token generation adds ~200-500ms per operation (JWT signing + one additional API call) — acceptable for on-demand operations
- Token caching within a single CLI command execution (e.g., `push --all` with 5 links) reuses the same token across links for the same installation
- No background token refresh (regenerate on each operation)

**NFR5. Documentation**
- `docs/tools/storage-nav.md` must document GitHub App authentication end-to-end: registration workflow (external), credential storage, precedence rules, scope model, troubleshooting
- `docs/design/configuration-guide.md` must be updated with GitHub App credential fields and recommended storage practices
- Inline help text (`--help`) for new CLI commands must be comprehensive

---

## Constraints

**C1. GitHub API Dependencies**
- Requires GitHub REST API v3 endpoints: `POST /app/installations/{id}/access_tokens`, `POST /app/installations/{id}/repositories`, `PUT /user/installations/{id}/repositories/{repo_id}`
- JWT library dependency: must add a lightweight JWT library for signing (e.g., `jsonwebtoken` or equivalent) — ONLY addition allowed, subject to dependency-vetting rules

**C2. GitHub App Registration Prerequisites**
- User must register the GitHub App externally (via GitHub Settings → Developer settings → GitHub Apps)
- User must install the app on their account/organization and select "Only select repositories" mode
- User must generate and download the private key PEM from GitHub
- storage-navigator does NOT provide an in-app registration wizard (user follows external GitHub documentation)

**C3. Credential Store Constraints**
- Private key PEM may be large (2048-bit RSA = ~1.7KB, 4096-bit = ~3.2KB) — stays within existing `credentials.json` size budget (typically < 50KB for all credentials)
- AES-256-GCM encryption envelope supports payloads up to ~1MB — no size constraint issue

**C4. GitHub App Permissions**
- The GitHub App must be configured with **Contents: Read & write** and **Metadata: Read-only** permissions at minimum
- **Administration: Read & write** is required ONLY if the app will create repositories (versus pushing to existing ones)
- User is responsible for configuring the correct permissions during GitHub App registration — storage-navigator surfaces a clear error when permissions are insufficient

**C5. Token Expiry**
- Installation tokens expire after 1 hour (GitHub enforced) — storage-navigator regenerates tokens on each operation, never persists them
- Private keys do not expire by default, but users may rotate them — `expiresAt` field is optional and informational (no automatic rotation logic)

**C6. Project Rules**
- **No fallback values**: missing `appId`, `privateKeyPem`, or `installationId` → `ConfigurationError` (exit code 3), never substitute defaults
- **Encryption mandatory**: private keys MUST be encrypted in the same AES-256-GCM envelope as PATs
- **No version control operations**: storage-navigator does not commit the updated `credentials.json` (user responsibility if they version-control their config)

---

## Acceptance Criteria

### GitHub App Credential Management

**AC-GM1**: User can store a GitHub App credential via CLI: `storage-nav add-github-app --name my-app --app-id 123456 --installation-id 789012 --private-key-file ~/Downloads/my-app.pem`; the credential is encrypted and persisted to `~/.storage-navigator/credentials.json`

**AC-GM2**: User can list stored GitHub Apps via CLI: `storage-nav list-github-apps` outputs a table with columns: name, appId, installationId, addedAt, expiresAt, isExpired; private key PEM is NOT printed

**AC-GM3**: User can remove a GitHub App credential via CLI: `storage-nav remove-github-app --name my-app`; the credential is deleted from `credentials.json`

**AC-GM4**: Electron UI "GitHub Apps" settings panel allows adding, listing, and removing GitHub Apps with the same fields as the CLI

**AC-GM5**: Private key PEM pasted into the Electron UI is encrypted before being saved (verified by inspecting `credentials.json` — the PEM string does not appear in plaintext)

### Authentication Flow

**AC-AF1**: When publishing a container to GitHub with `--github-app-name my-app`, the operation generates an installation token (verified via debug logging showing token generation), uses it to create the repository, and adds the repository to the installation's selected repositories (verified via GitHub UI → App settings → Repository access)

**AC-AF2**: When the installation token generation fails (invalid private key, revoked installation, missing permissions), the operation fails with `GitHubApiError` (exit code 2) and the error message includes the GitHub API response body

**AC-AF3**: When a reverse-link is created with GitHub App authentication (`--github-app-name my-app`), the link metadata includes `authType: "github-app"` and `authCredentialName: "my-app"` (verified by inspecting `.reverse-git-links.json` or `credentials.json` for storage-account scope)

**AC-AF4**: A subsequent `push` operation on the same link resolves the GitHub App credentials by name, regenerates an installation token, and pushes successfully (verified via GitHub commit history)

**AC-AF5**: When a GitHub App credential is missing or the name is misspelled, the push operation fails with `ConfigurationError` (exit code 3) and the error message states: "GitHub App credential '<name>' not found. Run 'storage-nav list-github-apps' to see available credentials."

### Credential Precedence

**AC-CP1**: When both `--github-app-name my-app` and `--token-name my-pat` are provided, GitHub App takes precedence (verified via debug logging showing installation token generation, not PAT usage)

**AC-CP2**: When neither `--github-app-name` nor `--token-name` is provided, the operation defaults to the first stored PAT with `provider: "github"` (backward compatibility — existing behavior unchanged)

**AC-CP3**: When `--github-app-inline '{"appId":"123","privateKeyPem":"...","installationId":"456"}'` is provided, the inline credentials are used without requiring a stored entry (verified via successful publish without prior `add-github-app`)

**AC-CP4**: Electron UI credential selector shows both PATs (with PAT icon) and GitHub Apps (with App icon); selecting a GitHub App and publishing creates a link with `authType: "github-app"` (verified via link metadata inspection)

### Repository Scope Management

**AC-RS1**: When creating a repository via GitHub App authentication, the repository is automatically added to the installation's selected repositories (verified via GitHub UI → Applications → Configure → Repository access showing the new repo in the list)

**AC-RS2**: When the repository addition API call fails (403 or 404), a warning is logged/displayed ("Repository created successfully but could not be added to the installation's selected repositories. Add it manually via GitHub UI.") and the operation succeeds (exit code 0 or 1 depending on whether changes were pushed)

**AC-RS3**: When pushing to a repository NOT in the installation's selected repositories, the push fails with `InsufficientScopesError` (exit code 2) and the error message guides the user: "Repository owner/repo is not accessible to GitHub App installation 123456. Add it via GitHub UI or switch to PAT authentication."

**AC-RS4**: User can manually add a repository to the installation via GitHub UI (Settings → Applications → Configure → Repository access → Select repositories); subsequent push operations to that repository succeed when using the same GitHub App credentials

### Backward Compatibility

**AC-BC1**: An existing `credentials.json` file without the `githubApps` field loads successfully; `listGitHubApps()` returns an empty array (no error)

**AC-BC2**: An existing reverse-link created with PAT authentication (no `authType` or `authCredentialName` fields) continues to push successfully via PAT resolution (verified via an old link created before this feature)

**AC-BC3**: All existing CLI commands (`clone-github`, `sync`, `publish-github`, `push`) work unchanged when GitHub App credentials are not provided (verified via regression test suite)

**AC-BC4**: Electron UI existing PAT-based workflows (forward sync, reverse-git with PAT) remain functional after GitHub App UI additions (verified via manual testing)

### Documentation & Error Messages

**AC-DE1**: `docs/tools/storage-nav.md` contains a new "GitHub App Authentication" section documenting: registration workflow (link to GitHub's docs), credential storage, CLI commands (`add-github-app`, `list-github-apps`, `remove-github-app`), precedence rules, scope model, and troubleshooting (insufficient permissions, revoked installation, expired private key)

**AC-DE2**: `docs/design/configuration-guide.md` updated with GitHub App credential fields (appId, privateKeyPem, installationId, clientId/clientSecret, expiresAt) and recommended storage practices (never commit private keys to Git, rotate keys periodically, use one app per organization)

**AC-DE3**: `storage-nav add-github-app --help` output includes: purpose, required flags, optional flags, example usage, and a note about where to obtain the App ID / installation ID / private key (GitHub Settings → Developer settings → GitHub Apps)

**AC-DE4**: When a GitHub App operation fails due to insufficient permissions, the error message explicitly lists the required permissions: "GitHub App lacks required permissions. Ensure the app has 'Contents: Read & write' and 'Administration: Read & write' (for repository creation) permissions."

### UI / UX

**AC-UX1**: Electron UI "GitHub Apps" section visually distinguishes GitHub App credentials from PATs (different icon, separate section or tab)

**AC-UX2**: Publish modal's credential selector shows both credential types with clear labels (e.g., "PAT: my-github-token" vs "GitHub App: my-app-install-1")

**AC-UX3**: Reverse-links panel displays the auth type and credential name for each link in a dedicated column (e.g., "Auth: GitHub App (my-app)")

**AC-UX4**: When adding a GitHub App via UI, the private key PEM textarea supports multi-line paste and validates the PEM format (basic check: starts with `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----`)

### Integration & Regression

**AC-IR1**: Full integration test: (1) register a GitHub App via GitHub UI, (2) add credentials via `storage-nav add-github-app`, (3) publish a container via `storage-nav publish-github --github-app-name <name>`, (4) verify repository created and added to installation, (5) make a storage change, (6) push via `storage-nav push --link-id <id>`, (7) verify new commit on GitHub

**AC-IR2**: No new runtime dependencies EXCEPT one lightweight JWT library (e.g., `jsonwebtoken@9.x`) — verified via `package.json` diff and `npm audit`

**AC-IR3**: All existing Vitest tests pass (no regressions in forward-sync, PAT-based reverse-git, credential store)

**AC-IR4**: `npx tsc --noEmit` passes (no TypeScript errors)

---

## Assumptions

**A1. GitHub App Registration**
- User registers the GitHub App externally and provides the credentials to storage-navigator
- storage-navigator does NOT provide an OAuth flow or in-app registration wizard
- User is responsible for configuring the correct permissions and installation settings

**A2. Installation Token Caching**
- Installation tokens are ephemeral and regenerated on each operation (or cached for the duration of a single CLI command execution)
- No persistent token cache to disk (security / simplicity trade-off)

**A3. Single Installation Per Credential Entry**
- Each `GitHubAppEntry` represents ONE installation (one `installationId`)
- If the user installs the same app on multiple organizations, they add multiple credential entries (one per installation)
- Credential selector in UI / CLI allows choosing the appropriate installation

**A4. Repository ID Resolution**
- Repository ID (numeric) is obtained from the repository creation response (`POST /app/installations/{id}/repositories` returns `{ id: 123456, ... }`)
- No separate API call needed to resolve owner/repo → repository ID before addition to installation scope

**A5. Private Key Rotation**
- Users rotate private keys manually via GitHub UI (regenerate & download new PEM)
- storage-navigator supports `expiresAt` field for informational tracking but does NOT automatically rotate keys
- Expired keys are flagged in `list-github-apps` output and Electron UI (same treatment as expired PATs)

**A6. Scope Extension Workflow**
- Repositories are added to the installation scope either (1) automatically when created via the app, or (2) manually via GitHub UI
- storage-navigator provides an optional `add-repo-to-installation` helper command (low priority, can be deferred)
- The primary workflow assumes repositories are created via the app (automatic addition)

**A7. Error Handling Philosophy**
- GitHub App errors (invalid credentials, insufficient permissions, revoked installation) follow the existing error taxonomy (map to `GitHubApiError`, `InsufficientScopesError`, `ConfigurationError`)
- No new error classes UNLESS a GitHub App-specific failure mode is not representable by existing types

**A8. JWT Library Choice**
- Prefer a lightweight, well-maintained JWT library with minimal dependencies
- Candidate: `jsonwebtoken@9.x` (widely used, actively maintained, supports RSA signing)
- Subject to dependency-vetting rules (check for known vulnerabilities before adding)

---

## Open Questions

> **RESOLUTION (user-confirmed, 2026-06-14):** All 7 open questions are resolved by ACCEPTING the proposed answers as written below. OQ1 → client id/secret optional, reserved for future, no OAuth flows. OQ2 → one credential entry per installation with distinct user-defined names. OQ3 → no background health checks. OQ4 → no retry in v1, warn + continue. OQ5 → basic PEM validation, defer crypto check to signing. OQ6 → in-memory token cache per command/UI action keyed by installationId. OQ7 → `authType` made extensible (`pat`/`github-app`/`ado-app`) but ADO app auth NOT implemented in this phase.


**OQ1. Client ID / Client Secret**
- **Question**: Are `clientId` and `clientSecret` needed for any GitHub App workflows in the storage-navigator context (OAuth device flow, web application flow)?
- **Context**: Current plan assumes installation tokens are sufficient (server-to-server flow). Client ID/secret may be needed for user-facing OAuth flows (out of scope for v1).
- **Proposed answer**: Make `clientId` and `clientSecret` optional fields on `GitHubAppEntry` for future extensibility, but do NOT implement OAuth flows in this phase. Document as "reserved for future use."

**OQ2. Multiple Installations per App**
- **Question**: If the user installs the same GitHub App on multiple organizations (e.g., personal account + work org), how should the UI represent this?
- **Context**: Each installation has a unique `installationId`. Current plan: add one credential entry per installation with distinct names (e.g., "my-app-personal", "my-app-work").
- **Proposed answer**: Credential name is user-defined and distinguishes installations. Document recommended naming convention in `docs/tools/storage-nav.md`.

**OQ3. Installation Health Check**
- **Question**: Should storage-navigator periodically check if the installation is still active (not revoked / uninstalled)?
- **Context**: Installation tokens will fail to generate if the installation is revoked. Current plan: check on-demand when generating tokens.
- **Proposed answer**: No background health checks. Token generation failure surfaces `GitHubApiError` at operation time. Document in troubleshooting section.

**OQ4. Scope Addition Retry Logic**
- **Question**: If the repository addition to installation scope fails (transient error), should we retry?
- **Context**: Current plan: log a warning and continue (repository is created, user can add manually).
- **Proposed answer**: No retry in v1 (fail fast with warning). Retry logic can be added in a future enhancement if users report frequent transient failures.

**OQ5. Key Format Validation**
- **Question**: How strict should the private key PEM validation be?
- **Context**: PEM can be RSA or ECDSA, may include passphrase (encrypted key). Current plan: accept any PEM-formatted string, let JWT library fail if invalid.
- **Proposed answer**: Basic validation (starts with `-----BEGIN`), defer cryptographic validation to JWT signing attempt. Error message guides user to check key format if signing fails.

**OQ6. Token Caching Scope**
- **Question**: Should installation tokens be cached across multiple reverse-links in a single `push --all` operation?
- **Context**: Each token generation costs ~200-500ms. For 10 links on the same installation, that's 2-5 seconds overhead.
- **Proposed answer**: Cache tokens in-memory for the duration of a single CLI command execution or UI action, keyed by `installationId`. Flush cache at command exit. Document this optimization in NFR4.

**OQ7. Azure DevOps Equivalence**
- **Question**: Should the design anticipate Azure DevOps "App" authentication (equivalent feature)?
- **Context**: Azure DevOps has "OAuth Apps" with similar scoped access models. Current plan: out of scope for this phase.
- **Proposed answer**: Design the credential store and auth resolution chain to be extensible (e.g., `authType: "pat" | "github-app" | "ado-app"`), but do NOT implement ADO app authentication until a future phase. Document as a known future enhancement.

---

## Original Request (Verbatim)

Make the storage-navigator application "GitHub App compatible" so it can create and manage GitHub repositories while remaining limited to exactly the repositories it has created — with the ability to extend its scope to additional repositories later (e.g. via additional tokens/installations).

CONFIRMED SCOPING DECISIONS (from the user):
1. ADD, do not replace: GitHub App authentication is an ADDITIONAL auth method alongside the existing Personal Access Token (PAT) flow. The PAT flow must keep working unchanged for backward compatibility.
2. Boundary mechanism: a GitHub App installed with "Only select repositories" access. The app's access is limited to exactly the repos it created; it must be able to add each repo it creates to its own installation's selected-repository set, AND be able to extend its scope to additional repositories later (e.g. via additional tokens/installations/explicit add-repo operations).
3. Provider scope: GitHub ONLY for this effort. Azure DevOps gets an equivalent treatment in a later phase (out of scope now, but the design should not preclude it).
4. Surface scope: BOTH the CLI and the Electron desktop UI must support the new GitHub App auth method. (The LangGraph agent tools are NOT required in this effort unless trivially free.)
5. App ownership: the USER registers and owns the GitHub App and provides the credentials (App ID, private key PEM, and installation/client identifiers as needed). These must be stored in the existing encrypted credential store (~/.storage-navigator/credentials.json, AES-256-GCM) the same way PATs are stored today.

KEY CONTEXT ABOUT THE CURRENT CODEBASE (for grounding the refined request):
- GitHub auth is currently PAT-only. Read client: src/core/github-client.ts (GitHubClient, takes a PAT). Write client: src/core/github-write-client.ts (GitHubWriteClient, takes a PAT; createRepo() does POST /user/repos or POST /orgs/{org}/repos with auto_init:true).
- Credentials live in src/core/credential-store.ts (CredentialStore) as TokenEntry { name, provider: "github"|"azure-devops", token, expiresAt }. Reverse-git resolves PATs via resolvePatToken / getReverseLinkPAT / getTokenByProvider.
- The reverse-git publish/push subsystem is documented in docs/design/plan-011-reverse-git.md and the <reverseGit> block of CLAUDE.md. It is the primary consumer of GitHub write access.
- Project rule: NEVER create fallback values for missing configuration — raise/report an explicit error instead.
