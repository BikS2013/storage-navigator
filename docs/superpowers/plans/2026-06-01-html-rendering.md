# HTML Rendering for Stored Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-06-01-html-rendering-design.md`

**Goal:** Render HTML blobs and file-share files as web pages — inside the Electron viewer (sandboxed iframe) and via the HTTP API (so external browsers can navigate stored static sites) — for both blob containers and file shares, with a per-container/per-share trust toggle that relaxes the sandbox/CSP.

**Architecture:** One new server route per backend serves any blob/file at its real content-type (`/api/site/...` for blob, `/api/site-file/...` for file share). The Electron viewer points a sandboxed iframe at the same route. Because all assets are served from the same URL prefix, the browser resolves relative URLs (`./styles.css`, `images/foo.png`, sibling pages) natively — no rewriting. A per-container/per-share `trustedHtml*` array persisted in the encrypted credential store controls iframe-sandbox flags and CSP strictness.

**Tech Stack:** Express 5 (existing server), Node streams, Electron 35 (existing main + preload + renderer), AES-256-GCM credential store (existing), vitest (existing test runner).

**Version-control note:** Per project rule, no `git commit` is executed by this plan unless the user explicitly asks. The "Commit" steps are documented but only run on explicit request.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/core/types.ts` | Modify | Add `trustedHtmlContainers?: string[]` and `trustedHtmlShares?: string[]` to `DirectStorageEntry` and `ApiBackendEntry`. |
| `src/core/credential-store.ts` | Modify | Add `isHtmlTrusted(storage, scope, name)` / `setHtmlTrust(storage, scope, name, trusted)` helpers. |
| `src/electron/site-routes.ts` | Create | Single small module that registers `/api/site`, `/api/site-file`, `/api/trust`, `/api/trust-file` routes. Keeps `server.ts` from growing further. |
| `src/electron/server.ts` | Modify | Wire `registerSiteRoutes(app)` from the new module. |
| `src/util/site-path.ts` | Create | Pure helper: decode + normalise path, reject `..` segments. Reused by routes and tested in isolation. |
| `src/electron/public/html-view.js` | Create | Tiny renderer module: builds the sandboxed iframe, manages the Trust / Open-in-browser / View-source toolbar. |
| `src/electron/public/app.js` | Modify | Dispatch to `html-view.js` for `.html` / `.htm` blobs and share files; keep `?view=source` escape hatch. |
| `src/electron/preload.cjs` | Modify | Allowlist new IPC channel `shell:open-external`. |
| `src/electron/main.ts` | Modify | Register `ipcMain.handle('shell:open-external', …)` using existing `shell.openExternal`. |
| `tests/unit/site-path.test.ts` | Create | Unit tests for path normalisation. |
| `tests/unit/site-routes.test.ts` | Create | Route tests: blob+file symmetry, CSP, content-type fallback, 404/403 dual format. |
| `tests/unit/trust-routes.test.ts` | Create | GET/PUT round-trip + credential-store persistence. |
| `tests/unit/html-view.test.ts` | Create | Renderer test (JSDOM) — sandbox computed from trust flag, iframe src built from storage/container/path. |
| `README.md` | Modify | Add short "HTML rendering" section explaining trust toggle and security model. |

---

## Task 1: Add `trustedHtml*` arrays to credential types

**Files:**
- Modify: `src/core/types.ts:1-30`
- Test: `tests/unit/types-discriminator.test.ts` (existing; will extend in Task 2)

- [ ] **Step 1: Extend the type definitions.**

Edit `src/core/types.ts`. In `DirectStorageEntry` (lines 1-8), add the two optional arrays. In `ApiBackendEntry` (lines 17-30), add the same two fields.

```typescript
export type DirectStorageEntry = {
  kind: 'direct';
  name: string;
  accountName: string;
  sasToken?: string;
  accountKey?: string;
  addedAt: string;
  /** Container names within this storage whose HTML may run with relaxed sandbox/CSP. */
  trustedHtmlContainers?: string[];
  /** Share names within this storage whose HTML may run with relaxed sandbox/CSP. */
  trustedHtmlShares?: string[];
};
```

```typescript
export type ApiBackendEntry = {
  kind: 'api';
  name: string;
  baseUrl: string;
  authEnabled: boolean;
  oidc?: OidcConfig;
  staticAuthHeader?: { name: string; value: string };
  addedAt: string;
  /** Container names whose HTML may run with relaxed sandbox/CSP. */
  trustedHtmlContainers?: string[];
  /** Share names whose HTML may run with relaxed sandbox/CSP. */
  trustedHtmlShares?: string[];
};
```

- [ ] **Step 2: Build the project to confirm types compile.**

Run: `npx tsc --noEmit`
Expected: zero errors. The fields are optional, so no existing consumer breaks.

---

## Task 2: Credential-store trust helpers

**Files:**
- Modify: `src/core/credential-store.ts` (add methods near line 263)
- Test: `tests/unit/credential-trust.test.ts` (create)

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/credential-trust.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Force a fresh, isolated store dir per test.
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-trust-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CredentialStore HTML trust', () => {
  it('defaults to untrusted', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(false);
    expect(store.isHtmlTrusted('s1', 'share', 'sh1')).toBe(false);
  });

  it('round-trips trust for containers', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'container', 'c1', true);
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(true);
    // Independent re-load reads it back from disk.
    const store2 = new CredentialStore();
    expect(store2.isHtmlTrusted('s1', 'container', 'c1')).toBe(true);
  });

  it('round-trips trust for shares independently from containers', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'share', 'sh1', true);
    expect(store.isHtmlTrusted('s1', 'share', 'sh1')).toBe(true);
    expect(store.isHtmlTrusted('s1', 'container', 'sh1')).toBe(false);
  });

  it('setHtmlTrust(false) removes the entry without leaving duplicates', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'container', 'c1', true);
    store.setHtmlTrust('s1', 'container', 'c1', true); // idempotent
    store.setHtmlTrust('s1', 'container', 'c1', false);
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(false);
    const entry = store.getStorage('s1') as { trustedHtmlContainers?: string[] };
    expect(entry.trustedHtmlContainers ?? []).toEqual([]);
  });

  it('throws when storage name does not exist', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    expect(() => store.setHtmlTrust('nope', 'container', 'c1', true))
      .toThrow(/Storage 'nope' not found/);
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail.**

Run: `npx vitest run tests/unit/credential-trust.test.ts`
Expected: FAIL — `store.isHtmlTrusted` / `store.setHtmlTrust` are undefined.

- [ ] **Step 3: Implement the helpers.**

Edit `src/core/credential-store.ts`. Add these methods inside the `CredentialStore` class (after `removeStorage`, around line 252):

```typescript
  /**
   * Is this container / share's HTML trusted to run with a relaxed
   * iframe sandbox and CSP? Default false.
   */
  isHtmlTrusted(storageName: string, scope: 'container' | 'share', name: string): boolean {
    const entry = this.data.storages.find((s) => s.name === storageName);
    if (!entry) return false;
    const list = scope === 'container' ? entry.trustedHtmlContainers : entry.trustedHtmlShares;
    return Array.isArray(list) && list.includes(name);
  }

  /**
   * Set the trust flag for a container / share. Idempotent. Persists immediately.
   * Throws when the storage name is unknown — callers should pre-validate.
   */
  setHtmlTrust(storageName: string, scope: 'container' | 'share', name: string, trusted: boolean): void {
    const entry = this.data.storages.find((s) => s.name === storageName);
    if (!entry) throw new Error(`Storage '${storageName}' not found`);
    const key = scope === 'container' ? 'trustedHtmlContainers' : 'trustedHtmlShares';
    const current = new Set<string>(entry[key] ?? []);
    if (trusted) current.add(name); else current.delete(name);
    (entry as Record<string, unknown>)[key] = Array.from(current);
    this.save();
  }
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `npx vitest run tests/unit/credential-trust.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: (Optional) Commit — only on explicit user request.**

```bash
git add src/core/types.ts src/core/credential-store.ts tests/unit/credential-trust.test.ts
git commit -m "feat(credentials): per-container/share HTML trust flag"
```

---

## Task 3: Pure path-normalisation helper

**Files:**
- Create: `src/util/site-path.ts`
- Test: `tests/unit/site-path.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/site-path.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normaliseSitePath, SitePathError } from '../../src/util/site-path.js';

describe('normaliseSitePath', () => {
  it('returns a simple relative path unchanged after URL-decoding', () => {
    expect(normaliseSitePath('dir/index.html')).toBe('dir/index.html');
    expect(normaliseSitePath('dir%2Findex.html')).toBe('dir/index.html');
  });

  it('strips a leading slash', () => {
    expect(normaliseSitePath('/dir/x.html')).toBe('dir/x.html');
  });

  it('treats an empty or "/" path as the root marker ""', () => {
    expect(normaliseSitePath('')).toBe('');
    expect(normaliseSitePath('/')).toBe('');
  });

  it('rejects literal traversal segments', () => {
    expect(() => normaliseSitePath('../etc/passwd')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/../b')).toThrow(SitePathError);
  });

  it('rejects URL-encoded traversal segments', () => {
    expect(() => normaliseSitePath('%2E%2E/etc/passwd')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/%2e%2e/b')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/%2E./b')).toThrow(SitePathError);
  });

  it('rejects backslash segments (Windows-style traversal)', () => {
    expect(() => normaliseSitePath('a\\..\\b')).toThrow(SitePathError);
  });

  it('rejects NUL bytes', () => {
    expect(() => normaliseSitePath('a/ b')).toThrow(SitePathError);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module missing).**

Run: `npx vitest run tests/unit/site-path.test.ts`
Expected: FAIL — `Cannot find module '.../site-path.js'`.

- [ ] **Step 3: Implement `site-path.ts`.**

Create `src/util/site-path.ts`:

```typescript
export class SitePathError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SitePathError'; }
}

/**
 * Normalise a URL-path segment supplied by a client into a safe relative
 * blob/file path. Returns "" for the container/share root.
 *
 * Rejects (with SitePathError) any input that, after URL decoding and
 * separator normalisation, contains a `..` segment, a NUL byte, or a
 * backslash. The caller is expected to pass the value to the storage
 * backend verbatim after this returns.
 */
export function normaliseSitePath(raw: string): string {
  if (raw == null) return '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new SitePathError('invalid percent-encoding');
  }
  if (decoded.includes(' ')) throw new SitePathError('NUL byte not allowed');
  if (decoded.includes('\\')) throw new SitePathError('backslash not allowed');
  // Strip leading slash; empty == root.
  const stripped = decoded.replace(/^\/+/, '');
  if (stripped === '') return '';
  const segments = stripped.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') throw new SitePathError(`forbidden segment: ${seg}`);
  }
  return stripped;
}
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `npx vitest run tests/unit/site-path.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: (Optional) Commit — only on explicit user request.**

```bash
git add src/util/site-path.ts tests/unit/site-path.test.ts
git commit -m "feat(util): site path normaliser with traversal rejection"
```

---

## Task 4: `/api/trust*` routes

**Files:**
- Create: `src/electron/site-routes.ts` (initial — trust routes only; site routes added in Task 5)
- Modify: `src/electron/server.ts` (wire `registerSiteRoutes(app)`)
- Test: `tests/unit/trust-routes.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/trust-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-trust-rt-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function buildApp() {
  const { CredentialStore } = await import('../../src/core/credential-store.js');
  const store = new CredentialStore();
  store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
  const { registerSiteRoutes } = await import('../../src/electron/site-routes.js');
  const app = express();
  app.use(express.json());
  registerSiteRoutes(app);
  return app;
}

describe('GET/PUT /api/trust', () => {
  it('GET returns trusted=false by default for an unknown container', async () => {
    const app = await buildApp();
    const r = await request(app).get('/api/trust/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ trusted: false });
  });

  it('PUT { trusted: true } persists; subsequent GET sees true', async () => {
    const app = await buildApp();
    const put = await request(app).put('/api/trust/s1/c1').send({ trusted: true });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ trusted: true });
    const get = await request(app).get('/api/trust/s1/c1');
    expect(get.body.trusted).toBe(true);
  });

  it('PUT validates the body', async () => {
    const app = await buildApp();
    const r = await request(app).put('/api/trust/s1/c1').send({ trusted: 'yes' });
    expect(r.status).toBe(400);
  });

  it('PUT 404s on unknown storage', async () => {
    const app = await buildApp();
    const r = await request(app).put('/api/trust/nope/c1').send({ trusted: true });
    expect(r.status).toBe(404);
  });

  it('share endpoint is independent from container endpoint', async () => {
    const app = await buildApp();
    await request(app).put('/api/trust/s1/shared-name').send({ trusted: true });
    const container = await request(app).get('/api/trust/s1/shared-name');
    expect(container.body.trusted).toBe(true);
    const share = await request(app).get('/api/trust-file/s1/shared-name');
    expect(share.body.trusted).toBe(false);
  });
});
```

- [ ] **Step 2: Install supertest if missing, then run the test — expect FAIL (module missing).**

```bash
npm ls supertest || npm install --save-dev supertest @types/supertest
npx vitest run tests/unit/trust-routes.test.ts
```
Expected: FAIL — `Cannot find module '.../site-routes.js'`.

> Dependency-vetting note (per project rule): `supertest` is widely used in the test toolchain. Before installing, run `npm audit --package supertest@latest --json` and confirm zero HIGH-or-above advisories. Record the vetted-on date in `Issues - Pending Items.md` under "Dependency vetting log".

- [ ] **Step 3: Implement `site-routes.ts` (trust routes only).**

Create `src/electron/site-routes.ts`:

```typescript
import type express from 'express';
import { CredentialStore } from '../core/credential-store.js';

type Scope = 'container' | 'share';

function handleTrustGet(scope: Scope) {
  return (req: express.Request, res: express.Response) => {
    const store = new CredentialStore();
    const storageName = req.params.storage;
    if (!store.getStorage(storageName)) {
      res.status(404).json({ error: `Storage '${storageName}' not found` });
      return;
    }
    const name = scope === 'container' ? req.params.container : req.params.share;
    res.json({ trusted: store.isHtmlTrusted(storageName, scope, name) });
  };
}

function handleTrustPut(scope: Scope) {
  return (req: express.Request, res: express.Response) => {
    const body = req.body as { trusted?: unknown };
    if (typeof body?.trusted !== 'boolean') {
      res.status(400).json({ error: "JSON body field 'trusted' (boolean) required" });
      return;
    }
    const store = new CredentialStore();
    const storageName = req.params.storage;
    if (!store.getStorage(storageName)) {
      res.status(404).json({ error: `Storage '${storageName}' not found` });
      return;
    }
    const name = scope === 'container' ? req.params.container : req.params.share;
    store.setHtmlTrust(storageName, scope, name, body.trusted);
    res.json({ trusted: body.trusted });
  };
}

export function registerSiteRoutes(app: express.Express): void {
  app.get('/api/trust/:storage/:container', handleTrustGet('container'));
  app.put('/api/trust/:storage/:container', handleTrustPut('container'));
  app.get('/api/trust-file/:storage/:share', handleTrustGet('share'));
  app.put('/api/trust-file/:storage/:share', handleTrustPut('share'));
  // Site routes added in Task 5.
}
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `npx vitest run tests/unit/trust-routes.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Wire `registerSiteRoutes` into the real server.**

Edit `src/electron/server.ts`. Near the top of `createServer`, after `app.use(express.static(publicDir));` (around line 69), add:

```typescript
import { registerSiteRoutes } from './site-routes.js';
// …
  app.use(express.static(publicDir));
  registerSiteRoutes(app);
```

(Add the `import` at the top of the file alongside the others.)

- [ ] **Step 6: Run full test suite — confirm nothing else broke.**

Run: `npx vitest run`
Expected: all tests still pass, including the new credential-trust + site-path + trust-routes suites.

- [ ] **Step 7: (Optional) Commit — only on explicit user request.**

```bash
git add src/electron/site-routes.ts src/electron/server.ts tests/unit/trust-routes.test.ts package.json package-lock.json
git commit -m "feat(server): per-container/share HTML trust GET/PUT routes"
```

---

## Task 5: `/api/site` + `/api/site-file` routes

**Files:**
- Modify: `src/electron/site-routes.ts` (add the two streaming routes)
- Test: `tests/unit/site-routes.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/site-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-site-rt-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeBackend(map: Record<string, { ct?: string; body: string }>) {
  return {
    readBlob: vi.fn(async (_c: string, p: string) => {
      const v = map[p];
      if (!v) throw new Error(`Blob '${p}' not found`);
      return { stream: Readable.from(Buffer.from(v.body)), contentType: v.ct, contentLength: v.body.length };
    }),
    readFile: vi.fn(async (_s: string, p: string) => {
      const v = map[p];
      if (!v) throw new Error(`File '${p}' not found`);
      return { stream: Readable.from(Buffer.from(v.body)), contentType: v.ct, contentLength: v.body.length };
    }),
  };
}

async function buildApp(backendMap: Record<string, { ct?: string; body: string }>) {
  const { CredentialStore } = await import('../../src/core/credential-store.js');
  const store = new CredentialStore();
  store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });

  // The site-routes module imports a backend factory; stub it before importing.
  vi.doMock('../../src/core/backend/index.js', () => ({
    makeBackend: () => fakeBackend(backendMap),
  }));
  const { registerSiteRoutes } = await import('../../src/electron/site-routes.js');
  const app = express();
  app.use(express.json());
  registerSiteRoutes(app);
  return app;
}

describe('GET /api/site/:storage/:container/*path', () => {
  it('streams HTML with text/html and a restrictive default CSP', async () => {
    const app = await buildApp({ 'index.html': { ct: 'text/html', body: '<h1>hi</h1>' } });
    const r = await request(app).get('/api/site/s1/c1/index.html');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.text).toBe('<h1>hi</h1>');
  });

  it('uses relaxed CSP when the container is trusted', async () => {
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    new CredentialStore().setHtmlTrust('s1', 'container', 'c1', true);
    const app = await buildApp({ 'index.html': { ct: 'text/html', body: '<h1>hi</h1>' } });
    const r = await request(app).get('/api/site/s1/c1/index.html');
    expect(r.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(r.headers['content-security-policy']).toContain("form-action 'self'");
  });

  it('falls back to extension-derived content-type when the backend reports octet-stream', async () => {
    const app = await buildApp({ 'a.css': { ct: 'application/octet-stream', body: 'body{}' } });
    const r = await request(app).get('/api/site/s1/c1/a.css');
    expect(r.headers['content-type']).toMatch(/^text\/css/);
  });

  it('passes through non-HTML content as-is and does NOT set CSP', async () => {
    const app = await buildApp({ 'img.png': { ct: 'image/png', body: 'PNGDATA' } });
    const r = await request(app).get('/api/site/s1/c1/img.png');
    expect(r.headers['content-type']).toMatch(/^image\/png/);
    expect(r.headers['content-security-policy']).toBeUndefined();
  });

  it('returns 404 with JSON for missing non-HTML', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/missing.png');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns 404 with an HTML body when the request is for HTML', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/missing.html');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.text).toMatch(/not found/i);
  });

  it('rejects path traversal with 400', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/..%2Fsecrets.txt');
    expect(r.status).toBe(400);
  });

  it('symmetric file-share route streams shares', async () => {
    const app = await buildApp({ 'page.html': { ct: 'text/html', body: '<p>x</p>' } });
    const r = await request(app).get('/api/site-file/s1/share1/page.html');
    expect(r.status).toBe(200);
    expect(r.text).toBe('<p>x</p>');
    expect(r.headers['content-security-policy']).toContain("connect-src 'none'");
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**

Run: `npx vitest run tests/unit/site-routes.test.ts`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Confirm the backend factory module path the test mocks.**

Inspect `src/electron/server.ts` to find the import that resolves `backendFor` → the underlying `makeBackend`. Use the same import path in `site-routes.ts` so the test's `vi.doMock` intercepts the right module.

Run: `grep -n "makeBackend\|backend/index\|backend/factory" src/electron/server.ts src/core/backend/*.ts | head -10`
Expected: a single canonical import path (e.g. `../core/backend/index.js` or `../core/backend/factory.js`). Use that exact path in the next step.

- [ ] **Step 4: Implement the streaming routes.**

Append to `src/electron/site-routes.ts`:

```typescript
import { pipeline } from 'node:stream/promises';
import { normaliseSitePath, SitePathError } from '../util/site-path.js';
import { makeBackend } from '../core/backend/index.js'; // adjust to the path confirmed in Step 3
import type { IStorageBackend } from '../core/backend/types.js';   // adjust import as needed

const EXT_CT: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm:  'text/html; charset=utf-8',
  css:  'text/css; charset=utf-8',
  js:   'application/javascript; charset=utf-8',
  mjs:  'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg:  'image/svg+xml',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  ico:  'image/x-icon',
  woff: 'font/woff',
  woff2:'font/woff2',
  ttf:  'font/ttf',
  txt:  'text/plain; charset=utf-8',
  md:   'text/markdown; charset=utf-8',
  pdf:  'application/pdf',
};

function resolveContentType(handleCt: string | undefined, blobPath: string): string {
  if (handleCt && handleCt !== 'application/octet-stream') return handleCt;
  const ext = (blobPath.split('.').pop() || '').toLowerCase();
  return EXT_CT[ext] ?? 'application/octet-stream';
}

function htmlCsp(trusted: boolean): string {
  const base = [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
  ];
  if (trusted) {
    base.push("connect-src 'self'");
    base.push("form-action 'self'");
  } else {
    base.push("connect-src 'none'");
    base.push("form-action 'none'");
  }
  return base.join('; ');
}

function isHtmlRequest(reqPath: string): boolean {
  const ext = (reqPath.split('.').pop() || '').toLowerCase();
  return ext === 'html' || ext === 'htm';
}

function sendError(res: express.Response, status: number, msg: string, wantsHtml: boolean) {
  if (wantsHtml) {
    res.status(status)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(`<!doctype html><meta charset="utf-8"><title>${status}</title><body><h1>${status}</h1><p>${escapeHtml(msg)}</p></body>`);
  } else {
    res.status(status).json({ error: msg });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function serveFromBackend(opts: {
  res: express.Response;
  backend: IStorageBackend;
  scope: 'container' | 'share';
  parent: string;
  rawPath: string;
  trusted: boolean;
}) {
  const { res, backend, scope, parent, rawPath, trusted } = opts;
  let normalised: string;
  try {
    normalised = normaliseSitePath(rawPath);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : 'invalid path', isHtmlRequest(rawPath));
    return;
  }
  // Empty path → serve the implicit index.
  const target = normalised === '' ? 'index.html' : normalised;
  const wantsHtml = isHtmlRequest(target);
  try {
    const handle = scope === 'container'
      ? await backend.readBlob(parent, target)
      : await backend.readFile(parent, target);
    const ct = resolveContentType(handle.contentType, target);
    res.setHeader('Content-Type', ct);
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (handle.contentLength !== undefined) res.setHeader('Content-Length', String(handle.contentLength));
    if (ct.startsWith('text/html')) {
      res.setHeader('Content-Security-Policy', htmlCsp(trusted));
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    await pipeline(handle.stream, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(msg) ? 404 : /denied|forbidden|unauthor/i.test(msg) ? 403 : 500;
    sendError(res, status, msg, wantsHtml);
  }
}
```

Then register the two routes in `registerSiteRoutes`:

```typescript
  app.get('/api/site/:storage/:container/*', async (req, res) => {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { sendError(res, 404, `Storage '${req.params.storage}' not found`, isHtmlRequest(req.path)); return; }
    const account = entry.kind === 'api' ? ((req.query.account as string) ?? entry.name) : undefined;
    const backend = makeBackend(entry as never, account as never);
    const trusted = store.isHtmlTrusted(req.params.storage, 'container', req.params.container);
    const rawPath = (req.params as Record<string, string>)[0] ?? '';
    await serveFromBackend({ res, backend, scope: 'container', parent: req.params.container, rawPath, trusted });
  });

  app.get('/api/site-file/:storage/:share/*', async (req, res) => {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { sendError(res, 404, `Storage '${req.params.storage}' not found`, isHtmlRequest(req.path)); return; }
    const account = entry.kind === 'api' ? ((req.query.account as string) ?? entry.name) : undefined;
    const backend = makeBackend(entry as never, account as never);
    const trusted = store.isHtmlTrusted(req.params.storage, 'share', req.params.share);
    const rawPath = (req.params as Record<string, string>)[0] ?? '';
    await serveFromBackend({ res, backend, scope: 'share', parent: req.params.share, rawPath, trusted });
  });
```

> If `makeBackend` lives at a different path (per Step 3), adjust the import and the cast accordingly. The `as never` cast bypasses the discriminated-union narrowing — keep it minimal; the same pattern is already used in `server.ts`.

- [ ] **Step 5: Run the test — expect PASS.**

Run: `npx vitest run tests/unit/site-routes.test.ts`
Expected: 8 tests pass.

- [ ] **Step 6: Run full suite to confirm no regressions.**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 7: (Optional) Commit — only on explicit user request.**

```bash
git add src/electron/site-routes.ts tests/unit/site-routes.test.ts
git commit -m "feat(server): /api/site + /api/site-file streaming routes with CSP"
```

---

## Task 6: Renderer module `html-view.js`

**Files:**
- Create: `src/electron/public/html-view.js`
- Test: `tests/unit/html-view.test.ts`

- [ ] **Step 1: Add JSDOM to vitest config (if not already enabled per-file).**

Inspect `vitest.config.ts` — `environment: 'node'` is the default. The new test will opt into JSDOM per file via the `// @vitest-environment jsdom` pragma so we don't change the global environment.

If `jsdom` is missing, install it:
```bash
npm ls jsdom || npm install --save-dev jsdom
```

> Dependency-vetting note: confirm `jsdom@latest` has zero HIGH-or-above advisories before install; record vetted-on date.

- [ ] **Step 2: Write the failing test.**

Create `tests/unit/html-view.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We dynamically import the module so each test gets a fresh fetch stub.
async function loadModule() {
  // The renderer module attaches itself to window.htmlView (UMD-style).
  await import('../../src/electron/public/html-view.js');
  return (window as unknown as { htmlView: HtmlView }).htmlView;
}

interface HtmlView {
  render(opts: {
    storage: string;
    container: string;
    path: string;
    scope: 'container' | 'share';
    contentBody: HTMLElement;
    onTrustChange?: (trusted: boolean) => void;
  }): Promise<void>;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('htmlView.render', () => {
  it('renders a sandboxed iframe with restrictive sandbox when untrusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'c1', path: 'a/b.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.src).toContain('/api/site/s1/c1/a/b.html');
  });

  it('renders a permissive sandbox when trusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: true }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'c1', path: 'index.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
  });

  it('uses /api/site-file/... for share scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'sh1', path: 'r.html', scope: 'share', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/site-file/s1/sh1/r.html');
  });

  it('URL-encodes each path segment but preserves the slashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's 1', container: 'c+1', path: 'a b/c d.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/site/s%201/c%2B1/a%20b/c%20d.html');
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL (module missing).**

Run: `npx vitest run tests/unit/html-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `html-view.js`.**

Create `src/electron/public/html-view.js`:

```javascript
// UMD-ish surface — attaches to window.htmlView so app.js can dispatch to it.
(function (root) {
  function encPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  function buildSrc(scope, storage, parent, path) {
    const prefix = scope === 'share' ? '/api/site-file' : '/api/site';
    return `${prefix}/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}/${encPath(path)}`;
  }

  function sandboxAttr(trusted) {
    return trusted
      ? 'allow-scripts allow-same-origin allow-forms allow-popups'
      : 'allow-scripts';
  }

  async function fetchTrust(scope, storage, parent) {
    const url = scope === 'share'
      ? `/api/trust-file/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`
      : `/api/trust/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return false;
      const j = await r.json();
      return !!j.trusted;
    } catch { return false; }
  }

  async function setTrust(scope, storage, parent, trusted) {
    const url = scope === 'share'
      ? `/api/trust-file/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`
      : `/api/trust/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`;
    const r = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trusted }),
    });
    if (!r.ok) throw new Error(`PUT ${url} → HTTP ${r.status}`);
    const j = await r.json();
    return !!j.trusted;
  }

  function buildToolbar({ scope, storage, parent, path, onTrustChange, getTrusted, setTrustedRef }) {
    const bar = document.createElement('div');
    bar.className = 'html-view-toolbar';

    const trustBtn = document.createElement('button');
    trustBtn.type = 'button';
    trustBtn.textContent = getTrusted() ? 'Untrust container' : 'Trust container';
    trustBtn.addEventListener('click', async () => {
      const next = !getTrusted();
      try {
        const applied = await setTrust(scope, storage, parent, next);
        setTrustedRef(applied);
        trustBtn.textContent = applied ? 'Untrust container' : 'Trust container';
        onTrustChange?.(applied);
      } catch (e) {
        trustBtn.textContent = `Error: ${e.message}`;
      }
    });

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open in browser';
    openBtn.addEventListener('click', () => {
      const url = buildSrc(scope, storage, parent, path);
      const absolute = new URL(url, window.location.origin).toString();
      if (window.electron?.invoke) {
        window.electron.invoke('shell:open-external', absolute).catch(() => window.open(absolute, '_blank'));
      } else {
        window.open(absolute, '_blank');
      }
    });

    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.textContent = 'View source';
    sourceBtn.addEventListener('click', () => {
      // Re-trigger the parent viewer with a ?view=source hint via a CustomEvent.
      bar.dispatchEvent(new CustomEvent('html-view:view-source', { bubbles: true }));
    });

    bar.appendChild(trustBtn);
    bar.appendChild(openBtn);
    bar.appendChild(sourceBtn);
    return bar;
  }

  function buildIframe(scope, storage, parent, path, trusted) {
    const iframe = document.createElement('iframe');
    iframe.className = 'html-view';
    iframe.setAttribute('sandbox', sandboxAttr(trusted));
    iframe.src = buildSrc(scope, storage, parent, path);
    return iframe;
  }

  async function render(opts) {
    const { storage, container, path, scope, contentBody, onTrustChange } = opts;
    const parent = scope === 'share' ? (opts.share ?? container) : container;
    let trusted = await fetchTrust(scope, storage, parent);

    contentBody.innerHTML = '';
    const toolbar = buildToolbar({
      scope, storage, parent, path,
      onTrustChange: (t) => { trusted = t; replaceIframe(); onTrustChange?.(t); },
      getTrusted: () => trusted,
      setTrustedRef: (t) => { trusted = t; },
    });
    contentBody.appendChild(toolbar);

    let iframe = buildIframe(scope, storage, parent, path, trusted);
    contentBody.appendChild(iframe);

    function replaceIframe() {
      const fresh = buildIframe(scope, storage, parent, path, trusted);
      contentBody.replaceChild(fresh, iframe);
      iframe = fresh;
    }
  }

  root.htmlView = { render };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Run the test — expect PASS.**

Run: `npx vitest run tests/unit/html-view.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: (Optional) Commit — only on explicit user request.**

```bash
git add src/electron/public/html-view.js tests/unit/html-view.test.ts
git commit -m "feat(ui): html-view renderer with sandbox + trust toolbar"
```

---

## Task 7: Dispatch HTML from `app.js` (blob viewer + share viewer)

**Files:**
- Modify: `src/electron/public/app.js:669-740` (blob viewer dispatch)
- Modify: `src/electron/public/app.js:440-479` (share-file viewer dispatch)
- Modify: `src/electron/public/index.html` (load `html-view.js` script tag)
- Modify: `src/electron/public/styles.css` (`.html-view` iframe size; `.html-view-toolbar` styling)

- [ ] **Step 1: Add the script tag.**

Edit `src/electron/public/index.html`. After the existing `<script src="app.js">` (or just before it — order doesn't matter because `app.js` reads `window.htmlView` lazily), add:

```html
<script src="html-view.js"></script>
```

- [ ] **Step 2: Add CSS.**

Edit `src/electron/public/styles.css`. Append:

```css
.html-view-toolbar {
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border, #ddd);
  margin-bottom: 0.25rem;
}
.html-view-toolbar button {
  font: inherit;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}
iframe.html-view {
  width: 100%;
  height: calc(100% - 2.25rem);
  border: 0;
  background: #fff;
}
```

- [ ] **Step 3: Dispatch HTML from `showBlob()` in `app.js`.**

Locate the block at `app.js:685-698` (the `docx`/`doc` branch). **Before** that block, insert an `html` / `htm` branch:

```javascript
      if ((ext === "html" || ext === "htm") && !location.hash.includes("view=source")) {
        if (window.htmlView) {
          contentBody.addEventListener('html-view:view-source', () => {
            // Re-enter showBlob in source mode for one navigation.
            location.hash = 'view=source';
            // Re-trigger the current selection: simplest is to call showBlob again.
            // (The dispatch listener uses location.hash to opt out of html-view on the next call.)
            showBlob(container, blobName); // identifiers in the enclosing scope
          }, { once: true });
          await window.htmlView.render({
            storage: currentStorage,
            container,
            path: blobName,
            scope: 'container',
            contentBody,
          });
          return;
        }
        // Fall through if html-view.js failed to load — render as text.
      }
```

> Note: `showBlob(container, blobName)` must match the existing function signature in `app.js`. If the local identifiers differ (e.g. `blobName` is named `path`), adapt the names — do not introduce new variables.

- [ ] **Step 4: Dispatch HTML from `viewShareFile()` in `app.js` (lines 440-479).**

Insert a branch before the existing `renderView` definition (around line 454, right after `const ext = ...`):

```javascript
      if ((ext === "html" || ext === "htm") && !location.hash.includes("view=source")) {
        if (window.htmlView) {
          contentBody.addEventListener('html-view:view-source', () => {
            location.hash = 'view=source';
            viewShareFile(shareName, filePath, size);
          }, { once: true });
          await window.htmlView.render({
            storage: currentStorage,
            container: shareName,
            share: shareName,
            path: filePath,
            scope: 'share',
            contentBody,
          });
          return;
        }
      }
```

- [ ] **Step 5: Manual smoke test (no automated test for this glue).**

Build and launch the Electron UI:

```bash
npx tsc
npx tsx src/electron/main.ts
```

Steps:
1. Upload a small static site to a blob container — `index.html` referencing `styles.css` and `images/logo.png`, plus a link to `page2.html`.
2. Click `index.html` in the tree.
3. Expected: viewer shows the rendered page; CSS applies; image loads; clicking `page2.html` navigates within the iframe.
4. Open the browser devtools (Electron has them) and confirm the iframe has `sandbox="allow-scripts"`.
5. Click **Trust container** → iframe reloads; confirm `sandbox` now includes `allow-same-origin`.
6. Click **Open in browser** → default browser opens the same `/api/site/...` URL.
7. Click **View source** → falls back to the existing escaped-source view + Edit button.
8. Repeat steps 2-7 against a file share.

- [ ] **Step 6: (Optional) Commit — only on explicit user request.**

```bash
git add src/electron/public/app.js src/electron/public/index.html src/electron/public/styles.css
git commit -m "feat(ui): dispatch HTML files to html-view renderer"
```

---

## Task 8: IPC channel `shell:open-external`

**Files:**
- Modify: `src/electron/preload.cjs:12-16` (extend `INVOKE_CHANNELS`)
- Modify: `src/electron/main.ts` (register handler)

- [ ] **Step 1: Allowlist the channel in the preload bridge.**

Edit `src/electron/preload.cjs` lines 12-16:

```javascript
const INVOKE_CHANNELS = new Set([
  "oidc:login",
  "download-zip:start",
  "download-zip:cancel",
  "shell:open-external",
]);
```

- [ ] **Step 2: Register the handler in `main.ts`.**

Edit `src/electron/main.ts`. After the existing `ipcMain.handle('oidc:login', …)` block (around line 18-30), add:

```typescript
ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
  // Defensive: only allow http(s) URLs. Refuse file:, javascript:, etc.
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error('invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refused protocol: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.toString());
});
```

- [ ] **Step 3: Manual verification (no automated test possible without spawning Electron).**

Steps:
1. `npx tsc && npx tsx src/electron/main.ts`
2. Open an HTML blob, click **Open in browser**.
3. Default OS browser opens the URL.
4. Attempt the equivalent IPC call from devtools with `javascript:alert(1)` — should throw "refused protocol".

- [ ] **Step 4: (Optional) Commit — only on explicit user request.**

```bash
git add src/electron/preload.cjs src/electron/main.ts
git commit -m "feat(ipc): allowlist shell:open-external for HTML view"
```

---

## Task 9: README + Issues log

**Files:**
- Modify: `README.md`
- Modify: `Issues - Pending Items.md` (dependency vetting log entries)

- [ ] **Step 1: Add an "HTML rendering" section to `README.md`.**

Locate the Features section in `README.md` and add this subsection (full text — copy verbatim):

```markdown
### HTML rendering

When you open an `.html` or `.htm` file from a container or file share, the
viewer renders it inside a sandboxed iframe. The same content is also
reachable from any browser at:

  http://localhost:<port>/api/site/<storage>/<container>/<path>
  http://localhost:<port>/api/site-file/<storage>/<share>/<path>

Relative references (`./styles.css`, `images/foo.png`, sibling pages) resolve
to sibling blobs / files in the same container or share.

**Security model.** By default the iframe runs with `sandbox="allow-scripts"`
only — scripts execute but cannot reach the host page, navigate the window,
submit forms, or call back into the API. The server adds a matching
Content-Security-Policy with `connect-src 'none'`.

If you need a stored page to behave like a real site (XHR, forms,
same-origin storage), click **Trust container** in the viewer's HTML
toolbar. The trust flag is per-container (or per-share), persisted in your
encrypted credential store, and can be cleared at any time. Trusted mode
adds `allow-same-origin allow-forms allow-popups` to the sandbox and relaxes
CSP to `connect-src 'self'` and `form-action 'self'` — third-party access is
still forbidden.

The **Open in browser** button opens the same URL in your OS default
browser. **View source** falls back to the escaped-source viewer with the
existing in-place Edit button.
```

- [ ] **Step 2: Record dependency-vetting entries in `Issues - Pending Items.md`.**

Under (or create) a `## Dependency vetting log` section, add lines for each new dev-dependency added in this work:

```markdown
## Dependency vetting log

- 2026-06-01 — `supertest@<version>` — pinned by Task 4. `npm audit` clean at install time.
- 2026-06-01 — `jsdom@<version>` — pinned by Task 6 (only if newly added). `npm audit` clean at install time.
```

Fill in the `<version>` field with the version that landed in `package.json` after install. Skip an entry if the dependency was already present.

- [ ] **Step 3: Run the full test suite one more time.**

Run: `npx vitest run`
Expected: every suite passes.

- [ ] **Step 4: (Optional) Commit — only on explicit user request.**

```bash
git add README.md "Issues - Pending Items.md"
git commit -m "docs: HTML rendering + trust model"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (render in Electron viewer) → Tasks 6 + 7.
- Goal 2 (API surface for external browsers) → Task 5 (`/api/site` + `/api/site-file`).
- Goal 3 (relative URLs work without rewriting) → Task 5 (path-component-based URLs) + manual smoke step 3 in Task 7.
- Goal 4 (blob containers AND file shares) → Symmetric routes in Task 5; symmetric dispatch in Task 7 steps 3 and 4.
- Goal 5 (default-safe + opt-in trust) → Tasks 1 + 2 (persistence), Task 4 (HTTP toggle), Task 5 (CSP), Task 6 (iframe sandbox).
- Non-goal "no CLI/agent changes" → Confirmed, no tasks touch `src/cli/**` or `src/agent/**`.
- Risk "blob `.html` with `application/octet-stream`" → Task 5 step 4 `resolveContentType`.
- Risk "path traversal" → Task 3 (helper) + Task 5 test "rejects path traversal with 400".
- Risk "bloating `app.js`" → Tasks 6 + 7 isolate rendering in `html-view.js`.

**Placeholder scan:** No TBDs, no "implement later", no "add error handling" steps without code. All code blocks present.

**Type consistency:** `isHtmlTrusted` / `setHtmlTrust` signature used identically in Tasks 2, 4, 5. `registerSiteRoutes` defined in Task 4, extended in Task 5, called in Task 4 step 5. `window.htmlView.render(opts)` signature consistent across Task 6 (definition + test) and Task 7 (callers in `app.js`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-html-rendering.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
