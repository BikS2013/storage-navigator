// tests/unit/reverse-git-routes.test.ts
//
// Tests for the six Phase-F reverse-git Express endpoints in
// src/electron/server.ts:
//
//   POST   /api/reverse-links/:storage/:container?     → 201 { link }
//   GET    /api/reverse-links/:storage/:container?     → 200 { links }
//   DELETE /api/reverse-links/:storage/:container/:id  → 200 { removed: true }
//   POST   /api/push/:storage/:container/:linkId       → 200 { result }
//   POST   /api/push-all/:storage/:container?          → 200 or 502 { results }
//   GET    /api/reverse-diff/:storage/:container/:id   → 200 { diff }
//
// All engine imports are vi.doMock-ed so no real Azure or Git calls occur.
// The pattern follows the existing site-routes.test.ts / trust-routes.test.ts
// conventions: temp STORAGE_NAVIGATOR_DIR, vi.resetModules() before each test,
// dynamic imports inside buildApp().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-rev-rt-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Canonical fake ReverseLink and PushResult for stubs
// ---------------------------------------------------------------------------

const FAKE_LINK = {
  id: 'link-aaa',
  scope: { kind: 'container', account: 'a1', container: 'c1' },
  provider: 'github',
  repoUrl: 'owner/repo',
  branch: 'main',
  repoSubPath: '',
  tokenName: 'my-pat',
  author: { name: 'Storage Navigator', email: 'storage-nav@local' },
  exclusionPatterns: [],
  respectGitignore: true,
  createRepo: false,
  visibility: 'private' as const,
  blobSnapshot: {},
  createdAt: '2026-01-01T00:00:00Z',
};

const FAKE_PUSH_RESULT = {
  linkId: 'link-aaa',
  pushed: true,
  commitSha: 'abc123',
  treeSha: 'tree456',
  added: ['foo.txt'],
  modified: [],
  deleted: [],
  skipped: [],
  errors: [],
  at: '2026-01-01T00:00:00Z',
};

const FAKE_DIFF = {
  linkId: 'link-aaa',
  added: ['new.txt'],
  modified: ['changed.txt'],
  deleted: ['old.txt'],
  unchanged: ['same.txt'],
  counts: { added: 1, modified: 1, deleted: 1, unchanged: 1 },
};

// ---------------------------------------------------------------------------
// buildApp — dynamically imports createServer after all mocks are in place
// ---------------------------------------------------------------------------

interface EngineStubs {
  initReverseLink?: ReturnType<typeof vi.fn>;
  pushReverseLink?: ReturnType<typeof vi.fn>;
  previewReverseDiff?: ReturnType<typeof vi.fn>;
  removeReverseLink?: ReturnType<typeof vi.fn>;
  listReverseLinks?: ReturnType<typeof vi.fn>;
  resolveReverseLinks?: ReturnType<typeof vi.fn>;
}

async function buildApp(stubs: EngineStubs = {}) {
  // 1. Create the storage entry so reverseGitContext() can resolve it.
  const { CredentialStore } = await import('../../src/core/credential-store.js');
  const store = new CredentialStore();
  store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });

  // 2. Stub the reverse-sync-engine (the only async engine used by these routes).
  vi.doMock('../../src/core/reverse-sync-engine.js', () => ({
    initReverseLink: stubs.initReverseLink ?? vi.fn(async () => FAKE_LINK),
    pushReverseLink: stubs.pushReverseLink ?? vi.fn(async () => FAKE_PUSH_RESULT),
    previewReverseDiff: stubs.previewReverseDiff ?? vi.fn(async () => FAKE_DIFF),
    removeReverseLink: stubs.removeReverseLink ?? vi.fn(async () => undefined),
    listReverseLinks: stubs.listReverseLinks ?? vi.fn(async () => [FAKE_LINK]),
    resolveReverseLinks: stubs.resolveReverseLinks ?? vi.fn(async () => [FAKE_LINK]),
  }));

  // 3. Stub BlobClient so the server never opens a real Azure connection.
  //    Must be a real class (not an arrow-function) because the server does
  //    `new BlobClient(entry)`. Vitest 4 requires constructor-compatible fns.
  vi.doMock('../../src/core/blob-client.js', () => ({
    BlobClient: class MockBlobClient { constructor(_entry: unknown) {} },
  }));

  // 4. Import createServer AFTER mocks are registered.
  const { createServer } = await import('../../src/electron/server.js');
  // createServer also calls app.listen; we pass a dummy port — supertest
  // never uses the port but createServer must not throw.
  const app = createServer(0);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: POST /api/reverse-links with required body fields
// ---------------------------------------------------------------------------

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'github',
    repoUrl: 'owner/repo',
    tokenName: 'my-pat',
    ...overrides,
  };
}

// ===========================================================================
// GET /api/reverse-links/:storage/:container
// ===========================================================================

describe('GET /api/reverse-links — list reverse-links (container scope)', () => {
  it('responds 200 with { links: [...] } when links exist', async () => {
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => [FAKE_LINK]),
    });
    const r = await request(app).get('/api/reverse-links/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('links');
    expect(Array.isArray(r.body.links)).toBe(true);
    expect(r.body.links[0].id).toBe('link-aaa');
  });

  it('responds 200 with { links: [] } when no links exist', async () => {
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
    });
    const r = await request(app).get('/api/reverse-links/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body.links).toEqual([]);
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app).get('/api/reverse-links/UNKNOWN/c1');
    expect(r.status).toBe(404);
    expect(r.body).toHaveProperty('error');
  });
});

// ===========================================================================
// GET /api/reverse-links/:storage (account scope — no container param)
// ===========================================================================

describe('GET /api/reverse-links — account scope', () => {
  it('responds 200 with { links } for account-scope route', async () => {
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => [FAKE_LINK]),
    });
    const r = await request(app).get('/api/reverse-links/s1');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('links');
  });
});

// ===========================================================================
// POST /api/reverse-links/:storage/:container — create link
// ===========================================================================

describe('POST /api/reverse-links — create reverse-link (container scope)', () => {
  it('responds 201 with { link } on success', async () => {
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: vi.fn(async () => FAKE_LINK),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody());
    expect(r.status).toBe(201);
    expect(r.body).toHaveProperty('link');
    expect(r.body.link.id).toBe('link-aaa');
  });

  it('responds 400 when required fields are missing (no provider)', async () => {
    const app = await buildApp({ listReverseLinks: vi.fn(async () => []) });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send({ repoUrl: 'owner/repo', tokenName: 't' });
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty('error');
  });

  it('responds 400 when required fields are missing (no tokenName)', async () => {
    const app = await buildApp({ listReverseLinks: vi.fn(async () => []) });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send({ provider: 'github', repoUrl: 'owner/repo' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tokenName/);
  });

  it('responds 400 when provider is invalid', async () => {
    const app = await buildApp({ listReverseLinks: vi.fn(async () => []) });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ provider: 'gitlab' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/provider/);
  });

  it('responds 400 when visibility has an invalid value', async () => {
    const app = await buildApp({ listReverseLinks: vi.fn(async () => []) });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ visibility: 'internal' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/visibility/);
  });

  it('responds 400 when exclusionPatterns is not an array of strings', async () => {
    const app = await buildApp({ listReverseLinks: vi.fn(async () => []) });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ exclusionPatterns: 'not-an-array' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/exclusionPatterns/);
  });

  // 409 pre-check: duplicate scope + repoUrl must be rejected before calling initReverseLink.
  it('responds 409 when a link for the same repoUrl already exists in scope', async () => {
    const app = await buildApp({
      // listReverseLinks returns an existing link with the same repoUrl.
      listReverseLinks: vi.fn(async () => [FAKE_LINK]),
      initReverseLink: vi.fn(async () => { throw new Error('should not be called'); }),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ repoUrl: 'owner/repo' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/owner\/repo/);
  });

  it('does NOT 409 when a link for the same repoUrl exists in a DIFFERENT scope', async () => {
    // listReverseLinks is called per-scope; if it returns an empty array the
    // conflict guard lets the request through.
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: vi.fn(async () => FAKE_LINK),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ repoUrl: 'owner/repo' }));
    expect(r.status).toBe(201);
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app)
      .post('/api/reverse-links/UNKNOWN/c1')
      .send(validCreateBody());
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/reverse-links/:storage (account scope — no container param)
// ===========================================================================

describe('POST /api/reverse-links — account scope', () => {
  it('responds 201 with { link } using the account-scope route', async () => {
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: vi.fn(async () => ({
        ...FAKE_LINK,
        scope: { kind: 'account', account: 'a1' },
      })),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1')
      .send(validCreateBody());
    expect(r.status).toBe(201);
    expect(r.body.link.scope.kind).toBe('account');
  });
});

// ===========================================================================
// DELETE /api/reverse-links/:storage/:container/:linkId
// ===========================================================================

describe('DELETE /api/reverse-links — remove reverse-link', () => {
  it('responds 200 with { removed: true } on success', async () => {
    const app = await buildApp({
      removeReverseLink: vi.fn(async () => undefined),
    });
    const r = await request(app).delete('/api/reverse-links/s1/c1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ removed: true });
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app).delete('/api/reverse-links/UNKNOWN/c1/link-aaa');
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /api/reverse-links/:storage/:linkId (account scope)
// ===========================================================================

describe('DELETE /api/reverse-links — account scope', () => {
  it('responds 200 with { removed: true } using account-scope route', async () => {
    const app = await buildApp({
      removeReverseLink: vi.fn(async () => undefined),
    });
    const r = await request(app).delete('/api/reverse-links/s1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ removed: true });
  });
});

// ===========================================================================
// POST /api/push/:storage/:container/:linkId
// ===========================================================================

describe('POST /api/push — push a single reverse-link', () => {
  it('responds 200 with { result } on success', async () => {
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => FAKE_PUSH_RESULT),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('result');
    expect(r.body.result.linkId).toBe('link-aaa');
    expect(r.body.result.pushed).toBe(true);
  });

  it('passes dryRun=true query param to the engine', async () => {
    const pushFn = vi.fn(async (_id: string, opts: { dryRun?: boolean }) => ({
      ...FAKE_PUSH_RESULT,
      pushed: false,
    }));
    const app = await buildApp({ pushReverseLink: pushFn });
    const r = await request(app).post('/api/push/s1/c1/link-aaa?dryRun=true');
    expect(r.status).toBe(200);
    expect(pushFn).toHaveBeenCalledWith(
      'link-aaa',
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('passes force=true query param to the engine', async () => {
    const pushFn = vi.fn(async () => FAKE_PUSH_RESULT);
    const app = await buildApp({ pushReverseLink: pushFn });
    await request(app).post('/api/push/s1/c1/link-aaa?force=true');
    expect(pushFn).toHaveBeenCalledWith(
      'link-aaa',
      expect.objectContaining({ force: true }),
    );
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/push/UNKNOWN/c1/link-aaa');
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/push/:storage/:linkId  (account scope — no container param)
// ===========================================================================

describe('POST /api/push — account scope', () => {
  it('responds 200 with { result } using account-scope route', async () => {
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => FAKE_PUSH_RESULT),
    });
    const r = await request(app).post('/api/push/s1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('result');
  });
});

// ===========================================================================
// POST /api/push-all/:storage/:container
// ===========================================================================

describe('POST /api/push-all — push all links in scope', () => {
  it('responds 200 with { results: [...] } when all links succeed', async () => {
    const app = await buildApp({
      resolveReverseLinks: vi.fn(async () => [FAKE_LINK]),
      pushReverseLink: vi.fn(async () => FAKE_PUSH_RESULT),
    });
    const r = await request(app).post('/api/push-all/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('results');
    expect(Array.isArray(r.body.results)).toBe(true);
    expect(r.body.results[0]).toMatchObject({ linkId: 'link-aaa', ok: true });
  });

  it('responds 502 when at least one link push fails', async () => {
    // Import error class directly (not mocked) to simulate engine throw.
    const { RemoteDivergedError } = await import('../../src/core/reverse-git-errors.js');

    const app = await buildApp({
      resolveReverseLinks: vi.fn(async () => [
        FAKE_LINK,
        { ...FAKE_LINK, id: 'link-bbb' },
      ]),
      pushReverseLink: vi.fn(async (id: string) => {
        if (id === 'link-bbb') {
          throw new RemoteDivergedError('abc', 'xyz', 'Remote diverged');
        }
        return FAKE_PUSH_RESULT;
      }),
    });
    const r = await request(app).post('/api/push-all/s1/c1');
    expect(r.status).toBe(502);
    expect(r.body.results.some((x: { ok: boolean }) => x.ok === false)).toBe(true);
    expect(r.body.results.some((x: { ok: boolean }) => x.ok === true)).toBe(true);
  });

  it('responds 200 with empty results when no links are in scope', async () => {
    const app = await buildApp({
      resolveReverseLinks: vi.fn(async () => []),
      pushReverseLink: vi.fn(),
    });
    const r = await request(app).post('/api/push-all/s1/c1');
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([]);
  });

  it('responds 502 with the failed link identified in the results', async () => {
    const { InvalidPATError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      resolveReverseLinks: vi.fn(async () => [FAKE_LINK]),
      pushReverseLink: vi.fn(async () => {
        throw new InvalidPATError('Invalid or revoked PAT');
      }),
    });
    const r = await request(app).post('/api/push-all/s1/c1');
    expect(r.status).toBe(502);
    expect(r.body.results[0]).toMatchObject({
      linkId: 'link-aaa',
      ok: false,
      error: { error: expect.stringContaining('PAT'), code: 'INVALID_PAT' },
    });
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/push-all/UNKNOWN/c1');
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/push-all/:storage (account scope — no container param)
// ===========================================================================

describe('POST /api/push-all — account scope', () => {
  it('responds 200 using account-scope route', async () => {
    const app = await buildApp({
      resolveReverseLinks: vi.fn(async () => [FAKE_LINK]),
      pushReverseLink: vi.fn(async () => FAKE_PUSH_RESULT),
    });
    const r = await request(app).post('/api/push-all/s1');
    expect(r.status).toBe(200);
    expect(r.body.results[0].ok).toBe(true);
  });
});

// ===========================================================================
// GET /api/reverse-diff/:storage/:container/:linkId
// ===========================================================================

describe('GET /api/reverse-diff — preview diff (no push)', () => {
  it('responds 200 with { diff } on success', async () => {
    const app = await buildApp({
      previewReverseDiff: vi.fn(async () => FAKE_DIFF),
    });
    const r = await request(app).get('/api/reverse-diff/s1/c1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('diff');
    expect(r.body.diff.linkId).toBe('link-aaa');
    expect(r.body.diff.added).toEqual(['new.txt']);
    expect(r.body.diff.modified).toEqual(['changed.txt']);
    expect(r.body.diff.deleted).toEqual(['old.txt']);
  });

  it('responds 404 when the storage entry is not found', async () => {
    const app = await buildApp();
    const r = await request(app).get('/api/reverse-diff/UNKNOWN/c1/link-aaa');
    expect(r.status).toBe(404);
  });
});

// ===========================================================================
// GET /api/reverse-diff/:storage/:linkId (account scope)
// ===========================================================================

describe('GET /api/reverse-diff — account scope', () => {
  it('responds 200 with { diff } using account-scope route', async () => {
    const app = await buildApp({
      previewReverseDiff: vi.fn(async () => FAKE_DIFF),
    });
    const r = await request(app).get('/api/reverse-diff/s1/link-aaa');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('diff');
  });
});

// ===========================================================================
// mapReverseGitErrorToHttp — HTTP error mapping assertions
// (exercised via the live route handlers, not via the mapper directly)
// ===========================================================================

describe('Typed engine error → HTTP mapping via sendReverseGitError', () => {
  // RemoteDivergedError → 409
  it('RemoteDivergedError thrown by pushReverseLink maps to 409', async () => {
    const { RemoteDivergedError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => {
        throw new RemoteDivergedError('sha-local', 'sha-remote');
      }),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'REMOTE_DIVERGED' });
  });

  // RepoNotFoundError → 404
  it('RepoNotFoundError thrown by pushReverseLink maps to 404', async () => {
    const { RepoNotFoundError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => {
        throw new RepoNotFoundError('Repository not found');
      }),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  // InvalidPATError → 401
  it('InvalidPATError thrown by pushReverseLink maps to 401', async () => {
    const { InvalidPATError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => {
        throw new InvalidPATError('Invalid or revoked PAT');
      }),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'INVALID_PAT' });
  });

  // InsufficientScopesError → 403
  it('InsufficientScopesError thrown by initReverseLink maps to 403', async () => {
    const { InsufficientScopesError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: vi.fn(async () => {
        throw new InsufficientScopesError('PAT lacks contents:write');
      }),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody());
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'INSUFFICIENT_SCOPES' });
  });

  // PayloadTooLargeError → 413
  it('PayloadTooLargeError thrown by pushReverseLink maps to 413', async () => {
    const { PayloadTooLargeError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => {
        throw new PayloadTooLargeError('Payload exceeds limit');
      }),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  // RateLimitExceededError → 503
  it('RateLimitExceededError thrown by pushReverseLink maps to 503', async () => {
    const { RateLimitExceededError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      pushReverseLink: vi.fn(async () => {
        throw new RateLimitExceededError('429 rate limit');
      }),
    });
    const r = await request(app).post('/api/push/s1/c1/link-aaa');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'RATE_LIMIT' });
  });

  // ConfigurationError → 400
  it('ConfigurationError thrown by initReverseLink maps to 400 with CONFIG_MISSING', async () => {
    const { ConfigurationError } = await import('../../src/core/reverse-git-errors.js');
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: vi.fn(async () => {
        throw new ConfigurationError('Missing required config');
      }),
    });
    const r = await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'CONFIG_MISSING' });
  });

  // Plain Error → 500 (no code field)
  it('A plain Error thrown by previewReverseDiff maps to 500 without a code field', async () => {
    const app = await buildApp({
      previewReverseDiff: vi.fn(async () => {
        throw new Error('Internal problem');
      }),
    });
    const r = await request(app).get('/api/reverse-diff/s1/c1/link-aaa');
    expect(r.status).toBe(500);
    expect(r.body).toHaveProperty('error', 'Internal problem');
    expect(r.body.code).toBeUndefined();
  });
});

// ===========================================================================
// Container scope vs account scope routing
// ===========================================================================

describe('Container scope vs account scope routing', () => {
  it('GET with container segment calls listReverseLinks (container scope)', async () => {
    const listFn = vi.fn(async () => [FAKE_LINK]);
    const app = await buildApp({ listReverseLinks: listFn });
    await request(app).get('/api/reverse-links/s1/c1');
    expect(listFn).toHaveBeenCalledOnce();
    // The scope passed must carry the container
    const callArg = listFn.mock.calls[0][0] as { kind: string; container?: string };
    expect(callArg.kind).toBe('container');
    expect(callArg.container).toBe('c1');
  });

  it('GET without container segment calls listReverseLinks (account scope)', async () => {
    const listFn = vi.fn(async () => [FAKE_LINK]);
    const app = await buildApp({ listReverseLinks: listFn });
    await request(app).get('/api/reverse-links/s1');
    expect(listFn).toHaveBeenCalledOnce();
    const callArg = listFn.mock.calls[0][0] as { kind: string };
    expect(callArg.kind).toBe('account');
  });

  it('POST with container and no prefix body uses container scope', async () => {
    const initFn = vi.fn(async () => FAKE_LINK);
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: initFn,
    });
    await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody());
    const opts = initFn.mock.calls[0][0] as { scope: { kind: string } };
    expect(opts.scope.kind).toBe('container');
  });

  it('POST with prefix field in body uses prefix scope', async () => {
    const initFn = vi.fn(async () => ({
      ...FAKE_LINK,
      scope: { kind: 'prefix', account: 'a1', container: 'c1', prefix: 'docs/' },
    }));
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: initFn,
    });
    await request(app)
      .post('/api/reverse-links/s1/c1')
      .send(validCreateBody({ prefix: 'docs/' }));
    const opts = initFn.mock.calls[0][0] as { scope: { kind: string; prefix?: string } };
    expect(opts.scope.kind).toBe('prefix');
    expect(opts.scope.prefix).toBe('docs/');
  });

  it('POST without container segment uses account scope', async () => {
    const initFn = vi.fn(async () => ({
      ...FAKE_LINK,
      scope: { kind: 'account', account: 'a1' },
    }));
    const app = await buildApp({
      listReverseLinks: vi.fn(async () => []),
      initReverseLink: initFn,
    });
    await request(app)
      .post('/api/reverse-links/s1')
      .send(validCreateBody());
    const opts = initFn.mock.calls[0][0] as { scope: { kind: string } };
    expect(opts.scope.kind).toBe('account');
  });
});
