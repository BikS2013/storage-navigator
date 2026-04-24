# Plan 007 — Storage Navigator Client Adapter (api backend type)

Status: Draft (awaiting user review)
Date: 2026-04-23

## 1. Overview

Add a third backend type to the Storage Navigator client (`api`) so the existing CLI and Electron UI can talk to the deployed Storage Navigator RBAC API (Plan 006) instead of going to Azure Storage directly. The new backend supports both authentication modes the API exposes (OIDC-protected and anonymous), and adds first-class file-share UI/CLI parity with blob support — including for the existing direct backends (account-key / SAS), which today are blob-only.

This plan is the deferred Section 11 of the Plan 006 design, expanded to also bring file-share support to direct backends so the new `shares` / `files` UI surface is meaningful regardless of which backend type is in use.

## 2. Goals

- Add `kind: 'direct' | 'api'` discriminator to `StorageEntry`. Existing entries auto-migrate to `kind: 'direct'` on first load.
- New `IStorageBackend` interface that both backend kinds implement. All CLI commands and Electron route handlers consume the interface — never the concrete `BlobClient`.
- `DirectBackend` wraps the existing `BlobClient` plus a new `FileShareClient` (Azure Files SDK on the client side).
- `ApiBackend` is a thin HTTP client over the deployed API surface (Plan 006 §6).
- OIDC client (PKCE for Electron with system-browser + loopback redirect; device-code for CLI) registered alongside the api backend at `add-api` time.
- Token store: Electron `safeStorage` for the desktop app; chmod-600 file for the CLI. Keyed by api backend `name`.
- New CLI commands: `add-api`, `shares`, `share-create`, `share-delete`, `files`, `file-view`, `file-upload`, `file-rename`, `file-delete`, `file-delete-folder`.
- Electron "Add Storage" dialog gains a third tab (Connect to Storage Navigator API). Storage list shows a different icon for api backends. Tree adds a sibling "Shares" node alongside "Containers".
- Existing CLI behavior for account-key / SAS backends stays unchanged after the refactor.

## 3. Non-goals (deferred to follow-up plans)

- Repo sync / link / diff features over the api backend. v1 keeps these direct-only (per the Plan 006 spec deferral).
- Provider-agnostic OIDC support beyond NBG IdentityServer. The OIDC client is provider-neutral in code but only NBG is validated.
- Multi-tenant token storage (one token set per api backend name is the only structure).
- File-share OAuth-on-REST from the direct backend in the same way the API does it. Direct backends authenticate file-share calls via the same account-key / SAS the user provided when registering — no new auth path on the client side. The user can also register the same physical storage account both as `direct` (for SMB-style ergonomics) and as `api` (for OAuth-via-MI ergonomics) if they want both.

## 4. Architecture

```
                              ┌───────────────────────────┐
                              │    StorageBackend         │
                              │  (discriminated union)    │
                              │   kind: 'direct' | 'api'  │
                              └────────────┬──────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        ▼                                     ▼
              ┌─────────────────┐                   ┌──────────────────┐
              │ DirectStorage   │                   │ ApiBackendEntry  │
              │ Entry           │                   │  baseUrl, oidc?  │
              │  accountName    │                   └──────────────────┘
              │  accountKey?    │
              │  sasToken?      │
              └─────────────────┘
                        │                                     │
              ┌─────────▼──────────┐                ┌─────────▼───────────┐
              │ DirectBackend      │                │ ApiBackend          │
              │ ┌─────────────┐    │                │ ┌─────────────┐     │
              │ │ BlobClient  │    │                │ │ HTTP fetch  │     │
              │ │ (existing)  │    │                │ │ + OIDC      │     │
              │ ├─────────────┤    │                │ │ (PKCE/dev)  │     │
              │ │ FileShare   │NEW │                │ └─────────────┘     │
              │ │ Client      │    │                └─────────────────────┘
              │ └─────────────┘    │                          │
              └────────────────────┘                          ▼
                        │                            ┌──────────────────┐
                        ▼                            │  Storage Nav API │
              ┌─────────────────┐                    │  (deployed)      │
              │ Azure Storage   │◀───────────────────┤  /storages/...   │
              │ (blob+file)     │  ARM + data plane  └──────────────────┘
              └─────────────────┘
```

`IStorageBackend` is the single seam every consumer codes against. Production callers obtain an instance from `factory.makeBackend(entry)`; tests inject mocks.

## 5. `IStorageBackend` interface

```ts
// core/backend/backend.ts
export type PageOpts = { pageSize?: number; continuationToken?: string };
export type Page<T> = { items: T[]; continuationToken: string | null };

export type ListBlobOpts = PageOpts & { prefix?: string; delimiter?: string };
export type ContainerInfo = { name: string };
export type ShareInfo = { name: string; quotaGiB?: number };
export type FileItem = { name: string; isDirectory: boolean; size?: number; lastModified?: string };

export type BlobReadHandle = {
  stream: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
};

export interface IStorageBackend {
  // containers
  listContainers(opts?: PageOpts): Promise<Page<ContainerInfo>>;
  createContainer(name: string): Promise<void>;
  deleteContainer(name: string): Promise<void>;

  // blobs
  listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>>;
  readBlob(container: string, path: string, range?: { offset: number; count?: number }): Promise<BlobReadHandle>;
  headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>>;
  uploadBlob(container: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }>;
  deleteBlob(container: string, path: string): Promise<void>;
  renameBlob(container: string, fromPath: string, toPath: string): Promise<void>;
  deleteFolder(container: string, prefix: string): Promise<number>;

  // file shares
  listShares(opts?: PageOpts): Promise<Page<ShareInfo>>;
  createShare(name: string, quotaGiB?: number): Promise<void>;
  deleteShare(name: string): Promise<void>;
  listDir(share: string, path: string, opts?: PageOpts): Promise<Page<FileItem>>;
  readFile(share: string, path: string): Promise<BlobReadHandle>;
  headFile(share: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>>;
  uploadFile(share: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }>;
  deleteFile(share: string, path: string): Promise<void>;
  renameFile(share: string, fromPath: string, toPath: string): Promise<void>;
  deleteFileFolder(share: string, path: string): Promise<number>;
}
```

`BlobItem` and `BlobContent` types in `core/types.ts` stay unchanged. The interface refines them only where the existing shape is too loose.

## 6. Folder layout

```
src/
├── core/
│   ├── types.ts                       # MODIFY: add `kind` discriminator + ApiBackendEntry
│   ├── credential-store.ts            # MODIFY: persist OIDC tokens (separate file); migrate StorageEntry
│   ├── blob-client.ts                 # KEEP (used by DirectBackend.blobs)
│   ├── file-share-client.ts           # NEW: parallel to blob-client.ts (Azure Files SDK)
│   └── backend/
│       ├── backend.ts                 # NEW: IStorageBackend interface + Page/PageOpts shapes
│       ├── direct-backend.ts          # NEW: wraps BlobClient + FileShareClient
│       ├── api-backend.ts             # NEW: HTTP client to deployed API
│       ├── factory.ts                 # NEW: StorageBackend → IStorageBackend
│       ├── http-error.ts              # NEW: maps API JSON errors to thrown Errors
│       └── auth/
│           ├── discovery.ts           # NEW: GET /.well-known/storage-nav-config + cache
│           ├── oidc-client.ts         # NEW: PKCE (Electron) + device-code (CLI)
│           ├── token-store.ts         # NEW: Electron safeStorage + CLI chmod-600
│           └── token-refresh.ts       # NEW: refresh access token < 60s from expiry
├── cli/
│   ├── index.ts                       # MODIFY: register new commands; existing commands stay
│   └── commands/
│       ├── shared.ts                  # MODIFY: resolveStorageEntry returns IStorageBackend (factory call)
│       ├── add-storage.ts             # MODIFY: write `kind:'direct'`
│       ├── add-api.ts                 # NEW: registers ApiBackendEntry + OIDC login if needed
│       ├── auth-ops.ts                # NEW: `login` (re-run OIDC) + `logout` (delete tokens)
│                                      #      for an existing api backend
│       ├── view.ts                    # MODIFY: use IStorageBackend (no behavior change)
│       ├── blob-ops.ts                # MODIFY: use IStorageBackend
│       ├── list-storages.ts           # MODIFY: render kind column
│       ├── remove-storage.ts          # KEEP
│       ├── token-ops.ts               # KEEP (PAT tokens, separate from OIDC)
│       ├── shares-ops.ts              # NEW: shares + share-create + share-delete + files
│       │                              #      + file-view + file-upload + file-rename
│       │                              #      + file-delete + file-delete-folder
│       ├── repo-sync.ts               # KEEP (direct only, deferred)
│       ├── link-ops.ts                # KEEP (direct only, deferred)
│       └── diff-ops.ts                # KEEP (direct only, deferred)
├── electron/
│   ├── server.ts                      # MODIFY: route handlers go through IStorageBackend;
│   │                                  #         add /api/shares/* + /api/files/*
│   ├── main.ts                        # MODIFY: register loopback OIDC redirect handler
│   ├── oidc-loopback.ts               # NEW: tiny http server on 127.0.0.1:<random> for PKCE callback
│   └── public/
│       ├── index.html                 # MODIFY: "Add Storage" dialog 3rd tab + share node tree
│       ├── app.js                     # MODIFY: backend-aware list rendering, OIDC login flow,
│       │                              #         file-share UI parity with blob UI
│       └── styles.css                 # MODIFY: kind icon (cloud-link for api, key for direct)
└── tests/                             # NEW dir for client tests (project has none today)
    └── unit/
        ├── backend-factory.test.ts
        ├── api-backend.test.ts        # vi.mock fetch
        ├── direct-backend.test.ts     # mock BlobClient/FileShareClient
        ├── token-store.test.ts        # tmp dir for CLI mode
        ├── credential-migration.test.ts
        └── discovery.test.ts
```

## 7. Type definitions + migration

```ts
// core/types.ts (additions)

export type DirectStorageEntry = {
  kind: 'direct';
  name: string;
  accountName: string;
  sasToken?: string;
  accountKey?: string;
  addedAt: string;
};

export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: {
    issuer: string;
    clientId: string;
    audience: string;
    scopes: string[];
  };
  addedAt: string;
};

export type StorageEntry = DirectStorageEntry | ApiBackendEntry;
```

**Migration** (in `credential-store.ts` `load()`):

- Read existing JSON.
- For each entry where `kind` is undefined, set `kind: 'direct'` in memory.
- Write back atomically only when at least one entry was changed.
- One-shot; safe to re-run; preserves the encryption envelope.

**OIDC tokens** stored separately, NOT in the encrypted credential file:

- Electron: `safeStorage.encryptString(JSON.stringify(tokens))` written to `~/.storage-navigator/oidc-tokens.bin`.
- CLI: `~/.storage-navigator/oidc-tokens.json` chmod 600.
- Both files store a `Record<apiBackendName, TokenSet>` so multiple api backends can coexist.

## 8. Auth + data flow

### `add-api` flow

```
storage-nav add-api --name nbg-dev --base-url https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
  1. fetch ${baseUrl}/.well-known/storage-nav-config
       → {authEnabled:true|false, issuer?, clientId?, audience?, scopes?}
  2. if authEnabled === true:
       a. CLI: device-code flow
            POST issuer/connect/deviceauthorization
              client_id, scope = scopes.join(' '), audience
            → device_code, user_code, verification_uri, interval, expires_in
            print user_code + verification_uri to user
            poll issuer/connect/token { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', ... }
              until 200 (or expires_in elapses)
            tokens received → token-store.save('nbg-dev', tokens)
       b. Electron: PKCE flow
            generate code_verifier (random 64 bytes b64url)
            code_challenge = SHA256(code_verifier) b64url
            start loopback http server on 127.0.0.1:<random-port>/cb
            shell.openExternal(issuer/connect/authorize?
              response_type=code,
              client_id, scope, audience,
              redirect_uri=http://127.0.0.1:<port>/cb,
              code_challenge, code_challenge_method=S256,
              state=<random>)
            on callback:
              validate state matches
              POST issuer/connect/token { code, redirect_uri, code_verifier, client_id, grant_type:'authorization_code' }
              → tokens → token-store.save('nbg-dev', tokens)
            close loopback server
  3. credential-store.add({kind:'api', name:'nbg-dev', baseUrl, authEnabled, oidc, addedAt})
```

### Per-request flow (api backend)

```
op (e.g. listContainers('foo')):
  factory.makeBackend(entry) → ApiBackend
  ApiBackend.listContainers({pageSize, continuationToken}):
    1. if entry.authEnabled:
         tokens = await token-store.load(entry.name)
         if !tokens: throw NeedsLoginError(`Run: storage-nav login --name ${entry.name}`)
         if tokens.expiresAt < now+60s: tokens = await token-refresh.refresh(entry, tokens)
         headers = { Authorization: `Bearer ${tokens.access}` }
       else:
         headers = {}
    2. fetch ${baseUrl}/storages/${account}/containers?pageSize=&continuationToken=
       headers
    3. if 401 (auth-on): try refresh once, if still 401 → throw NeedsLoginError
    4. if 4xx: parse {error:{code,message,correlationId}} → throw HttpError
    5. parse {items, continuationToken} → return Page<ContainerInfo>
```

### Streaming flow (read blob)

```
ApiBackend.readBlob('foo', 'docs/x.pdf', range?):
  res = fetch GET ${baseUrl}/storages/${account}/containers/<container>/blobs/<encoded path>
        with Bearer header (if auth-on) and optional Range: bytes=offset-(offset+count-1)
  return BlobReadHandle{
    stream: res.body,
    contentType: res.headers.get('content-type'),
    contentLength: parseInt(res.headers.get('content-length')),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  }
  caller pipes the stream into the final consumer (file write / Express response / etc).
```

### Streaming flow (upload blob)

```
ApiBackend.uploadBlob('foo', 'config.json', body, size, 'application/json'):
  fetch PUT ${baseUrl}/storages/${account}/containers/<c>/blobs/<encoded path>
        body, headers: { Content-Type, Content-Length, Authorization }
  on 201: return { etag, lastModified } from JSON body
```

### Token refresh

`token-refresh.ts` exposes `refresh(entry, tokens) → tokens`. In-flight refreshes are deduped via a per-backend-name Promise so concurrent requests don't trigger N parallel refreshes.

## 9. Error mapping (api backend)

| HTTP status | Body code | Thrown error |
|---|---|---|
| 401 | `UNAUTHENTICATED` | `NeedsLoginError` (with hint to run `login --name <api>`) |
| 403 | `FORBIDDEN` | `AccessDeniedError` |
| 404 | `NOT_FOUND` | `NotFoundError` |
| 409 | `CONFLICT` | `ConflictError` |
| 400 | `BAD_REQUEST` | `BadRequestError` (with `details` if present) |
| 502/503 | `UPSTREAM_ERROR` | `UpstreamError` (transient — caller may retry) |
| 5xx | `INTERNAL` | `ApiInternalError` (carries `correlationId`) |
| Network failure | — | `NetworkError` (no API contact) |

CLI commands convert these to friendly stderr + exit codes; Electron server passes them through to its own JSON shape.

## 10. CLI surface

### New commands

| Command | Purpose |
|---|---|
| `add-api --name <n> --base-url <u> [--device-code]` | Register an api backend; runs OIDC login if discovery says auth on |
| `login --name <n>` | Re-run OIDC login for an existing api backend (refresh failed, or token revoked) |
| `logout --name <n>` | Delete stored tokens for an api backend |
| `shares --storage <n>` | List file shares |
| `share-create --name <s> --storage <n> [--quota <gib>]` | Create file share (Writer) |
| `share-delete --name <s> --storage <n>` | Delete file share (Admin) |
| `files --share <s> --storage <n> [--path <dir>]` | List dir |
| `file-view --share <s> --file <path> --storage <n>` | View file (text/JSON/markdown) |
| `file-upload --share <s> --file <path> [--source <local>] [--content <text>] --storage <n>` | Upload file |
| `file-rename --share <s> --file <path> --new-name <path> --storage <n>` | Rename file |
| `file-delete --share <s> --file <path> --storage <n>` | Delete file |
| `file-delete-folder --share <s> --path <dir> --storage <n>` | Recursive delete (Admin) |

### Commands that gain api-backend support (no syntax change)

`containers`, `create-container`, `ls`, `view`, `download`, `create`, `rename`, `delete`, `delete-folder` — `--storage <n>` accepts an api backend name interchangeably with a direct one.

### Commands that stay direct-only (deferred)

`add`, `clone-github`, `clone-devops`, `clone-ssh`, `sync`, `link-github`, `link-devops`, `link-ssh`, `unlink`, `list-links`, `diff`. If the user supplies `--storage <api-backend-name>` they get a clear error: `Backend kind 'api' does not support repo sync (Plan 008)`.

## 11. Electron UI changes

- `index.html` — "Add Storage" dialog gains a third tab **Connect to Storage Navigator API** (URL field, optional friendly name, login button).
- `app.js` — On URL submit, fetch `/.well-known/storage-nav-config`. If `authEnabled`, open the system browser for PKCE login; capture the loopback callback in the Electron main process; `safeStorage.encryptString(tokens)` to disk.
- Storage tree item icon: `cloud-link` for api backends, `key` for direct backends. Tooltip shows the backend type.
- Tree node hierarchy under each storage: **Containers** (existing) and **Shares** (new). Each share expands to directories/files mirroring the existing blob-prefix UI.
- "Tokens" panel surfaces OIDC sessions per api backend with a logout action. Existing PAT token listing stays.
- For direct backends, the **Shares** node uses `DirectBackend.listShares()` (Azure Files SDK with the same account-key / SAS).

## 12. Tests

- `tests/unit/credential-migration.test.ts` — old `StorageEntry` without `kind` → migrated to `kind:'direct'`; idempotent on re-run.
- `tests/unit/backend-factory.test.ts` — both kinds produce the correct concrete impl; throws on unknown kind.
- `tests/unit/direct-backend.test.ts` — mocks `BlobClient` + `FileShareClient`, asserts proxying + signature matches `IStorageBackend`.
- `tests/unit/api-backend.test.ts` — mocks global `fetch`, exercises every method, error mapping, token refresh path, range header.
- `tests/unit/token-store.test.ts` — fs path; tmp dir; chmod 600; multiple api backends keyed by name.
- `tests/unit/discovery.test.ts` — mocks fetch; validates response shape; rejects missing fields when `authEnabled:true`.
- Manual smoke test (final verification) — `add-api` against `https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net` (auth-off currently), then `containers`, `ls`, `view`, `shares`, `files`, `file-view` all return real data.
- Live OIDC test deferred — depends on a NBG IdP test client registration.

## 13. Acceptance criteria

1. Existing `npx tsx src/cli/index.ts list` shows pre-existing direct entries with `kind: direct` after migration; no data loss.
2. `npx tsx src/cli/index.ts add-api --name nbg-dev --base-url https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net` succeeds against the auth-off deployed API and writes the entry to the credential store.
3. `npx tsx src/cli/index.ts containers --storage nbg-dev` lists `sadirectusersgeneric`.
4. `npx tsx src/cli/index.ts ls --storage nbg-dev --container <one of the listed containers>` lists blobs with metadata.
5. `npx tsx src/cli/index.ts view --storage nbg-dev --container <c> --blob <path>` returns blob content.
6. `npx tsx src/cli/index.ts shares --storage nbg-dev` lists file shares (`e-auctions`, `test`).
7. `npx tsx src/cli/index.ts files --storage nbg-dev --share e-auctions --path logs` returns paginated dir listing.
8. `npx tsx src/cli/index.ts file-view --storage nbg-dev --share e-auctions --file logs/2025-11-17.log` returns file content.
9. CLI `--storage <direct-backend-name>` continues to work for every existing blob command without behavior change.
10. CLI `--storage <direct-backend-name>` works for the new `shares` / `files` / `file-view` / `file-upload` etc commands too (uses `DirectBackend.listShares()` via Azure Files SDK + the user's account-key / SAS).
11. Electron UI launches with `npm run ui` and shows the storage list with the new icon for api backends.
12. Electron "Add Storage" dialog has a third tab for api backends; clicking through registers the backend and (when auth-on) opens the system browser for PKCE login.
13. Electron tree shows a **Shares** sibling node alongside **Containers** for both backend kinds.
14. New unit tests pass; existing test suite (currently empty for `src/`) gains the listed test files; CI build remains clean.

## 14. Out-of-scope follow-ups

- Plan 008 — repo sync / link / diff over the api backend.
- Plan 009 — provider-agnostic OIDC support (other than NBG IdentityServer).
- Plan 010 — pre-signed-URL / SAS-redirect download path on the api backend (Plan 006 follow-up).
