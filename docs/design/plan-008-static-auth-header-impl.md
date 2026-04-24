# Static Auth Header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project rule:** Per `CLAUDE.md`, no git operation may be performed without explicit user approval. Each task ends with a "commit" step — Claude executing this plan must pause and ask the user before running it.

**Goal:** Build the perimeter API-key gate described in `docs/design/plan-008-static-auth-header.md` — opt-in `STATIC_AUTH_HEADER_VALUE` env on the API plus a configurable header name; client adapter (CLI + Electron UI) prompts for, persists, and sends the value on every request.

**Architecture:** Add an Express middleware (`staticAuthMiddleware`) mounted between the public endpoints (well-known/health/openapi/docs) and the auth/principal middlewares. Header name is configurable; values are comma-separated for zero-downtime rotation. Client-side: extend `ApiBackendEntry` with an optional `staticAuthHeader: { name, value }`, persisted via the existing encrypted credential store; `ApiBackend.authHeaders()` injects the header on every outgoing request. Discovery endpoint advertises the header NAME (never the value) via two new optional fields.

**Tech Stack:** Same as Plan 006/007 — Node 22, TypeScript 5+, Express 5, vitest. No new dependencies.

---

## File map

| Path | Responsibility |
|---|---|
| `API/src/auth/static-auth.ts` | NEW: `staticAuthMiddleware(values, name)` — pass-through if values empty, else 401 unless header matches |
| `API/src/errors/api-error.ts` | MODIFY: add `STATIC_AUTH_FAILED` to `ApiErrorCode` union |
| `API/src/config.ts` | MODIFY: parse `STATIC_AUTH_HEADER_VALUE` (csv) + `STATIC_AUTH_HEADER_NAME` (default `X-Storage-Nav-Auth`); add `staticAuth` to `Config` schema |
| `API/src/app.ts` | MODIFY: mount `staticAuthMiddleware` between `healthRouter` and the auth middleware |
| `API/src/routes/well-known.ts` | MODIFY: include `staticAuthHeaderRequired` + `staticAuthHeaderName` when active |
| `API/test/unit/static-auth.test.ts` | NEW: 6 cases covering middleware behavior |
| `API/test/unit/config.test.ts` | MODIFY: +4 cases for staticAuth env parsing |
| `API/test/unit/well-known.test.ts` | MODIFY: +2 cases for new fields |
| `src/core/types.ts` | MODIFY: add `staticAuthHeader?: { name; value }` to `ApiBackendEntry` |
| `src/core/backend/auth/discovery.ts` | MODIFY: parse + return `staticAuthHeaderRequired` + `staticAuthHeaderName` |
| `src/core/backend/http-error.ts` | MODIFY: add `StaticAuthFailedError` class; `fromResponseBody` dispatches `STATIC_AUTH_FAILED` |
| `src/core/backend/api-backend.ts` | MODIFY: `authHeaders()` injects static header when entry carries it |
| `src/cli/commands/add-api.ts` | MODIFY: prompt for / accept `--static-secret`; store on entry |
| `src/cli/commands/auth-ops.ts` | MODIFY: `login` reconciles 3 transition cases per spec §7 |
| `src/cli/index.ts` | MODIFY: add `--static-secret <value>` flag to `add-api` + `login` |
| `src/electron/server.ts` | MODIFY: `POST /api/storage/api-backend` accepts new field |
| `src/electron/public/index.html` | MODIFY: add hidden static-secret row |
| `src/electron/public/app.js` | MODIFY: reveal row when discovery says required; submit value |
| `tests/unit/discovery.test.ts` | MODIFY: +2 cases for new fields |
| `tests/unit/api-backend-blobs.test.ts` | MODIFY: +2 cases (header sent, STATIC_AUTH_FAILED → StaticAuthFailedError) |
| `tests/unit/http-error.test.ts` | MODIFY: +1 case for the new dispatch |

---

## Phase 0 — API: error code + middleware (foundation)

### Task 1: Add `STATIC_AUTH_FAILED` to `ApiErrorCode`

**Files:**
- Modify: `API/src/errors/api-error.ts`
- Modify: `API/test/unit/errors/api-error.test.ts`

- [ ] **Step 1: Failing test**

Append to `API/test/unit/errors/api-error.test.ts`:
```ts
  it('STATIC_AUTH_FAILED is an accepted code', () => {
    const e = new ApiError(401, 'STATIC_AUTH_FAILED', 'bad header');
    expect(e.code).toBe('STATIC_AUTH_FAILED');
    expect(e.status).toBe(401);
  });
```

- [ ] **Step 2: Run, expect TS fail**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/errors/api-error.test.ts
```
Expected: TS error — `'STATIC_AUTH_FAILED'` not assignable to `ApiErrorCode`.

- [ ] **Step 3: Extend the union**

In `API/src/errors/api-error.ts`, change:
```ts
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL'
  | 'STATIC_AUTH_FAILED';
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/errors/api-error.test.ts
```
Expected: 4 PASS (3 prior + 1 new).

- [ ] **Step 5: Pause for user approval, commit**

```bash
cd /Users/thanos/Work/Repos/storage-navigator
git add API/src/errors/api-error.ts API/test/unit/errors/api-error.test.ts
git commit -m "API: add STATIC_AUTH_FAILED ApiErrorCode"
```

---

### Task 2: `staticAuthMiddleware`

**Files:**
- Create: `API/src/auth/static-auth.ts`
- Create: `API/test/unit/static-auth.test.ts`

- [ ] **Step 1: Failing test**

`API/test/unit/static-auth.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { staticAuthMiddleware } from '../../src/auth/static-auth.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

function buildApp(values: string[], headerName = 'X-Storage-Nav-Auth') {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(staticAuthMiddleware(values, headerName));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware());
  return app;
}

describe('staticAuthMiddleware', () => {
  it('passes through when allowedValues is empty (gate disabled)', async () => {
    const r = await request(buildApp([])).get('/x');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('rejects 401 STATIC_AUTH_FAILED when header missing', async () => {
    const r = await request(buildApp(['secret'])).get('/x');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('STATIC_AUTH_FAILED');
  });

  it('rejects 401 when header value wrong', async () => {
    const r = await request(buildApp(['secret']))
      .get('/x').set('X-Storage-Nav-Auth', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('STATIC_AUTH_FAILED');
  });

  it('accepts when header value matches', async () => {
    const r = await request(buildApp(['secret']))
      .get('/x').set('X-Storage-Nav-Auth', 'secret');
    expect(r.status).toBe(200);
  });

  it('accepts any value in the comma-separated list (rotation)', async () => {
    const app = buildApp(['new', 'old']);
    const a = await request(app).get('/x').set('X-Storage-Nav-Auth', 'new');
    const b = await request(app).get('/x').set('X-Storage-Nav-Auth', 'old');
    const c = await request(app).get('/x').set('X-Storage-Nav-Auth', 'other');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(401);
  });

  it('honours configurable header name', async () => {
    const app = buildApp(['secret'], 'X-Api-Key');
    const ok = await request(app).get('/x').set('X-Api-Key', 'secret');
    const wrongHeader = await request(app).get('/x').set('X-Storage-Nav-Auth', 'secret');
    expect(ok.status).toBe(200);
    expect(wrongHeader.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/static-auth.test.ts
```
Expected: module-not-found.

- [ ] **Step 3: Implement**

`API/src/auth/static-auth.ts`:
```ts
import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';

/**
 * Perimeter "API key" gate. When `allowedValues` is empty, the middleware is
 * a pass-through (gate disabled). Otherwise every request must carry the
 * configured header with a value that exactly matches one of the allowed
 * values; mismatches and missing headers return 401 STATIC_AUTH_FAILED.
 *
 * Header name comparison uses Express's case-insensitive `req.header(...)`.
 */
export function staticAuthMiddleware(
  allowedValues: string[],
  headerName: string,
): RequestHandler {
  if (allowedValues.length === 0) {
    return (_req, _res, next) => next();
  }
  const set = new Set(allowedValues);
  return (req, _res, next) => {
    const got = req.header(headerName);
    if (!got || !set.has(got)) {
      return next(new ApiError(401, 'STATIC_AUTH_FAILED', 'Missing or invalid static auth header'));
    }
    next();
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/static-auth.test.ts
```
Expected: 6 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/auth/static-auth.ts API/test/unit/static-auth.test.ts
git commit -m "API: add staticAuthMiddleware (perimeter API-key gate)"
```

---

## Phase 1 — API: config + wire-up + discovery

### Task 3: Config — parse `STATIC_AUTH_HEADER_VALUE` + `STATIC_AUTH_HEADER_NAME`

**Files:**
- Modify: `API/src/config.ts`
- Modify: `API/test/unit/config.test.ts`

- [ ] **Step 1: Failing tests**

Append to `API/test/unit/config.test.ts` (after the existing describe blocks):

```ts
describe('loadConfig — staticAuth', () => {
  const validEnv = {
    AUTH_ENABLED: 'false',
    ANON_ROLE: 'Reader',
  };

  it('defaults to empty values + default header name when env unset', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.staticAuth.values).toEqual([]);
    expect(cfg.staticAuth.headerName).toBe('X-Storage-Nav-Auth');
  });

  it('parses single value', () => {
    const cfg = loadConfig({ ...validEnv, STATIC_AUTH_HEADER_VALUE: 'abc' });
    expect(cfg.staticAuth.values).toEqual(['abc']);
  });

  it('parses comma-separated values, trims whitespace, drops blanks', () => {
    const cfg = loadConfig({ ...validEnv, STATIC_AUTH_HEADER_VALUE: 'a, b , , c' });
    expect(cfg.staticAuth.values).toEqual(['a', 'b', 'c']);
  });

  it('honours STATIC_AUTH_HEADER_NAME override', () => {
    const cfg = loadConfig({ ...validEnv, STATIC_AUTH_HEADER_NAME: 'X-Api-Key' });
    expect(cfg.staticAuth.headerName).toBe('X-Api-Key');
  });
});
```

- [ ] **Step 2: Run, expect fail (no `staticAuth` in Config)**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/config.test.ts
```
Expected: TS / runtime errors on `cfg.staticAuth`.

- [ ] **Step 3: Extend Config schema + loader**

In `API/src/config.ts`:

a) Add to the `ConfigSchema` `z.object({...})`:
```ts
  staticAuth: z.object({
    values: z.array(z.string().min(1)).default([]),
    headerName: z.string().min(1).default('X-Storage-Nav-Auth'),
  }),
```

b) Add a CSV parser (use the existing `csv` helper if it already returns `string[]` from comma-split; otherwise add):
```ts
const csv = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
```

c) In `loadConfig`'s `raw` object, add:
```ts
    staticAuth: {
      values: csv(env.STATIC_AUTH_HEADER_VALUE),
      headerName: env.STATIC_AUTH_HEADER_NAME ?? 'X-Storage-Nav-Auth',
    },
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/config.test.ts
```
Expected: all prior tests + 4 new = 17 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/config.ts API/test/unit/config.test.ts
git commit -m "API: add staticAuth config (STATIC_AUTH_HEADER_VALUE csv + STATIC_AUTH_HEADER_NAME)"
```

---

### Task 4: Wire `staticAuthMiddleware` into `app.ts`

**Files:**
- Modify: `API/src/app.ts`

- [ ] **Step 1: Open `API/src/app.ts`** and find the existing `buildApp(opts)` mount sequence. The current sequence is roughly:

```
requestIdMiddleware
pinoHttp
wellKnownRouter
openapiRouter
healthRouter
auth (oidc OR anonymous)
storagesRouter
... etc
```

- [ ] **Step 2: Add the import + mount**

Add at the top of `app.ts`:
```ts
import { staticAuthMiddleware } from './auth/static-auth.js';
```

Insert the middleware AFTER `healthRouter` and BEFORE the auth middleware. Concretely, locate the line that mounts the auth middleware (e.g. `app.use(buildAuthMiddleware(opts.config))` — name may differ; check the file) and add this line immediately above it:

```ts
  app.use(staticAuthMiddleware(opts.config.staticAuth.values, opts.config.staticAuth.headerName));
```

- [ ] **Step 3: Run the full suite**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run
```
Expected: ALL existing tests still pass (the middleware is a no-op when `STATIC_AUTH_HEADER_VALUE` is unset, which is the default in every existing test).

- [ ] **Step 4: TS-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npm run build
```
Expected: exit 0.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/app.ts
git commit -m "API: mount staticAuthMiddleware between health and auth in app factory"
```

---

### Task 5: Discovery endpoint — advertise `staticAuthHeaderRequired` + `staticAuthHeaderName`

**Files:**
- Modify: `API/src/routes/well-known.ts`
- Modify: `API/test/unit/well-known.test.ts`

- [ ] **Step 1: Failing tests**

Append to `API/test/unit/well-known.test.ts`:

```ts
  it('omits staticAuth fields when gate disabled', async () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    const app = buildApp({ config: cfg, /* discovery, services as in existing tests */ } as never);
    const res = await request(app).get('/.well-known/storage-nav-config');
    expect(res.body.staticAuthHeaderRequired).toBeUndefined();
    expect(res.body.staticAuthHeaderName).toBeUndefined();
  });

  it('includes staticAuthHeaderRequired + staticAuthHeaderName when gate active', async () => {
    const cfg = loadConfig({
      AUTH_ENABLED: 'false', ANON_ROLE: 'Reader',
      STATIC_AUTH_HEADER_VALUE: 'secret',
      STATIC_AUTH_HEADER_NAME: 'X-Api-Key',
    });
    const app = buildApp({ config: cfg, /* services */ } as never);
    const res = await request(app)
      .get('/.well-known/storage-nav-config')
      .set('X-Api-Key', 'secret'); // defensive: not strictly needed, well-known is public, but doesn't hurt
    expect(res.body.staticAuthHeaderRequired).toBe(true);
    expect(res.body.staticAuthHeaderName).toBe('X-Api-Key');
    // Value must NEVER appear:
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
```

> If the existing `well-known.test.ts` constructs `buildApp` with required `discovery`/`blobService`/`fileService` stubs, copy that exact construction from the existing tests in the same file. Do not invent new stubs.

- [ ] **Step 2: Run, expect fail**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/well-known.test.ts
```

- [ ] **Step 3: Update `well-known.ts`**

`API/src/routes/well-known.ts`:
```ts
import { Router } from 'express';
import type { Config } from '../config.js';

export function wellKnownRouter(config: Config): Router {
  const r = Router();
  r.get('/.well-known/storage-nav-config', (_req, res) => {
    const staticActive = config.staticAuth.values.length > 0;
    const staticFields = staticActive
      ? { staticAuthHeaderRequired: true as const, staticAuthHeaderName: config.staticAuth.headerName }
      : {};

    if (config.oidc.mode === 'enabled') {
      res.json({
        authEnabled: true,
        issuer: config.oidc.issuer,
        clientId: config.oidc.clientId,
        audience: config.oidc.audience,
        scopes: config.oidc.scopes,
        ...staticFields,
      });
    } else {
      res.json({ authEnabled: false, ...staticFields });
    }
  });
  return r;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npx vitest run test/unit/well-known.test.ts
```
Expected: prior tests + 2 new pass.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/routes/well-known.ts API/test/unit/well-known.test.ts
git commit -m "API: discovery exposes staticAuthHeaderRequired + staticAuthHeaderName"
```

---

## Phase 2 — Client adapter: types + discovery + ApiBackend

### Task 6: Extend `ApiBackendEntry` with `staticAuthHeader`

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add the optional field**

In `src/core/types.ts`, find the existing `ApiBackendEntry` type and add `staticAuthHeader`:

```ts
export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: OidcConfig;
  /**
   * Operator-supplied perimeter API-key header. When the API has
   * STATIC_AUTH_HEADER_VALUE set, every request must carry this header.
   * Persisted encrypted via CredentialStore (AES-256-GCM).
   */
  staticAuthHeader?: { name: string; value: string };
  addedAt: string;
};
```

- [ ] **Step 2: TS-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: clean. The field is optional — existing `ApiBackendEntry` literals continue to compile.

- [ ] **Step 3: Run unit suite (no behavior change)**

```bash
npm test
```
Expected: all green; no test changes yet.

- [ ] **Step 4: Pause, commit**

```bash
git add src/core/types.ts
git commit -m "client: add ApiBackendEntry.staticAuthHeader optional field"
```

---

### Task 7: Discovery client — parse new fields

**Files:**
- Modify: `src/core/backend/auth/discovery.ts`
- Modify: `tests/unit/discovery.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/discovery.test.ts`:

```ts
  it('parses staticAuthHeaderRequired + staticAuthHeaderName when present', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({
      authEnabled: false,
      staticAuthHeaderRequired: true,
      staticAuthHeaderName: 'X-Storage-Nav-Auth',
    })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.staticAuthHeaderRequired).toBe(true);
    expect(d.staticAuthHeaderName).toBe('X-Storage-Nav-Auth');
  });

  it('defaults staticAuthHeaderRequired to false when fields absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ authEnabled: false })));
    const d = await fetchDiscovery('https://x.example.com');
    expect(d.staticAuthHeaderRequired).toBe(false);
  });
```

- [ ] **Step 2: Run, expect fail**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx vitest run tests/unit/discovery.test.ts
```

- [ ] **Step 3: Extend `DiscoveryResult` and parser**

`src/core/backend/auth/discovery.ts`:

```ts
export type DiscoveryResult = (
  | { authEnabled: false }
  | { authEnabled: true; issuer: string; clientId: string; audience: string; scopes: string[] }
) & {
  staticAuthHeaderRequired: boolean;
  staticAuthHeaderName?: string;
};

export async function fetchDiscovery(baseUrl: string): Promise<DiscoveryResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/.well-known/storage-nav-config`;
  let res: Response;
  try { res = await fetch(url); }
  catch (err) { throw new Error(`Discovery network error for ${url}: ${(err as Error).message}`); }
  if (!res.ok) throw new Error(`Discovery HTTP ${res.status} for ${url}`);
  const body = await res.json() as Record<string, unknown>;

  const staticAuthHeaderRequired = body.staticAuthHeaderRequired === true;
  const staticAuthHeaderName = typeof body.staticAuthHeaderName === 'string'
    ? body.staticAuthHeaderName
    : undefined;
  if (staticAuthHeaderRequired && !staticAuthHeaderName) {
    throw new Error(`Discovery says staticAuthHeaderRequired:true but missing staticAuthHeaderName at ${url}`);
  }

  if (body.authEnabled === false) {
    return { authEnabled: false, staticAuthHeaderRequired, staticAuthHeaderName };
  }
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
      staticAuthHeaderRequired,
      staticAuthHeaderName,
    };
  }
  throw new Error(`Discovery response missing authEnabled flag at ${url}`);
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run tests/unit/discovery.test.ts
```
Expected: all prior + 2 new = 6 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add src/core/backend/auth/discovery.ts tests/unit/discovery.test.ts
git commit -m "client: discovery parser exposes staticAuthHeaderRequired + name"
```

---

### Task 8: `StaticAuthFailedError` + `fromResponseBody` dispatch

**Files:**
- Modify: `src/core/backend/http-error.ts`
- Modify: `tests/unit/http-error.test.ts`

- [ ] **Step 1: Failing test**

Append to `tests/unit/http-error.test.ts`:

```ts
  it('fromResponseBody routes STATIC_AUTH_FAILED to StaticAuthFailedError', () => {
    const e = fromResponseBody(401,
      { error: { code: 'STATIC_AUTH_FAILED', message: 'bad header', correlationId: 'c' } },
      'nbg-dev');
    expect(e).toBeInstanceOf(StaticAuthFailedError);
    expect(e.message).toMatch(/nbg-dev/);
    expect(e.status).toBe(401);
  });
```

Add to the imports at the top of the same file:
```ts
import { ..., StaticAuthFailedError } from '../../src/core/backend/http-error.js';
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run tests/unit/http-error.test.ts
```

- [ ] **Step 3: Add `StaticAuthFailedError` + dispatch**

In `src/core/backend/http-error.ts`:

a) Append the class:
```ts
export class StaticAuthFailedError extends HttpError {
  constructor(apiBackendName: string) {
    super(401, `Static auth header invalid for "${apiBackendName}". Re-register: storage-nav remove --name ${apiBackendName} && storage-nav add-api ...`);
  }
}
```

b) In `fromResponseBody`, before the existing `case 401:` line, add a guard:
```ts
  const errBody = (body as ApiErrorBody | undefined)?.error;
  if (errBody?.code === 'STATIC_AUTH_FAILED') {
    return new StaticAuthFailedError(apiBackendName);
  }
```
(Hoist `errBody` to the top of the function if it isn't already; the existing implementation already destructures the error object.)

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run tests/unit/http-error.test.ts
```
Expected: prior tests + 1 new pass.

- [ ] **Step 5: Pause, commit**

```bash
git add src/core/backend/http-error.ts tests/unit/http-error.test.ts
git commit -m "client: add StaticAuthFailedError + fromResponseBody dispatch"
```

---

### Task 9: `ApiBackend.authHeaders()` injects static header

**Files:**
- Modify: `src/core/backend/api-backend.ts`
- Modify: `tests/unit/api-backend-blobs.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/api-backend-blobs.test.ts`:

```ts
  it('sends staticAuthHeader on every request when entry has it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [], continuationToken: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const e: ApiBackendEntry = {
      ...entry,
      staticAuthHeader: { name: 'X-Storage-Nav-Auth', value: 'sekret' },
    };
    const b = new ApiBackend(e, acct);
    await b.listContainers();
    const init = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
    expect((init.headers as Record<string, string>)['X-Storage-Nav-Auth']).toBe('sekret');
  });

  it('throws StaticAuthFailedError on 401 with STATIC_AUTH_FAILED code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'STATIC_AUTH_FAILED', message: 'bad', correlationId: 'c' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    await expect(b.listContainers()).rejects.toThrow(/Re-register/);
  });
```

- [ ] **Step 2: Run, expect fail (header not sent)**

```bash
npx vitest run tests/unit/api-backend-blobs.test.ts
```

- [ ] **Step 3: Update `authHeaders()`**

In `src/core/backend/api-backend.ts`, find the existing `authHeaders()` method and replace its body:

```ts
  private async authHeaders(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (this.entry.staticAuthHeader) {
      out[this.entry.staticAuthHeader.name] = this.entry.staticAuthHeader.value;
    }
    if (!this.entry.authEnabled) return out;
    if (!this.entry.oidc) throw new NeedsLoginError(this.entry.name);
    let t = await this.tokens.load(this.entry.name);
    if (!t) throw new NeedsLoginError(this.entry.name);
    if (t.expiresAt < Date.now() + 60_000) {
      t = await refreshTokens(this.entry.name, this.entry.oidc, t);
    }
    out.Authorization = `Bearer ${t.accessToken}`;
    return out;
  }
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run tests/unit/api-backend-blobs.test.ts
```
Expected: prior 5 + 2 new = 7 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add src/core/backend/api-backend.ts tests/unit/api-backend-blobs.test.ts
git commit -m "client: ApiBackend injects staticAuthHeader on every request"
```

---

## Phase 3 — Client UX: CLI + Electron UI

### Task 10: CLI `add-api` prompt + `--static-secret` flag

**Files:**
- Modify: `src/cli/commands/add-api.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Inspect the existing CLI prompt mechanism**

Read `src/cli/commands/shared.ts` (or wherever existing hidden prompts live, e.g. `promptSecret` if present). Use that same mechanism in `add-api.ts`. If no hidden-input prompt exists yet, fall back to using `node:readline` directly with `process.stdin.setRawMode(true)` for hidden input.

- [ ] **Step 2: Update `add-api.ts`**

Replace the body of `addApi(name, baseUrl)` with (preserving the existing structure, only adding the static-secret branch):

```ts
import { CredentialStore } from '../../core/credential-store.js';
import type { ApiBackendEntry } from '../../core/types.js';
import { fetchDiscovery } from '../../core/backend/auth/discovery.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';

export async function addApi(name: string, baseUrl: string, opts: { staticSecret?: string } = {}): Promise<void> {
  const store = new CredentialStore();
  if (store.getStorage(name)) {
    console.error(`Storage with name "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`Probing ${baseUrl} ...`);
  const discovery = await fetchDiscovery(baseUrl);
  console.log(`  authEnabled = ${discovery.authEnabled}`);
  if (discovery.staticAuthHeaderRequired) {
    console.log(`  staticAuthHeaderRequired = true (header: ${discovery.staticAuthHeaderName})`);
  }

  let staticAuthHeader: { name: string; value: string } | undefined;
  if (discovery.staticAuthHeaderRequired) {
    const headerName = discovery.staticAuthHeaderName!;
    const value = opts.staticSecret ?? await promptHidden(`Enter ${headerName} value: `);
    if (!value) {
      console.error(`A value for ${headerName} is required.`);
      process.exit(1);
    }
    staticAuthHeader = { name: headerName, value };
  }

  const entry: Omit<ApiBackendEntry, 'addedAt'> = {
    kind: 'api',
    name,
    baseUrl,
    authEnabled: discovery.authEnabled,
    oidc: discovery.authEnabled
      ? { issuer: discovery.issuer, clientId: discovery.clientId, audience: discovery.audience, scopes: discovery.scopes }
      : undefined,
    staticAuthHeader,
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
  console.log(`Added api backend "${name}" → ${baseUrl}`);
}

async function promptHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const buf: string[] = [];
    const onData = (chunk: Buffer): void => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(buf.join(''));
          return;
        }
        if (ch === '') { // Ctrl+C
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '' || ch === '\b') { // backspace
          buf.pop();
          continue;
        }
        buf.push(ch);
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
```

- [ ] **Step 3: Add `--static-secret` flag in `src/cli/index.ts`**

Find the existing `add-api` command registration and add the option + pass it through:

```ts
program
  .command('add-api')
  .description('Register a Storage Navigator API as a backend')
  .requiredOption('--name <name>', 'Display name')
  .requiredOption('--base-url <url>', 'API base URL (e.g. https://your-api.azurewebsites.net)')
  .option('--static-secret <value>', 'Value for the static auth header (use when API requires it; CLI prompts otherwise)')
  .action(async (opts) => {
    await addApi(opts.name, opts.baseUrl, { staticSecret: opts.staticSecret });
  });
```

- [ ] **Step 4: TS-check**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Smoke against deployed API (manual; gate is currently disabled there, so prompt shouldn't fire)**

```bash
npx tsx src/cli/index.ts remove --name dev || true
npx tsx src/cli/index.ts add-api --name dev \
  --base-url https://nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
# expect: probe → authEnabled=false, no static prompt → "Added api backend dev"
```

- [ ] **Step 6: Pause, commit**

```bash
git add src/cli/commands/add-api.ts src/cli/index.ts
git commit -m "client: CLI add-api prompts for / accepts --static-secret; persists on entry"
```

---

### Task 11: CLI `login` reconciliation per spec §7

**Files:**
- Modify: `src/cli/commands/auth-ops.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update `login`**

Replace the body of `login(name, opts)` in `src/cli/commands/auth-ops.ts` to match spec §7:

```ts
import { CredentialStore } from '../../core/credential-store.js';
import { fetchDiscovery } from '../../core/backend/auth/discovery.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';

export async function login(name: string, opts: { staticSecret?: string } = {}): Promise<void> {
  const store = new CredentialStore();
  const entry = store.getStorage(name);
  if (!entry || entry.kind !== 'api') {
    console.error(`No api backend named "${name}".`);
    process.exit(1);
  }

  // Re-probe discovery so we reconcile any operator-side changes (gate added/removed).
  const discovery = await fetchDiscovery(entry.baseUrl);

  // Static-header reconciliation
  let staticAuthHeader = entry.staticAuthHeader;
  if (discovery.staticAuthHeaderRequired) {
    const headerName = discovery.staticAuthHeaderName!;
    if (opts.staticSecret) {
      // Operator passed a new value (rotation case)
      staticAuthHeader = { name: headerName, value: opts.staticSecret };
    } else if (!staticAuthHeader) {
      // Gate was added after registration — prompt
      const value = await promptHidden(`Enter ${headerName} value: `);
      if (!value) { console.error(`A value for ${headerName} is required.`); process.exit(1); }
      staticAuthHeader = { name: headerName, value };
    } else if (staticAuthHeader.name !== headerName) {
      // Header NAME changed; preserve value but update name
      staticAuthHeader = { name: headerName, value: staticAuthHeader.value };
    }
  } else if (entry.staticAuthHeader) {
    console.log(`Note: API no longer requires a static header. The stored value is harmless but unused; remove + re-add to clear it.`);
  }

  // Persist any change to staticAuthHeader before OIDC step
  if (staticAuthHeader !== entry.staticAuthHeader) {
    store.removeStorage(name);
    store.addStorage({ ...entry, staticAuthHeader });
  }

  if (!discovery.authEnabled) {
    console.log(`API "${name}" is auth-off; nothing to log in to. Static header (if any) preserved.`);
    return;
  }
  if (!entry.oidc) {
    console.error(`Api backend "${name}" lacks oidc config but discovery says authEnabled=true. Re-register.`);
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

// Same helper as add-api.ts — extract to shared.ts in a follow-up if it grows further.
async function promptHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const buf: string[] = [];
    const onData = (chunk: Buffer): void => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(buf.join(''));
          return;
        }
        if (ch === '') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '' || ch === '\b') { buf.pop(); continue; }
        buf.push(ch);
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
```

- [ ] **Step 2: Add `--static-secret` flag to `login` in `src/cli/index.ts`**

```ts
program.command('login')
  .description('Re-run OIDC login + reconcile static-header for an existing api backend')
  .requiredOption('--name <name>', 'API backend name')
  .option('--static-secret <value>', 'New static-header value (e.g. after rotation)')
  .action(async (opts) => { await login(opts.name, { staticSecret: opts.staticSecret }); });
```

- [ ] **Step 3: TS-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Pause, commit**

```bash
git add src/cli/commands/auth-ops.ts src/cli/index.ts
git commit -m "client: login reconciles static-header (added/rotated/removed) + accepts --static-secret"
```

---

### Task 12: Electron embedded server — `POST /api/storage/api-backend` accepts `staticAuthHeader`

**Files:**
- Modify: `src/electron/server.ts`

- [ ] **Step 1: Update the POST handler**

Find the existing `app.post("/api/storage/api-backend", ...)` block in `src/electron/server.ts`. Replace its body destructure with:

```ts
  app.post("/api/storage/api-backend", express.json(), (req, res, next) => {
    try {
      const { name, baseUrl, authEnabled, oidc, staticAuthHeader } = req.body as {
        name: string; baseUrl: string; authEnabled: boolean;
        oidc?: { issuer: string; clientId: string; audience: string; scopes: string[] };
        staticAuthHeader?: { name: string; value: string };
      };
      if (!name || !baseUrl || authEnabled === undefined) {
        res.status(400).json({ error: { message: "name, baseUrl, and authEnabled are required" } });
        return;
      }
      const store = new CredentialStore();
      if (store.getStorage(name)) {
        res.status(409).json({ error: { message: `Storage "${name}" already exists` } });
        return;
      }
      const entry: Omit<ApiBackendEntry, 'addedAt'> = {
        kind: 'api', name, baseUrl, authEnabled, oidc, staticAuthHeader,
      };
      store.addStorage(entry);
      res.status(201).json({ name });
    } catch (err) { next(err); }
  });
```

(`staticAuthHeader` is optional; absent body fields preserve today's behavior.)

- [ ] **Step 2: TS-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Pause, commit**

```bash
git add src/electron/server.ts
git commit -m "client: server.ts POST /api/storage/api-backend accepts staticAuthHeader"
```

---

### Task 13: Electron UI — reveal password row when discovery says required

**Files:**
- Modify: `src/electron/public/index.html`
- Modify: `src/electron/public/app.js`

- [ ] **Step 1: Update `index.html`**

Find the existing api-backend tab body (the `<div data-tab="api">` block, contains `#api-name` and `#api-url`). Add a hidden row immediately before the buttons:

```html
<div id="api-static-secret-row" hidden>
  <label>
    <span id="api-static-label">X-Storage-Nav-Auth</span>
    <input id="api-static-secret" type="password" autocomplete="off" />
  </label>
</div>
```

- [ ] **Step 2: Update `app.js`**

Find the `#api-add-btn` click handler. Around the discovery probe step, add:

```js
const probeRes = await fetch(`/api/discovery?url=${encodeURIComponent(baseUrl)}`);
if (!probeRes.ok) { apiStatus.textContent = `Probe failed: HTTP ${probeRes.status}`; return; }
const probe = await probeRes.json();

// Static-header gate
let staticAuthHeader;
if (probe.staticAuthHeaderRequired) {
  const headerName = probe.staticAuthHeaderName || 'X-Storage-Nav-Auth';
  const row = document.getElementById('api-static-secret-row');
  document.getElementById('api-static-label').textContent = headerName;
  row.hidden = false;
  const valueEl = document.getElementById('api-static-secret');
  const value = (valueEl.value || '').trim();
  if (!value) {
    apiStatus.textContent = `${headerName} is required — enter the value above and click Connect again.`;
    valueEl.focus();
    return;
  }
  staticAuthHeader = { name: headerName, value };
}

// ... (existing OIDC branch unchanged) ...

const res = await fetch("/api/storage/api-backend", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name, baseUrl,
    authEnabled: probe.authEnabled,
    oidc: probe.authEnabled
      ? { issuer: probe.issuer, clientId: probe.clientId, audience: probe.audience, scopes: probe.scopes }
      : undefined,
    staticAuthHeader,
  }),
});
```

(Preserve existing OIDC handling between the gate block and the POST.)

Also: when the dialog opens (or the api tab is activated), reset the state:
```js
function resetApiStaticRow() {
  const row = document.getElementById('api-static-secret-row');
  const valueEl = document.getElementById('api-static-secret');
  if (row) row.hidden = true;
  if (valueEl) valueEl.value = '';
}
```
Call `resetApiStaticRow()` from wherever the modal/tab is shown.

- [ ] **Step 3: Lint check**

```bash
node --check src/electron/public/app.js
```
Expected: no syntax errors.

- [ ] **Step 4: Smoke (gate disabled — row should stay hidden)**

```bash
npx tsx src/cli/index.ts ui --port 3499 &
PID=$!
sleep 5
echo "--- discovery proxy (gate disabled) ---"
curl -s "http://localhost:3499/api/discovery?url=https%3A%2F%2Fnbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net"
kill $PID 2>/dev/null; wait $PID 2>/dev/null
```
Expected: `staticAuthHeaderRequired` either absent or `false`.

- [ ] **Step 5: Pause, commit**

```bash
git add src/electron/public/index.html src/electron/public/app.js
git commit -m "client: Electron Add Storage reveals static-secret input when discovery requires it"
```

---

## Phase 4 — Documentation + final verification

### Task 14: Update CLAUDE.md tools block + project docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/design/project-functions.md`

- [ ] **Step 1: Extend the `<storage-nav>` tool block**

In the existing `<storage-nav>` `<info>` body, append under the `add-api` command spec:

```
            --static-secret <value>  Value for the static auth header (when API requires it).
                                      CLI prompts hidden if omitted and discovery says it's required.

          login        ... (existing)
            --static-secret <value>  New static header value (e.g. after rotation)
```

Also extend the `<storage-nav-api>` tool block's env-var list (the `<info>` body that lists `AUTH_ENABLED`, `OIDC_*`, etc.) with:

```
        STATIC_AUTH_HEADER_VALUE   When set, every protected route requires this header
                                   value. Comma-separated list = zero-downtime rotation.
                                   Typically referenced from Key Vault:
                                   @Microsoft.KeyVault(VaultName=...;SecretName=...)
        STATIC_AUTH_HEADER_NAME    Header name (default: X-Storage-Nav-Auth)
```

- [ ] **Step 2: Append section to `docs/design/project-functions.md`**

```markdown
## Static auth header (Plan 008)

- API has an opt-in perimeter API-key gate via `STATIC_AUTH_HEADER_VALUE`.
- Independent of OIDC: when both are configured, every request needs the header AND a valid Bearer JWT.
- Header NAME is operator-configurable (`STATIC_AUTH_HEADER_NAME`, default `X-Storage-Nav-Auth`).
- Comma-separated values for zero-downtime rotation.
- Discovery exposes `staticAuthHeaderRequired` + `staticAuthHeaderName` (never the value).
- `/.well-known/*`, `/healthz`, `/readyz`, `/openapi.yaml`, `/docs` remain public.
- Client persists the value on `ApiBackendEntry.staticAuthHeader` (encrypted via the existing credential store) and sends it on every request.
- CLI: `add-api --static-secret <v>` or hidden interactive prompt; `login --static-secret <v>` for rotation.
- Electron UI: Add Storage tab reveals a password input when the API requires it.
```

- [ ] **Step 3: Pause, commit**

```bash
git add CLAUDE.md docs/design/project-functions.md
git commit -m "docs: register static auth header in CLAUDE.md and project-functions"
```

---

### Task 15: Final verification

> Verification-only — no source changes, no commit.

- [ ] **Step 1: Full test suite (root + API)**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npm test
cd /Users/thanos/Work/Repos/storage-navigator/API && npm test
```
Expected: all green; counts include the new tests added by Tasks 1, 2, 3, 5, 7, 8, 9.

- [ ] **Step 2: TS build clean (both)**

```bash
cd /Users/thanos/Work/Repos/storage-navigator && npx tsc --noEmit
cd /Users/thanos/Work/Repos/storage-navigator/API && npm run build
```

- [ ] **Step 3: OpenAPI lint**

```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npm run lint:openapi
```
Expected: 0 errors.

- [ ] **Step 4: Live smoke against deployed API (gate currently DISABLED — verify backwards compat)**

```bash
HOST=nbg-webapp-storage-nav-api-we-dev-01.azurewebsites.net
echo "--- discovery (no staticAuth fields expected) ---"
curl -s https://$HOST/.well-known/storage-nav-config | python3 -m json.tool
echo "--- /storages still works without header ---"
curl -sw "\n%{http_code}\n" https://$HOST/storages | head -3
```
Expected: discovery omits the new fields; `/storages` returns 200 + accounts.

- [ ] **Step 5: Acceptance walkthrough**

Read Section 10 of `docs/design/plan-008-static-auth-header.md`. Produce a table mapping each criterion → satisfying test/file/step.

- [ ] **Step 6: No commit — verification only.**

---

## Self-review

| Spec section | Plan task |
|---|---|
| §1 Overview, §2 Goals, §3 Non-goals | All tasks; non-goals documented in spec, not implemented |
| §4 Architecture (matrix + mount order) | Task 4 (mount), Tasks 1+2 (middleware) |
| §5 API config | Task 3 |
| §6 Discovery shape | Task 5 |
| §7 Client adapter (types, ApiBackend, CLI add-api, CLI login, Electron UI) | Tasks 6, 9, 10, 11, 12, 13; types in 6; ApiBackend in 9; CLI in 10+11; UI in 12+13 |
| §8 Key Vault wiring | Operator runbook in spec; no impl task (deployment-only) |
| §9 Tests | Tasks 2, 3, 5, 7, 8, 9 each include test cases |
| §10 Acceptance criteria | Task 15 walkthrough |
| §11 Out-of-scope follow-ups | Not in this plan (by design) |

Placeholder scan: every task has concrete code blocks + file paths. No "TBD"/"TODO" steps.

Type consistency: `staticAuthHeader: { name: string; value: string }` defined in Task 6 and reused unchanged in Tasks 9, 10, 11, 12, 13. `STATIC_AUTH_FAILED` literal defined in Task 1 and used in Tasks 2, 8.

---

## Execution handoff

Plan complete and saved to `docs/design/plan-008-static-auth-header-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Same pattern that shipped Plans 006 + 007.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batched checkpoints.

Which approach?
