// ===========================================================================
// tests/unit/diff-engine-backend.test.ts
// Tests for the physical-check path of src/core/diff-engine.ts after it moved
// from BlobClient.listBlobsFlat to IStorageBackend.iterateBlobsFlat (plan-015).
// ===========================================================================

import { describe, it, expect } from 'vitest';
import type { IStorageBackend } from '../../src/core/backend/backend.js';
import type { RepoLink, RepoProvider } from '../../src/core/types.js';
import { diffLink } from '../../src/core/diff-engine.js';

function fakeBackend(names: string[]): IStorageBackend {
  return {
    async *iterateBlobsFlat(_container: string, prefix: string) {
      for (const name of names) {
        if (prefix && !name.startsWith(prefix)) continue;
        yield { name };
      }
    },
  } as unknown as IStorageBackend;
}

function provider(files: Array<{ path: string; sha: string }>): RepoProvider {
  return {
    listFiles: async () => files,
    downloadFile: async () => { throw new Error('diff must never download'); },
  };
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

describe('diffLink physical check', () => {
  it('finds untracked blobs by draining iterateBlobsFlat', async () => {
    const backend = fakeBackend(['a.txt', 'stray.txt', '.repo-links.json']);
    const link = makeLink({ fileShas: { 'a.txt': 'sha-a' } });

    const report = await diffLink(provider([{ path: 'a.txt', sha: 'sha-a' }]), link, backend, 'c', {
      includePhysicalCheck: true,
    });

    expect(report.untracked.map((e) => e.blobPath)).toEqual(['stray.txt']);
    expect(report.summary.untrackedCount).toBe(1);
  });

  it('annotates repo-only entries with physicallyExists', async () => {
    const backend = fakeBackend(['present.txt']);
    const link = makeLink();

    const report = await diffLink(
      provider([{ path: 'present.txt', sha: 'sha-1' }, { path: 'absent.txt', sha: 'sha-2' }]),
      link,
      backend,
      'c',
      { includePhysicalCheck: true },
    );

    const byPath = Object.fromEntries(report.repoOnly.map((e) => [e.blobPath, e.physicallyExists]));
    expect(byPath).toEqual({ 'present.txt': true, 'absent.txt': false });
  });

  it('restricts untracked detection to the link targetPrefix', async () => {
    const backend = fakeBackend(['docs/stray.txt', 'other/ignored.txt']);
    const link = makeLink({ targetPrefix: 'docs' });

    const report = await diffLink(provider([]), link, backend, 'c', { includePhysicalCheck: true });

    expect(report.untracked.map((e) => e.blobPath)).toEqual(['docs/stray.txt']);
  });

  it('throws when includePhysicalCheck is set without a backend', async () => {
    await expect(
      diffLink(provider([]), makeLink(), undefined, 'c', { includePhysicalCheck: true }),
    ).rejects.toThrow('backend is required when includePhysicalCheck is true');
  });

  it('does not enumerate blobs when includePhysicalCheck is off', async () => {
    let enumerated = false;
    const backend = {
      async *iterateBlobsFlat() { enumerated = true; },
    } as unknown as IStorageBackend;

    const report = await diffLink(provider([{ path: 'a.txt', sha: 'sha-a' }]), makeLink(), backend, 'c');

    expect(enumerated).toBe(false);
    expect(report.summary.untrackedCount).toBe(0);
  });
});
