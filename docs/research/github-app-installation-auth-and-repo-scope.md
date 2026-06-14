# GitHub App Installation Authentication and Repository-Scope Management

## Overview

This document provides deep, source-backed technical research on GitHub App authentication, focusing on installation token generation, repository creation, and the critical challenge of managing repository scope for "Only select repositories" installations.

**Research Date**: 2026-06-14  
**API Version**: 2022-11-28 (also compatible with 2026-03-10)  
**Context**: storage-navigator reverse-git feature — enabling GitHub App-based repository creation while maintaining scoped access limited to created repositories

---

## Executive Summary

**Key Finding — CRITICAL LIMITATION IDENTIFIED**:

The endpoint `PUT /user/installations/{installation_id}/repositories/{repository_id}` — which adds a repository to an installation's "Only select repositories" list — **explicitly only works with Personal Access Tokens (PATs) with the `repo` scope. Installation tokens CANNOT call this endpoint.**

**Source**: GitHub REST API Documentation, Apps/Installations endpoints  
**URL**: https://docs.github.com/en/rest/apps/installations?apiVersion=2022-11-28

**Implication for storage-navigator**:

- **Auto-addition of created repos to installation scope is NOT possible via installation tokens alone**
- The recommended implementation approach (Option 2b from the investigation) requires graceful degradation: attempt the PUT call, and if it fails with 403 Forbidden, log a warning instructing the user to manually add the repository via GitHub UI
- Alternative: implement a user-to-server OAuth flow to obtain a PAT that can call the PUT endpoint (significantly expands scope)

---

## 1. GitHub App JWT Generation

### 1.1 JWT Purpose and Lifecycle

A JSON Web Token (JWT) is used to authenticate **as the GitHub App itself** (not as an installation). The JWT is then exchanged for an installation access token that acts on behalf of a specific installation.

**JWT Lifetime**: Maximum 10 minutes  
**Algorithm**: RS256 (RSA signature with SHA-256)

### 1.2 Required JWT Claims

| Claim | Name | Value | Notes |
|-------|------|-------|-------|
| `iat` | Issued At | `Math.floor(Date.now() / 1000) - 60` | Unix timestamp. GitHub recommends setting this 60 seconds in the past to protect against clock drift. |
| `exp` | Expires At | `Math.floor(Date.now() / 1000) + 600` | Unix timestamp. Must be no more than 10 minutes into the future. |
| `iss` | Issuer | App ID or Client ID | The unique identifier of your GitHub App. **Client ID is recommended** over App ID. |
| `alg` | Algorithm | `RS256` | Must be RS256. Set in the JWT header, not the payload. |

**Source**: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app

### 1.3 JWT Header and Payload Structure

**Header**:
```json
{
  "alg": "RS256",
  "typ": "JWT"
}
```

**Payload**:
```json
{
  "iat": 1718368740,
  "exp": 1718369340,
  "iss": "123456"
}
```

### 1.4 Signing the JWT

The JWT must be signed with the GitHub App's private key (RSA, typically 2048-bit or 4096-bit). The private key is downloaded from GitHub when you generate it in the app settings.

**Private Key Formats Supported**:
- PKCS#8: `-----BEGIN PRIVATE KEY-----`
- PKCS#1: `-----BEGIN RSA PRIVATE KEY-----`

**Note**: Most modern JWT libraries (including `jose` in Node.js) expect PKCS#8. If your key is in PKCS#1 format, it may need conversion or the library may handle it automatically.

### 1.5 Using the JWT

**HTTP Headers**:
```http
Authorization: Bearer <JWT>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Important**: Must use `Authorization: Bearer`, not `Authorization: token`.

**Endpoints Requiring JWT Authentication**:
- `GET /app` — Get the authenticated app
- `POST /app/installations/{installation_id}/access_tokens` — Create installation access token
- `GET /app/installations` — List installations for the authenticated app

**Source**: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app

### 1.6 TypeScript Example with `jose`

```typescript
import { SignJWT, importPKCS8 } from 'jose';

async function generateAppJWT(
  clientId: string,
  privateKeyPem: string
): Promise<string> {
  // Import the RSA private key
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  
  // Current time (Unix timestamp)
  const now = Math.floor(Date.now() / 1000);
  
  // Create and sign the JWT
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now - 60)         // 60 seconds in the past
    .setExpirationTime(now + 600)  // 10 minutes in the future
    .setIssuer(clientId)
    .sign(privateKey);
  
  return jwt;
}
```

**Library Used**: `jose@5.x` (zero dependencies, Web Crypto API-based, TypeScript-native)

---

## 2. Installation Access Token Generation

### 2.1 Endpoint

**POST** `/app/installations/{installation_id}/access_tokens`

**Authentication**: Requires a valid GitHub App JWT (see section 1)

**Source**: https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app

### 2.2 Request Headers

```http
POST /app/installations/{installation_id}/access_tokens
Authorization: Bearer <JWT>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

### 2.3 Request Body Parameters (Optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `repositories` | array of strings | List of repository **names** the token should have access to. Up to 500 repos. |
| `repository_ids` | array of integers | List of repository **IDs** the token should have access to. Up to 500 repos. |
| `permissions` | object | Permissions granted to the installation token. Cannot exceed the permissions granted to the app itself. |

**Important**:
- If neither `repositories` nor `repository_ids` is specified, the installation token will have access to **all repositories** that the installation was granted access to.
- The installation token **cannot** be granted access to repositories that the installation was not granted access to.

### 2.4 Response

**Status Code**: 201 Created

**Response Body**:
```json
{
  "token": "ghs_16C7e42F292c6912E7710c838347Ae178B4a",
  "expires_at": "2016-07-11T22:14:10Z",
  "permissions": {
    "issues": "write",
    "contents": "read"
  },
  "repository_selection": "selected",
  "repositories": [
    {
      "id": 1296269,
      "node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
      "name": "Hello-World",
      "full_name": "octocat/Hello-World",
      "private": false
      // ... (full repository object)
    }
  ]
}
```

**Token Lifetime**: **Exactly 1 hour** from creation  
**Token Format**: Starting April 2026, GitHub began rolling out a stateless format `ghs_APPID_JWT` (longer than the traditional 40-character format)

### 2.5 Error Codes

| Status Code | Description |
|-------------|-------------|
| 401 | Requires authentication — JWT is invalid, expired, or malformed |
| 403 | Forbidden — Installation is suspended or the app lacks required permissions |
| 404 | Resource not found — Installation ID does not exist or is not accessible to this app |
| 422 | Validation failed — Invalid request body (e.g., requesting access to repositories not in the installation's scope) |

### 2.6 TypeScript Example with `jose`

```typescript
async function generateInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string
): Promise<{ token: string; expiresAt: string }> {
  // Step 1: Generate JWT
  const jwt = await generateAppJWT(appId, privateKeyPem);
  
  // Step 2: Exchange JWT for installation token
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to generate installation token: ${response.status} ${response.statusText}\n${error}`
    );
  }
  
  const data = await response.json();
  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
}
```

**Caching Recommendation**: Cache installation tokens in-memory (keyed by `installationId`) for the duration of a single CLI command or UI action. Do NOT persist tokens to disk (security risk + violates project NFR1).

---

## 3. Repository Creation with Installation Tokens

### 3.1 Can Installation Tokens Create Repositories?

**Yes**, installation tokens CAN create repositories, but the endpoint and required permissions differ for organization vs. personal account installations.

### 3.2 Organization-Owned Installation

**Endpoint**: **POST** `/orgs/{org}/repos`

**Required GitHub App Permission**: `Administration: Read & write`

**Request Headers**:
```http
POST /orgs/{org}/repos
Authorization: Bearer <installation_token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

**Request Body** (minimal):
```json
{
  "name": "my-repo",
  "private": true,
  "auto_init": true
}
```

**Response**: 201 Created, returns a full repository object including:
- `id` (numeric repository ID — needed for scope addition attempts)
- `name`, `full_name`, `owner`, `html_url`, etc.

**Source**: https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-an-organization-repository

### 3.3 User-Account (Personal) Installation

**Endpoint**: **POST** `/user/repos`

**CRITICAL AMBIGUITY**: GitHub's REST API documentation for `POST /user/repos` states that this endpoint works with:
- OAuth app tokens
- Fine-grained personal access tokens
- GitHub App **user access tokens**

**However**, the documentation does NOT explicitly state whether installation access tokens (server-to-server) can call this endpoint for personal account installations.

**Hypothesis (requires verification)**:
- Installation tokens **with `Administration: Read & write` permission** should be able to call `POST /user/repos` when the installation is on a personal account
- If this fails with 403 Forbidden, the alternative is to require a user-to-server OAuth flow (out of scope for the initial implementation)

**Source**: https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-a-repository-for-the-authenticated-user

### 3.4 Request Body Parameters (Common)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | — | Repository name (alphanumeric, hyphens, underscores) |
| `description` | string | No | `null` | Short description |
| `private` | boolean | No | `false` | `true` = private, `false` = public (subject to account plan) |
| `auto_init` | boolean | No | `false` | `true` = create initial commit with README |
| `visibility` | string | No | `"private"` | `"public"`, `"private"`, or `"internal"` (org-only) |

**Note**: `visibility` supersedes `private` when both are specified. For storage-navigator, use `visibility` for clarity.

### 3.5 Error Codes

| Status Code | Description |
|-------------|-------------|
| 201 | Created — Repository created successfully |
| 400 | Bad Request — Invalid repository name or parameters |
| 403 | Forbidden — Installation lacks `Administration: write` permission, or rate limit exceeded |
| 422 | Validation failed — Repository name already exists, or repository limit reached |

---

## 4. THE CRITICAL QUESTION: Adding Created Repos to "Only Select Repositories" Installation

### 4.1 The Endpoint

**PUT** `/user/installations/{installation_id}/repositories/{repository_id}`

**Purpose**: Add a single repository to an installation's "Only select repositories" set.

**Source**: https://docs.github.com/en/rest/apps/installations?apiVersion=2022-11-28

### 4.2 CRITICAL FINDING — Authentication Restriction

**Verbatim from GitHub Documentation**:

> Add a single repository to an installation. The authenticated user must have admin access to the repository.
> 
> **This endpoint only works for PATs (classic) with the `repo` scope.**

**What This Means**:
- **Installation tokens CANNOT call this endpoint**
- **GitHub App user access tokens CANNOT call this endpoint**
- **Only user-to-server OAuth tokens (classic PATs with `repo` scope) can call this endpoint**

**Implications**:
1. Automatic addition of created repositories to the installation's selected-repository set is **not possible** using installation tokens alone.
2. The app can create the repository successfully, but cannot programmatically add it to its own installation scope without a PAT.
3. Users must either:
   - Manually add the repository via GitHub UI (Settings → Applications → Configure → [App Name] → Repository access → Select repositories)
   - Provide a classic PAT with `repo` scope (requires OAuth flow, expands project scope significantly)

### 4.3 Request Format (For Reference)

**Request**:
```http
PUT /user/installations/{installation_id}/repositories/{repository_id}
Authorization: Bearer <classic_PAT_with_repo_scope>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**No request body required.**

**Response**: 204 No Content (success)

**Error Codes**:
| Status Code | Description |
|-------------|-------------|
| 204 | No Content — Repository added successfully |
| 304 | Not modified — Repository was already in the installation's selected repositories |
| 403 | Forbidden — Authenticated token is not a classic PAT with `repo` scope, or user lacks admin access to the repository |
| 404 | Resource not found — Installation ID or repository ID does not exist |

### 4.4 Alternative Endpoint (DELETE)

**DELETE** `/user/installations/{installation_id}/repositories/{repository_id}`

**Purpose**: Remove a repository from an installation's selected repositories.

**Same Authentication Restriction**: Only works with classic PATs with `repo` scope.

**Error 422**: Returned when the installation is configured for "All repositories" mode, or if removing this repository would leave the installation with zero repositories.

---

## 5. Extending Scope to Additional Repositories

### 5.1 Programmatic Scope Extension

Given the findings in section 4, **programmatic scope extension via the API is only possible with a classic PAT**.

**Workflow**:
1. User authenticates via OAuth (user-to-server flow) and grants the `repo` scope
2. App receives a classic PAT
3. App calls `PUT /user/installations/{installation_id}/repositories/{repository_id}` for each repository to add

**Out of Scope for storage-navigator v1**: Implementing a full OAuth flow.

### 5.2 Manual Scope Extension (GitHub UI)

**User Workflow**:
1. Navigate to GitHub Settings → Applications → Installed GitHub Apps
2. Click "Configure" next to the app
3. Under "Repository access", select "Only select repositories"
4. Use the dropdown or search to add repositories

**This is the recommended fallback** when automatic scope addition fails.

### 5.3 "All Repositories" Installation Mode

**Alternative Approach** (bypasses scope addition issue):
- User installs the GitHub App with "All repositories" access
- The app can create repositories and automatically has access to them
- **Downside**: Violates the "Only select repositories" requirement in the refined-request
- **Not recommended** unless explicitly approved by the user

---

## 6. Permissions Matrix

### 6.1 Minimum Permissions for storage-navigator Use Case

| Operation | Required GitHub App Permission | Token Type | Endpoint |
|-----------|-------------------------------|------------|----------|
| Generate installation token | — | App JWT | `POST /app/installations/{id}/access_tokens` |
| Create repository (org) | `Administration: Read & write` | Installation token | `POST /orgs/{org}/repos` |
| Create repository (user) | `Administration: Read & write` (unverified) | Installation token | `POST /user/repos` |
| Push contents (commits, files) | `Contents: Read & write` | Installation token | Git push / `POST /repos/{owner}/{repo}/git/*` |
| Read repository metadata | `Metadata: Read-only` | Installation token | `GET /repos/{owner}/{repo}` |
| Add repo to installation scope | `repo` scope (PAT) | **Classic PAT only** | `PUT /user/installations/{id}/repositories/{repo_id}` |

### 6.2 Organization vs. User Account Differences

| Aspect | Organization Installation | User Account Installation |
|--------|---------------------------|---------------------------|
| Repository creation endpoint | `POST /orgs/{org}/repos` | `POST /user/repos` |
| `Administration: write` grants repo creation | **Yes** (verified) | **Assumed, needs verification** |
| Newly created repo auto-added to scope | **No** (requires PAT) | **No** (requires PAT) |
| Default visibility | Respects org settings | User account plan (free = public only) |

---

## 7. Error and Edge-Case Behavior

### 7.1 Revoked or Suspended Installation

**Symptom**: `POST /app/installations/{id}/access_tokens` returns 403 Forbidden

**Error Message** (example):
```json
{
  "message": "This installation has been suspended",
  "documentation_url": "https://docs.github.com/rest/apps/apps#create-an-installation-access-token-for-an-app"
}
```

**Handling**: Surface to the user as "GitHub App installation is suspended or revoked. Reinstall the app or contact the organization owner."

### 7.2 Token Expiry Mid-Operation

**Scenario**: Installation token generated at 10:00:00, expires at 11:00:00. A long-running operation (e.g., publishing 50 containers) starts at 10:55:00.

**Symptom**: API calls after 11:00:00 return 401 Unauthorized

**Error Message**:
```json
{
  "message": "Bad credentials",
  "documentation_url": "https://docs.github.com/rest"
}
```

**Handling**:
1. Detect 401 response
2. Regenerate installation token (via JWT → `POST /app/installations/{id}/access_tokens`)
3. Retry the failed operation with the new token
4. **In-memory token caching**: Check expiry before each API call, regenerate if `Date.now() > expiresAt - 60_000` (1-minute safety margin)

### 7.3 403 vs. 404 Ambiguity on Private Repos

**GitHub API Behavior**: For security reasons, GitHub returns 404 Not Found for private repositories that the authenticated token cannot access, rather than 403 Forbidden (which would leak the existence of the repository).

**Implication**: When `PUT /user/installations/{id}/repositories/{repo_id}` returns 404, it could mean:
- The repository does not exist
- The repository is private and the installation does not have access
- The installation ID is invalid

**Handling**: Assume 404 means "cannot add repository to installation scope" and fall back to manual addition guidance.

### 7.4 Rate Limits for Installation Tokens

**Primary Rate Limit**: 5,000 requests per hour per installation

**Secondary Rate Limits**: GitHub may enforce additional limits to prevent abuse (e.g., 100 repository creations per hour).

**Headers to Check**:
- `X-RateLimit-Limit`: Total requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when the limit resets

**Handling**: If `X-RateLimit-Remaining` is 0:
1. Calculate wait time: `resetTime - Date.now()`
2. Surface error to user: "GitHub API rate limit exceeded. Retry after {wait_time} seconds."
3. For bulk operations, implement exponential backoff

**Source**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

---

## Assumptions and Uncertainties

### Assumptions

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `POST /user/repos` works with installation tokens for personal account installations | **MEDIUM** | If false, storage-navigator cannot create repos on personal accounts via GitHub App auth — would require OAuth flow or org-only support |
| Org-level installations with `Administration: write` can create repos via `POST /orgs/{org}/repos` | **HIGH** | Verified by GitHub docs; minimal risk |
| `PUT /user/installations/{id}/repositories/{repo_id}` restriction to PATs is permanent, not a temporary limitation | **HIGH** | If GitHub adds installation-token support later, we can remove the graceful-degradation fallback |
| In-memory token caching (per CLI command/UI action) does not violate security best practices | **HIGH** | Tokens never persist to disk; memory is cleared at process exit |
| `jose` library correctly handles PKCS#8 and PKCS#1 private key formats | **HIGH** | `jose` documentation confirms PKCS#8 support; PKCS#1 may require conversion |
| GitHub's 1-hour token lifetime applies uniformly to all installation tokens | **HIGH** | Documented behavior; GitHub does not offer longer-lived installation tokens |

### Uncertainties and Gaps

| Area | Uncertainty | How to Resolve |
|------|-------------|----------------|
| **Personal account repo creation** | Does `POST /user/repos` accept installation tokens (not just user access tokens)? | **Empirical testing**: Create a GitHub App, install on a personal account, generate installation token, attempt `POST /user/repos`. |
| **Auto-addition behavior** | Does GitHub have undocumented auto-addition of created repos to "Only select repositories" installations under certain conditions (e.g., org-level app with `Administration: write`)? | **Empirical testing**: Create repo via installation token, immediately check installation's selected-repository list via `GET /user/installations/{id}/repositories`. |
| **Stateless token format** | Does the new `ghs_APPID_JWT` token format (April 2026 rollout) work identically to the 40-character format for all API operations? | **Monitoring**: Watch for GitHub Changelog updates; test against both formats if rollout causes issues. |
| **Repository ID extraction** | Is the `id` field in the `POST /orgs/{org}/repos` or `POST /user/repos` response always a numeric integer, or could it be a node ID? | **Empirical testing**: Create a repo and inspect the response `id` field. GitHub docs suggest it's always numeric. |
| **Error messages for 403 on PUT** | What is the exact error message when an installation token (vs. PAT) calls `PUT /user/installations/{id}/repositories/{repo_id}`? | **Empirical testing**: Attempt the call with an installation token and log the full response body. |

### Clarifying Questions for Follow-Up

1. **User-account repo creation**: Can the storage-navigator project provide a test GitHub App with a personal-account installation to empirically verify that `POST /user/repos` accepts installation tokens?

2. **Graceful-degradation UX**: When automatic scope addition fails, should the CLI command:
   a. Exit with error code 2 (failure) and display manual-addition instructions?
   b. Exit with error code 0 (success, repo created) and display a warning?
   c. Exit with error code 1 (changes pushed) and display a warning?

3. **OAuth flow feasibility**: If `POST /user/repos` does NOT work with installation tokens for personal accounts, is the project willing to expand scope to include a user-to-server OAuth flow?

4. **Fallback installation mode**: Should storage-navigator support "All repositories" installation mode as an explicit user-configurable option (with warnings about security implications)?

5. **Multi-installation orchestration**: If a user installs the same GitHub App on multiple organizations, should storage-navigator:
   a. Store one credential entry per installation (current design)?
   b. Provide a UI/CLI selector to choose which installation to use for a given operation?
   c. Support "installation groups" or "default installation per organization"?

---

## References

### Official GitHub REST API Documentation

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | **Generating a JSON Web Token (JWT) for a GitHub App** | https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app | JWT structure (iat, exp, iss, alg), RS256 algorithm, 10-minute maximum lifetime, clock drift protection |
| 2 | **Create an installation access token for an app** | https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app | POST /app/installations/{id}/access_tokens endpoint, request/response schema, 1-hour token lifetime, optional `repositories`/`repository_ids`/`permissions` body parameters |
| 3 | **GitHub App installations** | https://docs.github.com/en/rest/apps/installations?apiVersion=2022-11-28 | PUT /user/installations/{id}/repositories/{repo_id} endpoint, **CRITICAL**: "This endpoint only works for PATs (classic) with the repo scope" |
| 4 | **Create a repository for the authenticated user** | https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-a-repository-for-the-authenticated-user | POST /user/repos endpoint, works with OAuth app tokens, fine-grained PATs, GitHub App user access tokens (installation token support unclear) |
| 5 | **Create an organization repository** | https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#create-an-organization-repository | POST /orgs/{org}/repos endpoint, requires `Administration: write` permission, works with installation tokens |
| 6 | **Authenticating as a GitHub App installation** | https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation | Installation token overview, permissions inheritance from app configuration, repository scoping behavior |
| 7 | **Permissions required for GitHub Apps** | https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps | Comprehensive permission matrix for GitHub Apps, `Administration: write` grants repo creation, `Contents: write` grants push access |
| 8 | **Rate limits for the REST API** | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | 5,000 requests/hour for installation tokens, headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset |

### Additional Resources

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 9 | **GitHub API v3 OpenAPI Description** | https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json | Machine-readable API schema, endpoint parameter details, response schemas |
| 10 | **GitHub Changelog: Installation Token Format** | https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header | Stateless token format rollout (`ghs_APPID_JWT`), backward compatibility guidance |

---

## Recommended Implementation Path

Based on the research findings, the recommended implementation for storage-navigator is:

### Phase 1: Core GitHub App Authentication (Minimum Viable)

1. **JWT Generation**: Implement `generateAppJWT(clientId, privateKeyPem)` using `jose` library
2. **Installation Token Generation**: Implement `generateInstallationToken(appId, privateKeyPem, installationId)` with in-memory caching (keyed by `installationId`, 1-minute expiry safety margin)
3. **Credential Storage**: Extend `CredentialData` with `githubApps?: GitHubAppEntry[]`, encrypt private key PEM alongside PATs
4. **CLI Commands**:
   - `storage-nav add-github-app --name <name> --app-id <id> --installation-id <id> --private-key-file <path>`
   - `storage-nav list-github-apps`
   - `storage-nav remove-github-app --name <name>`
5. **Repository Creation**:
   - Detect organization vs. personal account from repo URL (`github.com/{owner}/{repo}` — check if `owner` is an org via `GET /orgs/{owner}`)
   - Call `POST /orgs/{org}/repos` for orgs, `POST /user/repos` for personal accounts
   - Set `visibility: "private"` (or user-configurable), `auto_init: true`

### Phase 2: Graceful Degradation for Scope Addition

6. **Attempt Scope Addition**:
   - After successful `POST /orgs/{org}/repos` or `POST /user/repos`, extract `repository.id` from response
   - Attempt `PUT /user/installations/{installationId}/repositories/{repository.id}` using the **same installation token** (we know it will fail, but we try anyway for future-proofing)
7. **Handle 403 Forbidden**:
   - Log warning (CLI) or display toast (Electron UI): "Repository created successfully, but could not be automatically added to the GitHub App installation's selected repositories. To grant the app access, navigate to: Settings → Applications → Installed GitHub Apps → Configure → [App Name] → Repository access → Select repositories → Add '{repo_name}'."
   - **Exit code**: 0 (repo creation succeeded) or 1 (if changes were also pushed in the same operation)
8. **Handle Other Errors**:
   - 404: Same as 403 (assume repo addition failed)
   - 204: Success (log: "Repository added to GitHub App installation scope")

### Phase 3: Error Handling and Edge Cases

9. **Token Expiry Detection**:
   - On 401 Unauthorized response from any API call, regenerate installation token and retry once
10. **Rate Limit Handling**:
   - Check `X-RateLimit-Remaining` header after each API call
   - If 0, surface error with wait time: "GitHub API rate limit exceeded. Retry after {resetTime - now} seconds."
11. **Revoked Installation**:
   - On 403 from `POST /app/installations/{id}/access_tokens`, surface: "GitHub App installation is suspended or revoked. Reinstall the app or contact the organization owner."

### Phase 4: Documentation and Testing

12. **Update Documentation**:
   - `docs/tools/storage-nav.md`: Add "GitHub App Authentication" section with end-to-end workflow (registration, credential storage, usage, manual scope addition)
   - `docs/design/configuration-guide.md`: Document GitHub App credential fields
13. **Integration Tests**:
   - End-to-end test: add GitHub App → publish container → verify repo created (cannot verify scope addition without PAT)
14. **Regression Tests**:
   - Verify existing PAT-based workflows unchanged

### Future Enhancements (Out of Scope for v1)

- **User-to-Server OAuth Flow**: Implement OAuth device flow or web application flow to obtain a classic PAT with `repo` scope, enabling automatic scope addition
- **"All Repositories" Installation Mode**: Add a configuration option (with security warnings) to support apps installed with "All repositories" access
- **Personal Account Empirical Testing**: Verify `POST /user/repos` works with installation tokens for personal accounts

---

## Conclusion

GitHub App authentication for storage-navigator is **feasible with known limitations**:

✅ **Fully Supported**:
- JWT generation and installation token exchange
- Repository creation for organization installations (verified)
- Repository creation for personal account installations (assumed, needs empirical verification)
- Push operations via installation tokens with `Contents: write`

❌ **Not Supported via Installation Tokens**:
- Automatic addition of created repositories to "Only select repositories" installations (requires classic PAT with `repo` scope)

**Recommended Approach**: Implement graceful degradation — create the repository successfully, attempt scope addition (knowing it will fail), and provide clear manual-addition instructions to the user. This satisfies the core use case (scoped repository creation) while maintaining transparency about the API limitation.

**Absolute Path to This File**: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/research/github-app-installation-auth-and-repo-scope.md`
