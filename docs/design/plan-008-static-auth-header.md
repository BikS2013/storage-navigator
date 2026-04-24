# Plan 008 — Static Auth Header (perimeter API key gate)

Status: Draft (awaiting user review)
Date: 2026-04-23

## 1. Overview

Add an optional perimeter "API-key" check to the Storage Navigator API: when `STATIC_AUTH_HEADER_VALUE` is set on the App Service (typically backed by a Key Vault reference), every protected route requires that value to be presented in a configurable HTTP header. The check is independent of OIDC — when both are configured, every request must satisfy the header check first AND carry a valid JWT second. When OIDC is disabled, the static header is the sole authentication.

The Storage Navigator client (CLI + Electron UI) is taught to probe discovery, prompt the operator for the value, persist it encrypted in the existing credential store, and inject the header on every API request.

This plan is purely additive. When `STATIC_AUTH_HEADER_VALUE` is unset, the API and clients behave identically to today.

## 2. Goals

- A single environment variable (`STATIC_AUTH_HEADER_VALUE`) toggles a perimeter API-key gate on the API.
- The variable is resolved from Key Vault at App Service startup via the standard `@Microsoft.KeyVault(...)` reference syntax (no app code change for KV plumbing).
- The header **name** is operator-configurable (`STATIC_AUTH_HEADER_NAME`, defaults to `X-Storage-Nav-Auth`).
- Zero-downtime rotation: comma-separated `STATIC_AUTH_HEADER_VALUE=new,old` accepts both during the overlap window.
- Discovery (`/.well-known/storage-nav-config`), `/healthz`, `/readyz`, `/openapi.yaml`, `/docs` remain public so clients can probe and the platform can liveness-check.
- The Storage Navigator client gains a UI prompt + CLI flag for the value; it is stored encrypted in the same `credentials.json` already used for direct-mode account keys.
- Friendly `StaticAuthFailedError` on the client distinguishes header failures from OIDC failures.

## 3. Non-goals

- Per-user API keys / multi-tenant key registries. The static header is one shared secret per deployment (rotation aside).
- Client-side Key Vault access. The client never talks to Key Vault directly — the operator pastes the resolved value once at registration time.
- Replacing OIDC. When auth is enabled, OIDC continues to drive the role / principal model; the static header is purely a perimeter gate.
- IP allowlisting, mTLS, or other transport-level controls. Out of scope; orthogonal.

## 4. Architecture

### Combined behavior matrix (key result of S3 + N2 + D1 + R2)

| `AUTH_ENABLED` | `STATIC_AUTH_HEADER_VALUE` set? | What every protected request needs |
|---|---|---|
| false | no | nothing (today's behavior; anonymous principal w/ `ANON_ROLE`) |
| false | yes | static header value match → anonymous principal w/ `ANON_ROLE` |
| true | no | valid Bearer JWT (today's behavior; principal from JWT) |
| true | yes | static header value match AND valid Bearer JWT (defense-in-depth) |

`/.well-known/storage-nav-config`, `/healthz`, `/readyz`, `/openapi.yaml`, `/docs` are exempt from BOTH checks regardless of mode.

### Mount order in `app.ts`

```
requestId
  → pinoHttp
  → wellKnownRouter        ← public
  → openapiRouter          ← public
  → healthRouter           ← public
  → staticAuthMiddleware   ← gate (NEW; no-op if STATIC_AUTH_HEADER_VALUE empty)
  → oidcMiddleware OR anonymousPrincipalMiddleware
  → storagesRouter
  → containersRouter
  → blobsRouter
  → sharesRouter
  → filesRouter
  → errorMiddleware
```

`staticAuthMiddleware` is mounted unconditionally — when no values are configured, it returns a no-op pass-through so the mount order itself is stable across deployments.

## 5. API-side configuration

### New env vars

| Var | Required | Default | Purpose |
|---|---|---|---|
| `STATIC_AUTH_HEADER_VALUE` | no | — | Comma-separated list of accepted header values. Empty = gate disabled. Operators typically reference Key Vault: `@Microsoft.KeyVault(VaultName=...;SecretName=...)` |
| `STATIC_AUTH_HEADER_NAME` | no | `X-Storage-Nav-Auth` | The HTTP header name the client must send the value in |

### Config loader (`API/src/config.ts`)

Add to the root schema:

```ts
staticAuth: z.object({
  values: z.array(z.string().min(1)).default([]),
  headerName: z.string().min(1).default('X-Storage-Nav-Auth'),
}),
```

Loader rule for `STATIC_AUTH_HEADER_VALUE`: split on commas, trim each, drop empties. Empty list ⇒ gate disabled.

### New middleware

`API/src/auth/static-auth.ts` (new file):

```ts
import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';

export function staticAuthMiddleware(
  allowedValues: string[],
  headerName: string,
): RequestHandler {
  if (allowedValues.length === 0) {
    // Gate disabled — pass-through.
    return (_req, _res, next) => next();
  }
  const set = new Set(allowedValues);
  const lc = headerName.toLowerCase();
  return (req, _res, next) => {
    const got = req.header(lc);
    if (!got || !set.has(got)) {
      return next(new ApiError(401, 'STATIC_AUTH_FAILED', 'Missing or invalid static auth header'));
    }
    next();
  };
}
```

### `ApiError` codes (`API/src/errors/api-error.ts`)

Extend the union: `STATIC_AUTH_FAILED` joins the existing list (`UNAUTHENTICATED`, `FORBIDDEN`, etc.). The error middleware already serializes any `ApiError`; no change there.

## 6. Discovery endpoint

`/.well-known/storage-nav-config` adds two NEW optional fields when the gate is active. Existing fields are unchanged.

### Auth disabled, static header set

```json
{
  "authEnabled": false,
  "staticAuthHeaderRequired": true,
  "staticAuthHeaderName": "X-Storage-Nav-Auth"
}
```

### Auth enabled, static header set

```json
{
  "authEnabled": true,
  "issuer": "https://my.nbg.gr/identity",
  "clientId": "...",
  "audience": "...",
  "scopes": ["openid", "role"],
  "staticAuthHeaderRequired": true,
  "staticAuthHeaderName": "X-Storage-Nav-Auth"
}
```

### No static header (today's shape)

```json
{ "authEnabled": false }
```

The two new fields are omitted entirely when the gate is disabled. Older clients ignore unknown fields — backwards compatible.

The header VALUE is NEVER returned. The endpoint itself is NOT gated by the static header (D1).

## 7. Client adapter

### Type extension (`src/core/types.ts`)

```ts
export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: OidcConfig;
  staticAuthHeader?: { name: string; value: string };  // NEW
  addedAt: string;
};
```

`CredentialStore` already encrypts the entire `StorageEntry` payload at rest (AES-256-GCM); the new field is encrypted automatically. No migration needed (the field is optional; older entries simply lack it).

### `DiscoveryResult` (`src/core/backend/auth/discovery.ts`)

```ts
export type DiscoveryResult = (
  | { authEnabled: false }
  | { authEnabled: true; issuer: string; clientId: string; audience: string; scopes: string[] }
) & {
  staticAuthHeaderRequired?: boolean;
  staticAuthHeaderName?: string;
};
```

`fetchDiscovery()` reads both fields when present.

### `ApiBackend.authHeaders()` (`src/core/backend/api-backend.ts`)

```ts
private async authHeaders(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (this.entry.staticAuthHeader) {
    out[this.entry.staticAuthHeader.name] = this.entry.staticAuthHeader.value;
  }
  if (!this.entry.authEnabled) return out;
  // ... existing OIDC token resolution / refresh logic ...
  out.Authorization = `Bearer ${t.accessToken}`;
  return out;
}
```

The static header is sent on EVERY outgoing request, including the `readBlob` / `readFile` direct-fetch streaming paths and `uploadBlob` / `uploadFile` PUTs. No code path bypasses `authHeaders()`.

### CLI `add-api` flow

```
1. fetchDiscovery(baseUrl)        ← public, no header
2. let staticValue:
     if discovery.staticAuthHeaderRequired:
       staticValue = opts.staticSecret
                  ?? await prompt(`Enter ${discovery.staticAuthHeaderName} value: `, { hidden: true })
3. if discovery.authEnabled:
     await deviceCodeFlow(...)    ← OIDC login
     tokenStore.save(name, tokens)
4. credentialStore.add({
     kind: 'api',
     name, baseUrl, authEnabled: discovery.authEnabled,
     oidc: discovery.authEnabled ? { issuer, clientId, audience, scopes } : undefined,
     staticAuthHeader: discovery.staticAuthHeaderRequired
       ? { name: discovery.staticAuthHeaderName, value: staticValue }
       : undefined,
   })
```

CLI flag added: `--static-secret <value>` for non-interactive use (CI). Hidden interactive prompt is the default.

### CLI `login` flow

`login` re-probes discovery and reconciles three cases:

1. Entry has `staticAuthHeader`, discovery says `staticAuthHeaderRequired:true` → preserve the value unchanged. (Operator may have rotated; user can also pass `--static-secret <new>` to overwrite.)
2. Entry lacks `staticAuthHeader`, discovery says `staticAuthHeaderRequired:true` → prompt for the value (or take `--static-secret <v>`); update the entry.
3. Entry has `staticAuthHeader`, discovery says `staticAuthHeaderRequired:false` (gate was removed by operator) → keep the field on the entry but log a one-line note. The server now ignores the header; sending it is harmless. The user can clear it with `storage-nav remove --name <n>` followed by `add-api` if desired.

### Electron UI

The Add Storage → "Connect to Storage Navigator API" tab gains a third row:

```html
<label id="api-static-secret-row" hidden>
  <span id="api-static-label">X-Storage-Nav-Auth</span>
  <input id="api-static-secret" type="password" />
</label>
```

`app.js` flow on `#api-add-btn` click:

1. Fetch `/api/discovery?url=...` (proxied through embedded server).
2. If `staticAuthHeaderRequired` → set `#api-static-label` text to the actual header name; reveal the row; require non-empty value before continuing.
3. POST to `/api/storage/api-backend` with `staticAuthHeader: { name, value }` field included when supplied.

Embedded server's `POST /api/storage/api-backend` (`src/electron/server.ts`) accepts the new field and stores it on the entry as-is.

`/api/discovery` proxy passes the new fields through unchanged (no transform).

### Client error handling

`StaticAuthFailedError` extends `HttpError` with a clear remediation hint:

```ts
// src/core/backend/http-error.ts
export class StaticAuthFailedError extends HttpError {
  constructor(apiBackendName: string) {
    super(401, `Static auth header invalid for "${apiBackendName}". Re-register with the current value.`);
  }
}
```

`fromResponseBody()` distinguishes `code === 'STATIC_AUTH_FAILED'` (→ `StaticAuthFailedError`) from `code === 'UNAUTHENTICATED'` (→ existing `NeedsLoginError`). CLI commands surface a clear message that the secret is wrong (vs telling the user to re-run OIDC `login`).

## 8. Key Vault wiring (operator)

One-time setup:

```bash
KV=<your-key-vault-name>
SUB=51dfc225-0c48-4bf4-bbcc-ce78272befc5

SECRET=$(openssl rand -base64 48)
az keyvault secret set --vault-name $KV --name storage-nav-static-auth \
  --value "$SECRET" --subscription $SUB

# Grant App Service MI access
PID=0bf19509-694b-4772-af7d-c9da024a3c1c
KV_ID=$(az keyvault show -n $KV --subscription $SUB --query id -o tsv)
az role assignment create --assignee $PID \
  --role "Key Vault Secrets User" --scope $KV_ID

# Reference the secret as an env var
az webapp config appsettings set \
  --name nbg-webapp-storage-nav-api-we-dev-01 \
  --resource-group rg-direct-development-deployments \
  --subscription $SUB \
  --settings "STATIC_AUTH_HEADER_VALUE=@Microsoft.KeyVault(VaultName=${KV};SecretName=storage-nav-static-auth)"

az webapp restart \
  --name nbg-webapp-storage-nav-api-we-dev-01 \
  --resource-group rg-direct-development-deployments \
  --subscription $SUB
```

App Service resolves the `@Microsoft.KeyVault(...)` reference at startup; the process sees `STATIC_AUTH_HEADER_VALUE=<actual-secret>` in `process.env`. No app code change.

### Rotation (R2)

```bash
NEW=$(openssl rand -base64 48)
OLD=$(az keyvault secret show --vault-name $KV --name storage-nav-static-auth \
  --query value -o tsv --subscription $SUB)

# Step 1 — accept both
az keyvault secret set --vault-name $KV --name storage-nav-static-auth \
  --value "${NEW},${OLD}" --subscription $SUB
az webapp restart ...

# Step 2 — distribute $NEW to all clients (chat / vault link / runbook)

# Step 3 — once no old clients remain
az keyvault secret set --vault-name $KV --name storage-nav-static-auth \
  --value "$NEW" --subscription $SUB
az webapp restart ...
```

Zero downtime in the overlap window.

## 9. Tests

### API unit tests (vitest)

- `static-auth.test.ts`:
  - Empty `allowedValues` → middleware is a pass-through.
  - Missing header → 401 `STATIC_AUTH_FAILED`.
  - Wrong header value → 401 `STATIC_AUTH_FAILED`.
  - Correct value → `next()` called without error.
  - Multiple allowed values (`["new","old"]`) → both accepted; a third value rejected.
  - Header name match is case-insensitive (Express normalizes).
- `config.test.ts`:
  - `STATIC_AUTH_HEADER_VALUE` unset → `staticAuth.values === []`.
  - `STATIC_AUTH_HEADER_VALUE="a"` → `["a"]`.
  - `STATIC_AUTH_HEADER_VALUE="a, b , c"` → `["a","b","c"]` (trim + drop blanks).
  - `STATIC_AUTH_HEADER_NAME` defaults to `X-Storage-Nav-Auth`; override accepted.
- `well-known.test.ts`:
  - Gate inactive → response omits `staticAuthHeaderRequired`/`staticAuthHeaderName` fields.
  - Gate active → both fields present; value never returned.

### API integration tests

Extend the auth-on / auth-off E2E suites to add a third axis: gate active. Verify each combination from the §4 matrix returns the expected status. Two new test scenarios are sufficient (auth-off + gate, auth-on + gate); the no-gate variants already exist.

### Client unit tests (vitest, root)

- `discovery.test.ts`: parses `staticAuthHeaderRequired:true` + name; defaults to `false` when absent.
- `api-backend-blobs.test.ts` (new case): when `entry.staticAuthHeader` set, every fetch carries the configured header.
- `api-backend-blobs.test.ts` (new case): 401 with body code `STATIC_AUTH_FAILED` throws `StaticAuthFailedError` (NOT `NeedsLoginError`).
- `http-error.test.ts`: `fromResponseBody(401, {error:{code:'STATIC_AUTH_FAILED',...}}, 'name')` → `StaticAuthFailedError`.

### Manual smoke (final verification)

```bash
HOST=nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
SECRET=<value-from-vault>

curl -s https://$HOST/.well-known/storage-nav-config | jq
# expect staticAuthHeaderRequired:true, staticAuthHeaderName:"X-Storage-Nav-Auth"

curl -sw "\n%{http_code}\n" https://$HOST/storages
# expect 401 STATIC_AUTH_FAILED

curl -s -H "X-Storage-Nav-Auth: $SECRET" https://$HOST/storages | jq
# expect 200 with items
```

CLI:

```bash
storage-nav remove --name dev
storage-nav add-api --name dev --base-url https://$HOST
# CLI prompts for the secret (hidden)
storage-nav containers --storage dev --account sadirectusersgeneric
# expect normal listing
```

UI:

- Reload Electron window.
- Add Storage → "Connect to Storage Navigator API" → enter URL.
- Probe reveals the password field labeled `X-Storage-Nav-Auth`.
- Enter value → Connect.
- Tree expands as before.

## 10. Acceptance criteria

1. With `STATIC_AUTH_HEADER_VALUE` UNSET, the API and clients behave identically to today (full backwards compatibility).
2. With `STATIC_AUTH_HEADER_VALUE` set, every protected route rejects requests missing the header with `401 STATIC_AUTH_FAILED`.
3. Comma-separated values are accepted concurrently (`new,old` rotation).
4. `STATIC_AUTH_HEADER_NAME` defaults to `X-Storage-Nav-Auth`; override env changes the required header name.
5. `/.well-known/storage-nav-config`, `/healthz`, `/readyz`, `/openapi.yaml`, `/docs` are reachable WITHOUT the header even when the gate is active.
6. Discovery exposes `staticAuthHeaderRequired:true` + `staticAuthHeaderName:<name>` (never the value) when the gate is active; both fields absent otherwise.
7. With OIDC enabled AND the gate active, both checks must pass (defense-in-depth).
8. CLI `add-api` prompts for the secret when discovery says required; `--static-secret <v>` flag bypasses the prompt; the value is stored encrypted on the `staticAuthHeader` field of `ApiBackendEntry`.
9. CLI ops (containers, ls, view, shares, files, file-view, etc.) and Electron UI ops send the header on every request when the entry has it.
10. 401 with body code `STATIC_AUTH_FAILED` raises `StaticAuthFailedError` on the client (not `NeedsLoginError`); CLI surfaces a remediation message that says "re-register" rather than "re-run login".
11. Electron UI Add Storage tab reveals the password input ONLY when discovery says required; label = the actual header name from discovery.
12. Key Vault rotation per §8 procedure works without dropping in-flight requests during the comma-separated overlap window.

## 11. Out-of-scope follow-ups

- Plan 009 — per-user / multi-tenant API keys (managed registry + per-key role assignment).
- Plan 010 — IP allowlist + WAF rules (network-layer perimeter, complementary to this).
- Plan 011 — Move OIDC token storage to system keychain on CLI (today: chmod-600 file).
