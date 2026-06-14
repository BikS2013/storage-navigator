// ===========================================================================
// tests/unit/reverse-link-registry.test.ts
// Tests for src/core/reverse-link-registry.ts — container-scope CRUD and
// storage-account-scope wrappers.
//
// All BlobClient calls are replaced with a minimal stub that stores blobs
// in a plain in-memory Map. No Azure SDK calls are made.
// CredentialStore is also stubbed via a minimal in-memory implementation
// to avoid touching the filesystem.
// ===========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type { ReverseLink, ReverseGitLinkRegistry } from '../../src/core/reverse-git-types.js';
import { REVERSE_LINKS_BLOB } from '../../src/core/reverse-git-types.js';
import {
  readReverseLinks,
  writeReverseLinks,
  createReverseLink,
  removeReverseLink,
  findReverseLink,
  updateReverseLink,
  readAccountReverseLinks,
  writeAccountReverseLinks,
} from '../../src/core/reverse-link-registry.js';
import type { CredentialStore } from '../../src/core/credential-store.js';

// ---------------------------------------------------------------------------
// Stub BlobClient
// ---------------------------------------------------------------------------

/** Minimal BlobClient stub — backed by an in-memory Map<blobName, string>. */
class StubBlobClient {
  private readonly blobs = new Map<string, string>();

  async getBlobContent(
    _container: string,
    blobName: string,
  ): Promise<{ content: string }> {
    const content = this.blobs.get(blobName);
    if (content === undefined) {
      throw new Error(`Blob '${blobName}' does not exist (stub).`);
    }
    return { content };
  }

  async createBlob(
    _container: string,
    blobName: string,
    content: string,
    _contentType?: string,
  ): Promise<{ etag?: string }> {
    this.blobs.set(blobName, content);
    return { etag: `"stub-etag-${Date.now()}"` };
  }

  /** Test helper — access raw blob bytes. */
  raw(blobName: string): string | undefined {
    return this.blobs.get(blobName);
  }

  /** Test helper — seed a blob directly. */
  seed(blobName: string, content: string): void {
    this.blobs.set(blobName, content);
  }
}

// ---------------------------------------------------------------------------
// Stub CredentialStore (only the 2 reverse-link methods used by this module)
// ---------------------------------------------------------------------------

class StubCredentialStore {
  private readonly store = new Map<string, ReverseLink[]>();

  getAccountReverseLinks(account: string): ReverseLink[] {
    return this.store.get(account) ? [...(this.store.get(account) as ReverseLink[])] : [];
  }

  async setAccountReverseLinks(account: string, links: ReverseLink[]): Promise<void> {
    this.store.set(account, [...links]);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLink(id: string, overrides: Partial<ReverseLink> = {}): ReverseLink {
  return {
    id,
    scope: { kind: 'container', account: 'sa1', container: 'c1' },
    provider: 'github',
    repoUrl: 'owner/repo',
    branch: 'main',
    repoSubPath: '',
    tokenName: 'my-pat',
    author: { name: 'Test', email: 'test@test.com' },
    exclusionPatterns: [],
    respectGitignore: false,
    createRepo: false,
    visibility: 'private',
    blobSnapshot: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readReverseLinks
// ---------------------------------------------------------------------------

describe('readReverseLinks', () => {
  it('returns schemaVersion:1, links:[] when registry blob is absent', async () => {
    const blob = new StubBlobClient();
    const result = await readReverseLinks(blob as any, 'c1');
    expect(result.schemaVersion).toBe(1);
    expect(result.links).toEqual([]);
  });

  it('returns the stored registry when blob is present', async () => {
    const blob = new StubBlobClient();
    const registry: ReverseGitLinkRegistry = {
      schemaVersion: 1,
      links: [makeLink('link-a')],
    };
    blob.seed(REVERSE_LINKS_BLOB, JSON.stringify(registry));

    const result = await readReverseLinks(blob as any, 'c1');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].id).toBe('link-a');
  });

  it('heals a hand-edited blob that is missing the links field', async () => {
    const blob = new StubBlobClient();
    blob.seed(REVERSE_LINKS_BLOB, JSON.stringify({ schemaVersion: 1 }));
    const result = await readReverseLinks(blob as any, 'c1');
    expect(Array.isArray(result.links)).toBe(true);
    expect(result.links).toHaveLength(0);
  });

  it('heals a hand-edited blob that is missing schemaVersion', async () => {
    const blob = new StubBlobClient();
    blob.seed(REVERSE_LINKS_BLOB, JSON.stringify({ links: [] }));
    const result = await readReverseLinks(blob as any, 'c1');
    expect(result.schemaVersion).toBe(1);
  });

  it('returns empty registry on JSON parse error', async () => {
    const blob = new StubBlobClient();
    blob.seed(REVERSE_LINKS_BLOB, 'NOT VALID JSON {{{');
    const result = await readReverseLinks(blob as any, 'c1');
    expect(result.schemaVersion).toBe(1);
    expect(result.links).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeReverseLinks
// ---------------------------------------------------------------------------

describe('writeReverseLinks', () => {
  it('serialises the registry as pretty JSON to the well-known blob name', async () => {
    const blob = new StubBlobClient();
    const link = makeLink('write-test');
    await writeReverseLinks(blob as any, 'c1', { schemaVersion: 1, links: [link] });

    const raw = blob.raw(REVERSE_LINKS_BLOB);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.links[0].id).toBe('write-test');
  });

  it('round-trips through readReverseLinks', async () => {
    const blob = new StubBlobClient();
    const original: ReverseGitLinkRegistry = { schemaVersion: 1, links: [makeLink('rt')] };
    await writeReverseLinks(blob as any, 'c1', original);
    const back = await readReverseLinks(blob as any, 'c1');
    expect(back.links[0].id).toBe('rt');
  });
});

// ---------------------------------------------------------------------------
// createReverseLink
// ---------------------------------------------------------------------------

describe('createReverseLink', () => {
  let blob: StubBlobClient;
  beforeEach(() => { blob = new StubBlobClient(); });

  it('adds a new link to an empty registry', async () => {
    const link = makeLink('create-1');
    await createReverseLink(blob as any, 'c1', link);
    const registry = await readReverseLinks(blob as any, 'c1');
    expect(registry.links).toHaveLength(1);
    expect(registry.links[0].id).toBe('create-1');
  });

  it('appends to an existing registry', async () => {
    await createReverseLink(blob as any, 'c1', makeLink('first'));
    await createReverseLink(blob as any, 'c1', makeLink('second'));
    const registry = await readReverseLinks(blob as any, 'c1');
    expect(registry.links).toHaveLength(2);
  });

  it('throws when a link with the same id already exists', async () => {
    await createReverseLink(blob as any, 'c1', makeLink('dup'));
    await expect(
      createReverseLink(blob as any, 'c1', makeLink('dup')),
    ).rejects.toThrow(/already exists/);
  });

  it('persists new link fields completely', async () => {
    const link = makeLink('persist-check', { repoUrl: 'owner/special-repo', branch: 'dev' });
    await createReverseLink(blob as any, 'c1', link);
    const found = await findReverseLink(blob as any, 'c1', 'persist-check');
    expect(found?.repoUrl).toBe('owner/special-repo');
    expect(found?.branch).toBe('dev');
  });
});

// ---------------------------------------------------------------------------
// removeReverseLink
// ---------------------------------------------------------------------------

describe('removeReverseLink', () => {
  let blob: StubBlobClient;
  beforeEach(async () => {
    blob = new StubBlobClient();
    await createReverseLink(blob as any, 'c1', makeLink('keep'));
    await createReverseLink(blob as any, 'c1', makeLink('remove-me'));
  });

  it('returns true and removes the targeted link', async () => {
    const removed = await removeReverseLink(blob as any, 'c1', 'remove-me');
    expect(removed).toBe(true);
    const registry = await readReverseLinks(blob as any, 'c1');
    expect(registry.links.map((l) => l.id)).not.toContain('remove-me');
  });

  it('leaves other links intact', async () => {
    await removeReverseLink(blob as any, 'c1', 'remove-me');
    const registry = await readReverseLinks(blob as any, 'c1');
    expect(registry.links.map((l) => l.id)).toContain('keep');
  });

  it('returns false when the id does not exist (no-op)', async () => {
    const removed = await removeReverseLink(blob as any, 'c1', 'ghost');
    expect(removed).toBe(false);
  });

  it('does NOT rewrite the blob on a no-op remove', async () => {
    const rawBefore = blob.raw(REVERSE_LINKS_BLOB);
    await removeReverseLink(blob as any, 'c1', 'ghost');
    const rawAfter = blob.raw(REVERSE_LINKS_BLOB);
    expect(rawAfter).toBe(rawBefore);
  });
});

// ---------------------------------------------------------------------------
// findReverseLink
// ---------------------------------------------------------------------------

describe('findReverseLink', () => {
  let blob: StubBlobClient;
  beforeEach(async () => {
    blob = new StubBlobClient();
    await createReverseLink(blob as any, 'c1', makeLink('alpha'));
    await createReverseLink(blob as any, 'c1', makeLink('beta'));
  });

  it('returns the link when found', async () => {
    const found = await findReverseLink(blob as any, 'c1', 'alpha');
    expect(found?.id).toBe('alpha');
  });

  it('returns null when not found', async () => {
    const found = await findReverseLink(blob as any, 'c1', 'ghost');
    expect(found).toBeNull();
  });

  it('returns null on an empty registry', async () => {
    const empty = new StubBlobClient();
    const found = await findReverseLink(empty as any, 'c1', 'any');
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateReverseLink
// ---------------------------------------------------------------------------

describe('updateReverseLink', () => {
  let blob: StubBlobClient;
  beforeEach(async () => {
    blob = new StubBlobClient();
    await createReverseLink(blob as any, 'c1', makeLink('upd'));
  });

  it('returns true and updates the stored link', async () => {
    const updated = makeLink('upd', {
      lastPushedCommitSha: 'new-sha',
      blobSnapshot: { 'foo.txt': 'etag123' },
    });
    const result = await updateReverseLink(blob as any, 'c1', updated);
    expect(result).toBe(true);

    const found = await findReverseLink(blob as any, 'c1', 'upd');
    expect(found?.lastPushedCommitSha).toBe('new-sha');
    expect(found?.blobSnapshot).toEqual({ 'foo.txt': 'etag123' });
  });

  it('returns false when id not found', async () => {
    const result = await updateReverseLink(blob as any, 'c1', makeLink('ghost'));
    expect(result).toBe(false);
  });

  it('does not add a new link when id is absent', async () => {
    await updateReverseLink(blob as any, 'c1', makeLink('ghost'));
    const registry = await readReverseLinks(blob as any, 'c1');
    expect(registry.links.map((l) => l.id)).not.toContain('ghost');
  });

  it('leaves other links in the registry untouched', async () => {
    await createReverseLink(blob as any, 'c1', makeLink('unrelated'));
    await updateReverseLink(blob as any, 'c1', makeLink('upd', { branch: 'feature' }));
    const found = await findReverseLink(blob as any, 'c1', 'unrelated');
    expect(found?.branch).toBe('main'); // original value unchanged
  });
});

// ---------------------------------------------------------------------------
// readAccountReverseLinks / writeAccountReverseLinks
// ---------------------------------------------------------------------------

describe('readAccountReverseLinks', () => {
  it('returns [] when no links are stored for the account', () => {
    const store = new StubCredentialStore();
    const links = readAccountReverseLinks(store as unknown as CredentialStore, 'sa-unknown');
    expect(links).toEqual([]);
  });

  it('returns the stored links for the account', async () => {
    const store = new StubCredentialStore();
    const link = makeLink('acct-1', { scope: { kind: 'account', account: 'sa1' } });
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', [link]);
    const links = readAccountReverseLinks(store as unknown as CredentialStore, 'sa1');
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe('acct-1');
  });

  it('isolates different account names', async () => {
    const store = new StubCredentialStore();
    const linkA = makeLink('for-sa1', { scope: { kind: 'account', account: 'sa1' } });
    const linkB = makeLink('for-sa2', { scope: { kind: 'account', account: 'sa2' } });
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', [linkA]);
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa2', [linkB]);
    expect(readAccountReverseLinks(store as unknown as CredentialStore, 'sa1').map((l) => l.id)).toEqual(['for-sa1']);
    expect(readAccountReverseLinks(store as unknown as CredentialStore, 'sa2').map((l) => l.id)).toEqual(['for-sa2']);
  });
});

describe('writeAccountReverseLinks', () => {
  it('overwrites the full list on second write', async () => {
    const store = new StubCredentialStore();
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', [makeLink('old')]);
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', [makeLink('new1'), makeLink('new2')]);
    const links = readAccountReverseLinks(store as unknown as CredentialStore, 'sa1');
    expect(links.map((l) => l.id)).toEqual(['new1', 'new2']);
  });

  it('persists an empty array (explicit "no links" survives round-trip)', async () => {
    const store = new StubCredentialStore();
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', [makeLink('x')]);
    await writeAccountReverseLinks(store as unknown as CredentialStore, 'sa1', []);
    const links = readAccountReverseLinks(store as unknown as CredentialStore, 'sa1');
    expect(links).toEqual([]);
  });
});
