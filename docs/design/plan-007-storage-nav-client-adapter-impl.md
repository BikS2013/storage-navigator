# Storage Navigator Client Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project rule:** Per `CLAUDE.md`, no git operation may be performed without explicit user approval. Each task ends with a "commit" step — Claude executing this plan must pause and ask the user before running it.

**Goal:** Build the third Storage Navigator client backend type (`api`) per `docs/design/plan-007-storage-nav-client-adapter.md`. Adds `kind:'direct'|'api'` discriminator, an `IStorageBackend` interface, `DirectBackend` (wraps existing `BlobClient` + a new `FileShareClient`), `ApiBackend` (HTTP client to the deployed API in Plan 006), an OIDC client (PKCE for Electron + device-code for CLI), token store (Electron `safeStorage` + CLI chmod-600), and the new CLI commands + Electron UI surface for file shares.

**Architecture:** All consumers (CLI commands, Electron `server.ts`) get an `IStorageBackend` instance from `factory.makeBackend(entry)`. `DirectBackend` keeps the existing direct-mode behavior unchanged. `ApiBackend` uses `fetch` to call the deployed API; when the API reports `authEnabled:true`, `ApiBackend` attaches a Bearer JWT obtained from the OIDC client.

**Tech Stack:** Node 22, TypeScript 5+ (existing repo settings), Express 5 (Electron embedded server), `@azure/storage-blob` (existing), `@azure/storage-file-share` (NEW client-side dep), `vitest` (NEW dev dep), `commander` (existing).

---

## File map

All paths under `/Users/thanos/Work/Repos/storage-navigator`.

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | MODIFY: add `kind` discriminator, `ApiBackendEntry`, `OidcConfig` |
| `src/core/credential-store.ts` | MODIFY: migrate StorageEntry without `kind`; persist nothing else (OIDC tokens go to a separate file) |
| `src/core/file-share-client.ts` | NEW: `FileShareClient` wrapper around `@azure/storage-file-share` |
| `src/core/backend/backend.ts` | NEW: `IStorageBackend` interface + Page/PageOpts/etc types |
| `src/core/backend/http-error.ts` | NEW: typed error classes for api backend |
| `src/core/backend/factory.ts` | NEW: `makeBackend(entry)` returns IStorageBackend |
| `src/core/backend/direct-backend.ts` | NEW: wraps `BlobClient` + `FileShareClient` |
| `src/core/backend/api-backend.ts` | NEW: HTTP client implementing IStorageBackend |
| `src/core/backend/auth/discovery.ts` | NEW: GET `/.well-known/storage-nav-config` + cache |
| `src/core/backend/auth/token-store.ts` | NEW: token persistence (Electron safeStorage / CLI fs) |
| `src/core/backend/auth/oidc-client.ts` | NEW: PKCE + device-code flows |
| `src/core/backend/auth/token-refresh.ts` | NEW: refresh dedup + persist |
| `src/cli/commands/shared.ts` | MODIFY: `resolveStorageBackend` returns `IStorageBackend` |
| `src/cli/commands/add-storage.ts` | MODIFY: write `kind:'direct'` |
| `src/cli/commands/list-storages.ts` | MODIFY: render `kind` column |
| `src/cli/commands/add-api.ts` | NEW: register an `api` backend; run OIDC login if needed |
| `src/cli/commands/auth-ops.ts` | NEW: `login` + `logout` for an existing api backend |
| `src/cli/commands/shares-ops.ts` | NEW: 9 file-share commands |
| `src/cli/commands/blob-ops.ts` | MODIFY: route through `IStorageBackend` (no behavior change) |
| `src/cli/commands/view.ts` | MODIFY: route through `IStorageBackend` (no behavior change) |
| `src/cli/index.ts` | MODIFY: register all new commands |
| `src/electron/server.ts` | MODIFY: routes go through `IStorageBackend`; add `/api/shares/*` + `/api/files/*` |
| `src/electron/oidc-loopback.ts` | NEW: tiny loopback http server for PKCE callback |
| `src/electron/main.ts` | MODIFY: wire up OIDC IPC channel + safeStorage handlers |
| `src/electron/public/index.html` | MODIFY: 3rd "Connect to Storage Navigator API" tab + Shares tree node |
| `src/electron/public/app.js` | MODIFY: backend-aware rendering, OIDC login button, Shares + file ops |
| `src/electron/public/styles.css` | MODIFY: icon for `api` kind |
| `tests/unit/credential-migration.test.ts` | NEW |
| `tests/unit/backend-factory.test.ts` | NEW |
| `tests/unit/direct-backend.test.ts` | NEW |
| `tests/unit/api-backend.test.ts` | NEW |
| `tests/unit/discovery.test.ts` | NEW |
| `tests/unit/token-store.test.ts` | NEW |
| `vitest.config.ts` | NEW (root) — picks up `tests/**/*.test.ts` |
| `package.json` (root) | MODIFY: add `vitest` + `@azure/storage-file-share` + test script |
| `CLAUDE.md` (root) | MODIFY: extend `<storage-nav>` with new commands |
| `docs/design/project-design.md` | MODIFY: add "Backend types" section |
| `docs/design/project-functions.md` | MODIFY: register new file-share + api features |

---

## Phase 0 — Foundation: deps + types + migration

### Task 1: Add deps + vitest config

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/.gitkeep` (so the empty dir is committed)

- [ ] **Step 1: Install deps**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npm install --save-dev vitest @types/supertest supertest
npm install @azure/storage-file-share@^12.30.0
```
Expected: lockfile updated; no errors.

- [ ] **Step 2: Add `test` + `test:unit` scripts to root `package.json`**

In `scripts`, add:
```json
"test": "vitest run",
"test:unit": "vitest run tests/unit",
"test:watch": "vitest"
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 4: Create empty test dir marker**

```bash
mkdir -p /Users/thanos/Work/Repos/storage-navigator/tests/unit
touch /Users/thanos/Work/Repos/storage-navigator/tests/.gitkeep
```

- [ ] **Step 5: Verify**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run
```
Expected: "No test files found" (zero failures).

- [ ] **Step 6: Pause for user approval, commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/.gitkeep
git commit -m "client: add vitest + @azure/storage-file-share deps, root vitest config"
```

---

### Task 2: types — add `kind` discriminator + ApiBackendEntry

**Files:**
- Modify: `src/core/types.ts`
- Create: `tests/unit/types-discriminator.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/types-discriminator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { StorageEntry, DirectStorageEntry, ApiBackendEntry } from '../../src/core/types.js';

describe('StorageEntry discriminator', () => {
  it('narrows to direct via kind', () => {
    const e: StorageEntry = {
      kind: 'direct',
      name: 'x',
      accountName: 'acct',
      accountKey: 'k',
      addedAt: new Date().toISOString(),
    };
    if (e.kind !== 'direct') throw new Error('discriminator');
    const d: DirectStorageEntry = e;
    expect(d.accountName).toBe('acct');
  });

  it('narrows to api via kind', () => {
    const e: StorageEntry = {
      kind: 'api',
      name: 'y',
      baseUrl: 'https://x.example.com',
      authEnabled: false,
      addedAt: new Date().toISOString(),
    };
    if (e.kind !== 'api') throw new Error('discriminator');
    const a: ApiBackendEntry = e;
    expect(a.baseUrl).toBe('https://x.example.com');
  });
});
```

- [ ] **Step 2: Run, expect fail (types don't exist yet)**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/types-discriminator.test.ts
```
Expected: TS error or runtime failure.

- [ ] **Step 3: Replace `StorageEntry` in `src/core/types.ts`**

Replace the existing `StorageEntry` interface with:
```ts
export type DirectStorageEntry = {
  kind: 'direct';
  name: string;
  accountName: string;
  sasToken?: string;       // SAS token (container or account level)
  accountKey?: string;     // Account key (full access)
  addedAt: string;
};

export type OidcConfig = {
  issuer: string;
  clientId: string;
  audience: string;
  scopes: string[];
};

export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: OidcConfig;
  addedAt: string;
};

export type StorageEntry = DirectStorageEntry | ApiBackendEntry;
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/types-discriminator.test.ts
```
Expected: 2 PASS.

- [ ] **Step 5: TS-check the rest of the codebase**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: many errors in places that read `entry.accountName`, `entry.sasToken`, `entry.accountKey` without narrowing first. **Do NOT fix yet — Task 16 introduces a new resolver that handles this. Verify the errors look like `Property 'accountName' does not exist on type 'ApiBackendEntry'`.** Capture the first 3 errors and include them in the commit message body.

- [ ] **Step 6: Pause, commit**

```bash
git add src/core/types.ts tests/unit/types-discriminator.test.ts
git commit -m "client: add StorageEntry discriminated union (direct | api)

TS errors expected in callers that read entry.accountName/sasToken/accountKey
without narrowing first. Resolved by Task 16 (shared.ts refactor)."
```

---

### Task 3: credential-store — auto-migrate kind-less entries to `direct`

**Files:**
- Modify: `src/core/credential-store.ts`
- Create: `tests/unit/credential-migration.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/credential-migration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../src/core/credential-store.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-cred-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});
afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe('CredentialStore migration', () => {
  it('marks pre-existing entries (no kind) as kind="direct"', () => {
    // Hand-craft an unencrypted plaintext credentials file in legacy shape
    // (the migration path runs after decryption — for this test we exercise
    // CredentialStore.migrate() directly with a JS object).
    const store = new CredentialStore();
    const legacy: any = {
      storages: [
        { name: 'a', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01' },
        { name: 'b', accountName: 'b', sasToken: 't', addedAt: '2025-01-02' },
      ],
      tokens: [],
    };
    const migrated = (store as any).migrate(legacy);
    expect(migrated.storages[0].kind).toBe('direct');
    expect(migrated.storages[1].kind).toBe('direct');
  });

  it('leaves entries that already have kind unchanged', () => {
    const store = new CredentialStore();
    const data: any = {
      storages: [
        { kind: 'api', name: 'x', baseUrl: 'https://x', authEnabled: false, addedAt: '2025-01-03' },
        { kind: 'direct', name: 'y', accountName: 'y', accountKey: 'k', addedAt: '2025-01-04' },
      ],
    };
    const migrated = (store as any).migrate(data);
    expect(migrated.storages[0].kind).toBe('api');
    expect(migrated.storages[1].kind).toBe('direct');
  });
});
```

- [ ] **Step 2: Run, expect fail (no migrate method yet)**

- [ ] **Step 3: Add `migrate()` to `CredentialStore`**

In `src/core/credential-store.ts`, add a private method:
```ts
  /**
   * Migrate legacy CredentialData (StorageEntry without `kind`) to the
   * tagged-union form by stamping `kind: 'direct'` on every entry that lacks
   * it. Idempotent. Called from load() after decryption.
   */
  private migrate(data: CredentialData): CredentialData {
    let changed = false;
    const storages = (data.storages ?? []).map((entry: any) => {
      if (entry.kind) return entry;
      changed = true;
      return { ...entry, kind: 'direct' };
    });
    if (!changed) return data;
    return { ...data, storages };
  }
```

And call it in `load()` immediately after decrypt:
```ts
  // existing load() — find the line that decrypts and parses JSON, e.g.:
  //   this.data = JSON.parse(plaintext) as CredentialData;
  // Replace with:
  //   this.data = this.migrate(JSON.parse(plaintext) as CredentialData);
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/credential-migration.test.ts
```
Expected: 2 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add src/core/credential-store.ts tests/unit/credential-migration.test.ts
git commit -m "client: migrate kind-less StorageEntry to kind:'direct' on load"
```

---

## Phase 1 — Backend interface + factory + errors

### Task 4: IStorageBackend interface + Page/PageOpts shapes

**Files:**
- Create: `src/core/backend/backend.ts`

- [ ] **Step 1: Write the interface (no test — type-only file)**

```ts
import type { BlobItem, ContainerInfo } from '../types.js';

export type PageOpts = { pageSize?: number; continuationToken?: string };
export type Page<T> = { items: T[]; continuationToken: string | null };

export type ListBlobOpts = PageOpts & { prefix?: string; delimiter?: string };

export type ShareInfo = { name: string; quotaGiB?: number };
export type FileItem = {
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
};

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

- [ ] **Step 2: TS-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit src/core/backend/backend.ts
```
Expected: clean.

- [ ] **Step 3: Pause, commit**

```bash
git add src/core/backend/backend.ts
git commit -m "client: add IStorageBackend interface + Page/PageOpts shapes"
```

---

### Task 5: http-error.ts — typed error classes for api backend

**Files:**
- Create: `src/core/backend/http-error.ts`
- Create: `tests/unit/http-error.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/http-error.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  HttpError,
  NeedsLoginError,
  AccessDeniedError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  UpstreamError,
  ApiInternalError,
  NetworkError,
  fromResponseBody,
} from '../../src/core/backend/http-error.js';

describe('http-error', () => {
  it('NeedsLoginError carries hint', () => {
    const e = new NeedsLoginError('nbg-dev');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).toMatch(/nbg-dev/);
    expect(e.status).toBe(401);
  });

  it('fromResponseBody dispatches by status + code', () => {
    expect(fromResponseBody(401, { error: { code: 'UNAUTHENTICATED', message: 'x', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(NeedsLoginError);
    expect(fromResponseBody(403, { error: { code: 'FORBIDDEN', message: 'x', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(AccessDeniedError);
    expect(fromResponseBody(404, { error: { code: 'NOT_FOUND', message: 'no', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(NotFoundError);
    expect(fromResponseBody(409, { error: { code: 'CONFLICT', message: 'c', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(ConflictError);
    expect(fromResponseBody(400, { error: { code: 'BAD_REQUEST', message: 'b', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(BadRequestError);
    expect(fromResponseBody(502, { error: { code: 'UPSTREAM_ERROR', message: 'u', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(UpstreamError);
    expect(fromResponseBody(500, { error: { code: 'INTERNAL', message: 'i', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(ApiInternalError);
  });
});
```

- [ ] **Step 2: Implement**

`src/core/backend/http-error.ts`:
```ts
export type ApiErrorBody = {
  error: { code: string; message: string; correlationId?: string; details?: unknown };
};

export class HttpError extends Error {
  readonly status: number;
  readonly correlationId?: string;
  constructor(status: number, message: string, correlationId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.correlationId = correlationId;
  }
}

export class NeedsLoginError extends HttpError {
  constructor(apiBackendName: string) {
    super(401, `OIDC login required. Run: storage-nav login --name ${apiBackendName}`);
  }
}

export class AccessDeniedError extends HttpError {
  constructor(message = 'Insufficient role', correlationId?: string) {
    super(403, message, correlationId);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(404, message, correlationId);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(409, message, correlationId);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(400, message, correlationId);
  }
}

export class UpstreamError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(502, message, correlationId);
  }
}

export class ApiInternalError extends HttpError {
  constructor(correlationId?: string) {
    super(500, `API internal error (correlationId=${correlationId ?? 'unknown'})`, correlationId);
  }
}

export class NetworkError extends HttpError {
  constructor(cause: Error) {
    super(0, `Network failure: ${cause.message}`);
  }
}

export function fromResponseBody(status: number, body: unknown, apiBackendName: string): HttpError {
  const err = (body as ApiErrorBody | undefined)?.error;
  const code = err?.code;
  const message = err?.message ?? `HTTP ${status}`;
  const cid = err?.correlationId;
  switch (status) {
    case 401: return new NeedsLoginError(apiBackendName);
    case 403: return new AccessDeniedError(message, cid);
    case 404: return new NotFoundError(message, cid);
    case 409: return new ConflictError(message, cid);
    case 400: return new BadRequestError(message, cid);
    case 502:
    case 503:
      return new UpstreamError(message, cid);
    case 500: return new ApiInternalError(cid);
    default:
      if (code === 'UPSTREAM_ERROR') return new UpstreamError(message, cid);
      return new HttpError(status, message, cid);
  }
}
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/http-error.test.ts
```
Expected: 2 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/http-error.ts tests/unit/http-error.test.ts
git commit -m "client: add typed http error classes + fromResponseBody mapper"
```

---

### Task 6: factory.ts — `makeBackend(entry) → IStorageBackend`

**Files:**
- Create: `src/core/backend/factory.ts`
- Create: `tests/unit/backend-factory.test.ts`

> Note: this task creates the factory shell with stub implementations (`makeBackend` throws "not implemented yet" for both kinds). T7 + T11 fill in the concrete backends. Tests in this task only verify the shape: factory dispatches by `kind` and rejects unknown kinds.

- [ ] **Step 1: Failing test**

`tests/unit/backend-factory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeBackend } from '../../src/core/backend/factory.js';
import type { StorageEntry } from '../../src/core/types.js';

describe('makeBackend', () => {
  it('throws helpful error for unknown kind', () => {
    expect(() => makeBackend({ kind: 'wat' } as never as StorageEntry))
      .toThrow(/Unknown StorageEntry kind/);
  });

  it('returns an object exposing IStorageBackend method names for direct kind', () => {
    const b = makeBackend({
      kind: 'direct', name: 'd', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01',
    });
    expect(typeof b.listContainers).toBe('function');
    expect(typeof b.listShares).toBe('function');
  });

  it('returns an object exposing IStorageBackend method names for api kind', () => {
    const b = makeBackend({
      kind: 'api', name: 'x', baseUrl: 'https://x.example.com', authEnabled: false, addedAt: '2025-01-01',
    });
    expect(typeof b.listContainers).toBe('function');
    expect(typeof b.listShares).toBe('function');
  });
});
```

- [ ] **Step 2: Implement factory + stubs**

`src/core/backend/factory.ts`:
```ts
import type { StorageEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';
import { DirectBackend } from './direct-backend.js';
import { ApiBackend } from './api-backend.js';

export function makeBackend(entry: StorageEntry): IStorageBackend {
  if (entry.kind === 'direct') return new DirectBackend(entry);
  if (entry.kind === 'api') return new ApiBackend(entry);
  throw new Error(`Unknown StorageEntry kind: ${(entry as { kind?: string }).kind ?? 'undefined'}`);
}
```

`src/core/backend/direct-backend.ts` (stub, fills in T7):
```ts
import type { DirectStorageEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';

export class DirectBackend implements IStorageBackend {
  constructor(_entry: DirectStorageEntry) {}
  // All 18 methods: minimal stubs that throw — T7 replaces.
  async listContainers() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async createContainer() { throw new Error('NotImplemented: T7'); }
  async deleteContainer() { throw new Error('NotImplemented: T7'); }
  async listBlobs() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async readBlob() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async headBlob() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async uploadBlob() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async deleteBlob() { throw new Error('NotImplemented: T7'); }
  async renameBlob() { throw new Error('NotImplemented: T7'); }
  async deleteFolder() { throw new Error('NotImplemented: T7'); return 0; }
  async listShares() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async createShare() { throw new Error('NotImplemented: T7'); }
  async deleteShare() { throw new Error('NotImplemented: T7'); }
  async listDir() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async readFile() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async headFile() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async uploadFile() { throw new Error('NotImplemented: T7'); return undefined as never; }
  async deleteFile() { throw new Error('NotImplemented: T7'); }
  async renameFile() { throw new Error('NotImplemented: T7'); }
  async deleteFileFolder() { throw new Error('NotImplemented: T7'); return 0; }
}
```

`src/core/backend/api-backend.ts` (stub, fills in T11):
```ts
import type { ApiBackendEntry } from '../types.js';
import type { IStorageBackend } from './backend.js';

export class ApiBackend implements IStorageBackend {
  constructor(_entry: ApiBackendEntry) {}
  async listContainers() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async createContainer() { throw new Error('NotImplemented: T11'); }
  async deleteContainer() { throw new Error('NotImplemented: T11'); }
  async listBlobs() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async readBlob() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async headBlob() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async uploadBlob() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async deleteBlob() { throw new Error('NotImplemented: T11'); }
  async renameBlob() { throw new Error('NotImplemented: T11'); }
  async deleteFolder() { throw new Error('NotImplemented: T11'); return 0; }
  async listShares() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async createShare() { throw new Error('NotImplemented: T11'); }
  async deleteShare() { throw new Error('NotImplemented: T11'); }
  async listDir() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async readFile() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async headFile() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async uploadFile() { throw new Error('NotImplemented: T11'); return undefined as never; }
  async deleteFile() { throw new Error('NotImplemented: T11'); }
  async renameFile() { throw new Error('NotImplemented: T11'); }
  async deleteFileFolder() { throw new Error('NotImplemented: T11'); return 0; }
}
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/backend-factory.test.ts
```
Expected: 3 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/factory.ts src/core/backend/direct-backend.ts src/core/backend/api-backend.ts tests/unit/backend-factory.test.ts
git commit -m "client: add backend factory + stub DirectBackend/ApiBackend (T7+T11 fill in)"
```

---

## Phase 2 — DirectBackend

### Task 7: file-share-client.ts — Azure Files SDK wrapper (parallel to blob-client.ts)

**Files:**
- Create: `src/core/file-share-client.ts`

> Read `src/core/blob-client.ts` first to mirror its style (constructor takes a `DirectStorageEntry`, exposes minimal-surface methods). The new `FileShareClient` uses `@azure/storage-file-share`. Auth via account-key or SAS — same pattern as BlobClient. No new client-side OAuth code needed.

- [ ] **Step 1: Write the wrapper**

```ts
import {
  ShareServiceClient,
  StorageSharedKeyCredential,
} from '@azure/storage-file-share';
import { Readable } from 'node:stream';
import type { DirectStorageEntry } from './types.js';
import type { Page, PageOpts, ShareInfo, FileItem, BlobReadHandle } from './backend/backend.js';

/**
 * Azure Files (SMB / REST) client used by DirectBackend. Mirrors BlobClient's
 * shape: constructor takes a DirectStorageEntry; auth is account-key or SAS.
 * Production deployments that want OAuth-on-Files-REST should use the api
 * backend instead — that path is already covered by Plan 006.
 */
export class FileShareClient {
  private readonly serviceClient: ShareServiceClient;

  constructor(entry: DirectStorageEntry) {
    if (entry.accountKey) {
      const cred = new StorageSharedKeyCredential(entry.accountName, entry.accountKey);
      this.serviceClient = new ShareServiceClient(
        `https://${entry.accountName}.file.core.windows.net`,
        cred,
      );
    } else if (entry.sasToken) {
      const url = `https://${entry.accountName}.file.core.windows.net?${entry.sasToken}`;
      this.serviceClient = new ShareServiceClient(url);
    } else {
      throw new Error(`Storage '${entry.name}' has no accountKey or sasToken configured.`);
    }
  }

  async listShares(opts: PageOpts = {}): Promise<Page<ShareInfo>> {
    const iter = this.serviceClient.listShares().byPage({
      maxPageSize: opts.pageSize,
      continuationToken: opts.continuationToken,
    });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    return {
      items: (r.value.shareItems ?? []).map((s) => ({ name: s.name, quotaGiB: s.properties?.quota })),
      continuationToken: r.value.continuationToken ?? null,
    };
  }

  async createShare(name: string, quotaGiB?: number): Promise<void> {
    await this.serviceClient.getShareClient(name).createIfNotExists({ quota: quotaGiB });
  }

  async deleteShare(name: string): Promise<void> {
    await this.serviceClient.getShareClient(name).deleteIfExists();
  }

  async listDir(share: string, path: string, opts: PageOpts = {}): Promise<Page<FileItem>> {
    const dir = this.serviceClient.getShareClient(share).getDirectoryClient(path);
    const iter = dir.listFilesAndDirectories().byPage({
      maxPageSize: opts.pageSize,
      continuationToken: opts.continuationToken,
    });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    const items: FileItem[] = [];
    for (const f of r.value.segment.fileItems ?? []) {
      items.push({ name: f.name, isDirectory: false, size: f.properties.contentLength });
    }
    for (const d of r.value.segment.directoryItems ?? []) {
      items.push({ name: d.name, isDirectory: true });
    }
    return { items, continuationToken: r.value.continuationToken ?? null };
  }

  async readFile(share: string, filePath: string): Promise<BlobReadHandle> {
    const { dir, file } = splitPath(filePath);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    const dl = await f.download(0);
    return {
      stream: dl.readableStreamBody as NodeJS.ReadableStream,
      contentType: dl.contentType ?? undefined,
      contentLength: dl.contentLength ?? undefined,
      etag: dl.etag ?? undefined,
      lastModified: dl.lastModified?.toISOString(),
    };
  }

  async headFile(share: string, filePath: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const { dir, file } = splitPath(filePath);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    const p = await f.getProperties();
    return {
      contentType: p.contentType ?? undefined,
      contentLength: p.contentLength ?? undefined,
      etag: p.etag ?? undefined,
      lastModified: p.lastModified?.toISOString(),
    };
  }

  async uploadFile(share: string, filePath: string, body: Readable | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    const { dir, file } = splitPath(filePath);
    await this.ensureDirChain(share, dir);
    const f = this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file);
    await f.create(sizeBytes);
    const stream = body instanceof Buffer ? Readable.from(body) : body;
    await f.uploadStream(stream, sizeBytes, 4 * 1024 * 1024, 4, {
      fileHttpHeaders: contentType ? { fileContentType: contentType } : undefined,
    });
    const p = await f.getProperties();
    return { etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
  }

  async deleteFile(share: string, filePath: string): Promise<void> {
    const { dir, file } = splitPath(filePath);
    await this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file).deleteIfExists();
  }

  async renameFile(share: string, fromPath: string, toPath: string): Promise<void> {
    const { dir, file } = splitPath(fromPath);
    await this.serviceClient.getShareClient(share).getDirectoryClient(dir).getFileClient(file).rename(toPath);
  }

  async deleteFileFolder(share: string, path: string): Promise<number> {
    if (!path || path === '/') throw new Error('path must be non-empty and not "/"');
    let count = 0;
    const walk = async (dirPath: string): Promise<void> => {
      const dir = this.serviceClient.getShareClient(share).getDirectoryClient(dirPath);
      for await (const item of dir.listFilesAndDirectories()) {
        const child = `${dirPath}/${item.name}`;
        if (item.kind === 'directory') {
          await walk(child);
          await this.serviceClient.getShareClient(share).getDirectoryClient(child).delete();
        } else {
          const r = await dir.getFileClient(item.name).deleteIfExists();
          if (r.succeeded) count++;
        }
      }
    };
    await walk(path);
    await this.serviceClient.getShareClient(share).getDirectoryClient(path).deleteIfExists();
    return count;
  }

  private async ensureDirChain(share: string, dir: string): Promise<void> {
    if (!dir) return;
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      await this.serviceClient.getShareClient(share).getDirectoryClient(cur).createIfNotExists();
    }
  }
}

function splitPath(p: string): { dir: string; file: string } {
  const i = p.lastIndexOf('/');
  if (i === -1) return { dir: '', file: p };
  return { dir: p.slice(0, i), file: p.slice(i + 1) };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: errors ONLY in places already broken since Task 2 (StorageEntry narrowing). The new file should compile cleanly.

- [ ] **Step 3: Pause, commit**

```bash
git add src/core/file-share-client.ts
git commit -m "client: add FileShareClient (parallel to BlobClient, account-key / SAS)"
```

---

### Task 8: DirectBackend — wire BlobClient + FileShareClient

**Files:**
- Modify: `src/core/backend/direct-backend.ts`
- Create: `tests/unit/direct-backend.test.ts`

- [ ] **Step 1: Failing test (mocked)**

`tests/unit/direct-backend.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BOTH client modules before importing DirectBackend.
vi.mock('../../src/core/blob-client.js', () => ({
  BlobClient: vi.fn().mockImplementation(() => ({
    listContainers: vi.fn().mockResolvedValue([{ name: 'c1' }, { name: 'c2' }]),
    listBlobs: vi.fn().mockResolvedValue([{ name: 'b1', isPrefix: false, size: 10 }]),
    viewBlob: vi.fn(),
    createContainer: vi.fn(),
  })),
}));

vi.mock('../../src/core/file-share-client.js', () => ({
  FileShareClient: vi.fn().mockImplementation(() => ({
    listShares: vi.fn().mockResolvedValue({ items: [{ name: 's1' }], continuationToken: null }),
    listDir: vi.fn().mockResolvedValue({ items: [{ name: 'a.txt', isDirectory: false, size: 5 }], continuationToken: null }),
  })),
}));

import { DirectBackend } from '../../src/core/backend/direct-backend.js';
import type { DirectStorageEntry } from '../../src/core/types.js';

const entry: DirectStorageEntry = {
  kind: 'direct', name: 'd', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01',
};

describe('DirectBackend', () => {
  it('listContainers proxies to BlobClient and returns Page shape', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listContainers();
    expect(r.items.map((c) => c.name)).toEqual(['c1', 'c2']);
    expect(r.continuationToken).toBeNull();
  });

  it('listShares proxies to FileShareClient', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listShares();
    expect(r.items.map((s) => s.name)).toEqual(['s1']);
  });

  it('listDir proxies to FileShareClient with share + path', async () => {
    const b = new DirectBackend(entry);
    const r = await b.listDir('s1', 'sub');
    expect(r.items[0].name).toBe('a.txt');
  });
});
```

- [ ] **Step 2: Replace stub `direct-backend.ts` with real impl**

```ts
import { Readable } from 'node:stream';
import type { DirectStorageEntry, BlobItem, ContainerInfo } from '../types.js';
import type {
  IStorageBackend,
  Page,
  PageOpts,
  ListBlobOpts,
  ShareInfo,
  FileItem,
  BlobReadHandle,
} from './backend.js';
import { BlobClient } from '../blob-client.js';
import { FileShareClient } from '../file-share-client.js';

export class DirectBackend implements IStorageBackend {
  private readonly blob: BlobClient;
  private readonly file: FileShareClient;

  constructor(entry: DirectStorageEntry) {
    this.blob = new BlobClient(entry);
    this.file = new FileShareClient(entry);
  }

  // Containers ---------------------------------------------------------
  async listContainers(_opts: PageOpts = {}): Promise<Page<ContainerInfo>> {
    const items = await this.blob.listContainers();
    return { items, continuationToken: null };
  }
  async createContainer(name: string): Promise<void> {
    await this.blob.createContainer(name);
  }
  async deleteContainer(name: string): Promise<void> {
    // Add this method to BlobClient if missing — see existing blob-ops.ts
    await this.blob.deleteContainer(name);
  }

  // Blobs --------------------------------------------------------------
  async listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>> {
    const items = await this.blob.listBlobs(container, opts.prefix);
    return { items, continuationToken: null };
  }
  async readBlob(container: string, path: string): Promise<BlobReadHandle> {
    const r = await this.blob.viewBlob(container, path);
    return {
      stream: Readable.from(r.content as Buffer),
      contentType: r.contentType,
      contentLength: r.size,
    };
  }
  async headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const r = await this.blob.viewBlob(container, path);
    return { contentType: r.contentType, contentLength: r.size };
  }
  async uploadBlob(container: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    const buf = body instanceof Buffer ? body : await readStreamToBuffer(body, sizeBytes);
    await this.blob.uploadBlob(container, path, buf, contentType);
    return {};
  }
  async deleteBlob(container: string, path: string): Promise<void> {
    await this.blob.deleteBlob(container, path);
  }
  async renameBlob(container: string, fromPath: string, toPath: string): Promise<void> {
    await this.blob.renameBlob(container, fromPath, toPath);
  }
  async deleteFolder(container: string, prefix: string): Promise<number> {
    const n = await this.blob.deleteFolder(container, prefix);
    return n;
  }

  // Shares -------------------------------------------------------------
  async listShares(opts: PageOpts = {}) { return this.file.listShares(opts); }
  async createShare(name: string, quotaGiB?: number) { await this.file.createShare(name, quotaGiB); }
  async deleteShare(name: string) { await this.file.deleteShare(name); }
  async listDir(share: string, path: string, opts: PageOpts = {}) { return this.file.listDir(share, path, opts); }
  async readFile(share: string, path: string) { return this.file.readFile(share, path); }
  async headFile(share: string, path: string) { return this.file.headFile(share, path); }
  async uploadFile(share: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string) { return this.file.uploadFile(share, path, body as Buffer | Readable, sizeBytes, contentType); }
  async deleteFile(share: string, path: string) { await this.file.deleteFile(share, path); }
  async renameFile(share: string, fromPath: string, toPath: string) { await this.file.renameFile(share, fromPath, toPath); }
  async deleteFileFolder(share: string, path: string) { return this.file.deleteFileFolder(share, path); }
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream, _hintSize: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
```

> **Note:** if `blob-client.ts` is missing `deleteContainer`, add it now (existing blob-ops.ts already calls some destructive container ops via direct SDK — search for `containerClient.deleteIfExists` to find the existing helper, or add a thin wrapper).

- [ ] **Step 3: Run direct-backend test**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/direct-backend.test.ts
```
Expected: 3 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/direct-backend.ts src/core/blob-client.ts tests/unit/direct-backend.test.ts
git commit -m "client: implement DirectBackend wrapping BlobClient + FileShareClient"
```

---

## Phase 3 — OIDC stack

### Task 9: discovery.ts — `/.well-known/storage-nav-config` fetch + cache

**Files:**
- Create: `src/core/backend/auth/discovery.ts`
- Create: `tests/unit/discovery.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/discovery.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDiscovery } from '../../src/core/backend/auth/discovery.js';

const ok = (body: object) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeEach(() => { vi.restoreAllMocks(); });

describe('fetchDiscovery', () => {
  it('returns enabled config when the API reports auth on', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({
      authEnabled: true,
      issuer: 'https://my.nbg.gr/identity',
      clientId: 'cid',
      audience: 'aud',
      scopes: ['openid','role'],
    })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.authEnabled).toBe(true);
    if (!d.authEnabled) throw new Error('discriminator');
    expect(d.issuer).toBe('https://my.nbg.gr/identity');
    expect(d.scopes).toEqual(['openid','role']);
  });

  it('returns disabled config', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ authEnabled: false })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.authEnabled).toBe(false);
  });

  it('throws on missing required fields when authEnabled', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ authEnabled: true })));
    await expect(fetchDiscovery('https://x.example.com')).rejects.toThrow(/missing/);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))));
    await expect(fetchDiscovery('https://x.example.com')).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core/backend/auth/discovery.ts
export type DiscoveryResult =
  | { authEnabled: false }
  | { authEnabled: true; issuer: string; clientId: string; audience: string; scopes: string[] };

export async function fetchDiscovery(baseUrl: string): Promise<DiscoveryResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/.well-known/storage-nav-config`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Discovery network error for ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Discovery HTTP ${res.status} for ${url}`);
  const body = await res.json() as Record<string, unknown>;
  if (body.authEnabled === false) return { authEnabled: false };
  if (body.authEnabled === true) {
    const required = ['issuer', 'clientId', 'audience', 'scopes'];
    const missing = required.filter((k) => body[k] === undefined);
    if (missing.length) throw new Error(`Discovery missing required fields when authEnabled=true: ${missing.join(', ')}`);
    return {
      authEnabled: true,
      issuer: String(body.issuer),
      clientId: String(body.clientId),
      audience: String(body.audience),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
    };
  }
  throw new Error(`Discovery response missing authEnabled flag at ${url}`);
}
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/discovery.test.ts
```
Expected: 4 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/auth/discovery.ts tests/unit/discovery.test.ts
git commit -m "client: add discovery client for /.well-known/storage-nav-config"
```

---

### Task 10: token-store.ts — fs-backed token persistence (CLI mode)

**Files:**
- Create: `src/core/backend/auth/token-store.ts`
- Create: `tests/unit/token-store.test.ts`

> **Scope of this task:** the CLI / fs path only. Electron `safeStorage` integration is wired in Task 19. The store API is the same in both modes; the fs implementation is the default and what tests cover.

- [ ] **Step 1: Failing test**

`tests/unit/token-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { TokenStore, type TokenSet } from '../../src/core/backend/auth/token-store.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-tok-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});
afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

const sample: TokenSet = {
  accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000, scope: 'openid',
};

describe('TokenStore (fs)', () => {
  it('save then load round-trips', async () => {
    const s = new TokenStore();
    await s.save('nbg-dev', sample);
    const loaded = await s.load('nbg-dev');
    expect(loaded?.accessToken).toBe('a');
  });

  it('keys multiple backends independently', async () => {
    const s = new TokenStore();
    await s.save('nbg-dev', sample);
    await s.save('nbg-prod', { ...sample, accessToken: 'b' });
    expect((await s.load('nbg-dev'))?.accessToken).toBe('a');
    expect((await s.load('nbg-prod'))?.accessToken).toBe('b');
  });

  it('delete removes only one entry', async () => {
    const s = new TokenStore();
    await s.save('a', sample);
    await s.save('b', sample);
    await s.delete('a');
    expect(await s.load('a')).toBeNull();
    expect(await s.load('b')).not.toBeNull();
  });

  it('returns null for missing entry', async () => {
    const s = new TokenStore();
    expect(await s.load('ghost')).toBeNull();
  });

  it('chmods the file 0600 on POSIX', async () => {
    if (platform() === 'win32') return;
    const s = new TokenStore();
    await s.save('x', sample);
    const file = join(tmp, 'oidc-tokens.json');
    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core/backend/auth/token-store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;          // epoch ms
  scope?: string;
  idToken?: string;
};

type StoreFile = Record<string, TokenSet>;

export class TokenStore {
  private readonly file: string;

  constructor() {
    const dir = process.env.STORAGE_NAVIGATOR_DIR ?? join(homedir(), '.storage-navigator');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, 'oidc-tokens.json');
  }

  private read(): StoreFile {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
  }

  private write(data: StoreFile): void {
    if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(this.file, 0o600);
  }

  async save(name: string, tokens: TokenSet): Promise<void> {
    const data = this.read();
    data[name] = tokens;
    this.write(data);
  }

  async load(name: string): Promise<TokenSet | null> {
    const data = this.read();
    return data[name] ?? null;
  }

  async delete(name: string): Promise<void> {
    const data = this.read();
    delete data[name];
    this.write(data);
  }
}
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/token-store.test.ts
```
Expected: 5 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/auth/token-store.ts tests/unit/token-store.test.ts
git commit -m "client: add fs-backed TokenStore (chmod 600, multi-backend keying)"
```

---

### Task 11: oidc-client.ts — device-code flow (CLI) + PKCE primitives

**Files:**
- Create: `src/core/backend/auth/oidc-client.ts`
- Create: `tests/unit/oidc-client.test.ts`

> **Scope:** device-code is fully implemented (used by CLI `add-api`). PKCE primitives (`generatePkce`, `buildAuthorizeUrl`, `exchangeCode`) are exported but the loopback callback flow is wired in Task 19 (Electron). Tests here cover device-code + the PKCE primitives.

- [ ] **Step 1: Failing test**

`tests/unit/oidc-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePkce, buildAuthorizeUrl, deviceCodeFlow, exchangeCode } from '../../src/core/backend/auth/oidc-client.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('oidc-client primitives', () => {
  it('generatePkce produces base64url verifier + S256 challenge', () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePkce();
    expect(codeChallengeMethod).toBe('S256');
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('buildAuthorizeUrl includes all required params', () => {
    const u = buildAuthorizeUrl({
      issuer: 'https://idp.example.com',
      clientId: 'cid',
      scopes: ['openid','role'],
      audience: 'aud',
      redirectUri: 'http://127.0.0.1:1234/cb',
      codeChallenge: 'cc',
      state: 'st',
    });
    expect(u.toString()).toContain('https://idp.example.com/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234/cb');
    expect(u.searchParams.get('code_challenge')).toBe('cc');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid role');
    expect(u.searchParams.get('audience')).toBe('aud');
  });
});

describe('deviceCodeFlow', () => {
  it('happy path: device_code → poll → token', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/connect/deviceauthorization')) {
        return new Response(JSON.stringify({
          device_code: 'dc', user_code: 'UC', verification_uri: 'https://idp.example/device', interval: 0, expires_in: 300,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/connect/token')) {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const tokens = await deviceCodeFlow({
      issuer: 'https://idp.example.com', clientId: 'cid', scopes: ['openid','role'], audience: 'aud',
      onUserCode: () => undefined,  // suppress stdout for tests
    });
    expect(tokens.accessToken).toBe('a');
    expect(tokens.refreshToken).toBe('r');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core/backend/auth/oidc-client.ts
import { createHash, randomBytes } from 'node:crypto';
import type { TokenSet } from './token-store.js';

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export type PkcePair = { codeVerifier: string; codeChallenge: string; codeChallengeMethod: 'S256' };

export function generatePkce(): PkcePair {
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function buildAuthorizeUrl(opts: {
  issuer: string; clientId: string; scopes: string[]; audience: string;
  redirectUri: string; codeChallenge: string; state: string;
}): URL {
  const u = new URL(`${opts.issuer.replace(/\/$/, '')}/connect/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('scope', opts.scopes.join(' '));
  u.searchParams.set('audience', opts.audience);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', opts.state);
  return u;
}

export async function exchangeCode(opts: {
  issuer: string; clientId: string;
  code: string; redirectUri: string; codeVerifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(`${opts.issuer.replace(/\/$/, '')}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope,
    idToken: tok.id_token,
  };
}

export async function deviceCodeFlow(opts: {
  issuer: string; clientId: string; scopes: string[]; audience: string;
  onUserCode?: (info: { userCode: string; verificationUri: string }) => void;
}): Promise<TokenSet> {
  const issuer = opts.issuer.replace(/\/$/, '');
  // 1. Request device code
  const dcRes = await fetch(`${issuer}/connect/deviceauthorization`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId, scope: opts.scopes.join(' '), audience: opts.audience,
    }),
  });
  if (!dcRes.ok) throw new Error(`Device authorization failed ${dcRes.status}: ${await dcRes.text()}`);
  const dc = await dcRes.json() as { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
  (opts.onUserCode ?? defaultUserCodeReporter)({ userCode: dc.user_code, verificationUri: dc.verification_uri });

  // 2. Poll
  const intervalMs = Math.max(dc.interval, 0) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (Date.now() < deadline) {
    if (intervalMs > 0) await sleep(intervalMs);
    const res = await fetch(`${issuer}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dc.device_code,
        client_id: opts.clientId,
      }),
    });
    if (res.ok) {
      const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
      return {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
        scope: tok.scope,
        idToken: tok.id_token,
      };
    }
    const err = await res.json().catch(() => ({})) as { error?: string };
    if (err.error === 'authorization_pending' || err.error === 'slow_down') continue;
    throw new Error(`Device code polling failed: ${err.error ?? `HTTP ${res.status}`}`);
  }
  throw new Error('Device code authorization timed out.');
}

function defaultUserCodeReporter(info: { userCode: string; verificationUri: string }): void {
  // eslint-disable-next-line no-console
  console.log(`\nVisit ${info.verificationUri} and enter code: ${info.userCode}\n`);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/oidc-client.test.ts
```
Expected: 3 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/auth/oidc-client.ts tests/unit/oidc-client.test.ts
git commit -m "client: add OIDC primitives (PKCE) + device-code flow"
```

---

### Task 12: token-refresh.ts — dedup + persist on refresh

**Files:**
- Create: `src/core/backend/auth/token-refresh.ts`
- Create: `tests/unit/token-refresh.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/token-refresh.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshTokens, _resetInflight } from '../../src/core/backend/auth/token-refresh.js';
import type { TokenSet } from '../../src/core/backend/auth/token-store.js';

beforeEach(() => { vi.restoreAllMocks(); _resetInflight(); });

describe('refreshTokens', () => {
  it('exchanges refresh_token for new access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: 'openid',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const old: TokenSet = { accessToken: 'a1', refreshToken: 'r1', expiresAt: 0 };
    const fresh = await refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old);
    expect(fresh.accessToken).toBe('a2');
    expect(fresh.refreshToken).toBe('r2');
  });

  it('dedups concurrent refreshes', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'a', refresh_token: 'r', expires_in: 60,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const old: TokenSet = { accessToken: 'a1', refreshToken: 'r1', expiresAt: 0 };
    const [r1, r2] = await Promise.all([
      refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old),
      refreshTokens('nbg', { issuer: 'https://idp.example.com', clientId: 'cid' }, old),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core/backend/auth/token-refresh.ts
import type { TokenSet } from './token-store.js';
import { TokenStore } from './token-store.js';

const inflight = new Map<string, Promise<TokenSet>>();

export function _resetInflight(): void { inflight.clear(); }

export async function refreshTokens(
  apiName: string,
  oidc: { issuer: string; clientId: string },
  old: TokenSet,
): Promise<TokenSet> {
  const existing = inflight.get(apiName);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`${oidc.issuer.replace(/\/$/, '')}/connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: old.refreshToken,
          client_id: oidc.clientId,
        }),
      });
      if (!res.ok) throw new Error(`Refresh failed ${res.status}: ${await res.text()}`);
      const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string; id_token?: string };
      const fresh: TokenSet = {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? old.refreshToken,
        expiresAt: Date.now() + tok.expires_in * 1000,
        scope: tok.scope ?? old.scope,
        idToken: tok.id_token ?? old.idToken,
      };
      await new TokenStore().save(apiName, fresh);
      return fresh;
    } finally {
      inflight.delete(apiName);
    }
  })();

  inflight.set(apiName, promise);
  return promise;
}
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/token-refresh.test.ts
```
Expected: 2 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/auth/token-refresh.ts tests/unit/token-refresh.test.ts
git commit -m "client: add OIDC token refresh with concurrent-call dedup"
```

---

## Phase 4 — ApiBackend

### Task 13: api-backend.ts — containers + blobs (with mocked fetch tests)

**Files:**
- Modify: `src/core/backend/api-backend.ts` (replace stub)
- Create: `tests/unit/api-backend-blobs.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/api-backend-blobs.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiBackend } from '../../src/core/backend/api-backend.js';
import type { ApiBackendEntry } from '../../src/core/types.js';
import { Readable } from 'node:stream';

const entry: ApiBackendEntry = {
  kind: 'api', name: 'nbg', baseUrl: 'https://api.example.com',
  authEnabled: false, addedAt: '2025-01-01',
};
// Account name in URLs comes from a callback or constructor param. The
// ApiBackend constructor takes (entry, accountName) — we pass the name
// the test uses.
const acct = 'sadirectusersgeneric';

beforeEach(() => { vi.restoreAllMocks(); });

describe('ApiBackend (blobs)', () => {
  it('listContainers calls /storages/{a}/containers and returns Page shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 'c1' }, { name: 'c2' }], continuationToken: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listContainers({ pageSize: 10 });
    expect(r.items.map((c) => c.name)).toEqual(['c1', 'c2']);
    expect(r.continuationToken).toBeNull();
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('/storages/sadirectusersgeneric/containers');
    expect(url).toContain('pageSize=10');
  });

  it('readBlob streams the response body', async () => {
    const body = Readable.from(Buffer.from('hello world'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body as unknown as ReadableStream, {
      status: 200,
      headers: { 'content-type': 'text/plain', 'content-length': '11', 'etag': 'e1', 'last-modified': '2026-04-23' },
    })));
    const b = new ApiBackend(entry, acct);
    const r = await b.readBlob('c1', 'docs/x.txt');
    expect(r.contentType).toBe('text/plain');
    expect(r.contentLength).toBe(11);
    expect(r.etag).toBe('e1');
    let data = '';
    for await (const chunk of r.stream) data += chunk.toString();
    expect(data).toBe('hello world');
  });

  it('uploadBlob PUTs body with Content-Type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ etag: 'e2' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    })));
    const b = new ApiBackend(entry, acct);
    const r = await b.uploadBlob('c1', 'x.json', Buffer.from('{}'), 2, 'application/json');
    expect(r.etag).toBe('e2');
    const init = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deleteBlob throws NotFoundError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'NOT_FOUND', message: "no", correlationId: 'cid' },
    }), { status: 404, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    await expect(b.deleteBlob('c1', 'gone.txt')).rejects.toMatchObject({ status: 404 });
  });

  it('throws NeedsLoginError on 401 when authEnabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'no', correlationId: 'cid' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const authEntry: ApiBackendEntry = {
      ...entry, authEnabled: true,
      oidc: { issuer: 'https://idp', clientId: 'cid', audience: 'a', scopes: ['openid'] },
    };
    const b = new ApiBackend(authEntry, acct);
    await expect(b.listContainers()).rejects.toThrow(/login required/);
  });
});
```

- [ ] **Step 2: Implement (replace api-backend.ts stub)**

```ts
// src/core/backend/api-backend.ts
import { Readable } from 'node:stream';
import type { ApiBackendEntry, BlobItem, ContainerInfo } from '../types.js';
import type {
  IStorageBackend,
  Page,
  PageOpts,
  ListBlobOpts,
  ShareInfo,
  FileItem,
  BlobReadHandle,
} from './backend.js';
import { TokenStore, type TokenSet } from './auth/token-store.js';
import { refreshTokens } from './auth/token-refresh.js';
import { fromResponseBody, NeedsLoginError, NetworkError } from './http-error.js';

export class ApiBackend implements IStorageBackend {
  private readonly entry: ApiBackendEntry;
  private readonly account: string;
  private readonly tokens = new TokenStore();

  constructor(entry: ApiBackendEntry, accountName: string) {
    this.entry = entry;
    this.account = accountName;
  }

  // ---- internals ----
  private base(): string { return this.entry.baseUrl.replace(/\/$/, ''); }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.entry.authEnabled) return {};
    if (!this.entry.oidc) throw new NeedsLoginError(this.entry.name);
    let t = await this.tokens.load(this.entry.name);
    if (!t) throw new NeedsLoginError(this.entry.name);
    if (t.expiresAt < Date.now() + 60_000) {
      t = await refreshTokens(this.entry.name, this.entry.oidc, t);
    }
    return { Authorization: `Bearer ${t.accessToken}` };
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { ...(init.headers as Record<string, string> | undefined ?? {}), ...(await this.authHeaders()) };
    let res: Response;
    try { res = await fetch(`${this.base()}${path}`, { ...init, headers }); }
    catch (err) { throw new NetworkError(err as Error); }
    if (res.status === 204) return undefined as never;
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('application/json') ? await res.json() : undefined;
    if (!res.ok) throw fromResponseBody(res.status, body, this.entry.name);
    return body as T;
  }

  private encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  // ---- containers ----
  async listContainers(opts: PageOpts = {}): Promise<Page<ContainerInfo>> {
    const params = new URLSearchParams();
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.json(`/storages/${this.account}/containers${qs}`);
  }
  async createContainer(name: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }
  async deleteContainer(name: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- blobs ----
  async listBlobs(container: string, opts: ListBlobOpts): Promise<Page<BlobItem>> {
    const params = new URLSearchParams();
    if (opts.prefix) params.set('prefix', opts.prefix);
    if (opts.delimiter) params.set('delimiter', opts.delimiter);
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const r = await this.json<{ items: Array<{ name: string; size?: number; contentType?: string; etag?: string; lastModified?: string; isPrefix?: boolean }>; continuationToken: string | null }>(
      `/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs${qs}`,
    );
    return {
      items: r.items.map((i) => ({
        name: i.name,
        isPrefix: i.isPrefix ?? false,
        size: i.size,
        contentType: i.contentType,
        lastModified: i.lastModified,
      })),
      continuationToken: r.continuationToken,
    };
  }

  async readBlob(container: string, path: string, range?: { offset: number; count?: number }): Promise<BlobReadHandle> {
    const headers: Record<string, string> = { ...(await this.authHeaders()) };
    if (range) {
      const end = range.count !== undefined ? range.offset + range.count - 1 : '';
      headers.Range = `bytes=${range.offset}-${end}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, { headers });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      const body = ct.includes('application/json') ? await res.json().catch(() => undefined) : undefined;
      throw fromResponseBody(res.status, body, this.entry.name);
    }
    return {
      stream: Readable.fromWeb(res.body as never) as NodeJS.ReadableStream,
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async headBlob(container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, {
        method: 'HEAD', headers: await this.authHeaders(),
      });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) throw fromResponseBody(res.status, undefined, this.entry.name);
    return {
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async uploadBlob(container: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    return this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(sizeBytes),
      },
      body: body as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex?: 'half' });
  }

  async deleteBlob(container: string, path: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(path)}`, { method: 'DELETE' });
  }

  async renameBlob(container: string, fromPath: string, toPath: string): Promise<void> {
    await this.json(`/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs/${this.encodePath(fromPath)}:rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: toPath }),
    });
  }

  async deleteFolder(container: string, prefix: string): Promise<number> {
    const r = await this.json<{ deleted: number }>(
      `/storages/${this.account}/containers/${encodeURIComponent(container)}/blobs?prefix=${encodeURIComponent(prefix)}&confirm=true`,
      { method: 'DELETE' },
    );
    return r.deleted;
  }

  // ---- shares + files (Task 14 fills in) ----
  async listShares(): Promise<Page<ShareInfo>> { throw new Error('NotImplemented: T14'); }
  async createShare(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async deleteShare(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async listDir(): Promise<Page<FileItem>> { throw new Error('NotImplemented: T14'); }
  async readFile(): Promise<BlobReadHandle> { throw new Error('NotImplemented: T14'); }
  async headFile(): Promise<Omit<BlobReadHandle, 'stream'>> { throw new Error('NotImplemented: T14'); }
  async uploadFile(): Promise<{ etag?: string; lastModified?: string }> { throw new Error('NotImplemented: T14'); }
  async deleteFile(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async renameFile(): Promise<void> { throw new Error('NotImplemented: T14'); }
  async deleteFileFolder(): Promise<number> { throw new Error('NotImplemented: T14'); }
}
```

> Update `factory.ts` to pass `accountName`. Existing factory call signature was `new ApiBackend(entry)` — change to `new ApiBackend(entry, account)`. Account name comes from CLI/server context (the URL's `:account` parameter) — the factory needs to take it as a second argument:
>
> ```ts
> // factory.ts updated signature:
> export function makeBackend(entry: StorageEntry, accountName?: string): IStorageBackend {
>   if (entry.kind === 'direct') return new DirectBackend(entry);
>   if (entry.kind === 'api') {
>     if (!accountName) throw new Error('makeBackend(api): accountName is required');
>     return new ApiBackend(entry, accountName);
>   }
>   throw new Error(`Unknown StorageEntry kind: ${(entry as { kind?: string }).kind ?? 'undefined'}`);
> }
> ```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/api-backend-blobs.test.ts
```
Expected: 5 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/api-backend.ts src/core/backend/factory.ts tests/unit/api-backend-blobs.test.ts
git commit -m "client: implement ApiBackend containers+blobs ops; factory now requires accountName for api kind"
```

---

### Task 14: api-backend.ts — shares + files

**Files:**
- Modify: `src/core/backend/api-backend.ts`
- Create: `tests/unit/api-backend-files.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/api-backend-files.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiBackend } from '../../src/core/backend/api-backend.js';
import type { ApiBackendEntry } from '../../src/core/types.js';

const entry: ApiBackendEntry = {
  kind: 'api', name: 'nbg', baseUrl: 'https://api.example.com',
  authEnabled: false, addedAt: '2025-01-01',
};
const acct = 'sadirectusersgeneric';

beforeEach(() => { vi.restoreAllMocks(); });

describe('ApiBackend (shares + files)', () => {
  it('listShares calls /storages/{a}/shares', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 's1', quotaGiB: 5 }], continuationToken: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listShares();
    expect(r.items[0]).toEqual({ name: 's1', quotaGiB: 5 });
  });

  it('listDir uses ?path= query parameter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 'a.txt', isDirectory: false, size: 5 }], continuationToken: '',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listDir('s1', 'logs');
    expect(r.items[0].name).toBe('a.txt');
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('/storages/sadirectusersgeneric/shares/s1/files?path=logs');
  });

  it('deleteFileFolder requires confirm=true in the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ deleted: 3 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const b = new ApiBackend(entry, acct);
    const n = await b.deleteFileFolder('s1', 'old/');
    expect(n).toBe(3);
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('confirm=true');
  });
});
```

- [ ] **Step 2: Replace the share/file stubs in api-backend.ts**

Replace each `throw new Error('NotImplemented: T14')` method body with:

```ts
  // ---- shares ----
  async listShares(opts: PageOpts = {}): Promise<Page<ShareInfo>> {
    const params = new URLSearchParams();
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.json(`/storages/${this.account}/shares${qs}`);
  }
  async createShare(name: string, quotaGiB?: number): Promise<void> {
    await this.json(`/storages/${this.account}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quotaGiB ? { name, quotaGiB } : { name }),
    });
  }
  async deleteShare(name: string): Promise<void> {
    await this.json(`/storages/${this.account}/shares/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  // ---- files ----
  async listDir(share: string, path: string, opts: PageOpts = {}): Promise<Page<FileItem>> {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts.continuationToken) params.set('continuationToken', opts.continuationToken);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.json(`/storages/${this.account}/shares/${encodeURIComponent(share)}/files${qs}`);
  }

  async readFile(share: string, path: string): Promise<BlobReadHandle> {
    const headers = await this.authHeaders();
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/shares/${encodeURIComponent(share)}/files/${this.encodePath(path)}`, { headers });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      const body = ct.includes('application/json') ? await res.json().catch(() => undefined) : undefined;
      throw fromResponseBody(res.status, body, this.entry.name);
    }
    return {
      stream: Readable.fromWeb(res.body as never) as NodeJS.ReadableStream,
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async headFile(share: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}/storages/${this.account}/shares/${encodeURIComponent(share)}/files/${this.encodePath(path)}`, {
        method: 'HEAD', headers: await this.authHeaders(),
      });
    } catch (err) { throw new NetworkError(err as Error); }
    if (!res.ok) throw fromResponseBody(res.status, undefined, this.entry.name);
    return {
      contentType: res.headers.get('content-type') ?? undefined,
      contentLength: res.headers.has('content-length') ? Number(res.headers.get('content-length')) : undefined,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    };
  }

  async uploadFile(share: string, path: string, body: NodeJS.ReadableStream | Buffer, sizeBytes: number, contentType?: string): Promise<{ etag?: string; lastModified?: string }> {
    return this.json(`/storages/${this.account}/shares/${encodeURIComponent(share)}/files/${this.encodePath(path)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(sizeBytes),
      },
      body: body as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex?: 'half' });
  }

  async deleteFile(share: string, path: string): Promise<void> {
    await this.json(`/storages/${this.account}/shares/${encodeURIComponent(share)}/files/${this.encodePath(path)}`, { method: 'DELETE' });
  }

  async renameFile(share: string, fromPath: string, toPath: string): Promise<void> {
    await this.json(`/storages/${this.account}/shares/${encodeURIComponent(share)}/files/${this.encodePath(fromPath)}:rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: toPath }),
    });
  }

  async deleteFileFolder(share: string, path: string): Promise<number> {
    const r = await this.json<{ deleted: number }>(
      `/storages/${this.account}/shares/${encodeURIComponent(share)}/files?path=${encodeURIComponent(path)}&confirm=true`,
      { method: 'DELETE' },
    );
    return r.deleted;
  }
```

- [ ] **Step 3: Run**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/api-backend-files.test.ts
```
Expected: 3 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/backend/api-backend.ts tests/unit/api-backend-files.test.ts
git commit -m "client: implement ApiBackend shares+files ops"
```

---

## Phase 5 — CLI integration

### Task 15: shared.ts — `resolveStorageBackend` returns `IStorageBackend`

**Files:**
- Modify: `src/cli/commands/shared.ts`

> This is the central refactor. After this task, every CLI command can call `resolveStorageBackend(opts, accountName?)` and get back an `IStorageBackend`. Existing code that reads `entry.accountName` directly inside `resolveStorageEntry` either narrows on `entry.kind === 'direct'` or migrates to the new function.

- [ ] **Step 1: Add a new `resolveStorageBackend()` next to `resolveStorageEntry()`**

In `src/cli/commands/shared.ts`, add:

```ts
import type { IStorageBackend } from '../../core/backend/backend.js';
import { makeBackend } from '../../core/backend/factory.js';
import type { StorageEntry } from '../../core/types.js';

/**
 * Resolve a storage backend for CLI commands. Looks up the named entry from
 * the credential store (or falls back to inline --account-key/--sas-token
 * for direct mode), then dispatches via the backend factory.
 *
 * For api-backend kinds, `accountName` is required (becomes the {account}
 * path segment in API URLs).
 */
export async function resolveStorageBackend(
  opts: StorageOpts,
  accountName?: string,
): Promise<{ entry: StorageEntry; backend: IStorageBackend }> {
  const { entry } = await resolveStorageEntry(opts);
  if (entry.kind === 'api') {
    if (!accountName) throw new Error('--account is required when using an api backend');
    return { entry, backend: makeBackend(entry, accountName) };
  }
  return { entry, backend: makeBackend(entry) };
}
```

> Keep the existing `resolveStorageEntry()` function — repo-sync / link / diff commands still use it (those are direct-only per spec).

- [ ] **Step 2: Type-check + smoke**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: any errors here go away once Tasks 16–18 migrate the existing commands. For T15 itself, only `shared.ts` should be modified — keep narrowing inside `resolveStorageEntry` correct (`entry.accountKey` etc only accessed inside `if (entry.kind === 'direct')` blocks).

- [ ] **Step 3: Pause, commit**

```bash
git add src/cli/commands/shared.ts
git commit -m "client: add resolveStorageBackend factory call to shared CLI helpers"
```

---

### Task 16: add-storage + list-storages — `kind:'direct'` writes + render kind column

**Files:**
- Modify: `src/cli/commands/add-storage.ts`
- Modify: `src/cli/commands/list-storages.ts`

- [ ] **Step 1: Update `add-storage.ts`** — set `kind: 'direct'` when constructing the new `StorageEntry`. Inside the existing `addStorage()` function, find the `const entry: ... = {` literal and add the discriminator:

```ts
const entry: DirectStorageEntry = {
  kind: 'direct',
  name, accountName, sasToken, accountKey,
  addedAt: new Date().toISOString(),
};
```

- [ ] **Step 2: Update `list-storages.ts`** — add a "Kind" column. Existing function prints rows like `${entry.name} (${entry.accountName})`; change to:

```ts
console.log(`  [${entry.kind}] ${entry.name} ${entry.kind === 'direct' ? `(${entry.accountName})` : `→ ${entry.baseUrl}`}`);
```

- [ ] **Step 3: TS-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: progress — TS errors decrease.

- [ ] **Step 4: Pause, commit**

```bash
git add src/cli/commands/add-storage.ts src/cli/commands/list-storages.ts
git commit -m "client: write kind:'direct' on add-storage; list-storages renders kind column"
```

---

### Task 17: add-api command + register in CLI

**Files:**
- Create: `src/cli/commands/add-api.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement `add-api`**

```ts
// src/cli/commands/add-api.ts
import { CredentialStore } from '../../core/credential-store.js';
import type { ApiBackendEntry } from '../../core/types.js';
import { fetchDiscovery } from '../../core/backend/auth/discovery.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';

export async function addApi(name: string, baseUrl: string): Promise<void> {
  const store = new CredentialStore();
  store.load();
  if (store.getStorage(name)) {
    console.error(`Storage with name "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`Probing ${baseUrl} ...`);
  const discovery = await fetchDiscovery(baseUrl);
  console.log(`  authEnabled = ${discovery.authEnabled}`);

  const entry: ApiBackendEntry = {
    kind: 'api',
    name,
    baseUrl,
    authEnabled: discovery.authEnabled,
    oidc: discovery.authEnabled
      ? { issuer: discovery.issuer, clientId: discovery.clientId, audience: discovery.audience, scopes: discovery.scopes }
      : undefined,
    addedAt: new Date().toISOString(),
  };

  if (discovery.authEnabled) {
    console.log(`Starting OIDC device-code login...`);
    const tokens = await deviceCodeFlow({
      issuer: discovery.issuer,
      clientId: discovery.clientId,
      scopes: discovery.scopes,
      audience: discovery.audience,
    });
    await new TokenStore().save(name, tokens);
    console.log(`  login successful (token expires in ${Math.floor((tokens.expiresAt - Date.now()) / 1000)}s)`);
  }

  store.addStorage(entry);
  store.save();
  console.log(`Added api backend "${name}" → ${baseUrl}`);
}
```

- [ ] **Step 2: Register in `src/cli/index.ts`**

Near the existing `add` command, add:

```ts
import { addApi } from './commands/add-api.js';

program
  .command('add-api')
  .description('Register a Storage Navigator API as a backend')
  .requiredOption('--name <name>', 'Display name')
  .requiredOption('--base-url <url>', 'API base URL (e.g. https://your-api.azurewebsites.net)')
  .action(async (opts) => {
    await addApi(opts.name, opts.baseUrl);
  });
```

- [ ] **Step 3: Smoke run against deployed API (auth-off)**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && \
  npx tsx src/cli/index.ts add-api --name nbg-dev \
  --base-url https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
npx tsx src/cli/index.ts list
```
Expected: `add-api` prints `authEnabled = false` then `Added api backend "nbg-dev"`. `list` shows the new entry with `[api]` prefix.

- [ ] **Step 4: Pause, commit**

```bash
git add src/cli/commands/add-api.ts src/cli/index.ts
git commit -m "client: add 'add-api' CLI command (registers api backend; OIDC if needed)"
```

---

### Task 18: auth-ops — login + logout

**Files:**
- Create: `src/cli/commands/auth-ops.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement**

```ts
// src/cli/commands/auth-ops.ts
import { CredentialStore } from '../../core/credential-store.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';

export async function login(name: string): Promise<void> {
  const store = new CredentialStore();
  store.load();
  const entry = store.getStorage(name);
  if (!entry || entry.kind !== 'api') {
    console.error(`No api backend named "${name}".`);
    process.exit(1);
  }
  if (!entry.authEnabled || !entry.oidc) {
    console.error(`Api backend "${name}" has authEnabled=false; nothing to log in to.`);
    process.exit(1);
  }
  console.log(`Re-running OIDC device-code login for ${name}...`);
  const tokens = await deviceCodeFlow({
    issuer: entry.oidc.issuer,
    clientId: entry.oidc.clientId,
    audience: entry.oidc.audience,
    scopes: entry.oidc.scopes,
  });
  await new TokenStore().save(name, tokens);
  console.log(`Login successful.`);
}

export async function logout(name: string): Promise<void> {
  await new TokenStore().delete(name);
  console.log(`Tokens for "${name}" cleared.`);
}
```

- [ ] **Step 2: Register**

```ts
// src/cli/index.ts
import { login, logout } from './commands/auth-ops.js';

program.command('login')
  .description('Re-run OIDC login for an existing api backend')
  .requiredOption('--name <name>', 'API backend name')
  .action(async (opts) => { await login(opts.name); });

program.command('logout')
  .description('Delete stored OIDC tokens for an api backend')
  .requiredOption('--name <name>', 'API backend name')
  .action(async (opts) => { await logout(opts.name); });
```

- [ ] **Step 3: Pause, commit**

```bash
git add src/cli/commands/auth-ops.ts src/cli/index.ts
git commit -m "client: add 'login' + 'logout' CLI commands for api backends"
```

---

### Task 19: shares-ops — 9 file-share commands

**Files:**
- Create: `src/cli/commands/shares-ops.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement**

```ts
// src/cli/commands/shares-ops.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveStorageBackend, type StorageOpts } from './shared.js';

export async function listShares(opts: StorageOpts & { account?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.listShares();
  for (const s of r.items) console.log(`  ${s.name}${s.quotaGiB ? ` (quota: ${s.quotaGiB} GiB)` : ''}`);
}

export async function createShare(opts: StorageOpts & { account?: string; name: string; quota?: number }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.createShare(opts.name, opts.quota);
  console.log(`Share "${opts.name}" created.`);
}

export async function deleteShareCmd(opts: StorageOpts & { account?: string; name: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.deleteShare(opts.name);
  console.log(`Share "${opts.name}" deleted.`);
}

export async function listDir(opts: StorageOpts & { account?: string; share: string; path?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.listDir(opts.share, opts.path ?? '');
  for (const f of r.items) console.log(`  ${f.isDirectory ? '[D]' : '   '} ${f.name}${f.size !== undefined ? ` (${f.size} bytes)` : ''}`);
}

export async function viewFile(opts: StorageOpts & { account?: string; share: string; file: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const r = await backend.readFile(opts.share, opts.file);
  for await (const chunk of r.stream) process.stdout.write(chunk);
  process.stdout.write('\n');
}

export async function uploadFileCmd(opts: StorageOpts & { account?: string; share: string; file: string; source?: string; content?: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  let body: Buffer;
  if (opts.source) body = readFileSync(opts.source);
  else if (opts.content !== undefined) body = Buffer.from(opts.content, 'utf8');
  else throw new Error('Provide --source <path> or --content <text>');
  await backend.uploadFile(opts.share, opts.file, body, body.length);
  console.log(`Uploaded ${opts.file} (${body.length} bytes).`);
}

export async function renameFileCmd(opts: StorageOpts & { account?: string; share: string; file: string; newName: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.renameFile(opts.share, opts.file, opts.newName);
  console.log(`Renamed ${opts.file} → ${opts.newName}.`);
}

export async function deleteFileCmd(opts: StorageOpts & { account?: string; share: string; file: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  await backend.deleteFile(opts.share, opts.file);
  console.log(`Deleted ${opts.file}.`);
}

export async function deleteFileFolderCmd(opts: StorageOpts & { account?: string; share: string; path: string }) {
  const { backend } = await resolveStorageBackend(opts, opts.account);
  const n = await backend.deleteFileFolder(opts.share, opts.path);
  console.log(`Deleted ${n} files under ${opts.path}.`);
}
```

- [ ] **Step 2: Register all 9 commands in `src/cli/index.ts`**

```ts
import {
  listShares, createShare, deleteShareCmd,
  listDir, viewFile, uploadFileCmd, renameFileCmd, deleteFileCmd, deleteFileFolderCmd,
} from './commands/shares-ops.js';

const commonStorageOpts = (cmd: import('commander').Command) =>
  cmd.option('--storage <name>', 'Storage backend name')
     .option('--account <account>', 'Azure storage account name (required for api backends)')
     .option('--account-key <key>', 'Inline account key (direct only)')
     .option('--sas-token <token>', 'Inline SAS token (direct only)');

commonStorageOpts(program.command('shares').description('List file shares'))
  .action(async (opts) => { await listShares(opts); });

commonStorageOpts(program.command('share-create').description('Create a file share')
  .requiredOption('--name <name>', 'Share name')
  .option('--quota <gib>', 'Quota in GiB', (v) => parseInt(v, 10)))
  .action(async (opts) => { await createShare(opts); });

commonStorageOpts(program.command('share-delete').description('Delete a file share')
  .requiredOption('--name <name>', 'Share name'))
  .action(async (opts) => { await deleteShareCmd(opts); });

commonStorageOpts(program.command('files').description('List directory contents in a file share')
  .requiredOption('--share <name>', 'Share name')
  .option('--path <dir>', 'Directory path (default: root)'))
  .action(async (opts) => { await listDir(opts); });

commonStorageOpts(program.command('file-view').description('View a file (UTF-8 text)')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'File path'))
  .action(async (opts) => { await viewFile(opts); });

commonStorageOpts(program.command('file-upload').description('Upload a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'Destination path')
  .option('--source <path>', 'Local file to upload')
  .option('--content <text>', 'Inline text content'))
  .action(async (opts) => { await uploadFileCmd(opts); });

commonStorageOpts(program.command('file-rename').description('Rename a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'Current path')
  .requiredOption('--new-name <path>', 'New path'))
  .action(async (opts) => { await renameFileCmd(opts); });

commonStorageOpts(program.command('file-delete').description('Delete a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'File path'))
  .action(async (opts) => { await deleteFileCmd(opts); });

commonStorageOpts(program.command('file-delete-folder').description('Delete a directory recursively')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--path <dir>', 'Directory path'))
  .action(async (opts) => { await deleteFileFolderCmd(opts); });
```

- [ ] **Step 3: Pause, commit**

```bash
git add src/cli/commands/shares-ops.ts src/cli/index.ts
git commit -m "client: add 9 file-share CLI commands (shares + share-create/delete + files + file-* ops)"
```

---

### Task 20: migrate existing blob commands to IStorageBackend

**Files:**
- Modify: `src/cli/commands/view.ts`
- Modify: `src/cli/commands/blob-ops.ts`

> Each command currently does:
> ```ts
> const { entry } = await resolveStorageEntry(opts);
> const client = new BlobClient(entry);
> await client.listContainers();
> ```
> Replace with:
> ```ts
> const { backend } = await resolveStorageBackend(opts, opts.account);
> await backend.listContainers();
> ```
> Method-by-method, the API of `IStorageBackend` is intentionally close to `BlobClient` so call sites change minimally. Where the old code consumed e.g. `BlobItem[]`, the new code unwraps `Page<BlobItem>.items`.

- [ ] **Step 1: Migrate `view.ts`**

For `listContainers`, `listBlobs`, `viewBlob`, `downloadBlob` — replace each `BlobClient` instantiation with `resolveStorageBackend(opts, opts.account)` and adjust where the result shape changed (`Page<T>` vs raw array).

- [ ] **Step 2: Migrate `blob-ops.ts`**

Same for `createContainer`, `renameBlob`, `deleteBlob`, `deleteFolder`, `createBlob`.

- [ ] **Step 3: Run smoke against direct backend**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && \
  npx tsx src/cli/index.ts list  # should still work
npx tsx src/cli/index.ts containers --storage <one of your existing direct entries>  # should still work
```
Expected: same output as before the refactor.

- [ ] **Step 4: Smoke against api backend (auth-off)**

```bash
npx tsx src/cli/index.ts containers --storage nbg-dev --account sadirectusersgeneric
npx tsx src/cli/index.ts ls --storage nbg-dev --account sadirectusersgeneric --container <name>
npx tsx src/cli/index.ts view --storage nbg-dev --account sadirectusersgeneric --container <c> --blob <path>
```
Expected: same output as live API.

- [ ] **Step 5: Pause, commit**

```bash
git add src/cli/commands/view.ts src/cli/commands/blob-ops.ts
git commit -m "client: migrate blob commands to IStorageBackend (works with both kinds)"
```

---

## Phase 6 — Electron UI

### Task 21: server.ts — route handlers go through IStorageBackend; add /api/shares + /api/files

**Files:**
- Modify: `src/electron/server.ts`

- [ ] **Step 1: Refactor existing handlers**

Where `server.ts` instantiates `BlobClient(entry)`, replace with `makeBackend(entry, accountName?)`. Existing /api routes (`/api/containers`, `/api/blobs/...`) keep their URL shape — just the handler implementation changes.

- [ ] **Step 2: Add /api/shares routes**

Inside `createServer(...)`:

```ts
app.get('/api/shares/:storage', async (req, res, next) => {
  try {
    const entry = store.getStorage(req.params.storage);
    if (!entry) return res.status(404).json({ error: { message: 'Storage not found' } });
    const account = req.params.storage; // for direct kinds, name == account; for api kinds use ?account= query
    const accountName = req.query.account as string | undefined;
    const backend = makeBackend(entry, accountName ?? (entry.kind === 'direct' ? entry.accountName : undefined));
    res.json(await backend.listShares());
  } catch (err) { next(err); }
});

app.get('/api/files/:storage/:share', async (req, res, next) => { /* listDir */ });
app.get('/api/file/:storage/:share/:path*', async (req, res, next) => { /* readFile streaming */ });
app.put('/api/file/:storage/:share/:path*', async (req, res, next) => { /* uploadFile */ });
app.delete('/api/file/:storage/:share/:path*', async (req, res, next) => { /* deleteFile */ });
app.post('/api/files/:storage/:share/:path*/rename', async (req, res, next) => { /* renameFile */ });
```

(Each handler mirrors the matching `IStorageBackend` method. Reuse the existing error-handler middleware shape from server.ts.)

- [ ] **Step 3: Smoke**

```bash
npx tsx src/cli/index.ts ui &
sleep 2
curl -s http://localhost:3100/api/shares/nbg-dev?account=sadirectusersgeneric | jq
kill %1
```
Expected: array of shares.

- [ ] **Step 4: Pause, commit**

```bash
git add src/electron/server.ts
git commit -m "client: server.ts goes through IStorageBackend; add /api/shares + /api/files routes"
```

---

### Task 22: oidc-loopback + main.ts wiring (Electron PKCE)

**Files:**
- Create: `src/electron/oidc-loopback.ts`
- Modify: `src/electron/main.ts`

- [ ] **Step 1: Implement loopback callback server**

```ts
// src/electron/oidc-loopback.ts
import { createServer, type Server } from 'node:http';

export async function captureCallback(): Promise<{ code: string; state: string; url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const u = new URL(req.url ?? '', 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      if (!code || !state) {
        res.statusCode = 400; res.end('Missing code or state'); return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<html><body><h2>Login successful</h2><p>You can close this window.</p></body></html>`);
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      resolve({ code, state, url: `http://127.0.0.1:${addr.port}/cb`, close: () => server.close() });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      // Caller reads the assigned port via the returned `url` field after the
      // callback fires — but they need the URL BEFORE that for the auth-url
      // build. Workaround: emit an early "listening" via a side-channel.
      // For simplicity in v1, expose a separate startLoopback() that returns
      // the redirectUri immediately (the resolve above happens on callback).
    });
  });
}

export type LoopbackHandle = {
  redirectUri: string;
  waitForCallback: () => Promise<{ code: string; state: string }>;
  close: () => void;
};

export async function startLoopback(): Promise<LoopbackHandle> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('bad addr');
  const redirectUri = `http://127.0.0.1:${addr.port}/cb`;
  let resolveCb!: (v: { code: string; state: string }) => void;
  let rejectCb!: (e: Error) => void;
  const cb = new Promise<{ code: string; state: string }>((res, rej) => { resolveCb = res; rejectCb = rej; });
  server.on('request', (req, res) => {
    const u = new URL(req.url ?? '', 'http://127.0.0.1');
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!code || !state) { res.statusCode = 400; res.end('Missing code/state'); rejectCb(new Error('Missing code/state')); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<html><body><h2>Login successful</h2><p>You can close this window.</p></body></html>`);
    resolveCb({ code, state });
  });
  return { redirectUri, waitForCallback: () => cb, close: () => server.close() };
}
```

- [ ] **Step 2: Add an IPC handler in `main.ts`**

```ts
// src/electron/main.ts (additions)
import { ipcMain, shell, safeStorage } from 'electron';
import { generatePkce, buildAuthorizeUrl, exchangeCode } from '../core/backend/auth/oidc-client.js';
import { startLoopback } from './oidc-loopback.js';
import { TokenStore } from '../core/backend/auth/token-store.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

ipcMain.handle('oidc:login', async (_event, args: { name: string; issuer: string; clientId: string; audience: string; scopes: string[] }) => {
  const lp = await startLoopback();
  const pkce = generatePkce();
  const state = Math.random().toString(36).slice(2);
  const url = buildAuthorizeUrl({
    issuer: args.issuer, clientId: args.clientId, scopes: args.scopes, audience: args.audience,
    redirectUri: lp.redirectUri, codeChallenge: pkce.codeChallenge, state,
  });
  await shell.openExternal(url.toString());
  const cb = await lp.waitForCallback();
  if (cb.state !== state) throw new Error('OIDC state mismatch');
  const tokens = await exchangeCode({
    issuer: args.issuer, clientId: args.clientId, code: cb.code,
    redirectUri: lp.redirectUri, codeVerifier: pkce.codeVerifier,
  });
  lp.close();
  // Encrypt with safeStorage and write to ~/.storage-navigator/oidc-tokens.bin
  // (Electron-side store; CLI uses the JSON path. The map structure is the same.)
  const dir = join(homedir(), '.storage-navigator');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'oidc-tokens.bin');
  let map: Record<string, unknown> = {};
  if (existsSync(file)) {
    const enc = readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      try { map = JSON.parse(safeStorage.decryptString(enc)) as Record<string, unknown>; } catch { map = {}; }
    }
  }
  map[args.name] = tokens;
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(file, safeStorage.encryptString(JSON.stringify(map)));
  } else {
    // Fall back to fs-backed plaintext (TokenStore default behavior)
    await new TokenStore().save(args.name, tokens);
  }
  return { ok: true };
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Pause, commit**

```bash
git add src/electron/oidc-loopback.ts src/electron/main.ts
git commit -m "client: add OIDC loopback callback server + Electron main IPC for PKCE login"
```

---

### Task 23: Electron UI — "Add Storage" 3rd tab + Shares tree node + OIDC login button + tokens panel

**Files:**
- Modify: `src/electron/public/index.html`
- Modify: `src/electron/public/app.js`
- Modify: `src/electron/public/styles.css`

- [ ] **Step 1: Update `index.html`**

In the "Add Storage" dialog, add a third tab labeled `Connect to Storage Navigator API`. Tab body:

```html
<div class="tab-body" data-tab="api" hidden>
  <label>Friendly name <input id="api-name" required /></label>
  <label>Base URL <input id="api-url" placeholder="https://your-api.azurewebsites.net" required /></label>
  <button id="api-add-btn">Connect</button>
</div>
```

In the storage tree, add a sibling `<ul class="shares-tree" data-storage="..."></ul>` next to the existing containers list.

- [ ] **Step 2: Update `app.js`**

Add the click handler for `#api-add-btn`:

```js
document.getElementById('api-add-btn').addEventListener('click', async () => {
  const name = document.getElementById('api-name').value;
  const baseUrl = document.getElementById('api-url').value;
  const probe = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/storage-nav-config`).then(r => r.json());
  if (probe.authEnabled) {
    const r = await window.electron.invoke('oidc:login', {
      name, issuer: probe.issuer, clientId: probe.clientId, audience: probe.audience, scopes: probe.scopes,
    });
    if (!r.ok) { alert('OIDC login failed'); return; }
  }
  await fetch('/api/storage/api-backend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, baseUrl, authEnabled: probe.authEnabled, oidc: probe.authEnabled ? { issuer: probe.issuer, clientId: probe.clientId, audience: probe.audience, scopes: probe.scopes } : undefined }) });
  refreshStorageList();
});
```

(Add the `/api/storage/api-backend` POST handler in `server.ts` to register the entry server-side.)

For the Shares tree node, fetch `/api/shares/${storageName}?account=${account}` and render entries beneath the storage. File ops mirror existing blob handlers.

- [ ] **Step 3: Update `styles.css`**

Add `.kind-api { background-image: url('cloud-link.svg'); }` and `.kind-direct { background-image: url('key.svg'); }` (or use unicode symbols if you prefer to skip new assets — `🔗` for api, `🔑` for direct).

- [ ] **Step 4: Smoke**

```bash
npx tsx src/electron/main.ts &
# In the UI: Add Storage → Connect to Storage Navigator API tab → enter URL → confirm shares tree appears
```

- [ ] **Step 5: Pause, commit**

```bash
git add src/electron/public/index.html src/electron/public/app.js src/electron/public/styles.css
git commit -m "client: Electron UI 'Add Storage' API tab + Shares tree + OIDC login button"
```

---

## Phase 7 — Live smoke + docs + verification

### Task 24: Live smoke against the deployed API (CLI)

> Verification-only — no source changes, no commit.

- [ ] **Step 1: Add the api backend if not already present**

```bash
npx tsx src/cli/index.ts add-api --name nbg-dev \
  --base-url https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
```

- [ ] **Step 2: Exercise every IStorageBackend method via CLI**

```bash
npx tsx src/cli/index.ts containers --storage nbg-dev --account sadirectusersgeneric
npx tsx src/cli/index.ts ls --storage nbg-dev --account sadirectusersgeneric --container agent-engine
npx tsx src/cli/index.ts view --storage nbg-dev --account sadirectusersgeneric --container agent-engine --blob langgraph-test-agent/agent_settings.json
npx tsx src/cli/index.ts shares --storage nbg-dev --account sadirectusersgeneric
npx tsx src/cli/index.ts files --storage nbg-dev --account sadirectusersgeneric --share e-auctions
npx tsx src/cli/index.ts files --storage nbg-dev --account sadirectusersgeneric --share e-auctions --path logs
npx tsx src/cli/index.ts file-view --storage nbg-dev --account sadirectusersgeneric --share e-auctions --file logs/2025-11-17.log
```

Each command must succeed against the live API.

- [ ] **Step 3: Capture results and report**

No commit. If any command fails, report which one and the error; the controller decides whether to fix or defer.

---

### Task 25: Update CLAUDE.md tools block + project-design + project-functions

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/design/project-design.md`
- Modify: `docs/design/project-functions.md`

- [ ] **Step 1: Extend `<storage-nav>` block in `CLAUDE.md`**

Append the new commands inside the existing `<info>` body (next to the existing command list):

```
          add-api      Register a Storage Navigator API as a backend
            --name <name>         Display name
            --base-url <url>      API base URL

          login        Re-run OIDC login for an existing api backend
          logout       Clear stored OIDC tokens for an api backend

          shares       List file shares (works with direct + api backends)
          share-create Create a file share (--name, optional --quota)
          share-delete Delete a file share

          files        List directory contents in a file share
          file-view    View a file (UTF-8 text)
          file-upload  Upload a file (--source local path OR --content text)
          file-rename  Rename a file
          file-delete  Delete a file
          file-delete-folder  Delete a directory recursively

          All blob commands (containers, ls, view, etc.) accept api backends
          via `--storage <api-backend-name> --account <azure-account>`.
```

- [ ] **Step 2: Append "Backend types" section to `project-design.md`**

```markdown
## Backend types (Plan 007)

Storage Navigator client supports three backend kinds:

| kind | Auth | File shares | Repo sync | Notes |
|---|---|---|---|---|
| `direct` (account-key) | Account key | yes | yes | Existing default |
| `direct` (sas-token) | SAS token | yes | yes | Existing |
| `api` | OIDC (Bearer JWT) or anonymous | yes | no (deferred) | Added in Plan 007; talks to the deployed Storage Navigator API |

All consumers route through `IStorageBackend` (`src/core/backend/backend.ts`). The factory `makeBackend(entry, account?)` dispatches by `kind`.
```

- [ ] **Step 3: Append RBAC API section to `project-functions.md`**

```markdown
## API backend client (Plan 007)

- New CLI commands: `add-api`, `login`, `logout`, `shares`, `share-create`, `share-delete`, `files`, `file-view`, `file-upload`, `file-rename`, `file-delete`, `file-delete-folder`.
- All existing blob commands gain `--account` to disambiguate Azure storage account when targeting an api backend.
- Electron "Add Storage" dialog has a third tab for connecting to a Storage Navigator API. Storage tree shows a Shares sibling node under each backend.
- OIDC login flows: PKCE via system browser + loopback redirect (Electron); device-code (CLI). Tokens persisted via Electron `safeStorage` or chmod-600 file (CLI), keyed by api backend name.
- File-share support added to the existing `direct` backends as well, via the new `FileShareClient` wrapping `@azure/storage-file-share` with the same account-key / SAS the user already provides.
```

- [ ] **Step 4: Pause, commit**

```bash
git add CLAUDE.md docs/design/project-design.md docs/design/project-functions.md
git commit -m "docs: register api backend type + new CLI commands in CLAUDE.md and project docs"
```

---

### Task 26: Final verification

- [ ] **Step 1: Run the full unit test suite**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npm test
```

Expected: all tests green (count depends on which tasks added new tests; aim for ≥30).

- [ ] **Step 2: Verify TS build is clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke-curl every endpoint via CLI** (combine T17 + T20 + T24 commands; capture pass/fail)

- [ ] **Step 4: Acceptance-criteria walkthrough** (read Section 13 of `docs/design/plan-007-storage-nav-client-adapter.md`; produce a table mapping each criterion → satisfying test/step/file)

- [ ] **Step 5: Verify no source files modified** (verification only — `git status` must show only the pre-existing unstaged paths)

- [ ] **Step 6: No commit — verification only.**

---

## Self-review checklist

| Spec section | Coverage |
|---|---|
| 1 Overview, 2 Goals, 3 Non-goals | Tasks 1–25; deferrals tracked in Issues file |
| 4 Architecture | Tasks 4 + 6 (interface + factory) anchor the seam |
| 5 IStorageBackend interface | Task 4 |
| 6 Folder layout | Each task creates files exactly per the file map |
| 7 Type definitions + migration | Tasks 2 + 3 |
| 8 Auth + data flow | Tasks 9–12 (OIDC stack), Tasks 13–14 (api backend wire) |
| 9 Error mapping | Task 5 |
| 10 CLI surface | Tasks 17 + 18 + 19 + 20 |
| 11 Electron UI changes | Tasks 21 + 22 + 23 |
| 12 Tests | Each implementation task adds tests |
| 13 Acceptance criteria | Task 26 walkthrough |
| 14 Out-of-scope follow-ups | Tracked in Issues file post-T25 |

Placeholder scan: every task has concrete file paths + concrete code blocks. No "TBD"/"TODO"/"add error handling" steps.

Type consistency: `StorageEntry`, `IStorageBackend`, `Page<T>`, `BlobReadHandle`, `TokenSet`, `OidcConfig` defined once and reused exactly.

---

## Execution handoff

Plan complete and saved to `docs/design/plan-007-storage-nav-client-adapter-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints.

Which approach?
