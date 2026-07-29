// ===========================================================================
// tests/unit/sync-engine-backend.test.ts
// Tests for src/core/sync-engine.ts after it moved from the concrete
// BlobClient to IStorageBackend (plan-015).
//
// The backend is a minimal in-memory fake: blobs live in a Map<name, Buffer>
// and a missing blob throws a `{status: 404}` shaped error, matching what
// both the api backend (NotFoundError.status) and the Azure SDK
// (RestError.statusCode) produce.
// ===========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { IStorageBackend } from '../../src/core/backend/backend.js';
import type { RepoLink, RepoLinksRegistry, RepoProvider } from '../../src/core/types.js';
import { readLinks, writeLinks, createLink, syncRepo } from '../../src/core/sync-engine.js';

const LINKS_BLOB = '.repo-links.json';

type Upload = { path: string; body: Buffer; sizeBytes: number; contentType?: string };

class FakeBackend {
  readonly blobs = new Map<string, Buffer>();
  readonly uploads: Upload[] = [];
  /** Blob paths whose deleteBlob should reject, to exercise the error path. */
  readonly failDeletes = new Set<string>();
  /** When set, readBlob rejects with this instead of a 404. */
  readError: unknown = null;

  async readBlob(_container: string, path: string) {
    if (this.readError) throw this.readError;
    const buf = this.blobs.get(path);
    if (!buf) throw Object.assign(new Error(`Blob '${path}' not found`), { status: 404 });
    return { stream: Readable.from(buf) as NodeJS.ReadableStream };
  }

  async uploadBlob(_container: string, path: string, body: Buffer, sizeBytes: number, contentType?: string) {
    this.uploads.push({ path, body, sizeBytes, contentType });
    this.blobs.set(path, body);
    return {};
  }

  async deleteBlob(_container: string, path: string) {
    if (this.failDeletes.has(path)) throw new Error(`Blob '${path}' does not exist.`);
    this.blobs.delete(path);
  }

  seedLinks(registry: RepoLinksRegistry): void {
    this.blobs.set(LINKS_BLOB, Buffer.from(JSON.stringify(registry, null, 2), 'utf-8'));
  }

  storedLinks(): RepoLinksRegistry {
    return JSON.parse(this.blobs.get(LINKS_BLOB)!.toString('utf-8')) as RepoLinksRegistry;
  }
}

function asBackend(fake: FakeBackend): IStorageBackend {
  return fake as unknown as IStorageBackend;
}

function makeLink(over: Partial<RepoLink> = {}): RepoLink {
  return {
    id: 'link-1',
    provider: 'github',
    repoUrl: 'https://github.com/acme/widgets',
    branch: 'main',
    repoSubPath: undefined,
    targetPrefix: undefined,
    lastSyncAt: '2026-01-01T00:00:00.000Z',
    lastCommitSha: undefined,
    fileShas: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('readLinks', () => {
  let fake: FakeBackend;
  beforeEach(() => { fake = new FakeBackend(); });

  it('returns null when the registry blob does not exist', async () => {
    await expect(readLinks(asBackend(fake), 'c')).resolves.toBeNull();
  });

  it('treats a statusCode-shaped 404 (Azure RestError) as missing', async () => {
    fake.readError = Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
    await expect(readLinks(asBackend(fake), 'c')).resolves.toBeNull();
  });

  // Regression guard: swallowing a 401 would render a synced container as
  // unlinked, and the next writeLinks would then wipe the real registry.
  it('re-throws a 401 instead of reporting "no links"', async () => {
    fake.readError = Object.assign(new Error('OIDC login required'), { status: 401 });
    await expect(readLinks(asBackend(fake), 'c')).rejects.toThrow('OIDC login required');
  });

  it('re-throws a 403 from the API RBAC layer', async () => {
    fake.readError = Object.assign(new Error('Insufficient role'), { status: 403 });
    await expect(readLinks(asBackend(fake), 'c')).rejects.toThrow('Insufficient role');
  });
});

describe('writeLinks', () => {
  it('uploads JSON with sizeBytes equal to the UTF-8 byte length', async () => {
    const fake = new FakeBackend();
    const registry: RepoLinksRegistry = { version: 1, links: [makeLink({ repoUrl: 'https://git/λ-répo' })] };

    await writeLinks(asBackend(fake), 'c', registry);

    const up = fake.uploads.at(-1)!;
    expect(up.path).toBe(LINKS_BLOB);
    expect(up.contentType).toBe('application/json');
    expect(up.sizeBytes).toBe(up.body.byteLength);
    // The multi-byte characters make byteLength exceed the string length —
    // this is what would truncate the Content-Length if .length were used.
    expect(up.sizeBytes).toBeGreaterThan(up.body.toString('utf-8').length);
  });

  it('round-trips through readLinks', async () => {
    const fake = new FakeBackend();
    const registry: RepoLinksRegistry = { version: 1, links: [makeLink()] };
    await writeLinks(asBackend(fake), 'c', registry);
    await expect(readLinks(asBackend(fake), 'c')).resolves.toEqual(registry);
  });
});

describe('createLink', () => {
  it('creates the registry on a container with no metadata', async () => {
    const fake = new FakeBackend();

    const { link } = await createLink(asBackend(fake), 'c', {
      provider: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      branch: 'main',
    });

    expect(link.id).toBeTruthy();
    expect(fake.storedLinks().links).toHaveLength(1);
    expect(fake.storedLinks().links[0].repoUrl).toBe('https://github.com/acme/widgets');
  });

  it('propagates a 401 rather than starting from an empty registry', async () => {
    const fake = new FakeBackend();
    fake.seedLinks({ version: 1, links: [makeLink()] });
    fake.readError = Object.assign(new Error('OIDC login required'), { status: 401 });

    await expect(
      createLink(asBackend(fake), 'c', { provider: 'github', repoUrl: 'https://github.com/acme/other', branch: 'main' }),
    ).rejects.toThrow('OIDC login required');

    expect(fake.storedLinks().links).toHaveLength(1);
  });
});

describe('syncRepo', () => {
  function provider(files: Record<string, { sha: string; body: string }>): RepoProvider {
    return {
      listFiles: async () => Object.entries(files).map(([path, f]) => ({ path, sha: f.sha })),
      downloadFile: async (path: string) => Buffer.from(files[path].body, 'utf-8'),
    };
  }

  it('uploads changed files, skips unchanged, and deletes stale ones', async () => {
    const fake = new FakeBackend();
    const link = makeLink({ fileShas: { 'a.txt': 'sha-a', 'gone.txt': 'sha-gone' } });

    const result = await syncRepo(asBackend(fake), 'c', provider({
      'a.txt': { sha: 'sha-a', body: 'unchanged' },
      'b.txt': { sha: 'sha-b', body: 'new file' },
    }), link);

    expect(result.uploaded).toEqual(['b.txt']);
    expect(result.skipped).toEqual(['a.txt']);
    expect(result.deleted).toEqual(['gone.txt']);
    expect(result.errors).toEqual([]);
    expect(link.fileShas).toEqual({ 'a.txt': 'sha-a', 'b.txt': 'sha-b' });
  });

  it('uploads file bodies with sizeBytes equal to byteLength, not string length', async () => {
    const fake = new FakeBackend();

    await syncRepo(asBackend(fake), 'c', provider({
      'greek.txt': { sha: 'sha-1', body: 'καλημέρα' },
    }), makeLink());

    const up = fake.uploads.find((u) => u.path === 'greek.txt')!;
    expect(up.sizeBytes).toBe(up.body.byteLength);
    expect(up.sizeBytes).toBe(Buffer.byteLength('καλημέρα', 'utf-8'));
  });

  it('records a failed delete in errors without aborting the sync', async () => {
    const fake = new FakeBackend();
    fake.failDeletes.add('gone.txt');
    const link = makeLink({ fileShas: { 'gone.txt': 'sha-gone' } });

    const result = await syncRepo(asBackend(fake), 'c', provider({
      'b.txt': { sha: 'sha-b', body: 'new file' },
    }), link);

    expect(result.uploaded).toEqual(['b.txt']);
    expect(result.deleted).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('gone.txt');
  });

  it('does not touch the backend under dryRun', async () => {
    const fake = new FakeBackend();
    const link = makeLink({ fileShas: { 'gone.txt': 'sha-gone' } });

    const result = await syncRepo(asBackend(fake), 'c', provider({
      'b.txt': { sha: 'sha-b', body: 'new file' },
    }), link, true);

    expect(result.uploaded).toEqual(['b.txt']);
    expect(result.deleted).toEqual(['gone.txt']);
    expect(fake.uploads).toHaveLength(0);
    expect(link.fileShas).toEqual({ 'gone.txt': 'sha-gone' });
  });
});
