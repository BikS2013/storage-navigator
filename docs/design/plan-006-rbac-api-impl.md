# Storage Navigator RBAC API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Project rule:** Per `CLAUDE.md`, no git operation may be performed without explicit user approval. Each task ends with a "commit" step — Claude executing this plan must pause and ask the user before running it.

**Goal:** Build the `API/` service described in `docs/design/plan-006-rbac-api.md` (spec) — a Node/TS HTTP API that brokers Azure Blob + Azure Files access behind toggleable OIDC authentication and three global roles (`StorageReader`, `StorageWriter`, `StorageAdmin`).

**Architecture:** Express app, `@azure/identity` `DefaultAzureCredential` for outbound Azure auth (Managed Identity in App Service, `az login` locally), `jose` for inbound JWT validation against NBG IdentityServer JWKS, `@azure/arm-storage` for storage account discovery, `@azure/storage-blob` and `@azure/storage-file-share` for data plane. Streaming reads/writes use Node `pipeline()`. Tests are vitest unit (mocked services) + integration (Azurite + a local mock JWKS server signing test JWTs).

**Tech Stack:** Node 22, TypeScript 5+, Express 5, zod, jose, pino, prom-client, @azure/identity, @azure/arm-storage, @azure/storage-blob, @azure/storage-file-share, vitest, @redocly/cli, Azurite (test only).

**Out of scope (future plan):** Spec Section 11 — Storage Navigator client adapter (`src/core/backend/`). Will be implemented after this plan ships.

---

## File map

The implementation lives entirely under `API/` (new directory at repo root). No code in `src/` is modified.

| Path | Responsibility |
|---|---|
| `API/package.json` | Own deps + scripts |
| `API/tsconfig.json` | strict TS, NodeNext modules, `dist/` output |
| `API/.gitignore` | `dist/`, `node_modules/`, `.env` |
| `API/.env.example` | Documented env vars |
| `API/Dockerfile` | Multi-stage Node 22 alpine |
| `API/docker-compose.dev.yml` | Local Azurite + mock IdP for dev/integration tests |
| `API/openapi.yaml` | OpenAPI 3.1 contract (hand-authored) |
| `API/README.md` | Quickstart + env var reference |
| `API/src/index.ts` | Process entrypoint: load config, build app, listen |
| `API/src/app.ts` | Express app factory (returns `Express` for tests) |
| `API/src/config.ts` | zod-validated env loader |
| `API/src/auth/oidc-middleware.ts` | JWT verification middleware |
| `API/src/auth/jwks-cache.ts` | Remote JWKS cache wrapper around `jose` `createRemoteJWKSet` |
| `API/src/auth/role-mapper.ts` | NBG role claim → app role set |
| `API/src/auth/auth-toggle.ts` | Disabled-mode synthetic principal middleware |
| `API/src/rbac/permissions.ts` | Role → allowed verb matrix constant |
| `API/src/rbac/enforce.ts` | `requireRole(role)` express middleware factory |
| `API/src/azure/credential.ts` | `DefaultAzureCredential` singleton |
| `API/src/azure/account-discovery.ts` | ARM scan + cache + allowlist filter |
| `API/src/azure/blob-service.ts` | `@azure/storage-blob` wrapper |
| `API/src/azure/file-service.ts` | `@azure/storage-file-share` wrapper |
| `API/src/routes/well-known.ts` | `/.well-known/storage-nav-config` |
| `API/src/routes/health.ts` | `/healthz`, `/readyz` |
| `API/src/routes/storages.ts` | `GET /storages` |
| `API/src/routes/containers.ts` | `/storages/{a}/containers[/{c}]` |
| `API/src/routes/blobs.ts` | `/storages/{a}/containers/{c}/blobs[/{path}]` |
| `API/src/routes/shares.ts` | `/storages/{a}/shares[/{s}]` |
| `API/src/routes/files.ts` | `/storages/{a}/shares/{s}/files[/{path}]` |
| `API/src/routes/openapi.ts` | `/openapi.yaml` + `/docs` |
| `API/src/errors/api-error.ts` | `ApiError` class |
| `API/src/errors/error-middleware.ts` | Final express error handler |
| `API/src/errors/azure-error-mapper.ts` | `RestError` → `ApiError` |
| `API/src/streaming/proxy.ts` | `pipeline(downloadStream, res)` helper |
| `API/src/observability/logger.ts` | pino instance |
| `API/src/observability/request-id.ts` | `X-Request-Id` middleware |
| `API/src/types/express.d.ts` | Ambient `Request.requestId` augmentation |
| `API/src/observability/metrics.ts` | prom-client (optional, env-gated) |
| `API/src/util/pagination.ts` | `{items, continuationToken}` helpers |
| `API/src/util/abort.ts` | `req` close → `AbortSignal` |
| `API/test/unit/**` | vitest unit tests |
| `API/test/integration/**` | vitest integration tests (Azurite + mock IdP) |
| `API/test/helpers/mock-idp.ts` | Local JWKS server signing test JWTs (`jose`) |
| `API/test/helpers/azurite.ts` | Programmatic Azurite start/stop helpers |
| `API/test/helpers/test-app.ts` | Build `Express` app for supertest |

---

## Phase 0 — Bootstrap

### Task 1: Create API/ skeleton

**Files:**
- Create: `API/package.json`
- Create: `API/tsconfig.json`
- Create: `API/.gitignore`
- Create: `API/.env.example`
- Create: `API/README.md`

- [ ] **Step 1: Create `API/` directory + files**

```bash
mkdir -p /Users/thanos/Work/Repos/storage-navigator/API/src \
         /Users/thanos/Work/Repos/storage-navigator/API/test/unit \
         /Users/thanos/Work/Repos/storage-navigator/API/test/integration \
         /Users/thanos/Work/Repos/storage-navigator/API/test/helpers
```

- [ ] **Step 2: Write `API/package.json`**

```json
{
  "name": "storage-navigator-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "lint:openapi": "redocly lint openapi.yaml",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@azure/arm-storage": "^19.1.0",
    "@azure/identity": "^4.5.0",
    "@azure/storage-blob": "^12.31.0",
    "@azure/storage-file-share": "^12.30.0",
    "express": "^5.2.1",
    "jose": "^6.2.0",
    "pino": "^10.0.0",
    "pino-http": "^11.0.0",
    "prom-client": "^15.1.3",
    "swagger-ui-express": "^5.0.1",
    "uuid": "^11.1.0",
    "yaml": "^2.7.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@redocly/cli": "^1.27.0",
    "@types/express": "^5.0.6",
    "@types/node": "^22.19.0",
    "@types/swagger-ui-express": "^4.1.7",
    "supertest": "^7.1.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 3: Write `API/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Write `API/.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
coverage/
.vitest/
```

- [ ] **Step 5: Write `API/.env.example`**

```
# --- Required ---
AUTH_ENABLED=true

# Required when AUTH_ENABLED=true
OIDC_ISSUER=https://my.nbg.gr/identity
OIDC_AUDIENCE=storage-nav-api
OIDC_CLIENT_ID=replace-me
OIDC_SCOPES=openid,role,storage-nav-api
ROLE_MAP={"StorageReader":"Reader","StorageWriter":"Writer","StorageAdmin":"Admin"}

# Required when AUTH_ENABLED=false
# ANON_ROLE=Reader

# --- Optional ---
PORT=3000
LOG_LEVEL=info
OIDC_JWKS_CACHE_MIN=10
OIDC_CLOCK_TOLERANCE_SEC=30
ROLE_CLAIM=role
AZURE_SUBSCRIPTIONS=
ALLOWED_ACCOUNTS=
DISCOVERY_REFRESH_MIN=15
DEFAULT_PAGE_SIZE=200
MAX_PAGE_SIZE=1000
UPLOAD_MAX_BYTES=
STREAM_BLOCK_SIZE_MB=8
SWAGGER_UI_ENABLED=true
CORS_ORIGINS=
APPINSIGHTS_CONNECTION_STRING=
```

- [ ] **Step 6: Write `API/README.md` (quickstart only — full docs land in Task 27)**

```markdown
# Storage Navigator API

See `docs/design/plan-006-rbac-api.md` for the full design.

## Quickstart (local)

1. `cp .env.example .env` and fill in required values (or set `AUTH_ENABLED=false` + `ANON_ROLE=Reader` for unauthenticated dev).
2. `npm install`
3. `npm run dev`
4. `curl http://localhost:3000/healthz`
```

- [ ] **Step 7: Pause for user approval, then commit**

Suggested:
```bash
git add API/
git commit -m "API: bootstrap package, tsconfig, env template"
```

---

### Task 2: Install deps and verify TS compiles

**Files:**
- Create: `API/src/index.ts` (stub)

- [ ] **Step 1: Install deps**

Run from `API/`:
```bash
cd /Users/thanos/Work/Repos/storage-navigator/API && npm install
```
Expected: lockfile created, no errors.

- [ ] **Step 2: Write stub `API/src/index.ts`**

```ts
console.log('storage-navigator-api boot stub');
```

- [ ] **Step 3: Verify build**

Run from `API/`:
```bash
npm run build
```
Expected: `dist/index.js` exists.

- [ ] **Step 4: Verify run**

```bash
npm start
```
Expected: prints `storage-navigator-api boot stub`, exits 0.

- [ ] **Step 5: Pause for user approval, commit**

```bash
git add API/package-lock.json API/src/index.ts
git commit -m "API: add stub entrypoint, verify build chain"
```

---

## Phase 1 — Configuration

### Task 3: zod-validated config (auth-enabled mode)

**Files:**
- Create: `API/src/config.ts`
- Create: `API/test/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

`API/test/unit/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig — auth enabled', () => {
  const validEnv = {
    AUTH_ENABLED: 'true',
    OIDC_ISSUER: 'https://my.nbg.gr/identity',
    OIDC_AUDIENCE: 'storage-nav-api',
    OIDC_CLIENT_ID: 'cid',
    OIDC_SCOPES: 'openid,role,storage-nav-api',
    ROLE_MAP: '{"StorageReader":"Reader","StorageWriter":"Writer"}',
  };

  it('parses required vars', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.authEnabled).toBe(true);
    expect(cfg.port).toBe(3000);
    expect(cfg.oidc.mode).toBe('enabled');
    if (cfg.oidc.mode !== 'enabled') throw new Error('discriminator');
    expect(cfg.oidc.issuer).toBe('https://my.nbg.gr/identity');
    expect(cfg.oidc.audience).toBe('storage-nav-api');
    expect(cfg.oidc.scopes).toEqual(['openid', 'role', 'storage-nav-api']);
    expect(cfg.oidc.roleMap).toEqual({
      StorageReader: 'Reader',
      StorageWriter: 'Writer',
    });
  });

  it('throws on missing OIDC_ISSUER', () => {
    const env = { ...validEnv, OIDC_ISSUER: undefined };
    expect(() => loadConfig(env as any)).toThrow(/OIDC_ISSUER/);
  });

  it('throws on invalid ROLE_MAP value', () => {
    const env = { ...validEnv, ROLE_MAP: '{"X":"Bogus"}' };
    expect(() => loadConfig(env)).toThrow();
  });

  it('throws with friendly error when ROLE_MAP is malformed JSON', () => {
    const env = { ...validEnv, ROLE_MAP: 'not-json' };
    expect(() => loadConfig(env)).toThrow(/ROLE_MAP is not valid JSON/);
  });

  it('throws when OIDC_ISSUER is not a URL', () => {
    const env = { ...validEnv, OIDC_ISSUER: 'not-a-url' };
    expect(() => loadConfig(env)).toThrow();
  });

  it('honors PORT override', () => {
    const cfg = loadConfig({ ...validEnv, PORT: '4040' });
    expect(cfg.port).toBe(4040);
  });

  it('rejects negative PORT with named error', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '-1' }))
      .toThrow(/PORT must be a positive integer/);
  });

  it('accepts OIDC_CLOCK_TOLERANCE_SEC=0', () => {
    const cfg = loadConfig({ ...validEnv, OIDC_CLOCK_TOLERANCE_SEC: '0' });
    if (cfg.oidc.mode !== 'enabled') throw new Error('discriminator');
    expect(cfg.oidc.clockToleranceSec).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd API && npx vitest run test/unit/config.test.ts
```
Expected: FAIL — module `../../src/config.js` not found.

- [ ] **Step 3: Implement `API/src/config.ts`**

```ts
import { z } from 'zod';

const RoleEnum = z.enum(['Reader', 'Writer', 'Admin']);

const EnabledOidc = z.object({
  mode: z.literal('enabled'),
  issuer: z.string().url(),
  audience: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  jwksCacheMin: z.number().int().positive().default(10),
  clockToleranceSec: z.number().int().nonnegative().default(30),
  roleClaim: z.string().min(1).default('role'),
  roleMap: z.record(z.string().min(1), RoleEnum),
});

const DisabledOidc = z.object({
  mode: z.literal('disabled'),
  anonRole: RoleEnum,
});

const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  logLevel: z.string().default('info'),
  authEnabled: z.boolean(),
  oidc: z.discriminatedUnion('mode', [EnabledOidc, DisabledOidc]),
  azure: z.object({
    subscriptions: z.array(z.string()).default([]),
    allowedAccounts: z.array(z.string()).default([]),
    discoveryRefreshMin: z.number().int().positive().default(15),
  }),
  pagination: z.object({
    defaultPageSize: z.number().int().positive().default(200),
    maxPageSize: z.number().int().positive().default(1000),
  }),
  uploads: z.object({
    maxBytes: z.number().int().positive().nullable().default(null),
    streamBlockSizeMb: z.number().int().positive().default(8),
  }),
  swaggerUiEnabled: z.boolean().default(true),
  corsOrigins: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

const csv = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

const positiveIntOrDefault = (name: string, v: string | undefined, d: number): number => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got '${v}'`);
  }
  return n;
};

const nonNegativeIntOrDefault = (name: string, v: string | undefined, d: number): number => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got '${v}'`);
  }
  return n;
};

const parseBool = (name: string, v: string): boolean => {
  const low = v.toLowerCase();
  if (low === 'true') return true;
  if (low === 'false') return false;
  throw new Error(`${name} must be 'true' or 'false', got '${v}'`);
};

const parseJsonObject = (name: string, v: string): unknown => {
  try {
    return JSON.parse(v);
  } catch (err) {
    throw new Error(`${name} is not valid JSON: ${(err as Error).message}`);
  }
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (v === undefined || v === '') {
      throw new Error(`Missing required env var: ${name}`);
    }
    return v;
  };

  const authEnabled = parseBool('AUTH_ENABLED', required('AUTH_ENABLED'));

  const oidc =
    authEnabled
      ? {
          mode: 'enabled' as const,
          issuer: required('OIDC_ISSUER'),
          audience: required('OIDC_AUDIENCE'),
          clientId: required('OIDC_CLIENT_ID'),
          scopes: csv(required('OIDC_SCOPES')),
          jwksCacheMin: positiveIntOrDefault('OIDC_JWKS_CACHE_MIN', env.OIDC_JWKS_CACHE_MIN, 10),
          clockToleranceSec: nonNegativeIntOrDefault('OIDC_CLOCK_TOLERANCE_SEC', env.OIDC_CLOCK_TOLERANCE_SEC, 30),
          roleClaim: env.ROLE_CLAIM ?? 'role',
          roleMap: parseJsonObject('ROLE_MAP', required('ROLE_MAP')),
        }
      : {
          mode: 'disabled' as const,
          anonRole: required('ANON_ROLE'),
        };

  const raw = {
    port: positiveIntOrDefault('PORT', env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    authEnabled,
    oidc,
    azure: {
      subscriptions: csv(env.AZURE_SUBSCRIPTIONS),
      allowedAccounts: csv(env.ALLOWED_ACCOUNTS),
      discoveryRefreshMin: positiveIntOrDefault('DISCOVERY_REFRESH_MIN', env.DISCOVERY_REFRESH_MIN, 15),
    },
    pagination: {
      defaultPageSize: positiveIntOrDefault('DEFAULT_PAGE_SIZE', env.DEFAULT_PAGE_SIZE, 200),
      maxPageSize: positiveIntOrDefault('MAX_PAGE_SIZE', env.MAX_PAGE_SIZE, 1000),
    },
    uploads: {
      maxBytes:
        env.UPLOAD_MAX_BYTES === undefined || env.UPLOAD_MAX_BYTES === ''
          ? null
          : positiveIntOrDefault('UPLOAD_MAX_BYTES', env.UPLOAD_MAX_BYTES, 0),
      streamBlockSizeMb: positiveIntOrDefault('STREAM_BLOCK_SIZE_MB', env.STREAM_BLOCK_SIZE_MB, 8),
    },
    swaggerUiEnabled:
      env.SWAGGER_UI_ENABLED === undefined || env.SWAGGER_UI_ENABLED === ''
        ? true
        : parseBool('SWAGGER_UI_ENABLED', env.SWAGGER_UI_ENABLED),
    corsOrigins: csv(env.CORS_ORIGINS),
  };

  return ConfigSchema.parse(raw);
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd API && npx vitest run test/unit/config.test.ts
```
Expected: 4 PASS.

- [ ] **Step 5: Add disabled-mode test cases (extend the same test file)**

Append to `config.test.ts`:
```ts
describe('loadConfig — auth disabled', () => {
  it('parses ANON_ROLE', () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    expect(cfg.authEnabled).toBe(false);
    expect(cfg.oidc.mode).toBe('disabled');
    if (cfg.oidc.mode !== 'disabled') throw new Error('discriminator');
    expect(cfg.oidc.anonRole).toBe('Reader');
  });

  it('throws on missing ANON_ROLE when auth disabled', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'false' })).toThrow(/ANON_ROLE/);
  });

  it('throws on invalid ANON_ROLE', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'God' }))
      .toThrow();
  });

  it('throws when AUTH_ENABLED missing entirely', () => {
    expect(() => loadConfig({})).toThrow(/AUTH_ENABLED/);
  });

  it('rejects AUTH_ENABLED with a non-boolean value', () => {
    expect(() => loadConfig({ AUTH_ENABLED: '1' }))
      .toThrow(/AUTH_ENABLED must be 'true' or 'false'/);
    expect(() => loadConfig({ AUTH_ENABLED: 'yes', ANON_ROLE: 'Reader' }))
      .toThrow(/AUTH_ENABLED must be 'true' or 'false'/);
  });
});
```

- [ ] **Step 6: Run all config tests**

```bash
cd API && npx vitest run test/unit/config.test.ts
```
Expected: 13 PASS.

- [ ] **Step 7: Pause, commit**

```bash
git add API/src/config.ts API/test/unit/config.test.ts
git commit -m "API: add zod-validated config loader with auth-enabled and disabled modes"
```

---

## Phase 2 — Cross-cutting plumbing

### Task 4: ApiError class

**Files:**
- Create: `API/src/errors/api-error.ts`
- Create: `API/test/unit/errors/api-error.test.ts`

- [ ] **Step 1: Write failing test**

`API/test/unit/errors/api-error.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '../../../src/errors/api-error.js';

describe('ApiError', () => {
  it('is an Error subclass with status, code, message', () => {
    const e = new ApiError(404, 'NOT_FOUND', 'Container foo not found');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Container foo not found');
    expect(e.details).toBeUndefined();
  });

  it('preserves details', () => {
    const e = new ApiError(409, 'CONFLICT', 'exists', { etag: 'x' });
    expect(e.details).toEqual({ etag: 'x' });
  });

  it('factory helpers produce expected codes', () => {
    expect(ApiError.notFound('x').status).toBe(404);
    expect(ApiError.notFound('x').code).toBe('NOT_FOUND');
    expect(ApiError.forbidden().status).toBe(403);
    expect(ApiError.unauthenticated().status).toBe(401);
    expect(ApiError.badRequest('bad').status).toBe(400);
    expect(ApiError.conflict('boom').status).toBe(409);
    expect(ApiError.internal('oops').status).toBe(500);
    expect(ApiError.upstream('storage 503').status).toBe(502);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd API && npx vitest run test/unit/errors/api-error.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement**

`API/src/errors/api-error.ts`:
```ts
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Insufficient role'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }
  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static upstream(message: string): ApiError {
    return new ApiError(502, 'UPSTREAM_ERROR', message);
  }
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, 'INTERNAL', message);
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd API && npx vitest run test/unit/errors/api-error.test.ts
```
Expected: 3 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/errors/api-error.ts API/test/unit/errors/api-error.test.ts
git commit -m "API: add ApiError class with factory helpers"
```

---

### Task 5: Error middleware + request ID + logger

**Files:**
- Create: `API/src/observability/logger.ts`
- Create: `API/src/observability/request-id.ts`
- Create: `API/src/errors/error-middleware.ts`
- Create: `API/test/unit/error-middleware.test.ts`

- [ ] **Step 1: Write failing test**

`API/test/unit/error-middleware.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ApiError } from '../../src/errors/api-error.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(requestIdMiddleware());
  app.get('/x', handler);
  app.use(errorMiddleware());
  return app;
}

describe('errorMiddleware', () => {
  it('serialises ApiError', async () => {
    const app = buildApp((_req, _res, next) =>
      next(ApiError.notFound("Container 'foo' not found"))
    );
    const res = await request(app).get('/x');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: "Container 'foo' not found",
        correlationId: expect.any(String),
      },
    });
  });

  it('masks unknown errors as INTERNAL with correlationId', async () => {
    const app = buildApp((_req, _res, next) => next(new Error('secret leak')));
    const res = await request(app).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toBe('Internal server error');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('echoes inbound X-Request-Id', async () => {
    const app = buildApp((_req, _res, next) => next(ApiError.badRequest('x')));
    const res = await request(app).get('/x').set('X-Request-Id', 'rid-abc');
    expect(res.body.error.correlationId).toBe('rid-abc');
    expect(res.headers['x-request-id']).toBe('rid-abc');
  });

  it('mints a fresh X-Request-Id when none supplied', async () => {
    const app = buildApp((_req, _res, next) => next(ApiError.badRequest('x')));
    const res = await request(app).get('/x');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd API && npx vitest run test/unit/error-middleware.test.ts
```
Expected: module-not-found.

- [ ] **Step 3: Implement logger**

`API/src/observability/logger.ts`:
```ts
import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'storage-navigator-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
```

- [ ] **Step 4: Implement request-id middleware**

`API/src/types/express.d.ts` (ambient declaration so `Request.requestId` is
typed regardless of import order):

```ts
import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}
```

`API/src/observability/request-id.ts`:
```ts
import type { RequestHandler } from 'express';
import { v7 as uuidv7 } from 'uuid';

// `Request.requestId` augmentation lives in src/types/express.d.ts so the type
// is available regardless of which file imports `requestIdMiddleware()` first.

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : uuidv7();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
```

- [ ] **Step 5: Implement error middleware**

`API/src/errors/error-middleware.ts`:
```ts
import type { ErrorRequestHandler } from 'express';
import { ApiError } from './api-error.js';
import { logger } from '../observability/logger.js';

export function errorMiddleware(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const correlationId = req.requestId ?? 'unknown';

    if (err instanceof ApiError) {
      logger.warn({ correlationId, code: err.code, status: err.status }, err.message);
      res.status(err.status).json({
        error: { code: err.code, message: err.message, correlationId },
      });
      return;
    }

    logger.error({ correlationId, err }, 'unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
        correlationId,
      },
    });
  };
}
```

- [ ] **Step 6: Run, expect pass**

```bash
cd API && npx vitest run test/unit/error-middleware.test.ts
```
Expected: 4 PASS.

- [ ] **Step 7: Pause, commit**

```bash
git add API/src/observability API/src/errors/error-middleware.ts API/test/unit/error-middleware.test.ts
git commit -m "API: add logger, request-id middleware, error middleware"
```

---

### Task 6: App factory + entrypoint + health routes

**Files:**
- Create: `API/src/routes/health.ts`
- Create: `API/src/app.ts`
- Modify: `API/src/index.ts`
- Create: `API/test/unit/health.test.ts`

- [ ] **Step 1: Write failing test**

`API/test/unit/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });

describe('health endpoints', () => {
  it('GET /healthz returns 200', async () => {
    const app = buildApp({ config: cfg });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 when all readiness checks pass', async () => {
    const app = buildApp({
      config: cfg,
      readinessChecks: {
        jwks: async () => true,
        arm: async () => true,
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /readyz returns 503 when a check fails', async () => {
    const app = buildApp({
      config: cfg,
      readinessChecks: {
        jwks: async () => true,
        arm: async () => false,
      },
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.checks.arm).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd API && npx vitest run test/unit/health.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement health route**

`API/src/routes/health.ts`:
```ts
import { Router } from 'express';

export type ReadinessChecks = {
  jwks?: () => Promise<boolean>;
  arm?: () => Promise<boolean>;
};

/**
 * `/readyz` reports `ready` when every registered check resolves to `true`.
 * With no checks registered the endpoint returns `200 ready` (operator opts
 * in to readiness probes; T9 wires `jwks`, T13 wires `arm`). A check that
 * throws is treated as `false`, never propagated.
 */
export function healthRouter(checks: ReadinessChecks = {}): Router {
  const r = Router();

  r.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  r.get('/readyz', async (_req, res) => {
    const results: Record<string, boolean> = {};
    for (const [name, fn] of Object.entries(checks)) {
      try {
        results[name] = await fn();
      } catch {
        results[name] = false;
      }
    }
    const allPass = Object.values(results).every(Boolean);
    res.status(allPass ? 200 : 503).json({
      status: allPass ? 'ready' : 'not_ready',
      checks: results,
    });
  });

  return r;
}
```

- [ ] **Step 4: Implement app factory**

`API/src/app.ts`:
```ts
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { logger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/request-id.js';
import { errorMiddleware } from './errors/error-middleware.js';
import { healthRouter, type ReadinessChecks } from './routes/health.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
};

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware());

  // Per-request structured logger that emits the spec Section 9 fields:
  // {ts, level, reqId, route, method, statusCode, durationMs, ...}.
  // principalSub, accountName, container, share, path are added downstream
  // (auth middleware in T9, route handlers in T13+).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) =>
        `${req.method} ${(req as express.Request).originalUrl} ${res.statusCode}`,
      customErrorMessage: (req, res) =>
        `${req.method} ${(req as express.Request).originalUrl} ${res.statusCode}`,
    })
  );

  app.use(healthRouter(opts.readinessChecks));

  app.use(errorMiddleware());
  return app;
}
```

- [ ] **Step 5: Replace stub `API/src/index.ts`**

```ts
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';

function main(): void {
  const config = loadConfig();
  // Apply config-driven log level (logger.ts initialises from LOG_LEVEL env at
  // import time; this lets the validated config override it post-boot).
  logger.level = config.logLevel;

  const app = buildApp({ config });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'storage-navigator-api listening');
  });
  server.on('error', (err) => {
    logger.error({ err, port: config.port }, 'failed to bind port');
    process.exit(1);
  });
}

try {
  main();
} catch (err) {
  // Boot-time failures (config invalid) — log and exit non-zero
  // eslint-disable-next-line no-console
  console.error('Boot failed:', (err as Error).message);
  process.exit(1);
}
```

- [ ] **Step 6: Run unit tests**

```bash
cd API && npx vitest run test/unit/health.test.ts
```
Expected: 3 PASS.

- [ ] **Step 7: Smoke test**

```bash
cd API && AUTH_ENABLED=false ANON_ROLE=Reader npx tsx src/index.ts &
sleep 1
curl -s http://localhost:3000/healthz
kill %1
```
Expected: `{"status":"ok"}`.

- [ ] **Step 8: Pause, commit**

```bash
git add API/src/routes/health.ts API/src/app.ts API/src/index.ts API/test/unit/health.test.ts
git commit -m "API: add app factory, health and readiness endpoints"
```

---

## Phase 3 — Discovery endpoint

### Task 7: /.well-known/storage-nav-config

**Files:**
- Create: `API/src/routes/well-known.ts`
- Modify: `API/src/app.ts`
- Create: `API/test/unit/well-known.test.ts`

- [ ] **Step 1: Failing test**

`API/test/unit/well-known.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

describe('GET /.well-known/storage-nav-config', () => {
  it('returns config when auth enabled', async () => {
    const cfg = loadConfig({
      AUTH_ENABLED: 'true',
      OIDC_ISSUER: 'https://my.nbg.gr/identity',
      OIDC_AUDIENCE: 'storage-nav-api',
      OIDC_CLIENT_ID: 'cid',
      OIDC_SCOPES: 'openid,role',
      ROLE_MAP: '{"Foo":"Reader"}',
    });
    const app = buildApp({ config: cfg });
    const res = await request(app).get('/.well-known/storage-nav-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authEnabled: true,
      issuer: 'https://my.nbg.gr/identity',
      clientId: 'cid',
      audience: 'storage-nav-api',
      scopes: ['openid', 'role'],
    });
  });

  it('returns minimal config when auth disabled', async () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    const app = buildApp({ config: cfg });
    const res = await request(app).get('/.well-known/storage-nav-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authEnabled: false });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd API && npx vitest run test/unit/well-known.test.ts
```

- [ ] **Step 3: Implement**

`API/src/routes/well-known.ts`:
```ts
import { Router } from 'express';
import type { Config } from '../config.js';

export function wellKnownRouter(config: Config): Router {
  const r = Router();
  r.get('/.well-known/storage-nav-config', (_req, res) => {
    if (config.oidc.mode === 'enabled') {
      res.json({
        authEnabled: true,
        issuer: config.oidc.issuer,
        clientId: config.oidc.clientId,
        audience: config.oidc.audience,
        scopes: config.oidc.scopes,
      });
    } else {
      res.json({ authEnabled: false });
    }
  });
  return r;
}
```

- [ ] **Step 4: Wire into `app.ts`**

In `API/src/app.ts`, add import and mount (just before the health router):
```ts
import { wellKnownRouter } from './routes/well-known.js';
// ...
app.use(wellKnownRouter(opts.config));
```

- [ ] **Step 5: Run, expect pass**

```bash
cd API && npx vitest run test/unit/well-known.test.ts
```
Expected: 2 PASS.

- [ ] **Step 6: Pause, commit**

```bash
git add API/src/routes/well-known.ts API/src/app.ts API/test/unit/well-known.test.ts
git commit -m "API: add /.well-known/storage-nav-config discovery endpoint"
```

---

## Phase 4 — OIDC authentication

### Task 8: JWKS cache + JWT verification + role mapper + auth-toggle middleware

This is the largest single task. It introduces a local mock JWKS server used by all auth tests downstream.

**Files:**
- Create: `API/src/auth/jwks-cache.ts`
- Create: `API/src/auth/role-mapper.ts`
- Create: `API/src/auth/oidc-middleware.ts`
- Create: `API/src/auth/auth-toggle.ts`
- Create: `API/test/helpers/mock-idp.ts`
- Create: `API/test/unit/auth.test.ts`

- [ ] **Step 1: Write the mock IdP helper**

`API/test/helpers/mock-idp.ts`:
```ts
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { v7 as uuidv7 } from 'uuid';

export type MockIdp = {
  issuer: string;
  jwksUri: string;
  signToken: (claims: Record<string, unknown>, opts?: SignOpts) => Promise<string>;
  rotate: () => Promise<void>;
  close: () => Promise<void>;
};

export type SignOpts = {
  audience?: string | string[];
  expiresInSec?: number;
  notBeforeSec?: number;
  alg?: 'RS256';
};

export async function startMockIdp(): Promise<MockIdp> {
  let { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  let kid = uuidv7();
  let jwks: { keys: JWK[] } = {
    keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }],
  };

  const server = createServer((req, res) => {
    if (req.url?.endsWith('/jwks')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(jwks));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('mock-idp: bad address');
  const issuer = `http://127.0.0.1:${addr.port}`;
  const jwksUri = `${issuer}/jwks`;

  const signToken: MockIdp['signToken'] = async (claims, opts = {}) => {
    const now = Math.floor(Date.now() / 1000);
    let jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid })
      .setIssuer(issuer)
      .setIssuedAt(now)
      .setNotBefore(opts.notBeforeSec ?? now)
      .setExpirationTime(now + (opts.expiresInSec ?? 300));
    if (opts.audience) jwt = jwt.setAudience(opts.audience);
    return jwt.sign(privateKey);
  };

  const rotate = async (): Promise<void> => {
    const next = await generateKeyPair('RS256', { extractable: true });
    privateKey = next.privateKey;
    publicKey = next.publicKey;
    kid = uuidv7();
    jwks = {
      keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }],
    };
  };

  const close = (): Promise<void> =>
    new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );

  return { issuer, jwksUri, signToken, rotate, close };
}
```

- [ ] **Step 2: Write JWKS cache test + module**

`API/src/auth/jwks-cache.ts`:
```ts
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

/**
 * Build a remote JWKS getter cached locally.
 *
 * `cooldownMs` controls how long jose waits before re-fetching JWKS after a
 * `kid` miss. Default = 30s (jose default + spec). Tests pass 0 to exercise
 * key rotation without sleeping. Setting it to 0 in production would let
 * spoofed `kid` values force one outbound JWKS round-trip per request and
 * amplify bad-actor traffic toward the IdP — keep the default unless you have
 * a specific reason.
 */
export function buildJwksGetter(
  jwksUri: string,
  cacheMinutes: number,
  cooldownMs = 30_000,
): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: cacheMinutes * 60 * 1000,
    cooldownDuration: cooldownMs,
  });
}
```

(Single thin wrapper — the underlying `jose` cache + cooldown handle rotation. Tests in Step 8 will exercise rotation through the middleware.)

- [ ] **Step 3: Write role mapper**

`API/src/auth/role-mapper.ts`:
```ts
export type AppRole = 'Reader' | 'Writer' | 'Admin';

export function mapRoles(
  claimValue: unknown,
  roleMap: Record<string, AppRole>
): Set<AppRole> {
  const values: string[] = Array.isArray(claimValue)
    ? claimValue.filter((v): v is string => typeof v === 'string')
    : typeof claimValue === 'string'
    ? [claimValue]
    : [];
  const out = new Set<AppRole>();
  for (const v of values) {
    const mapped = roleMap[v];
    if (mapped) out.add(mapped);
  }
  return out;
}

export function impliesRole(have: Set<AppRole>, need: AppRole): boolean {
  if (have.has('Admin')) return true;
  if (need === 'Reader') return have.has('Reader') || have.has('Writer');
  if (need === 'Writer') return have.has('Writer');
  return false;
}
```

- [ ] **Step 4: Write OIDC middleware**

`API/src/auth/oidc-middleware.ts` (Principal augmentation lives in `src/types/express.d.ts` alongside `requestId`):

```ts
import type { RequestHandler } from 'express';
import { jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { ApiError } from '../errors/api-error.js';
import { logger } from '../observability/logger.js';
import { mapRoles, type AppRole } from './role-mapper.js';

export type Principal = {
  sub: string;
  roles: Set<AppRole>;
  /**
   * Full JWT payload. WARNING: may contain PII (email, name, custom claims).
   * Do NOT log `principal` or `principal.raw` directly — strip to `{sub,
   * roles}` before emitting.
   */
  raw: JWTPayload;
};

export type OidcMiddlewareOptions = {
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  clockToleranceSec: number;
  roleClaim: string;
  roleMap: Record<string, AppRole>;
};

export function oidcMiddleware(opts: OidcMiddlewareOptions): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      return next(ApiError.unauthenticated('Missing Bearer token'));
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const { payload } = await jwtVerify(token, opts.jwks, {
        issuer: opts.issuer,
        audience: opts.audience,
        clockTolerance: opts.clockToleranceSec,
        algorithms: ['RS256'],
      });
      const sub = typeof payload.sub === 'string' ? payload.sub : 'unknown';
      const roles = mapRoles(payload[opts.roleClaim], opts.roleMap);
      req.principal = { sub, roles, raw: payload };
      next();
    } catch (err) {
      // Log the verbose jose reason at debug level for operator triage,
      // but return a generic message to the caller — the verbose detail
      // (e.g. "unexpected aud claim value") is a probing oracle.
      logger.debug(
        { reqId: req.requestId, reason: (err as Error).message },
        'JWT verification failed',
      );
      next(ApiError.unauthenticated('Invalid or expired token'));
    }
  };
}
```

- [ ] **Step 5: Write auth-toggle middleware**

`API/src/auth/auth-toggle.ts`:
```ts
import type { RequestHandler } from 'express';
import type { AppRole } from './role-mapper.js';

export function anonymousPrincipalMiddleware(anonRole: AppRole): RequestHandler {
  return (req, _res, next) => {
    req.principal = {
      sub: 'anonymous',
      roles: new Set<AppRole>([anonRole]),
      raw: { sub: 'anonymous' },
    };
    next();
  };
}
```

- [ ] **Step 6: Write rbac/enforce**

Create `API/src/rbac/permissions.ts` (constants for documentation only):
```ts
export type Verb = 'read' | 'write' | 'delete-item' | 'delete-container' | 'delete-folder';

export const ROLE_VERBS: Record<'Reader' | 'Writer' | 'Admin', Set<Verb>> = {
  Reader: new Set(['read']),
  Writer: new Set(['read', 'write', 'delete-item']),
  Admin: new Set(['read', 'write', 'delete-item', 'delete-container', 'delete-folder']),
};
```

`API/src/rbac/enforce.ts`:
```ts
import type { RequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';
import { impliesRole, type AppRole } from '../auth/role-mapper.js';

export function requireRole(role: AppRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) return next(ApiError.unauthenticated());
    if (!impliesRole(req.principal.roles, role)) return next(ApiError.forbidden());
    next();
  };
}
```

- [ ] **Step 7: Write the auth integration test**

`API/test/unit/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { startMockIdp, type MockIdp } from '../helpers/mock-idp.js';
import { buildJwksGetter } from '../../src/auth/jwks-cache.js';
import { oidcMiddleware } from '../../src/auth/oidc-middleware.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { requireRole } from '../../src/rbac/enforce.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

let idp: MockIdp;

beforeAll(async () => { idp = await startMockIdp(); });
afterAll(async () => { await idp.close(); });

function buildAuthenticatedApp() {
  const app = express();
  app.use(requestIdMiddleware());
  app.use(
    oidcMiddleware({
      jwks: buildJwksGetter(idp.jwksUri, 10),
      issuer: idp.issuer,
      audience: 'storage-nav-api',
      clockToleranceSec: 5,
      roleClaim: 'role',
      roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
    })
  );
  app.get('/r', requireRole('Reader'), (req, res) => res.json({ sub: req.principal!.sub }));
  app.get('/w', requireRole('Writer'), (_req, res) => res.json({ ok: true }));
  app.get('/a', requireRole('Admin'), (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware());
  return app;
}

describe('OIDC middleware + RBAC', () => {
  const app = buildAuthenticatedApp();

  it('401 when missing token', async () => {
    const res = await request(app).get('/r');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 when wrong audience', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'other-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('401 when expired', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api', expiresInSec: -10 }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('200 when Reader role mapped from claim', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe('alice');
  });

  it('403 when Reader hits Writer-only route', async () => {
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/w').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin satisfies any required role', async () => {
    const token = await idp.signToken(
      { sub: 'admin', role: ['StorageAdmin'] },
      { audience: 'storage-nav-api' }
    );
    const reader = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    const writer = await request(app).get('/w').set('Authorization', `Bearer ${token}`);
    const admin = await request(app).get('/a').set('Authorization', `Bearer ${token}`);
    expect(reader.status).toBe(200);
    expect(writer.status).toBe(200);
    expect(admin.status).toBe(200);
  });

  it('honours rotated signing key on next request after JWKS cache cooldown', async () => {
    await idp.rotate();
    const token = await idp.signToken(
      { sub: 'alice', role: 'StorageReader' },
      { audience: 'storage-nav-api' }
    );
    const res = await request(app).get('/r').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('anonymousPrincipalMiddleware', () => {
  it('grants the configured anon role', async () => {
    const app = express();
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware('Reader'));
    app.get('/r', requireRole('Reader'), (_req, res) => res.json({ ok: true }));
    app.get('/w', requireRole('Writer'), (_req, res) => res.json({ ok: true }));
    app.use(errorMiddleware());
    const r = await request(app).get('/r');
    const w = await request(app).get('/w');
    expect(r.status).toBe(200);
    expect(w.status).toBe(403);
  });
});
```

- [ ] **Step 8: Run, expect pass**

```bash
cd API && npx vitest run test/unit/auth.test.ts
```
Expected: 8 PASS.

- [ ] **Step 9: Pause, commit**

```bash
git add API/src/auth API/src/rbac API/test/helpers/mock-idp.ts API/test/unit/auth.test.ts
git commit -m "API: add OIDC verification, role mapper, RBAC enforce, anon-mode middleware, mock IdP test helper"
```

---

### Task 9: Wire auth into app factory

**Files:**
- Modify: `API/src/app.ts`
- Modify: `API/test/unit/health.test.ts` (no change needed; health stays unauth)

- [ ] **Step 1: Update `buildApp` to mount auth in order: well-known (no auth) → health (no auth) → auth (oidc OR anon) → routes**

Replace `API/src/app.ts` body with:
```ts
import express, { type Express, type RequestHandler } from 'express';
import type { Config } from './config.js';
import { requestIdMiddleware } from './observability/request-id.js';
import { errorMiddleware } from './errors/error-middleware.js';
import { healthRouter, type ReadinessChecks } from './routes/health.js';
import { wellKnownRouter } from './routes/well-known.js';
import { buildJwksGetter } from './auth/jwks-cache.js';
import { oidcMiddleware } from './auth/oidc-middleware.js';
import { anonymousPrincipalMiddleware } from './auth/auth-toggle.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
  /**
   * When set, used in place of building authentication from config.
   * Test-only.
   */
  authOverride?: RequestHandler;
};

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware());

  app.use(wellKnownRouter(opts.config));
  app.use(healthRouter(opts.readinessChecks));

  const auth = opts.authOverride ?? buildAuthMiddleware(opts.config);
  app.use(auth);

  // Authenticated routers will be mounted in later tasks.

  app.use(errorMiddleware());
  return app;
}

function buildAuthMiddleware(config: Config): RequestHandler {
  if (config.oidc.mode === 'enabled') {
    const jwks = buildJwksGetter(`${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration/jwks`, config.oidc.jwksCacheMin);
    return oidcMiddleware({
      jwks,
      issuer: config.oidc.issuer,
      audience: config.oidc.audience,
      clockToleranceSec: config.oidc.clockToleranceSec,
      roleClaim: config.oidc.roleClaim,
      roleMap: config.oidc.roleMap as Record<string, 'Reader' | 'Writer' | 'Admin'>,
    });
  }
  return anonymousPrincipalMiddleware(config.oidc.anonRole);
}
```

> Note: the IdentityServer JWKS path is `<issuer>/.well-known/openid-configuration/jwks`. We construct it from the issuer rather than requiring a separate env var.

- [ ] **Step 2: Run all unit tests**

```bash
cd API && npx vitest run test/unit
```
Expected: all green.

- [ ] **Step 3: Pause, commit**

```bash
git add API/src/app.ts
git commit -m "API: wire OIDC or anon middleware into app factory based on config"
```

---

## Phase 5 — Azure plumbing

### Task 10: DefaultAzureCredential singleton + smoke test

**Files:**
- Create: `API/src/azure/credential.ts`
- Create: `API/test/unit/azure-credential.test.ts`

- [ ] **Step 1: Failing test**

`API/test/unit/azure-credential.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DefaultAzureCredential } from '@azure/identity';
import { getAzureCredential, _resetAzureCredential } from '../../src/azure/credential.js';

describe('getAzureCredential', () => {
  it('returns a DefaultAzureCredential instance', () => {
    _resetAzureCredential();
    const c = getAzureCredential();
    expect(c).toBeInstanceOf(DefaultAzureCredential);
  });

  it('returns the same instance on repeated calls', () => {
    _resetAzureCredential();
    const a = getAzureCredential();
    const b = getAzureCredential();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Implement**

`API/src/azure/credential.ts`:
```ts
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

let cached: TokenCredential | null = null;

export function getAzureCredential(): TokenCredential {
  if (!cached) {
    cached = new DefaultAzureCredential();
  }
  return cached;
}

/** Test-only reset hook. Do not call from production code. */
export function _resetAzureCredential(): void {
  cached = null;
}
```

- [ ] **Step 3: Run, expect pass**

```bash
cd API && npx vitest run test/unit/azure-credential.test.ts
```
Expected: 2 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add API/src/azure/credential.ts API/test/unit/azure-credential.test.ts
git commit -m "API: add Azure credential singleton"
```

---

### Task 11: Account discovery (ARM scan + cache + allowlist)

**Files:**
- Create: `API/src/azure/account-discovery.ts`
- Create: `API/test/unit/account-discovery.test.ts`

- [ ] **Step 1: Failing test**

`API/test/unit/account-discovery.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { AccountDiscovery, type ArmAdapter, type DiscoveredAccount } from '../../src/azure/account-discovery.js';

const A1: DiscoveredAccount = {
  name: 'acct1',
  subscriptionId: 'sub-a',
  resourceGroup: 'rg-a',
  blobEndpoint: 'https://acct1.blob.core.windows.net',
  fileEndpoint: 'https://acct1.file.core.windows.net',
};
const A2: DiscoveredAccount = {
  name: 'acct2',
  subscriptionId: 'sub-a',
  resourceGroup: 'rg-a',
  blobEndpoint: 'https://acct2.blob.core.windows.net',
  fileEndpoint: 'https://acct2.file.core.windows.net',
};

function makeAdapter(accounts: DiscoveredAccount[]): ArmAdapter {
  return {
    list: vi.fn().mockResolvedValue(accounts),
  };
}

describe('AccountDiscovery', () => {
  it('lists discovered accounts after refresh', async () => {
    const adapter = makeAdapter([A1, A2]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    const all = d.list();
    expect(all.map((a) => a.name).sort()).toEqual(['acct1', 'acct2']);
  });

  it('filters by allowlist', async () => {
    const adapter = makeAdapter([A1, A2]);
    const d = new AccountDiscovery({ adapter, allowed: ['acct2'], refreshMin: 60 });
    await d.refresh();
    expect(d.list().map((a) => a.name)).toEqual(['acct2']);
  });

  it('lookup returns the account', async () => {
    const adapter = makeAdapter([A1]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    expect(d.lookup('acct1')?.blobEndpoint).toContain('acct1.blob');
  });

  it('lookup returns null when missing', async () => {
    const adapter = makeAdapter([]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    expect(d.lookup('ghost')).toBeNull();
  });

  it('refresh re-invokes the adapter', async () => {
    const adapter = makeAdapter([A1]);
    const d = new AccountDiscovery({ adapter, allowed: [], refreshMin: 60 });
    await d.refresh();
    await d.refresh();
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implement**

`API/src/azure/account-discovery.ts`:
```ts
import { StorageManagementClient } from '@azure/arm-storage';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import type { TokenCredential } from '@azure/identity';
import { logger } from '../observability/logger.js';

export type DiscoveredAccount = {
  name: string;
  subscriptionId: string;
  resourceGroup: string;
  blobEndpoint: string;
  fileEndpoint: string;
};

export type ArmAdapter = {
  list(): Promise<DiscoveredAccount[]>;
};

export type AccountDiscoveryOptions = {
  adapter: ArmAdapter;
  allowed: string[];
  refreshMin: number;
};

export class AccountDiscovery {
  private readonly adapter: ArmAdapter;
  private readonly allowed: Set<string>;
  private readonly refreshMs: number;
  private cache: Map<string, DiscoveredAccount> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: AccountDiscoveryOptions) {
    this.adapter = opts.adapter;
    this.allowed = new Set(opts.allowed);
    this.refreshMs = opts.refreshMin * 60 * 1000;
  }

  async refresh(): Promise<void> {
    const accounts = await this.adapter.list();
    const filtered = this.allowed.size === 0
      ? accounts
      : accounts.filter((a) => this.allowed.has(a.name));
    const next = new Map<string, DiscoveredAccount>();
    for (const a of filtered) next.set(a.name, a);
    this.cache = next;
  }

  list(): DiscoveredAccount[] {
    return [...this.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  lookup(name: string): DiscoveredAccount | null {
    return this.cache.get(name) ?? null;
  }

  startBackgroundRefresh(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // Surface ARM-side failures (permission revocation, throttling, network)
      // so they don't silently freeze the cache against a stale snapshot.
      void this.refresh().catch((err: unknown) => {
        logger.warn({ err }, 'account discovery background refresh failed');
      });
    }, this.refreshMs);
    // Don't keep the event loop alive solely for this timer.
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopBackgroundRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** Concrete adapter that scans subscriptions via ARM. */
export class ArmStorageAdapter implements ArmAdapter {
  constructor(
    private readonly credential: TokenCredential,
    private readonly subscriptions: string[]
  ) {}

  async list(): Promise<DiscoveredAccount[]> {
    const subs = this.subscriptions.length > 0
      ? this.subscriptions
      : await this.discoverSubscriptions();
    const out: DiscoveredAccount[] = [];
    for (const subscriptionId of subs) {
      const client = new StorageManagementClient(this.credential, subscriptionId);
      for await (const acct of client.storageAccounts.list()) {
        if (!acct.name || !acct.id) {
          logger.warn({ accountId: acct.id, name: acct.name }, 'skipping account: missing name or id');
          continue;
        }
        const rg = parseResourceGroup(acct.id);
        if (!rg) {
          logger.warn({ accountId: acct.id }, 'skipping account: cannot parse resource group');
          continue;
        }
        out.push({
          name: acct.name,
          subscriptionId,
          resourceGroup: rg,
          blobEndpoint: acct.primaryEndpoints?.blob ?? `https://${acct.name}.blob.core.windows.net`,
          fileEndpoint: acct.primaryEndpoints?.file ?? `https://${acct.name}.file.core.windows.net`,
        });
      }
    }
    return out;
  }

  private async discoverSubscriptions(): Promise<string[]> {
    const sc = new SubscriptionClient(this.credential);
    const ids: string[] = [];
    for await (const s of sc.subscriptions.list()) {
      if (s.subscriptionId) ids.push(s.subscriptionId);
    }
    return ids;
  }
}

function parseResourceGroup(id: string): string | null {
  // /subscriptions/{sub}/resourceGroups/{rg}/...
  // Case-sensitive: ARM canonically returns "resourceGroups" with a capital G.
  // If Azure ever changes canonical casing, every account skips with a warn
  // log (see callsite). Do not add /i — allowlists assume canonical casing.
  const match = /\/resourceGroups\/([^/]+)\//.exec(id);
  return match?.[1] ?? null;
}
```

- [ ] **Step 3: Add `@azure/arm-subscriptions` to deps**

```bash
# Pin to ^5.x. v6 of this package removed `subscriptions.list()` (the API the
# plan code calls) — the listing moved to @azure/arm-resources-subscriptions.
# Future migration tracked in Issues - Pending Items.md.
cd API && npm install '@azure/arm-subscriptions@^5.1.1'
```

- [ ] **Step 4: Run, expect pass**

```bash
cd API && npx vitest run test/unit/account-discovery.test.ts
```
Expected: 5 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/azure/account-discovery.ts API/test/unit/account-discovery.test.ts API/package.json API/package-lock.json
git commit -m "API: add storage account discovery (ARM scan, allowlist, cache)"
```

---

### Task 12: Integration test scaffolding (Azurite)

**Files:**
- Create: `API/test/helpers/azurite.ts`
- Create: `API/test/helpers/test-app.ts`
- Create: `API/docker-compose.dev.yml`
- Modify: `API/package.json` (add `azurite` dev dep)

- [ ] **Step 1: Add Azurite as a dev dep**

```bash
cd API && npm install --save-dev azurite
```

- [ ] **Step 2: Write Azurite helper**

`API/test/helpers/azurite.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export type AzuriteHandle = {
  blobUrl: string;
  fileUrl: string;
  accountName: string;
  accountKey: string;
  shutdown: () => Promise<void>;
};

const ACCOUNT = 'devstoreaccount1';
// Well-known Azurite default key; safe to commit (used only by emulator)
const KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

export async function startAzurite(): Promise<AzuriteHandle> {
  const workdir = mkdtempSync(join(tmpdir(), 'azurite-'));
  const blobPort = 10000 + Math.floor(Math.random() * 50000);
  const queuePort = blobPort + 1;
  const tablePort = blobPort + 2;

  const proc: ChildProcess = spawn(
    'npx',
    [
      'azurite',
      '--silent',
      // @azure/storage-blob 12.31 sends API version 2026-02-06; Azurite 3.35
      // (latest at plan date) only knows 2025-11-05. Skip the version check
      // until Azurite catches up — without this the smoke + service tests fail
      // with "RestError: The API version 2026-02-06 is not supported".
      '--skipApiVersionCheck',
      '--location', workdir,
      '--blobHost', '127.0.0.1',
      '--blobPort', String(blobPort),
      '--queueHost', '127.0.0.1',
      '--queuePort', String(queuePort),
      '--tableHost', '127.0.0.1',
      '--tablePort', String(tablePort),
    ],
    { stdio: 'ignore' }
  );

  // Wait for the blob endpoint to accept connections.
  const blobUrl = `http://127.0.0.1:${blobPort}/${ACCOUNT}`;
  const fileUrl = `http://127.0.0.1:${blobPort}/${ACCOUNT}`; // Azurite supports both via separate ports
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${blobPort}/`);
      if (r.status === 400 || r.status === 403 || r.status === 200) break;
    } catch { /* not yet */ }
    await sleep(100);
  }

  return {
    blobUrl,
    fileUrl,
    accountName: ACCOUNT,
    accountKey: KEY,
    shutdown: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
      rmSync(workdir, { recursive: true, force: true });
    },
  };
}
```

> Azurite v3 file-share support is via the `azurite-file` binary if needed; v1 of this plan exercises blob ops in integration tests and stubs file-share at the service-class level.

- [ ] **Step 3: Write a test-app helper**

`API/test/helpers/test-app.ts`:
```ts
import express from 'express';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import type { AppRole } from '../../src/auth/role-mapper.js';

export function disabledModeConfig(anonRole: AppRole = 'Admin'): Config {
  return {
    port: 0,
    logLevel: 'silent',
    authEnabled: false,
    oidc: { mode: 'disabled', anonRole },
    azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
    pagination: { defaultPageSize: 200, maxPageSize: 1000 },
    uploads: { maxBytes: null, streamBlockSizeMb: 8 },
    swaggerUiEnabled: false,
    corsOrigins: [],
  };
}

export function appWithFixedRole(role: AppRole) {
  const app = express();
  return buildApp({
    config: disabledModeConfig(role),
    authOverride: anonymousPrincipalMiddleware(role),
  });
}
```

- [ ] **Step 4: Write a docker-compose for dev (Azurite + mock IdP later — for now just Azurite)**

`API/docker-compose.dev.yml`:
```yaml
version: "3.9"
services:
  azurite:
    image: mcr.microsoft.com/azure-storage/azurite:latest
    container_name: storage-nav-azurite
    ports:
      - "10000:10000"  # blob
      - "10001:10001"  # queue
      - "10002:10002"  # table
    command: >-
      azurite
      --blobHost 0.0.0.0
      --queueHost 0.0.0.0
      --tableHost 0.0.0.0
      --location /data
    volumes:
      - azurite-data:/data
volumes:
  azurite-data: {}
```

- [ ] **Step 5: Smoke-test the helper**

`API/test/integration/azurite-smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

describe('azurite smoke', () => {
  it('can create and list a container', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const svc = new BlobServiceClient(az.blobUrl, cred);
    await svc.getContainerClient('smoke').createIfNotExists();
    const names: string[] = [];
    for await (const c of svc.listContainers()) names.push(c.name);
    expect(names).toContain('smoke');
  });
});
```

- [ ] **Step 6: Run the smoke test**

```bash
cd API && npx vitest run test/integration/azurite-smoke.test.ts
```
Expected: PASS.

- [ ] **Step 7: Pause, commit**

```bash
git add API/test/helpers API/test/integration/azurite-smoke.test.ts API/docker-compose.dev.yml API/package.json API/package-lock.json
git commit -m "API: add Azurite test helper + docker-compose for local dev"
```

---

## Phase 6 — Storages route

### Task 13: GET /storages

**Files:**
- Create: `API/src/routes/storages.ts`
- Modify: `API/src/app.ts`
- Create: `API/test/unit/storages.test.ts`

- [ ] **Step 1: Failing test**

`API/test/unit/storages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { storagesRouter } from '../../src/routes/storages.js';
import { AccountDiscovery, type DiscoveredAccount } from '../../src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

const fixture: DiscoveredAccount[] = [
  { name: 'acct1', subscriptionId: 's1', resourceGroup: 'rg', blobEndpoint: 'https://acct1.blob.core.windows.net', fileEndpoint: 'https://acct1.file.core.windows.net' },
  { name: 'acct2', subscriptionId: 's1', resourceGroup: 'rg', blobEndpoint: 'https://acct2.blob.core.windows.net', fileEndpoint: 'https://acct2.file.core.windows.net' },
];

describe('GET /storages', () => {
  it('returns discovered accounts as Reader', async () => {
    const discovery = new AccountDiscovery({
      adapter: { list: async () => fixture },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = express();
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware('Reader'));
    app.use(storagesRouter(discovery));
    app.use(errorMiddleware());

    const res = await request(app).get('/storages');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { name: 'acct1', blobEndpoint: 'https://acct1.blob.core.windows.net', fileEndpoint: 'https://acct1.file.core.windows.net' },
        { name: 'acct2', blobEndpoint: 'https://acct2.blob.core.windows.net', fileEndpoint: 'https://acct2.file.core.windows.net' },
      ],
      continuationToken: null,
    });
  });
});
```

- [ ] **Step 2: Implement**

`API/src/routes/storages.ts`:
```ts
import { Router } from 'express';
import { requireRole } from '../rbac/enforce.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';

export function storagesRouter(discovery: AccountDiscovery): Router {
  const r = Router();
  r.get('/storages', requireRole('Reader'), (_req, res) => {
    res.json({
      items: discovery.list().map(({ name, blobEndpoint, fileEndpoint }) => ({
        name, blobEndpoint, fileEndpoint,
      })),
      continuationToken: null,
    });
  });
  return r;
}
```

- [ ] **Step 3: Wire into `buildApp`**

In `API/src/app.ts`, extend `BuildAppOptions`:
```ts
import type { AccountDiscovery } from './azure/account-discovery.js';
import { storagesRouter } from './routes/storages.js';

export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
  authOverride?: RequestHandler;
  discovery: AccountDiscovery;
};
```

After mounting auth middleware, add:
```ts
  app.use(storagesRouter(opts.discovery));
```

Update `index.ts` to instantiate `AccountDiscovery`:

`API/src/index.ts`:
```ts
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';
import { getAzureCredential } from './azure/credential.js';
import { AccountDiscovery, ArmStorageAdapter } from './azure/account-discovery.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const credential = getAzureCredential();
  const discovery = new AccountDiscovery({
    adapter: new ArmStorageAdapter(credential, config.azure.subscriptions),
    allowed: config.azure.allowedAccounts,
    refreshMin: config.azure.discoveryRefreshMin,
  });
  await discovery.refresh();
  discovery.startBackgroundRefresh();

  const app = buildApp({
    config,
    discovery,
    readinessChecks: {
      arm: async () => discovery.list().length >= 0, // discovery cache populated
    },
  });
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'storage-navigator-api listening');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Boot failed:', (err as Error).message);
  process.exit(1);
});
```

- [ ] **Step 4: Run, expect pass**

```bash
cd API && npx vitest run test/unit/storages.test.ts
```
Expected: 1 PASS.

- [ ] **Step 5: Run full unit suite**

```bash
cd API && npx vitest run test/unit
```
Expected: green.

- [ ] **Step 6: Pause, commit**

```bash
git add API/src/routes/storages.ts API/src/app.ts API/src/index.ts API/test/unit/storages.test.ts
git commit -m "API: add GET /storages endpoint and discovery wiring in entrypoint"
```

---

## Phase 7 — Blob ops

### Task 14: BlobService — list/create/delete container, list blobs

**Files:**
- Create: `API/src/azure/blob-service.ts`
- Create: `API/src/util/pagination.ts`
- Create: `API/test/integration/blob-service.test.ts`

- [ ] **Step 1: Write pagination helper**

`API/src/util/pagination.ts`:
```ts
import { ApiError } from '../errors/api-error.js';

export type PageInputs = {
  pageSize?: string;
  continuationToken?: string;
};

export type PageParams = {
  pageSize: number;
  continuationToken?: string;
};

export function parsePage(inputs: PageInputs, defaults: { defaultPageSize: number; maxPageSize: number }): PageParams {
  let pageSize = defaults.defaultPageSize;
  if (inputs.pageSize !== undefined) {
    const n = Number(inputs.pageSize);
    if (!Number.isInteger(n) || n <= 0) throw ApiError.badRequest('pageSize must be a positive integer');
    if (n > defaults.maxPageSize) throw ApiError.badRequest(`pageSize exceeds max ${defaults.maxPageSize}`);
    pageSize = n;
  }
  return { pageSize, continuationToken: inputs.continuationToken };
}
```

- [ ] **Step 2: Write blob-service**

`API/src/azure/blob-service.ts`:
```ts
import {
  BlobServiceClient,
  ContainerClient,
  type BlockBlobUploadStreamOptions,
} from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';
import { Readable } from 'node:stream';
import { ApiError } from '../errors/api-error.js';

export type BlobListItem = {
  name: string;
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  isPrefix?: boolean;
};

export type BlobReadHandle = {
  stream: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
};

export class BlobService {
  constructor(
    private readonly credential: TokenCredential,
    private readonly resolveEndpoint: (account: string) => string
  ) {}

  private svc(account: string): BlobServiceClient {
    return new BlobServiceClient(this.resolveEndpoint(account), this.credential);
  }

  private container(account: string, container: string): ContainerClient {
    return this.svc(account).getContainerClient(container);
  }

  async listContainers(account: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: { name: string }[]; continuationToken: string | null }> {
    const iter = this.svc(account).listContainers().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
    const result = await iter.next();
    if (result.done) return { items: [], continuationToken: null };
    const items = (result.value.containerItems ?? []).map((c) => ({ name: c.name }));
    return { items, continuationToken: result.value.continuationToken ?? null };
  }

  async createContainer(account: string, name: string): Promise<void> {
    const r = await this.container(account, name).createIfNotExists();
    if (!r.succeeded) throw ApiError.conflict(`Container '${name}' already exists`);
  }

  async deleteContainer(account: string, name: string): Promise<void> {
    const r = await this.container(account, name).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`Container '${name}' not found`);
  }

  async listBlobs(
    account: string,
    container: string,
    opts: { prefix?: string; delimiter?: string; pageSize: number; continuationToken?: string }
  ): Promise<{ items: BlobListItem[]; continuationToken: string | null }> {
    const c = this.container(account, container);
    const items: BlobListItem[] = [];
    if (opts.delimiter) {
      const iter = c.listBlobsByHierarchy(opts.delimiter, { prefix: opts.prefix }).byPage({ maxPageSize: opts.pageSize, continuationToken: opts.continuationToken });
      const r = await iter.next();
      if (r.done) return { items: [], continuationToken: null };
      for (const seg of r.value.segment.blobPrefixes ?? []) {
        items.push({ name: seg.name, isPrefix: true });
      }
      for (const b of r.value.segment.blobItems) {
        items.push({
          name: b.name,
          size: b.properties.contentLength ?? undefined,
          contentType: b.properties.contentType ?? undefined,
          etag: b.properties.etag ?? undefined,
          lastModified: b.properties.lastModified?.toISOString(),
        });
      }
      return { items, continuationToken: r.value.continuationToken ?? null };
    }
    const iter = c.listBlobsFlat({ prefix: opts.prefix }).byPage({ maxPageSize: opts.pageSize, continuationToken: opts.continuationToken });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    for (const b of r.value.segment.blobItems) {
      items.push({
        name: b.name,
        size: b.properties.contentLength ?? undefined,
        contentType: b.properties.contentType ?? undefined,
        etag: b.properties.etag ?? undefined,
        lastModified: b.properties.lastModified?.toISOString(),
      });
    }
    return { items, continuationToken: r.value.continuationToken ?? null };
  }

  async readBlob(account: string, container: string, path: string, range?: { offset: number; count?: number }, signal?: AbortSignal): Promise<BlobReadHandle> {
    const blob = this.container(account, container).getBlobClient(path);
    try {
      const dl = await blob.download(range?.offset, range?.count, { abortSignal: signal });
      return {
        stream: dl.readableStreamBody as NodeJS.ReadableStream,
        contentType: dl.contentType ?? undefined,
        contentLength: dl.contentLength ?? undefined,
        etag: dl.etag ?? undefined,
        lastModified: dl.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `Blob '${path}' not found in container '${container}'`);
    }
  }

  async headBlob(account: string, container: string, path: string): Promise<Omit<BlobReadHandle, 'stream'>> {
    const blob = this.container(account, container).getBlobClient(path);
    try {
      const p = await blob.getProperties();
      return {
        contentType: p.contentType ?? undefined,
        contentLength: p.contentLength ?? undefined,
        etag: p.etag ?? undefined,
        lastModified: p.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `Blob '${path}' not found in container '${container}'`);
    }
  }

  async uploadBlob(
    account: string, container: string, path: string,
    body: Readable, contentType: string | undefined, opts: { blockSizeMb: number },
    signal?: AbortSignal,
  ): Promise<{ etag?: string; lastModified?: string }> {
    const blob = this.container(account, container).getBlockBlobClient(path);
    const blockSize = opts.blockSizeMb * 1024 * 1024;
    const uploadOpts: BlockBlobUploadStreamOptions = {
      blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
      abortSignal: signal,
    };
    const r = await blob.uploadStream(body, blockSize, 4, uploadOpts);
    return { etag: r.etag ?? undefined, lastModified: r.lastModified?.toISOString() };
  }

  async deleteBlob(account: string, container: string, path: string): Promise<void> {
    const r = await this.container(account, container).getBlobClient(path).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`Blob '${path}' not found`);
  }

  async renameBlob(account: string, container: string, fromPath: string, toPath: string): Promise<void> {
    const c = this.container(account, container);
    const src = c.getBlobClient(fromPath);
    const dst = c.getBlobClient(toPath);
    const poller = await dst.beginCopyFromURL(src.url);
    await poller.pollUntilDone();
    await src.deleteIfExists();
  }

  /** Delete every blob whose name starts with prefix. Returns count deleted. */
  async deleteFolder(account: string, container: string, prefix: string): Promise<number> {
    if (!prefix || prefix === '/') throw ApiError.badRequest('prefix must be non-empty and not "/"');
    const c = this.container(account, container);
    let deleted = 0;
    for await (const b of c.listBlobsFlat({ prefix })) {
      const r = await c.getBlobClient(b.name).deleteIfExists();
      if (r.succeeded) deleted++;
    }
    return deleted;
  }
}

function mapStorageError(err: unknown, notFoundMessage: () => string): ApiError {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 404) return ApiError.notFound(notFoundMessage());
  if (status === 409) return ApiError.conflict('Storage conflict');
  if (status === 412) return ApiError.conflict('Precondition failed');
  if (status === 403) return ApiError.upstream('Storage refused access (check role assignments)');
  return ApiError.upstream(`Storage error${status ? ` (${status})` : ''}: ${(err as Error).message}`);
}
```

- [ ] **Step 3: Write integration test using Azurite**

`API/test/integration/blob-service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Readable } from 'node:stream';
import { BlobService } from '../../src/azure/blob-service.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

function svc() {
  // For Azurite we use shared-key auth; in production this is MI/TokenCredential.
  // We adapt by passing a fake "token credential" — actually wrap the shared key.
  const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
  // BlobService is typed against TokenCredential, but @azure/storage-blob's
  // BlobServiceClient accepts SharedKey too. We construct a service that hands
  // back the same credential:
  return new BlobService(cred as unknown as never, () => az.blobUrl);
}

describe('BlobService — integration', () => {
  it('creates, lists, deletes containers', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tcon');
    const list = await s.listContainers(az.accountName, { pageSize: 100 });
    expect(list.items.map((c) => c.name)).toContain('tcon');
    await s.deleteContainer(az.accountName, 'tcon');
  });

  it('uploads, reads, lists, deletes a blob', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tblob');
    const body = 'hello world';
    await s.uploadBlob(
      az.accountName, 'tblob', 'greeting.txt',
      Readable.from(Buffer.from(body)), 'text/plain', { blockSizeMb: 4 },
    );

    const head = await s.headBlob(az.accountName, 'tblob', 'greeting.txt');
    expect(head.contentLength).toBe(body.length);
    expect(head.contentType).toBe('text/plain');

    const r = await s.readBlob(az.accountName, 'tblob', 'greeting.txt');
    let data = '';
    for await (const chunk of r.stream) data += chunk.toString();
    expect(data).toBe(body);

    const ls = await s.listBlobs(az.accountName, 'tblob', { pageSize: 100 });
    expect(ls.items.find((i) => i.name === 'greeting.txt')).toBeTruthy();

    await s.deleteBlob(az.accountName, 'tblob', 'greeting.txt');
    await expect(s.deleteBlob(az.accountName, 'tblob', 'greeting.txt'))
      .rejects.toMatchObject({ status: 404 });

    await s.deleteContainer(az.accountName, 'tblob');
  });

  it('renames a blob', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'trename');
    await s.uploadBlob(az.accountName, 'trename', 'a.txt', Readable.from(Buffer.from('x')), 'text/plain', { blockSizeMb: 4 });
    await s.renameBlob(az.accountName, 'trename', 'a.txt', 'b.txt');
    const head = await s.headBlob(az.accountName, 'trename', 'b.txt');
    expect(head.contentLength).toBe(1);
    await expect(s.headBlob(az.accountName, 'trename', 'a.txt')).rejects.toMatchObject({ status: 404 });
    await s.deleteContainer(az.accountName, 'trename');
  });

  it('delete-folder removes everything under a prefix', async () => {
    const s = svc();
    await s.createContainer(az.accountName, 'tfold');
    for (const name of ['p/a.txt', 'p/b.txt', 'q/c.txt']) {
      await s.uploadBlob(az.accountName, 'tfold', name, Readable.from(Buffer.from('x')), 'text/plain', { blockSizeMb: 4 });
    }
    const n = await s.deleteFolder(az.accountName, 'tfold', 'p/');
    expect(n).toBe(2);
    const ls = await s.listBlobs(az.accountName, 'tfold', { pageSize: 100 });
    expect(ls.items.map((i) => i.name).sort()).toEqual(['q/c.txt']);
    await s.deleteContainer(az.accountName, 'tfold');
  });
});
```

> Implementation note: `BlobService` is typed as accepting a `TokenCredential` because production uses MI. Azurite for tests uses `StorageSharedKeyCredential`. The `@azure/storage-blob` `BlobServiceClient` constructor accepts both via overloads, so the cast in the test (`as unknown as never`) is acceptable in test code only.

- [ ] **Step 4: Run integration test**

```bash
cd API && npx vitest run test/integration/blob-service.test.ts
```
Expected: 4 PASS.

- [ ] **Step 5: Pause, commit**

```bash
git add API/src/azure/blob-service.ts API/src/util/pagination.ts API/test/integration/blob-service.test.ts
git commit -m "API: add BlobService (containers + blobs CRUD + rename + delete-folder) with Azurite tests"
```

---

### Task 15: Containers + Blobs HTTP routes

**Files:**
- Create: `API/src/util/abort.ts`
- Create: `API/src/streaming/proxy.ts`
- Create: `API/src/routes/containers.ts`
- Create: `API/src/routes/blobs.ts`
- Modify: `API/src/app.ts`
- Create: `API/test/integration/blob-routes.test.ts`

- [ ] **Step 1: Abort signal helper**

`API/src/util/abort.ts`:
```ts
import type { Request } from 'express';

export function abortSignalForRequest(req: Request): AbortSignal {
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  return ac.signal;
}
```

- [ ] **Step 2: Streaming proxy helper**

`API/src/streaming/proxy.ts`:
```ts
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { BlobReadHandle } from '../azure/blob-service.js';

export async function proxyDownload(res: Response, h: BlobReadHandle): Promise<void> {
  if (h.contentType) res.setHeader('Content-Type', h.contentType);
  if (h.contentLength !== undefined) res.setHeader('Content-Length', h.contentLength);
  if (h.etag) res.setHeader('ETag', h.etag);
  if (h.lastModified) res.setHeader('Last-Modified', h.lastModified);
  await pipeline(h.stream, res);
}
```

- [ ] **Step 3: Containers route**

`API/src/routes/containers.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { BlobService } from '../azure/blob-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';

const CreateBody = z.object({ name: z.string().min(1).max(63) });

export function containersRouter(svc: BlobService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router();

  r.get('/storages/:account/containers', requireRole('Reader'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listContainers(req.params.account, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  r.post('/storages/:account/containers', requireRole('Writer'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const body = CreateBody.parse(req.body);
      await svc.createContainer(req.params.account, body.name);
      res.status(201).json({ name: body.name });
    } catch (err) { next(err); }
  });

  r.delete('/storages/:account/containers/:container', requireRole('Admin'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      await svc.deleteContainer(req.params.account, req.params.container);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
```

- [ ] **Step 4: Blobs route**

`API/src/routes/blobs.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { BlobService } from '../azure/blob-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';
import { abortSignalForRequest } from '../util/abort.js';
import { proxyDownload } from '../streaming/proxy.js';

const RenameBody = z.object({ newPath: z.string().min(1) });

const BLOB_PREFIX = '/storages/:account/containers/:container/blobs';

export function blobsRouter(svc: BlobService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router({ mergeParams: true });

  const requireAccount = (req: import('express').Request): void => {
    if (!discovery.lookup(req.params.account)) {
      throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
    }
  };

  // List
  r.get(`${BLOB_PREFIX}`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listBlobs(req.params.account, req.params.container, {
        prefix: typeof req.query.prefix === 'string' ? req.query.prefix : undefined,
        delimiter: typeof req.query.delimiter === 'string' ? req.query.delimiter : undefined,
        pageSize: page.pageSize,
        continuationToken: page.continuationToken,
      });
      res.json(out);
    } catch (err) { next(err); }
  });

  // Delete-folder (must come before /:path* to avoid eating the route)
  r.delete(`${BLOB_PREFIX}`, requireRole('Admin'), async (req, res, next) => {
    try {
      requireAccount(req);
      const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
      const confirm = req.query.confirm === 'true';
      if (!prefix) throw ApiError.badRequest('prefix query parameter required');
      if (!confirm) throw ApiError.badRequest('confirm=true required for delete-folder');
      const n = await svc.deleteFolder(req.params.account, req.params.container, prefix);
      res.json({ deleted: n });
    } catch (err) { next(err); }
  });

  // Read (GET path) — wildcard
  r.get(`${BLOB_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const range = parseRangeHeader(req.header('range'));
      const handle = await svc.readBlob(req.params.account, req.params.container, path, range, abortSignalForRequest(req));
      await proxyDownload(res, handle);
    } catch (err) { next(err); }
  });

  // HEAD
  r.head(`${BLOB_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const meta = await svc.headBlob(req.params.account, req.params.container, path);
      if (meta.contentType) res.setHeader('Content-Type', meta.contentType);
      if (meta.contentLength !== undefined) res.setHeader('Content-Length', meta.contentLength);
      if (meta.etag) res.setHeader('ETag', meta.etag);
      if (meta.lastModified) res.setHeader('Last-Modified', meta.lastModified);
      res.end();
    } catch (err) { next(err); }
  });

  // Upload
  r.put(`${BLOB_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const ct = req.header('content-type');
      const r2 = await svc.uploadBlob(
        req.params.account, req.params.container, path,
        req, ct, { blockSizeMb: config.uploads.streamBlockSizeMb },
        abortSignalForRequest(req),
      );
      res.status(201).json({ etag: r2.etag, lastModified: r2.lastModified });
    } catch (err) { next(err); }
  });

  // Delete
  r.delete(`${BLOB_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      await svc.deleteBlob(req.params.account, req.params.container, path);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Rename
  r.post(`${BLOB_PREFIX}/*path:rename`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const body = RenameBody.parse(req.body);
      await svc.renameBlob(req.params.account, req.params.container, path, body.newPath);
      res.json({ from: path, to: body.newPath });
    } catch (err) { next(err); }
  });

  return r;
}

function decodePath(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((s) => decodeURIComponent(String(s))).join('/');
  return decodeURIComponent(String(raw ?? ''));
}

function parseRangeHeader(h?: string): { offset: number; count?: number } | undefined {
  if (!h) return undefined;
  const m = /^bytes=(\d+)-(\d*)$/.exec(h);
  if (!m) return undefined;
  const offset = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined ? { offset, count: end - offset + 1 } : { offset };
}
```

- [ ] **Step 5: Wire into `app.ts`**

In `API/src/app.ts` add:
```ts
import { containersRouter } from './routes/containers.js';
import { blobsRouter } from './routes/blobs.js';
import { BlobService } from './azure/blob-service.js';
```

Extend `BuildAppOptions` with `blobService: BlobService` (and keep `discovery`):
```ts
export type BuildAppOptions = {
  config: Config;
  readinessChecks?: ReadinessChecks;
  authOverride?: RequestHandler;
  discovery: AccountDiscovery;
  blobService: BlobService;
};
```

After mounting `storagesRouter`:
```ts
  app.use(containersRouter(opts.blobService, opts.discovery, opts.config));
  app.use(blobsRouter(opts.blobService, opts.discovery, opts.config));
```

In `API/src/index.ts`, instantiate it:
```ts
import { BlobService } from './azure/blob-service.js';
// ...
const blobService = new BlobService(credential, (account) => discovery.lookup(account)?.blobEndpoint ?? `https://${account}.blob.core.windows.net`);
const app = buildApp({ config, discovery, blobService, readinessChecks: { arm: async () => discovery.list().length >= 0 } });
```

- [ ] **Step 6: Integration test for routes**

`API/test/integration/blob-routes.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { BlobService } from '../../src/azure/blob-service.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { buildApp } from '../../src/app.js';
import { disabledModeConfig } from '../helpers/test-app.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';

let az: AzuriteHandle;

beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

function appFor(role: 'Reader' | 'Writer' | 'Admin') {
  const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
  const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
    allowed: [], refreshMin: 60,
  });
  return discovery.refresh().then(() => buildApp({
    config: disabledModeConfig(role),
    authOverride: anonymousPrincipalMiddleware(role),
    discovery, blobService,
  }));
}

describe('Blob routes — RBAC + happy path', () => {
  it('Reader can list, cannot upload', async () => {
    const app = await appFor('Reader');
    const list = await request(app).get(`/storages/${az.accountName}/containers`);
    expect(list.status).toBe(200);
    const upload = await request(app)
      .put(`/storages/${az.accountName}/containers/x/blobs/y.txt`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(upload.status).toBe(403);
  });

  it('Writer round-trip: create container, upload, read, head, delete', async () => {
    const app = await appFor('Writer');
    const acc = az.accountName;
    let r = await request(app).post(`/storages/${acc}/containers`).send({ name: 'rt' });
    expect(r.status).toBe(201);
    r = await request(app).put(`/storages/${acc}/containers/rt/blobs/hello.txt`)
      .set('Content-Type', 'text/plain').send('hello');
    expect(r.status).toBe(201);
    r = await request(app).head(`/storages/${acc}/containers/rt/blobs/hello.txt`);
    expect(r.status).toBe(200);
    expect(r.headers['content-length']).toBe('5');
    r = await request(app).get(`/storages/${acc}/containers/rt/blobs/hello.txt`);
    expect(r.status).toBe(200);
    expect(r.text).toBe('hello');
    r = await request(app).delete(`/storages/${acc}/containers/rt/blobs/hello.txt`);
    expect(r.status).toBe(204);
  });

  it('Admin delete-folder requires confirm', async () => {
    const app = await appFor('Admin');
    const acc = az.accountName;
    await request(app).post(`/storages/${acc}/containers`).send({ name: 'df' });
    await request(app).put(`/storages/${acc}/containers/df/blobs/p/a.txt`).set('Content-Type', 'text/plain').send('x');
    await request(app).put(`/storages/${acc}/containers/df/blobs/p/b.txt`).set('Content-Type', 'text/plain').send('x');

    let r = await request(app).delete(`/storages/${acc}/containers/df/blobs?prefix=p/`);
    expect(r.status).toBe(400);
    r = await request(app).delete(`/storages/${acc}/containers/df/blobs?prefix=p/&confirm=true`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(2);
  });
});
```

- [ ] **Step 7: Run**

```bash
cd API && npx vitest run test/integration/blob-routes.test.ts
```
Expected: 3 PASS.

- [ ] **Step 8: Pause, commit**

```bash
git add API/src/util/abort.ts API/src/streaming/proxy.ts API/src/routes/containers.ts API/src/routes/blobs.ts API/src/app.ts API/src/index.ts API/test/integration/blob-routes.test.ts
git commit -m "API: add containers + blobs HTTP routes (CRUD + rename + delete-folder + range)"
```

---

## Phase 8 — File-share ops

### Task 16: FileService (shares + dirs + files)

**Files:**
- Create: `API/src/azure/file-service.ts`
- Create: `API/test/unit/file-service.test.ts` (mocked SDK)

> Azure Files OAuth-on-REST uses the `ShareServiceClient` with a `TokenCredential`. Azurite has limited file-share support; v1 does mocked unit tests against the SDK surface and defers a live emulator integration to a follow-up plan if real Azure smoke tests aren't sufficient.

- [ ] **Step 1: Write FileService**

`API/src/azure/file-service.ts`:
```ts
import {
  ShareServiceClient,
  ShareClient,
  ShareDirectoryClient,
  type FileUploadStreamOptionalParams,
} from '@azure/storage-file-share';
import type { TokenCredential } from '@azure/identity';
import { Readable } from 'node:stream';
import { ApiError } from '../errors/api-error.js';

export type FileListItem = {
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
};

export class FileService {
  constructor(
    private readonly credential: TokenCredential,
    private readonly resolveEndpoint: (account: string) => string
  ) {}

  private svc(account: string): ShareServiceClient {
    return new ShareServiceClient(this.resolveEndpoint(account), this.credential);
  }
  private share(account: string, share: string): ShareClient {
    return this.svc(account).getShareClient(share);
  }
  private dir(account: string, share: string, path: string): ShareDirectoryClient {
    return this.share(account, share).getDirectoryClient(path);
  }

  async listShares(account: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: { name: string; quotaGiB?: number }[]; continuationToken: string | null }> {
    const iter = this.svc(account).listShares().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    return {
      items: (r.value.shareItems ?? []).map((s) => ({ name: s.name, quotaGiB: s.properties?.quota })),
      continuationToken: r.value.continuationToken ?? null,
    };
  }

  async createShare(account: string, name: string, quotaGiB?: number): Promise<void> {
    const r = await this.share(account, name).createIfNotExists({ quota: quotaGiB });
    if (!r.succeeded) throw ApiError.conflict(`Share '${name}' already exists`);
  }

  async deleteShare(account: string, name: string): Promise<void> {
    const r = await this.share(account, name).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`Share '${name}' not found`);
  }

  async listDir(account: string, share: string, path: string, page: { pageSize: number; continuationToken?: string }): Promise<{ items: FileListItem[]; continuationToken: string | null }> {
    const dir = this.dir(account, share, path);
    const iter = dir.listFilesAndDirectories().byPage({ maxPageSize: page.pageSize, continuationToken: page.continuationToken });
    const r = await iter.next();
    if (r.done) return { items: [], continuationToken: null };
    const items: FileListItem[] = [];
    for (const f of r.value.segment.files ?? []) items.push({ name: f.name, isDirectory: false, size: f.properties.contentLength });
    for (const d of r.value.segment.directories ?? []) items.push({ name: d.name, isDirectory: true });
    return { items, continuationToken: r.value.continuationToken ?? null };
  }

  async readFile(account: string, share: string, path: string, signal?: AbortSignal): Promise<{ stream: NodeJS.ReadableStream; contentType?: string; contentLength?: number; etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    const f = this.dir(account, share, dir).getFileClient(file);
    try {
      const dl = await f.download(0, undefined, { abortSignal: signal });
      return {
        stream: dl.readableStreamBody as NodeJS.ReadableStream,
        contentType: dl.contentType ?? undefined,
        contentLength: dl.contentLength ?? undefined,
        etag: dl.etag ?? undefined,
        lastModified: dl.lastModified?.toISOString(),
      };
    } catch (err) {
      throw mapStorageError(err, () => `File '${path}' not found in share '${share}'`);
    }
  }

  async headFile(account: string, share: string, path: string): Promise<{ contentType?: string; contentLength?: number; etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    const f = this.dir(account, share, dir).getFileClient(file);
    try {
      const p = await f.getProperties();
      return { contentType: p.contentType ?? undefined, contentLength: p.contentLength ?? undefined, etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
    } catch (err) {
      throw mapStorageError(err, () => `File '${path}' not found in share '${share}'`);
    }
  }

  async uploadFile(account: string, share: string, path: string, body: Readable, sizeBytes: number, contentType: string | undefined, signal?: AbortSignal): Promise<{ etag?: string; lastModified?: string }> {
    const { dir, file } = this.splitPath(path);
    await this.ensureDirChain(account, share, dir);
    const f = this.dir(account, share, dir).getFileClient(file);
    const opts: FileUploadStreamOptionalParams = {
      fileHttpHeaders: contentType ? { fileContentType: contentType } : undefined,
      abortSignal: signal,
    };
    await f.create(sizeBytes);
    await f.uploadStream(body, sizeBytes, 4 * 1024 * 1024, 4, opts);
    const p = await f.getProperties();
    return { etag: p.etag ?? undefined, lastModified: p.lastModified?.toISOString() };
  }

  async deleteFile(account: string, share: string, path: string): Promise<void> {
    const { dir, file } = this.splitPath(path);
    const r = await this.dir(account, share, dir).getFileClient(file).deleteIfExists();
    if (!r.succeeded) throw ApiError.notFound(`File '${path}' not found`);
  }

  async renameFile(account: string, share: string, fromPath: string, toPath: string): Promise<void> {
    const { dir: srcDir, file: srcFile } = this.splitPath(fromPath);
    const src = this.dir(account, share, srcDir).getFileClient(srcFile);
    await src.rename(toPath);
  }

  async deleteFolder(account: string, share: string, path: string): Promise<number> {
    if (!path || path === '/') throw ApiError.badRequest('path must be non-empty and not "/"');
    let count = 0;
    const walk = async (dirPath: string): Promise<void> => {
      const dir = this.dir(account, share, dirPath);
      for await (const item of dir.listFilesAndDirectories()) {
        const child = `${dirPath}/${item.name}`;
        if (item.kind === 'directory') {
          await walk(child);
          await this.dir(account, share, child).delete();
        } else {
          const r = await dir.getFileClient(item.name).deleteIfExists();
          if (r.succeeded) count++;
        }
      }
    };
    await walk(path);
    await this.dir(account, share, path).deleteIfExists();
    return count;
  }

  private splitPath(path: string): { dir: string; file: string } {
    const i = path.lastIndexOf('/');
    if (i === -1) return { dir: '', file: path };
    return { dir: path.slice(0, i), file: path.slice(i + 1) };
  }

  private async ensureDirChain(account: string, share: string, dir: string): Promise<void> {
    if (!dir) return;
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      await this.dir(account, share, cur).createIfNotExists();
    }
  }
}

function mapStorageError(err: unknown, notFoundMessage: () => string): ApiError {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 404) return ApiError.notFound(notFoundMessage());
  if (status === 403) return ApiError.upstream('Storage refused access (check role assignments)');
  if (status === 409) return ApiError.conflict('Storage conflict');
  return ApiError.upstream(`Storage error${status ? ` (${status})` : ''}: ${(err as Error).message}`);
}
```

- [ ] **Step 2: Mocked unit test**

`API/test/unit/file-service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { FileService } from '../../src/azure/file-service.js';

vi.mock('@azure/storage-file-share', () => {
  const fileClient = {
    create: vi.fn().mockResolvedValue({}),
    uploadStream: vi.fn().mockResolvedValue({}),
    getProperties: vi.fn().mockResolvedValue({ etag: 'e', lastModified: new Date(), contentLength: 3, contentType: 'text/plain' }),
    deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
    rename: vi.fn().mockResolvedValue({}),
    download: vi.fn().mockResolvedValue({ readableStreamBody: null, contentLength: 3, contentType: 'text/plain' }),
  };
  const dirClient = {
    getFileClient: vi.fn(() => fileClient),
    createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
    listFilesAndDirectories: vi.fn(() => ({
      byPage: () => ({
        next: async () => ({ done: false, value: { segment: { files: [{ name: 'a.txt', properties: { contentLength: 1 } }], directories: [] }, continuationToken: null } }),
      }),
    })),
  };
  const shareClient = {
    getDirectoryClient: vi.fn(() => dirClient),
    createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
    deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
  };
  const svcClient = {
    getShareClient: vi.fn(() => shareClient),
    listShares: vi.fn(() => ({
      byPage: () => ({
        next: async () => ({ done: false, value: { shareItems: [{ name: 's1', properties: { quota: 5 } }], continuationToken: null } }),
      }),
    })),
  };
  return { ShareServiceClient: vi.fn(() => svcClient), ShareClient: vi.fn(), ShareDirectoryClient: vi.fn() };
});

describe('FileService — mocked SDK', () => {
  const svc = new FileService({} as never, () => 'https://fake');

  it('lists shares', async () => {
    const r = await svc.listShares('acct', { pageSize: 10 });
    expect(r.items.map((s) => s.name)).toEqual(['s1']);
  });

  it('creates a share', async () => {
    await expect(svc.createShare('acct', 's2', 5)).resolves.toBeUndefined();
  });

  it('lists dir', async () => {
    const r = await svc.listDir('acct', 's1', 'p', { pageSize: 10 });
    expect(r.items[0]).toEqual({ name: 'a.txt', isDirectory: false, size: 1 });
  });

  it('headFile returns metadata', async () => {
    const m = await svc.headFile('acct', 's1', 'p/a.txt');
    expect(m.contentType).toBe('text/plain');
    expect(m.contentLength).toBe(3);
  });
});
```

- [ ] **Step 3: Run**

```bash
cd API && npx vitest run test/unit/file-service.test.ts
```
Expected: 4 PASS.

- [ ] **Step 4: Pause, commit**

```bash
git add API/src/azure/file-service.ts API/test/unit/file-service.test.ts
git commit -m "API: add FileService (shares, dirs, files CRUD, rename, recursive delete)"
```

---

### Task 17: Shares + Files HTTP routes

**Files:**
- Create: `API/src/routes/shares.ts`
- Create: `API/src/routes/files.ts`
- Modify: `API/src/app.ts`
- Modify: `API/src/index.ts`
- Create: `API/test/unit/file-routes.test.ts`

- [ ] **Step 1: Implement shares route**

`API/src/routes/shares.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { FileService } from '../azure/file-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';

const CreateBody = z.object({ name: z.string().min(1).max(63), quotaGiB: z.number().int().positive().optional() });

export function sharesRouter(svc: FileService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router();

  r.get('/storages/:account/shares', requireRole('Reader'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listShares(req.params.account, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  r.post('/storages/:account/shares', requireRole('Writer'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const body = CreateBody.parse(req.body);
      await svc.createShare(req.params.account, body.name, body.quotaGiB);
      res.status(201).json({ name: body.name });
    } catch (err) { next(err); }
  });

  r.delete('/storages/:account/shares/:share', requireRole('Admin'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      await svc.deleteShare(req.params.account, req.params.share);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
```

- [ ] **Step 2: Implement files route**

`API/src/routes/files.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { FileService } from '../azure/file-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';
import { abortSignalForRequest } from '../util/abort.js';
import { proxyDownload } from '../streaming/proxy.js';

const RenameBody = z.object({ newPath: z.string().min(1) });
const FILE_PREFIX = '/storages/:account/shares/:share/files';

export function filesRouter(svc: FileService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router({ mergeParams: true });

  const requireAccount = (req: import('express').Request): void => {
    if (!discovery.lookup(req.params.account)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
  };

  // List dir
  r.get(FILE_PREFIX, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const out = await svc.listDir(req.params.account, req.params.share, path, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  // Delete-folder
  r.delete(FILE_PREFIX, requireRole('Admin'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = typeof req.query.path === 'string' ? req.query.path : undefined;
      const confirm = req.query.confirm === 'true';
      if (!path) throw ApiError.badRequest('path query parameter required');
      if (!confirm) throw ApiError.badRequest('confirm=true required for delete-folder');
      const n = await svc.deleteFolder(req.params.account, req.params.share, path);
      res.json({ deleted: n });
    } catch (err) { next(err); }
  });

  // Read
  r.get(`${FILE_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const handle = await svc.readFile(req.params.account, req.params.share, path, abortSignalForRequest(req));
      await proxyDownload(res, handle as never);
    } catch (err) { next(err); }
  });

  // HEAD
  r.head(`${FILE_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const m = await svc.headFile(req.params.account, req.params.share, path);
      if (m.contentType) res.setHeader('Content-Type', m.contentType);
      if (m.contentLength !== undefined) res.setHeader('Content-Length', m.contentLength);
      if (m.etag) res.setHeader('ETag', m.etag);
      if (m.lastModified) res.setHeader('Last-Modified', m.lastModified);
      res.end();
    } catch (err) { next(err); }
  });

  // Upload
  r.put(`${FILE_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const len = Number(req.header('content-length'));
      if (!Number.isFinite(len) || len < 0) throw ApiError.badRequest('Content-Length required');
      const ct = req.header('content-type');
      const r2 = await svc.uploadFile(req.params.account, req.params.share, path, req, len, ct, abortSignalForRequest(req));
      res.status(201).json(r2);
    } catch (err) { next(err); }
  });

  // Delete
  r.delete(`${FILE_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      await svc.deleteFile(req.params.account, req.params.share, path);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Rename
  r.post(`${FILE_PREFIX}/*path:rename`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const body = RenameBody.parse(req.body);
      await svc.renameFile(req.params.account, req.params.share, path, body.newPath);
      res.json({ from: path, to: body.newPath });
    } catch (err) { next(err); }
  });

  return r;
}

function decodePath(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((s) => decodeURIComponent(String(s))).join('/');
  return decodeURIComponent(String(raw ?? ''));
}
```

- [ ] **Step 3: Wire into `app.ts`**

Extend `BuildAppOptions` with `fileService: FileService`:
```ts
import { FileService } from './azure/file-service.js';
import { sharesRouter } from './routes/shares.js';
import { filesRouter } from './routes/files.js';

// in BuildAppOptions:
fileService: FileService;

// after blobsRouter:
app.use(sharesRouter(opts.fileService, opts.discovery, opts.config));
app.use(filesRouter(opts.fileService, opts.discovery, opts.config));
```

In `index.ts`:
```ts
import { FileService } from './azure/file-service.js';
const fileService = new FileService(credential, (account) => discovery.lookup(account)?.fileEndpoint ?? `https://${account}.file.core.windows.net`);
const app = buildApp({ config, discovery, blobService, fileService, readinessChecks: { arm: async () => discovery.list().length >= 0 } });
```

- [ ] **Step 4: Route-level RBAC unit test (with mocked services)**

`API/test/unit/file-routes.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sharesRouter } from '../../src/routes/shares.js';
import { filesRouter } from '../../src/routes/files.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';
import { disabledModeConfig } from '../helpers/test-app.js';

function buildAppWith(role: 'Reader' | 'Writer' | 'Admin') {
  const cfg = disabledModeConfig(role);
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: 'a1', subscriptionId: 's', resourceGroup: 'r', blobEndpoint: '', fileEndpoint: '' }] },
    allowed: [], refreshMin: 60,
  });
  return discovery.refresh().then(() => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(anonymousPrincipalMiddleware(role));
    const fileSvc = {
      listShares: vi.fn().mockResolvedValue({ items: [{ name: 's1' }], continuationToken: null }),
      createShare: vi.fn().mockResolvedValue(undefined),
      deleteShare: vi.fn().mockResolvedValue(undefined),
      listDir: vi.fn().mockResolvedValue({ items: [], continuationToken: null }),
      readFile: vi.fn(), headFile: vi.fn(), uploadFile: vi.fn(), deleteFile: vi.fn(), renameFile: vi.fn(), deleteFolder: vi.fn(),
    } as never;
    app.use(sharesRouter(fileSvc, discovery, cfg));
    app.use(filesRouter(fileSvc, discovery, cfg));
    app.use(errorMiddleware());
    return app;
  });
}

describe('Share + file routes RBAC', () => {
  it('Reader can list shares, cannot create', async () => {
    const app = await buildAppWith('Reader');
    expect((await request(app).get('/storages/a1/shares')).status).toBe(200);
    expect((await request(app).post('/storages/a1/shares').send({ name: 's2' })).status).toBe(403);
  });

  it('Writer can create, cannot delete share', async () => {
    const app = await buildAppWith('Writer');
    expect((await request(app).post('/storages/a1/shares').send({ name: 's2' })).status).toBe(201);
    expect((await request(app).delete('/storages/a1/shares/s1')).status).toBe(403);
  });

  it('Admin can delete', async () => {
    const app = await buildAppWith('Admin');
    expect((await request(app).delete('/storages/a1/shares/s1')).status).toBe(204);
  });

  it('delete-folder requires confirm', async () => {
    const app = await buildAppWith('Admin');
    expect((await request(app).delete('/storages/a1/shares/s1/files?path=x/')).status).toBe(400);
    expect((await request(app).delete('/storages/a1/shares/s1/files?path=x/&confirm=true')).status).toBe(200);
  });
});
```

- [ ] **Step 5: Run**

```bash
cd API && npx vitest run test/unit/file-routes.test.ts
```
Expected: 4 PASS.

- [ ] **Step 6: Pause, commit**

```bash
git add API/src/routes/shares.ts API/src/routes/files.ts API/src/app.ts API/src/index.ts API/test/unit/file-routes.test.ts
git commit -m "API: add shares + files HTTP routes with RBAC"
```

---

## Phase 9 — OpenAPI

### Task 18: openapi.yaml + /openapi.yaml + /docs

**Files:**
- Create: `API/openapi.yaml`
- Create: `API/src/routes/openapi.ts`
- Modify: `API/src/app.ts`
- Modify: `API/package.json` (lint script already added)
- Create: `API/test/unit/openapi.test.ts`

- [ ] **Step 1: Author openapi.yaml**

`API/openapi.yaml` — minimal but covers every endpoint defined in spec Section 6:

```yaml
openapi: 3.1.0
info:
  title: Storage Navigator API
  version: 0.1.0
  description: HTTP API brokering Azure Blob and Azure Files access behind toggleable OIDC and three global roles.
servers:
  - url: http://localhost:3000
    description: Local dev
security:
  - bearerAuth: []
paths:
  /.well-known/storage-nav-config:
    get:
      summary: Client auto-config
      security: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                oneOf:
                  - { $ref: '#/components/schemas/AuthEnabledConfig' }
                  - { $ref: '#/components/schemas/AuthDisabledConfig' }
  /healthz:
    get: { summary: Liveness, security: [], responses: { '200': { description: OK } } }
  /readyz:
    get: { summary: Readiness, security: [], responses: { '200': { description: Ready }, '503': { description: Not ready } } }
  /storages:
    get:
      summary: List visible storage accounts
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StorageList' }
  /storages/{account}/containers:
    parameters: [ { $ref: '#/components/parameters/account' } ]
    get:
      summary: List containers
      parameters: [ { $ref: '#/components/parameters/pageSize' }, { $ref: '#/components/parameters/continuationToken' } ]
      responses: { '200': { description: OK } }
    post:
      summary: Create container
      requestBody:
        required: true
        content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string } } } } }
      responses: { '201': { description: Created } }
  /storages/{account}/containers/{container}:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { $ref: '#/components/parameters/container' }
    delete:
      summary: Delete container
      responses: { '204': { description: Deleted } }
  /storages/{account}/containers/{container}/blobs:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { $ref: '#/components/parameters/container' }
    get:
      summary: List blobs
      parameters:
        - { name: prefix, in: query, schema: { type: string } }
        - { name: delimiter, in: query, schema: { type: string } }
        - { $ref: '#/components/parameters/pageSize' }
        - { $ref: '#/components/parameters/continuationToken' }
      responses: { '200': { description: OK } }
    delete:
      summary: Delete folder (recursive)
      parameters:
        - { name: prefix, in: query, required: true, schema: { type: string } }
        - { name: confirm, in: query, required: true, schema: { type: string, enum: ['true'] } }
      responses: { '200': { description: OK } }
  /storages/{account}/containers/{container}/blobs/{path}:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { $ref: '#/components/parameters/container' }
      - { name: path, in: path, required: true, schema: { type: string } }
    get: { summary: Read blob, responses: { '200': { description: OK }, '404': { description: NotFound } } }
    head: { summary: Blob metadata, responses: { '200': { description: OK } } }
    put: { summary: Upload blob, responses: { '201': { description: Created } } }
    delete: { summary: Delete blob, responses: { '204': { description: Deleted } } }
  /storages/{account}/shares:
    parameters: [ { $ref: '#/components/parameters/account' } ]
    get: { summary: List file shares, responses: { '200': { description: OK } } }
    post:
      summary: Create share
      requestBody:
        required: true
        content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string }, quotaGiB: { type: integer, minimum: 1 } } } } }
      responses: { '201': { description: Created } }
  /storages/{account}/shares/{share}:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { name: share, in: path, required: true, schema: { type: string } }
    delete: { summary: Delete share, responses: { '204': { description: Deleted } } }
  /storages/{account}/shares/{share}/files:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { name: share, in: path, required: true, schema: { type: string } }
    get: { summary: List dir, responses: { '200': { description: OK } } }
    delete:
      summary: Delete folder
      parameters:
        - { name: path, in: query, required: true, schema: { type: string } }
        - { name: confirm, in: query, required: true, schema: { type: string, enum: ['true'] } }
      responses: { '200': { description: OK } }
  /storages/{account}/shares/{share}/files/{path}:
    parameters:
      - { $ref: '#/components/parameters/account' }
      - { name: share, in: path, required: true, schema: { type: string } }
      - { name: path, in: path, required: true, schema: { type: string } }
    get: { summary: Read file, responses: { '200': { description: OK }, '404': { description: NotFound } } }
    head: { summary: File metadata, responses: { '200': { description: OK } } }
    put: { summary: Upload file, responses: { '201': { description: Created } } }
    delete: { summary: Delete file, responses: { '204': { description: Deleted } } }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  parameters:
    account: { name: account, in: path, required: true, schema: { type: string } }
    container: { name: container, in: path, required: true, schema: { type: string } }
    pageSize: { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 1000 } }
    continuationToken: { name: continuationToken, in: query, schema: { type: string } }
  schemas:
    AuthEnabledConfig:
      type: object
      required: [authEnabled, issuer, clientId, audience, scopes]
      properties:
        authEnabled: { type: boolean, enum: [true] }
        issuer: { type: string, format: uri }
        clientId: { type: string }
        audience: { type: string }
        scopes: { type: array, items: { type: string } }
    AuthDisabledConfig:
      type: object
      required: [authEnabled]
      properties:
        authEnabled: { type: boolean, enum: [false] }
    StorageList:
      type: object
      properties:
        items:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              blobEndpoint: { type: string }
              fileEndpoint: { type: string }
        continuationToken: { type: string, nullable: true }
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            correlationId: { type: string }
```

- [ ] **Step 2: Implement openapi route**

`API/src/routes/openapi.ts`:
```ts
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import type { Config } from '../config.js';

export function openapiRouter(config: Config): Router {
  const r = Router();
  const here = dirname(fileURLToPath(import.meta.url));
  // src/routes/ → ../../openapi.yaml
  const specPath = resolve(here, '../../openapi.yaml');
  const yamlText = readFileSync(specPath, 'utf8');
  const parsed = YAML.parse(yamlText);

  r.get('/openapi.yaml', (_req, res) => {
    res.setHeader('Content-Type', 'application/yaml');
    res.send(yamlText);
  });

  if (config.swaggerUiEnabled) {
    r.use('/docs', swaggerUi.serve, swaggerUi.setup(parsed));
  }
  return r;
}
```

- [ ] **Step 3: Wire**

In `API/src/app.ts`, add import + mount before health (so /docs is unauth):
```ts
import { openapiRouter } from './routes/openapi.js';
// after wellKnownRouter:
app.use(openapiRouter(opts.config));
```

- [ ] **Step 4: Test**

`API/test/unit/openapi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';

describe('openapi route', () => {
  it('serves /openapi.yaml', async () => {
    const cfg = loadConfig({ AUTH_ENABLED: 'false', ANON_ROLE: 'Reader' });
    const discovery = new AccountDiscovery({ adapter: { list: async () => [] }, allowed: [], refreshMin: 60 });
    await discovery.refresh();
    const app = buildApp({
      config: cfg, discovery,
      blobService: {} as never, fileService: {} as never,
    });
    const res = await request(app).get('/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('openapi: 3.1.0');
  });
});
```

- [ ] **Step 5: Run**

```bash
cd API && npx vitest run test/unit/openapi.test.ts
```
Expected: 1 PASS.

- [ ] **Step 6: Lint OpenAPI**

```bash
cd API && npm run lint:openapi
```
Expected: clean (warnings allowed; errors block).

- [ ] **Step 7: Pause, commit**

```bash
git add API/openapi.yaml API/src/routes/openapi.ts API/src/app.ts API/test/unit/openapi.test.ts
git commit -m "API: add OpenAPI 3.1 spec, /openapi.yaml endpoint, swagger-ui at /docs"
```

---

## Phase 10 — Containerization

### Task 19: Dockerfile

**Files:**
- Create: `API/Dockerfile`
- Create: `API/.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
.env
.env.local
test
*.log
```

- [ ] **Step 2: Write Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY openapi.yaml ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/openapi.yaml ./
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Build image**

```bash
cd API && docker build -t storage-navigator-api:dev .
```
Expected: build succeeds.

- [ ] **Step 4: Run image with auth disabled**

```bash
docker run --rm -p 3000:3000 -e AUTH_ENABLED=false -e ANON_ROLE=Reader storage-navigator-api:dev &
sleep 2
curl -s http://localhost:3000/healthz
docker stop $(docker ps -lq)
```
Expected: `{"status":"ok"}`. Note: `/storages` will fail without Azure credentials in the container — acceptable for this smoke test.

- [ ] **Step 5: Pause, commit**

```bash
git add API/Dockerfile API/.dockerignore
git commit -m "API: add multi-stage Dockerfile (Node 22 alpine, non-root)"
```

---

## Phase 11 — End-to-end acceptance

### Task 20: E2E auth-on flow against Azurite + mock IdP

**Files:**
- Create: `API/test/integration/e2e-auth-on.test.ts`

- [ ] **Step 1: Write E2E test**

`API/test/integration/e2e-auth-on.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { BlobService } from '../../src/azure/blob-service.js';
import { FileService } from '../../src/azure/file-service.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { startMockIdp, type MockIdp } from '../helpers/mock-idp.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import type { Config } from '../../src/config.js';
import { buildJwksGetter } from '../../src/auth/jwks-cache.js';
import { oidcMiddleware } from '../../src/auth/oidc-middleware.js';

let az: AzuriteHandle;
let idp: MockIdp;

beforeAll(async () => {
  az = await startAzurite();
  idp = await startMockIdp();
}, 30_000);
afterAll(async () => { await az.shutdown(); await idp.close(); });

describe('E2E — auth on', () => {
  it('rejects without token, accepts Reader, forbids Writer ops', async () => {
    const cfg: Config = {
      port: 0, logLevel: 'silent', authEnabled: true,
      oidc: {
        mode: 'enabled',
        issuer: idp.issuer,
        audience: 'storage-nav-api',
        clientId: 'cid',
        scopes: ['openid','role'],
        jwksCacheMin: 1,
        clockToleranceSec: 5,
        roleClaim: 'role',
        roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
      },
      azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
      pagination: { defaultPageSize: 200, maxPageSize: 1000 },
      uploads: { maxBytes: null, streamBlockSizeMb: 4 },
      swaggerUiEnabled: false,
      corsOrigins: [],
    };
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    // Custom authOverride that points at the mock IdP's JWKS
    const jwks = buildJwksGetter(idp.jwksUri, 1);
    const auth = oidcMiddleware({
      jwks, issuer: idp.issuer, audience: 'storage-nav-api',
      clockToleranceSec: 5, roleClaim: 'role',
      roleMap: { StorageReader: 'Reader', StorageWriter: 'Writer', StorageAdmin: 'Admin' },
    });
    const app = buildApp({ config: cfg, discovery, blobService, fileService, authOverride: auth });

    const acc = az.accountName;

    // No token → 401
    expect((await request(app).get('/storages')).status).toBe(401);

    // Reader token → list works, write blocked
    const reader = await idp.signToken({ sub: 'u1', role: 'StorageReader' }, { audience: 'storage-nav-api' });
    expect((await request(app).get('/storages').set('Authorization', `Bearer ${reader}`)).status).toBe(200);
    expect((await request(app).post(`/storages/${acc}/containers`).set('Authorization', `Bearer ${reader}`).send({ name: 'e2e' })).status).toBe(403);

    // Writer round-trip
    const writer = await idp.signToken({ sub: 'u2', role: 'StorageWriter' }, { audience: 'storage-nav-api' });
    expect((await request(app).post(`/storages/${acc}/containers`).set('Authorization', `Bearer ${writer}`).send({ name: 'e2e' })).status).toBe(201);
    expect((await request(app).put(`/storages/${acc}/containers/e2e/blobs/x.txt`).set('Authorization', `Bearer ${writer}`).set('Content-Type', 'text/plain').send('ok')).status).toBe(201);

    // Reader can read but not delete
    expect((await request(app).get(`/storages/${acc}/containers/e2e/blobs/x.txt`).set('Authorization', `Bearer ${reader}`)).status).toBe(200);
    expect((await request(app).delete(`/storages/${acc}/containers/e2e/blobs/x.txt`).set('Authorization', `Bearer ${reader}`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd API && npx vitest run test/integration/e2e-auth-on.test.ts
```
Expected: 1 PASS.

- [ ] **Step 3: Pause, commit**

```bash
git add API/test/integration/e2e-auth-on.test.ts
git commit -m "API: add E2E test (auth on, mock IdP, Azurite, RBAC matrix)"
```

---

### Task 21: E2E auth-off flow

**Files:**
- Create: `API/test/integration/e2e-auth-off.test.ts`

- [ ] **Step 1: Write test**

`API/test/integration/e2e-auth-off.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import { BlobService } from '../../src/azure/blob-service.js';
import { FileService } from '../../src/azure/file-service.js';
import { startAzurite, type AzuriteHandle } from '../helpers/azurite.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { disabledModeConfig } from '../helpers/test-app.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';

let az: AzuriteHandle;
beforeAll(async () => { az = await startAzurite(); }, 30_000);
afterAll(async () => { await az.shutdown(); });

describe('E2E — auth off', () => {
  it('Reader anon: list works, PUT forbidden', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = buildApp({
      config: disabledModeConfig('Reader'),
      authOverride: anonymousPrincipalMiddleware('Reader'),
      discovery, blobService, fileService,
    });
    expect((await request(app).get('/storages')).status).toBe(200);
    expect((await request(app).put(`/storages/${az.accountName}/containers/x/blobs/y.txt`).set('Content-Type', 'text/plain').send('z')).status).toBe(403);
  });

  it('Admin anon: full access', async () => {
    const cred = new StorageSharedKeyCredential(az.accountName, az.accountKey);
    const blobService = new BlobService(cred as unknown as never, () => az.blobUrl);
    const fileService = new FileService(cred as unknown as never, () => az.blobUrl);
    const discovery = new AccountDiscovery({
      adapter: { list: async () => [{ name: az.accountName, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: az.blobUrl, fileEndpoint: az.blobUrl }] },
      allowed: [], refreshMin: 60,
    });
    await discovery.refresh();
    const app = buildApp({
      config: disabledModeConfig('Admin'),
      authOverride: anonymousPrincipalMiddleware('Admin'),
      discovery, blobService, fileService,
    });
    const acc = az.accountName;
    expect((await request(app).post(`/storages/${acc}/containers`).send({ name: 'anon' })).status).toBe(201);
    expect((await request(app).delete(`/storages/${acc}/containers/anon`)).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd API && npx vitest run test/integration/e2e-auth-off.test.ts
```
Expected: 2 PASS.

- [ ] **Step 3: Pause, commit**

```bash
git add API/test/integration/e2e-auth-off.test.ts
git commit -m "API: add E2E auth-off test covering anonymous role enforcement"
```

---

## Phase 12 — Documentation + project bookkeeping

### Task 22: README quickstart

**Files:**
- Modify: `API/README.md`

- [ ] **Step 1: Replace `API/README.md`**

```markdown
# Storage Navigator API

HTTP API that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (`StorageReader`, `StorageWriter`, `StorageAdmin`). Designed to be the third backend type for the Storage Navigator client. Full design lives at `docs/design/plan-006-rbac-api.md`.

## Quickstart — local, auth disabled

```bash
cd API
cp .env.example .env
# Edit .env: AUTH_ENABLED=false, ANON_ROLE=Admin
npm install
npm run dev
```

Then:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/.well-known/storage-nav-config
curl http://localhost:3000/storages
```

(`/storages` requires reachable Azure credentials. Use `az login` locally — `DefaultAzureCredential` picks it up.)

## Quickstart — local, auth enabled (mock IdP)

Run the integration test suite — it spins up the mock IdP and Azurite and exercises every route end-to-end:

```bash
npm run test:integration
```

## Configuration

See `.env.example` for every supported variable. All required vars are validated at boot via zod; missing required vars cause the process to refuse to start (no fallbacks — by project rule).

| Var | Required | Purpose |
|---|---|---|
| `AUTH_ENABLED` | always | `true` or `false` |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OIDC_SCOPES`, `ROLE_MAP` | when `AUTH_ENABLED=true` | OIDC + role mapping |
| `ANON_ROLE` | when `AUTH_ENABLED=false` | Default role for anonymous callers |

## Testing

- `npm run test:unit` — vitest unit tests, no external deps
- `npm run test:integration` — spins up Azurite + mock IdP via the helpers in `test/helpers/`
- `npm run lint:openapi` — validates `openapi.yaml`

## Docker

```bash
docker build -t storage-navigator-api:dev .
docker run -p 3000:3000 --env-file .env storage-navigator-api:dev
```

## Endpoints

See `openapi.yaml` (also served at `GET /openapi.yaml`; `GET /docs` for Swagger UI when `SWAGGER_UI_ENABLED=true`).

## Deployment

Designed for Azure App Service (Linux, Node 22) with System-Assigned Managed Identity. MI requires:

- `Reader` on the in-scope subscription(s) for ARM enumeration
- `Storage Blob Data Contributor` on each storage account
- `Storage File Data Privileged Contributor` on each storage account (for OAuth-on-Files-REST)

Deploy via container image to ACR + App Service.
```

- [ ] **Step 2: Pause, commit**

```bash
git add API/README.md
git commit -m "API: add README quickstart + config + testing + deployment notes"
```

---

### Task 23: Update repo-level docs and CLAUDE.md tools list

**Files:**
- Modify: `/Users/thanos/Work/Repos/storage-navigator/CLAUDE.md` (add `<storage-nav-api>` tool block alongside `<storage-nav>`)
- Modify: `/Users/thanos/Work/Repos/storage-navigator/docs/design/project-design.md`
- Modify: `/Users/thanos/Work/Repos/storage-navigator/docs/design/project-functions.md`
- Modify: `/Users/thanos/Work/Repos/storage-navigator/Issues - Pending Items.md`

- [ ] **Step 1: Add `<storage-nav-api>` block to root `CLAUDE.md`**

Append after the existing `</storage-nav>` block (and before the next major section):

```markdown
<storage-nav-api>
    <objective>
        HTTP API that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (StorageReader, StorageWriter, StorageAdmin). Designed to be a third backend type for the Storage Navigator client. Implemented in the `API/` folder as a separate deployable.
    </objective>
    <command>
        cd API && npm run dev
    </command>
    <info>
        Lives in the `API/` folder at repo root. Own package.json, own deploy artifact (Azure App Service, Linux, Node 22).

        Auth: in-app OIDC via NBG IdentityServer (`https://my.nbg.gr/identity`). JWT validated locally via JWKS (`jose`). Toggleable with `AUTH_ENABLED=true|false`; when false `ANON_ROLE` env decides default role.

        Storage access: `DefaultAzureCredential` from `@azure/identity` resolves to System-Assigned MI on App Service and `az login` locally. Storage account discovery via `@azure/arm-storage` (MI needs Reader on subscription).

        URL shape: `/storages/{account}/containers[/{c}/blobs[/{path}]]` and `/storages/{account}/shares[/{s}/files[/{path}]]`. Discovery: `/.well-known/storage-nav-config`. Health: `/healthz`, `/readyz`. OpenAPI: `/openapi.yaml`, swagger UI at `/docs`.

        Commands (from `API/`):
          npm run dev                # tsx watch
          npm run build              # tsc -> dist/
          npm start                  # node dist/index.js
          npm run test               # vitest run
          npm run test:unit
          npm run test:integration   # Azurite + mock IdP
          npm run lint:openapi

        Design: `docs/design/plan-006-rbac-api.md`. Implementation plan: `docs/design/plan-006-rbac-api-impl.md`.
    </info>
</storage-nav-api>
```

- [ ] **Step 2: Update `project-design.md`** — add a top-level section describing the API service alongside the existing CLI/UI design.

Find the section that describes the architecture (search for `## Architecture` or similar) and append:

```markdown
## API service (Plan 006)

The `API/` folder houses a separate Node/TS deployable that exposes the same blob ops as the CLI/UI (plus Azure Files) behind an HTTP surface protected by OIDC. It uses System-Assigned Managed Identity to access Storage and the NBG IdentityServer for caller authentication. See `docs/design/plan-006-rbac-api.md` for the design and `docs/design/plan-006-rbac-api-impl.md` for the implementation plan. The Storage Navigator client gets a third backend type `api` (covered by a follow-up plan) that talks to this API instead of going to Azure Storage directly.
```

- [ ] **Step 3: Update `project-functions.md`** — add a new top-level section:

```markdown
## RBAC API (`API/`)

- HTTP API exposing Azure Blob + Azure Files behind OIDC + three roles (`StorageReader`, `StorageWriter`, `StorageAdmin`).
- Auth provider: NBG IdentityServer at `https://my.nbg.gr/identity`. JWT validated locally via JWKS.
- Toggleable auth: `AUTH_ENABLED=true|false`. When false, `ANON_ROLE` decides the default role.
- Discovery endpoint: `GET /.well-known/storage-nav-config` returns `{authEnabled, issuer, clientId, audience, scopes}`.
- URL shape:
  - `/storages` — list visible accounts
  - `/storages/{account}/containers[/{c}]` — container CRUD
  - `/storages/{account}/containers/{c}/blobs[/{path}]` — blob CRUD + rename + delete-folder
  - `/storages/{account}/shares[/{s}]` — share CRUD
  - `/storages/{account}/shares/{s}/files[/{path}]` — file CRUD + rename + delete-folder
- Storage access: `DefaultAzureCredential` (Managed Identity in App Service).
- Storage account discovery: ARM scan via `@azure/arm-storage`.
- Reads proxy-streamed through the API; writes streamed; client disconnects cancel via `AbortSignal`.
- Pagination: `?pageSize=` (default 200, max 1000), `?continuationToken=`.
- Errors: `{error: {code, message, correlationId}}`.
- Tests: vitest unit + integration (Azurite + mock IdP).
- Deployment: Azure App Service Linux Node 22 with System-Assigned MI; container via multi-stage Dockerfile.
```

- [ ] **Step 4: Mark spec Section 11 as a future plan in `Issues - Pending Items.md`**

Insert under `### Medium Priority`:

```markdown
- **Storage Navigator client adapter for the new `api` backend type (Plan 006 spec, Section 11)**: The API service in `API/` is implemented (Plan 006 impl), but the Storage Navigator client (CLI + Electron) does not yet support the `api` backend type. Follow-up plan needed: introduce `src/core/backend/` abstraction with `direct-backend.ts` and `api-backend.ts`, OIDC client (PKCE for Electron, device-code for CLI), token store (Electron `safeStorage` / CLI chmod-600), discovery client. Add `add-api`, `shares`, `files`, `file-view` CLI commands. Add "Connect to Storage Navigator API" option in Electron "Add Storage" dialog.
```

- [ ] **Step 5: Pause, commit**

```bash
git add CLAUDE.md docs/design/project-design.md docs/design/project-functions.md "Issues - Pending Items.md"
git commit -m "docs: register the new API service in CLAUDE.md tools, project-design, project-functions; track client adapter as pending follow-up"
```

---

### Task 24: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd API && npm test
```
Expected: all unit + integration pass.

- [ ] **Step 2: Verify TS build is clean**

```bash
cd API && npm run build
```

- [ ] **Step 3: Verify OpenAPI lint**

```bash
cd API && npm run lint:openapi
```

- [ ] **Step 4: Smoke run + curl every public endpoint**

```bash
cd API
AUTH_ENABLED=false ANON_ROLE=Admin npx tsx src/index.ts &
PID=$!
sleep 2
curl -sf http://localhost:3000/healthz
curl -sf http://localhost:3000/readyz
curl -sf http://localhost:3000/.well-known/storage-nav-config
curl -sf http://localhost:3000/openapi.yaml | head -1
kill $PID
```

Each curl must return without error (`-f` makes curl fail on non-2xx). The `/storages` call is intentionally not in the smoke list because it requires real Azure credentials.

- [ ] **Step 5: Acceptance-criteria walkthrough**

Confirm each acceptance criterion in spec Section 12 is satisfied by an existing test or smoke step:

| Spec criterion | Where verified |
|---|---|
| 1. API builds and starts | Task 24 Step 4 (smoke run) |
| 2. /healthz, /readyz | Task 6 unit tests + Task 24 smoke |
| 3. Auth-on 401/403 behaviour | Task 8 + Task 20 E2E |
| 4. Auth-off + ANON_ROLE=Reader | Task 21 E2E |
| 5. /.well-known/storage-nav-config | Task 7 unit + Task 24 smoke |
| 6. Blob + file CRUD against Azurite | Task 14 + Task 16 + Task 17 |
| 7. Client (CLI + Electron) round-trip | **Out of scope for this plan; future follow-up plan** |
| 8. OpenAPI lints | Task 18 |

Criterion 7 is explicitly deferred — the plan handoff note already records this. Tracked in `Issues - Pending Items.md` (Task 23 Step 4).

- [ ] **Step 6: Pause, no commit needed (verification only).**

---

## Self-review checklist

A quick post-write scan against the spec:

| Spec section | Coverage |
|---|---|
| 1 Overview, 2 Goals, 3 Non-goals | Tasks 1–22 align; client adapter (spec §11) explicitly deferred and tracked |
| 4 Architecture (App Service, MI, NBG, RS256 JWT) | Tasks 8–11 implement OIDC, MI singleton, ARM discovery |
| 5 Folder layout | Task 1 + each module-creating task |
| 6 URL surface (every row) | Tasks 13 (storages), 15 (containers + blobs), 17 (shares + files), 18 (openapi/docs), 6 (health), 7 (well-known) |
| 7 Auth flow (enabled + disabled, data flow, discovery) | Tasks 8, 9, 11; cancellation in Task 15 |
| 8 Configuration (every env var + zod) | Task 3 |
| 9 Errors / observability / testing | Tasks 4, 5; logging is structural; metrics deferred (env-gated, optional) |
| 10 Deployment (Dockerfile, App Service, MI roles) | Task 19 + README in Task 22 |
| 11 Client adapter | **Out of scope of this plan — follow-up plan** |
| 12 Acceptance criteria | Task 24 walkthrough |
| 13 Out-of-scope follow-ups | Tracked in Issues file (Task 23) |

Placeholder scan: no "TBD", "TODO", "implement later", or generic "add validation" steps. Every code-bearing step shows the code.

Type consistency: `Principal`, `AppRole`, `BuildAppOptions`, `DiscoveredAccount`, `BlobReadHandle`, `BlobListItem`, `FileListItem` are defined in their first task and reused unchanged in later tasks. The `BlobService` and `FileService` constructor signatures (`(credential, resolveEndpoint)`) match across the wiring tasks.

---

## Execution handoff

Plan complete and saved to `docs/design/plan-006-rbac-api-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints.

Which approach?
