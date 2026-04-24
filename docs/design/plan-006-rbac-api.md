# Plan 006 — Storage Navigator RBAC API

Status: Draft (awaiting user review)
Date: 2026-04-23

## 1. Overview

Add a hosted HTTP API (`API/` folder, separate deployable) that brokers all access to Azure Storage on behalf of authenticated callers. Add a new backend type `api` to the Storage Navigator client (Electron + CLI) so it can talk to that API as an alternative to direct account-key / SAS-token access.

The API authenticates callers against an OIDC Identity Provider (NBG IdentityServer at `https://my.nbg.gr/identity`), maps OIDC role claims to three application roles (`StorageReader`, `StorageWriter`, `StorageAdmin`), and accesses Azure Storage with its own System-Assigned Managed Identity. Authentication is operator-toggleable; when disabled, every request is treated as a configurable anonymous role.

The API exposes both Blob Storage and Azure Files (file shares) with full CRUD parity.

## 2. Goals

- Centralised, RBAC-controlled gateway in front of Azure Storage so that clients no longer need direct storage credentials.
- New client backend type `api` that can replace the existing `account-key` / `sas-token` backends without changing user-visible workflows.
- First-class support for Azure Files alongside Azure Blob.
- Toggleable authentication so the API can run protected (production) or open (trusted internal network / dev).
- Discovery endpoint so the client adapter auto-configures from the API rather than from local settings.

## 3. Non-goals (deferred to later specs)

- Repository sync, link, and diff features over the API. v1 keeps these direct-only on the client.
- Per-storage-account or per-container fine-grained roles. v1 uses three global roles.
- Pre-signed-URL / SAS download redirects. v1 proxy-streams all reads through the API.
- Auth providers other than NBG IdentityServer. The OIDC integration is provider-agnostic in code, but only NBG is validated.
- Reference (opaque) access tokens. v1 validates JWT access tokens locally via JWKS.

## 4. Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  Storage Navigator       │  HTTPS  │   Storage Navigator API  │
│  (Electron UI / CLI)     │────────▶│   (Node/TS, App Service) │
│                          │ Bearer  │   System-Assigned MI     │
│  Backend type = "api"    │  JWT    │                          │
└──────────────────────────┘         │   ┌──────────────────┐   │
        │                            │   │ OIDC middleware  │   │
        │ OIDC PKCE / device-code    │   │ (toggleable)     │   │
        ▼                            │   ├──────────────────┤   │
┌──────────────────────────┐         │   │ RBAC role mapper │   │
│  NBG Identity Server     │◀────────┤   ├──────────────────┤   │
│  my.nbg.gr/identity      │  JWKS   │   │ Routes (REST)    │   │
└──────────────────────────┘         │   ├──────────────────┤   │
                                     │   │ Azure SDK clients│   │
┌──────────────────────────┐  ARM    │   │ (Blob + Files)   │   │
│  Azure Subscription(s)   │◀────────┤   │ via DefaultAzure │   │
│  + Storage accounts      │  HTTPS  │   │   Credential     │   │
└──────────────────────────┘         │   └──────────────────┘   │
                                     └──────────────────────────┘
```

Key facts:

- API code lives in repo root `API/` folder, separate `package.json`, deployed independently.
- Hosting: Azure App Service (Linux, Node 22). System-Assigned Managed Identity.
- Identity provider: NBG IdentityServer. Discovery: `https://my.nbg.gr/identity/.well-known/openid-configuration`.
- Token type: JWT, RS256, validated locally via JWKS (cached).
- Storage access: `DefaultAzureCredential` from `@azure/identity` resolves to MI on App Service and `az login` locally.
- Storage account discovery: ARM scan via `@azure/arm-storage` (MI needs Reader on the in-scope subscriptions). Cached, refreshed periodically.
- Auth toggle: `AUTH_ENABLED=true|false`. When false, requests get a synthetic principal whose roles are `[ANON_ROLE]`.

## 5. Folder layout (API/)

```
API/
├── package.json                  # express, @azure/identity, @azure/arm-storage,
│                                 # @azure/storage-blob, @azure/storage-file-share,
│                                 # jose (JWT verify), pino, zod
├── tsconfig.json
├── Dockerfile
├── .env.example
├── README.md
├── openapi.yaml                  # served at /openapi.yaml + /docs (swagger-ui)
├── src/
│   ├── index.ts                  # entrypoint
│   ├── app.ts                    # express app factory (testable)
│   ├── config.ts                 # zod-validated env, throws on missing required
│   ├── auth/
│   │   ├── oidc-middleware.ts    # JWT verify via JWKS (jose), iss/aud/exp/nbf
│   │   ├── jwks-cache.ts         # remote JWKS cache, kid-miss rotation
│   │   ├── role-mapper.ts        # NBG `role` claim values → app roles
│   │   └── auth-toggle.ts        # disabled-mode synthetic principal
│   ├── rbac/
│   │   ├── permissions.ts        # role → allowed verbs matrix
│   │   └── enforce.ts            # express middleware factory: requireRole('Writer')
│   ├── azure/
│   │   ├── credential.ts         # DefaultAzureCredential singleton
│   │   ├── account-discovery.ts  # ARM scan, allowlist filter, cache
│   │   ├── blob-service.ts       # @azure/storage-blob wrapper
│   │   └── file-service.ts       # @azure/storage-file-share wrapper
│   ├── routes/
│   │   ├── well-known.ts         # GET /.well-known/storage-nav-config
│   │   ├── health.ts             # /healthz, /readyz
│   │   ├── storages.ts           # /storages
│   │   ├── containers.ts         # /storages/{a}/containers[/{c}]
│   │   ├── blobs.ts              # /storages/{a}/containers/{c}/blobs[/{path}]
│   │   ├── shares.ts             # /storages/{a}/shares[/{s}]
│   │   └── files.ts              # /storages/{a}/shares/{s}/files[/{path}]
│   ├── errors/
│   │   ├── api-error.ts          # typed error class
│   │   └── error-middleware.ts   # final express handler
│   ├── streaming/
│   │   └── proxy.ts              # readable-stream piping for reads
│   └── observability/
│       ├── logger.ts             # pino, request id, principal id, route
│       └── metrics.ts            # /metrics (prom-client) — optional
└── test/
    ├── unit/
    └── integration/              # vitest + Azurite + mock IdP
```

### Module responsibilities

| Module | Inputs | Outputs | Depends on |
|---|---|---|---|
| `config` | `process.env` | typed `Config` or throw | zod |
| `auth/oidc-middleware` | `Authorization` header | `req.principal = {sub, roles, raw}` or 401 | `jwks-cache`, `config` |
| `auth/role-mapper` | NBG `role` claim values | `Set<AppRole>` | `config.roleMap` |
| `rbac/enforce` | `req.principal`, required role | `next()` or 403 | `permissions` |
| `azure/account-discovery` | timer | `Map<accountName, AccountInfo>` | ARM SDK, MI |
| `azure/blob-service` | account, container, path | blob ops | `@azure/storage-blob`, MI |
| `azure/file-service` | account, share, path | file share ops | `@azure/storage-file-share`, MI |
| `routes/*` | HTTP req | HTTP res | services + `rbac/enforce` |

### Invariants

- Routes never call Azure SDK directly. All access goes through `azure/*` services. Keeps tests isolatable.
- Streaming reads use Node `pipeline()`. Whole blobs are never buffered.
- Every route declares an explicit RBAC requirement via `requireRole(...)` middleware.
- Error middleware is last. Any `ApiError` thrown anywhere is serialised to the documented JSON shape. Unknown errors become 500 with a correlation id; details are logged but never returned to the caller.

## 6. URL surface

### Discovery and ops

| Method | Path | Purpose | Min Role |
|---|---|---|---|
| GET | `/.well-known/storage-nav-config` | Client auto-config: `{authEnabled, issuer, clientId, audience, scopes}` | none |
| GET | `/healthz` | liveness | none |
| GET | `/readyz` | readiness (JWKS reachable, ARM reachable) | none |
| GET | `/openapi.yaml` | OpenAPI 3.1 spec | none |
| GET | `/docs` | Swagger UI (env-gated) | none |

### Storage accounts

| Method | Path | Purpose | Min Role |
|---|---|---|---|
| GET | `/storages` | List accounts caller can see (allowlist + discovery) | Reader |

### Blob containers

| Method | Path | Purpose | Min Role |
|---|---|---|---|
| GET | `/storages/{account}/containers` | List containers | Reader |
| POST | `/storages/{account}/containers` | Create container `{name}` | Writer |
| DELETE | `/storages/{account}/containers/{container}` | Delete container | Admin |

### Blobs

| Method | Path | Purpose | Min Role |
|---|---|---|---|
| GET | `/storages/{account}/containers/{container}/blobs` | List blobs (`?prefix=&delimiter=/&continuationToken=`) | Reader |
| GET | `/storages/{account}/containers/{container}/blobs/{path...}` | Read blob (proxy stream); honors `Range` | Reader |
| HEAD | `/storages/{account}/containers/{container}/blobs/{path...}` | Metadata only | Reader |
| PUT | `/storages/{account}/containers/{container}/blobs/{path...}` | Create / overwrite | Writer |
| DELETE | `/storages/{account}/containers/{container}/blobs/{path...}` | Delete blob | Writer |
| POST | `/storages/{account}/containers/{container}/blobs/{path...}:rename` | `{newPath}` — copy + delete | Writer |
| DELETE | `/storages/{account}/containers/{container}/blobs?prefix=…&confirm=true` | Delete-folder (recursive) | Admin |

### File shares

| Method | Path | Purpose | Min Role |
|---|---|---|---|
| GET | `/storages/{account}/shares` | List file shares | Reader |
| POST | `/storages/{account}/shares` | Create share `{name, quotaGiB?}` | Writer |
| DELETE | `/storages/{account}/shares/{share}` | Delete share | Admin |
| GET | `/storages/{account}/shares/{share}/files` | List dir | Reader |
| GET | `/storages/{account}/shares/{share}/files/{path...}` | Read file (proxy stream) | Reader |
| HEAD | `/storages/{account}/shares/{share}/files/{path...}` | Metadata | Reader |
| PUT | `/storages/{account}/shares/{share}/files/{path...}` | Create / overwrite (auto-creates parent dirs) | Writer |
| DELETE | `/storages/{account}/shares/{share}/files/{path...}` | Delete file | Writer |
| POST | `/storages/{account}/shares/{share}/files/{path...}:rename` | `{newPath}` | Writer |
| DELETE | `/storages/{account}/shares/{share}/files?path=…&confirm=true` | Delete-folder | Admin |

### Role matrix (B1 — global)

| Role | Read | Write | Delete blob/file | Delete container/share | Delete-folder |
|---|---|---|---|---|---|
| `StorageReader` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `StorageWriter` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `StorageAdmin`  | ✓ | ✓ | ✓ | ✓ | ✓ |

### Pagination

- All list endpoints return `{ items: [...], continuationToken: string|null }`.
- Caller passes `?continuationToken=…` to fetch the next page.
- `?pageSize=` defaults to 200; capped at 1000.

### Error response shape

```json
{ "error": { "code": "NOT_FOUND", "message": "Container 'foo' not found", "correlationId": "uuid" } }
```

Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `UPSTREAM_ERROR`, `INTERNAL`.

## 7. Auth flow

### Auth enabled

```
1. Client startup
   GET /.well-known/storage-nav-config (no auth)
   Response: { authEnabled: true,
               issuer: "https://my.nbg.gr/identity",
               clientId: "<configured>",
               audience: "<api-resource>",
               scopes: ["openid","role","<api-scope>"] }

2. User login
   Electron: oidc-client-ts → authorization_code + PKCE (S256), system browser,
             loopback redirect http://127.0.0.1:<port>/cb. Tokens persisted via
             Electron safeStorage (OS keychain).
   CLI:      device_code grant. Show user_code + verification_uri, poll token
             endpoint. Tokens persisted to ~/.storage-navigator/oidc-tokens.json
             with chmod 600.

3. Per request
   Client → API:  Authorization: Bearer <access_token (JWT)>
   API:
     a. oidc-middleware extracts token
     b. fetch JWKS (cached, rotate on kid miss)
     c. verify RS256 signature, iss, aud, exp, nbf
     d. role-mapper: read configured role claim → set req.principal.roles
     e. requireRole(min) middleware checks role intersection
     f. handler invokes azure/* service via DefaultAzureCredential (MI)
     g. service returns data or stream → response

4. Token refresh
   Client uses refresh_token (offline_access) when access_token <60s from expiry.
```

### Auth disabled

```
1. Client startup
   /.well-known/storage-nav-config → { authEnabled: false, ... }

2. Client skips OIDC. Requests do not include Authorization header.

3. API
   auth-toggle middleware injects synthetic principal:
     req.principal = { sub: 'anonymous', roles: [ANON_ROLE] }
   Rest of pipeline (rbac, services) unchanged.
```

### Read-blob data flow (representative)

```
GET /storages/foo/containers/bar/blobs/docs/x.pdf
  → oidc-middleware     (parse JWT → principal{roles:[Reader]})
  → requireRole(Reader) (pass)
  → blobs.ts handler    (validate path, decode segments)
  → blob-service.read() (account-discovery.lookup('foo')
                         → BlobClient(URL,MI).getBlobClient(path).download())
  → streaming/proxy     (pipeline(downloadStream, res),
                         copy Content-Type, Content-Length, ETag, Last-Modified)
  → Client
```

### Storage account discovery

```
On boot and every DISCOVERY_REFRESH_MIN minutes:
  ARM client (MI) →
    list subscriptions caller can read (or AZURE_SUBSCRIPTIONS list) →
    for each: list resource groups (optionally scoped by config) →
    for each: list Microsoft.Storage/storageAccounts →
    build Map<accountName, {subId, rg, blobEndpoint, fileEndpoint}>
  Apply ALLOWED_ACCOUNTS allowlist if set.
  Atomically swap cache.
On lookup miss: trigger refresh; if still missing → 404.
```

### Cancellation

All Azure SDK calls accept an `AbortSignal` derived from the inbound `req` close event. Client disconnects cancel uploads and downloads promptly.

## 8. Configuration

Config is parsed and validated at startup with zod. Required values must be present or the process refuses to start. There are no fallbacks for missing required configuration (per project rule).

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP listen port |
| `LOG_LEVEL` | no | `info` | pino log level |
| `AUTH_ENABLED` | yes | — | `true` \| `false` |
| `OIDC_ISSUER` | yes if AUTH_ENABLED | — | e.g. `https://my.nbg.gr/identity` |
| `OIDC_AUDIENCE` | yes if AUTH_ENABLED | — | API resource identifier registered at NBG |
| `OIDC_CLIENT_ID` | yes if AUTH_ENABLED | — | Public client id (returned via discovery) |
| `OIDC_SCOPES` | yes if AUTH_ENABLED | — | CSV, e.g. `openid,role,storage-nav-api` |
| `OIDC_JWKS_CACHE_MIN` | no | `10` | JWKS cache TTL (minutes) |
| `OIDC_CLOCK_TOLERANCE_SEC` | no | `30` | exp / nbf skew |
| `ROLE_CLAIM` | no | `role` | Claim name to read for roles |
| `ROLE_MAP` | yes if AUTH_ENABLED | — | JSON object: `{"<claim-value>":"Reader\|Writer\|Admin",...}` |
| `ANON_ROLE` | yes if AUTH_ENABLED=false | — | `Reader` \| `Writer` \| `Admin` |
| `AZURE_SUBSCRIPTIONS` | no | discover all reachable | CSV of subscription ids |
| `ALLOWED_ACCOUNTS` | no | all discovered | CSV of account names |
| `DISCOVERY_REFRESH_MIN` | no | `15` | Discovery cache refresh interval |
| `DEFAULT_PAGE_SIZE` | no | `200` | Listing default page size |
| `MAX_PAGE_SIZE` | no | `1000` | Listing maximum page size |
| `UPLOAD_MAX_BYTES` | no | unlimited | Hard cap for PUT body |
| `STREAM_BLOCK_SIZE_MB` | no | `8` | Upload chunk size |
| `SWAGGER_UI_ENABLED` | no | `true` | Disable in prod |
| `CORS_ORIGINS` | no | none | CSV of allowed browser origins |

### Validation example

```ts
// API/src/config.ts (excerpt)
export const Config = z.object({
  port: z.coerce.number().int().positive(),
  authEnabled: z.enum(['true','false']).transform(v => v === 'true'),
  oidc: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('enabled'),
      issuer: z.string().url(),
      audience: z.string().min(1),
      clientId: z.string().min(1),
      scopes: z.string().min(1).transform(s => s.split(',')),
      jwksCacheMin: z.coerce.number().default(10),
      clockToleranceSec: z.coerce.number().default(30),
      roleClaim: z.string().default('role'),
      roleMap: z.string()
        .transform(s => JSON.parse(s))
        .pipe(z.record(z.enum(['Reader','Writer','Admin']))),
    }),
    z.object({
      mode: z.literal('disabled'),
      anonRole: z.enum(['Reader','Writer','Admin']),
    }),
  ]),
  // ...
});
```

## 9. Errors, observability, testing

### Errors

- `ApiError` class with `(status, code, message, details?)`.
- Routes throw `ApiError`; the final middleware serialises to the documented shape.
- Azure SDK `RestError` mapping: 404 → `NOT_FOUND`, 403 → `FORBIDDEN` (upstream), 412 → `CONFLICT`, etc.
- Unknown errors become 500 `INTERNAL` with full stack logged plus a correlation id; the response carries only the correlation id.

### Observability

- `pino` JSON logs: `{ts, level, reqId, principalSub, route, method, statusCode, durationMs, accountName?, container?, share?, path?}`.
- Request-id middleware sets `X-Request-Id` (echoes inbound header if present; otherwise uuid v7).
- Optional `/metrics` (prom-client) exposes per-route latency/count and JWKS / ARM error counters.
- Application Insights opt-in via `APPINSIGHTS_CONNECTION_STRING`.

### Testing

- **Unit (vitest)**: config validation, role-mapper, rbac/enforce, error mapper, route handlers with mocked services.
- **Integration**: spin up the app against Azurite (Azure Storage emulator) for blob and file-share ops. Mock NBG with a local JWKS server signing test JWTs (`jose` test helpers).
- **Contract**: `openapi.yaml` linted with `@redocly/cli lint` in CI. The same spec generates the TypeScript client used in `src/core/backend/api-backend.ts` so any contract drift breaks the storage-navigator build.
- Test files live under `API/test/unit/` and `API/test/integration/` (the API is its own deployable; project-wide `test_scripts/` continues to host CLI / UI scripts).

## 10. Deployment

- Single Dockerfile, Node 22 alpine, multi-stage. `npm ci --omit=dev` and `tsc` in build; runtime is `node dist/index.js`.
- App Service (Linux): System-Assigned MI, `AUTH_ENABLED=true`, OIDC vars set, `Always On`, HTTP/2.
- MI role assignments:
  - `Reader` on each in-scope subscription (ARM enumeration).
  - `Storage Blob Data Contributor` on each storage account (or RG).
  - `Storage File Data Privileged Contributor` on each storage account (Azure Files REST data-plane via Entra ID). The legacy `Storage File Data SMB Share Contributor` is SMB-only and not sufficient for the REST API the API uses. If the target tenant blocks OAuth-on-Files-REST, fallback to retrieving account keys at boot via `Storage Account Key Operator Service Role` is the documented escape hatch.
- CI (GitHub Actions or Azure DevOps): lint, typecheck, unit + integration (Azurite + mock IdP), build image, push to ACR, deploy via OIDC federated credential.

## 11. Storage Navigator client adapter

### New backend type

```ts
// src/core/types.ts (additions)
export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: { issuer: string; clientId: string; audience: string; scopes: string[] };
};

export type DirectStorageEntry = {
  kind: 'direct';
  name: string;
  accountName: string;
  accountKey?: string;
  sasToken?: string;
};

export type StorageBackend = DirectStorageEntry | ApiBackendEntry;
```

Existing entries default to `kind: 'direct'`. One-shot migration in `CredentialStore.load()`.

### New module: `src/core/backend/`

```
src/core/backend/
├── backend.ts                # IStorageBackend interface (containers, blobs, shares, files)
├── direct-backend.ts         # wraps existing BlobClient and the new file-share client
├── api-backend.ts            # HTTP client → API endpoints; handles auth tokens
├── factory.ts                # given StorageBackend → IStorageBackend
└── auth/
    ├── oidc-client.ts        # PKCE (Electron) + device-code (CLI), token cache
    ├── token-store.ts        # safeStorage (Electron) / chmod-600 file (CLI)
    └── discovery.ts          # GET /.well-known/storage-nav-config + cache
```

`IStorageBackend` mirrors current ops (`listContainers`, `listBlobs`, `viewBlob`, `download`, `create`, `rename`, `delete`, `deleteFolder`) plus new file-share parallels (`listShares`, `listDir`, `getFile`, etc.). Repo-sync features keep using direct SDK access — repo-link integration with `api` backend is out of scope for this spec.

### CLI changes

```bash
# Add an API backend
storage-nav add-api --name corp-api --base-url https://storage-nav-api.example.com
# Probes /.well-known/storage-nav-config; if auth on, walks through device-code login.

# Use it like any other storage entry
storage-nav containers --storage corp-api
storage-nav view --storage corp-api --container prompts --blob config.json

# New file share commands
storage-nav shares --storage corp-api
storage-nav files --storage corp-api --share myshare --path some/dir
storage-nav file-view --storage corp-api --share myshare --file some/x.txt
```

`shared.ts` resolution chain extended: when backend kind is `api` and auth is enabled, ensure a valid OIDC token (refresh if needed) before each call. Re-prompt device-code login on `UNAUTHENTICATED`.

### Electron UI changes

- "Add Storage" dialog gains a third option: **Connect to Storage Navigator API** (URL field, friendly name).
- After URL submit, UI fetches `/.well-known/storage-nav-config`. If auth is enabled, the UI opens the system browser via `shell.openExternal` to NBG's `authorize` endpoint (PKCE). A loopback HTTP server in Electron main captures `code`; the exchange and tokens are cached via Electron `safeStorage`.
- Tokens panel surfaces OIDC sessions with a logout action.
- Storage list: API entries get a distinct icon; file shares appear as a sibling node to containers under API entries.

### What is unchanged

- Existing direct backends are untouched.
- Repo sync / link / diff (v1) still work only with direct backends. API-backend support for those features is deferred.

## 12. Acceptance criteria

1. `API/` builds and starts with `npm run start` against a local `.env`.
2. `GET /healthz` returns 200; `GET /readyz` returns 200 once JWKS and ARM are reachable (or AUTH_ENABLED=false skips JWKS readiness).
3. With `AUTH_ENABLED=true`, requests without a valid Bearer JWT return `401 UNAUTHENTICATED`. Requests with a valid JWT but an insufficient role return `403 FORBIDDEN`.
4. With `AUTH_ENABLED=false` and `ANON_ROLE=Reader`, an unauthenticated `GET /storages` succeeds; an unauthenticated `PUT` on a blob returns `403 FORBIDDEN`.
5. `GET /.well-known/storage-nav-config` returns the documented shape with the operator's configured values.
6. Blob and file-share CRUD operations succeed against Azurite in the integration test suite.
7. Storage Navigator client (CLI + Electron) can add an `api` backend, log in via OIDC (when enabled), list containers and blobs, list shares and files, and view a blob through the API.
8. OpenAPI spec at `/openapi.yaml` validates with `@redocly/cli lint` in CI.

## 13. Out-of-scope follow-ups (spec candidates)

- Plan 007 — Repo sync / link / diff over the API backend.
- Plan 008 — Per-storage-account or per-container fine-grained roles (B2/B4 from brainstorm).
- Plan 009 — Pre-signed-URL / SAS-redirect download path for very large blobs.
- Plan 010 — Repo hygiene cleanup (R1–R8 from the brainstorm; most already tracked in `Issues - Pending Items.md`).
