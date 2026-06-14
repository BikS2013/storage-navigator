// ===========================================================================
// tests/unit/blob-enumerator.test.ts
//
// Unit tests for src/core/blob-enumerator.ts
//
// A minimal stub BlobClient replaces the real Azure client — no network I/O.
// ===========================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enumerateScope } from '../../src/core/blob-enumerator.js';
import type { EnumerateScopeOptions } from '../../src/core/blob-enumerator.js';
import type { ReverseLinkScope, EnumeratedBlob } from '../../src/core/reverse-git-types.js';
import { PathCollisionError } from '../../src/core/reverse-git-errors.js';
import type { BlobClient } from '../../src/core/blob-client.js';

// ---------------------------------------------------------------------------
// Stub BlobClient factory
// ---------------------------------------------------------------------------

/**
 * Defines the shape of blob data each test controls.
 * `etag` defaults to `'"etag-<name>"'` when omitted.
 */
interface FakeBlob {
  name: string;
  etag?: string;
}

interface ContainerFixture {
  name: string;
  blobs: FakeBlob[];
  /** Optional .gitignore content at the container / prefix root. */
  gitignoreContent?: string;
}

/**
 * Build a stub `BlobClient` that satisfies the interface used by
 * `enumerateScope`. All methods that are NOT called by the enumerator
 * throw to catch unexpected invocations.
 */
function makeStubBlobClient(fixtures: ContainerFixture[]): BlobClient {
  const containerMap = new Map<string, ContainerFixture>(
    fixtures.map((f) => [f.name, f]),
  );

  const stub: Partial<BlobClient> = {
    listContainers: vi.fn(async () =>
      fixtures.map((f) => ({ name: f.name })),
    ),

    iterateBlobsFlat: vi.fn(async function* (
      container: string,
      prefix?: string,
    ) {
      const fixture = containerMap.get(container);
      if (!fixture) return;
      for (const b of fixture.blobs) {
        if (prefix === undefined || b.name.startsWith(prefix)) {
          yield { name: b.name };
        }
      }
    }),

    getBlobProperties: vi.fn(async (container: string, blobName: string) => {
      const fixture = containerMap.get(container);
      if (!fixture) throw new Error(`Unknown container: ${container}`);
      const blob = fixture.blobs.find((b) => b.name === blobName);
      if (!blob) throw new Error(`Unknown blob: ${blobName}`);
      const etag = blob.etag ?? `"etag-${blobName}"`;
      return { etag, size: 100 };
    }),

    getBlobContent: vi.fn(async (container: string, blobName: string) => {
      const fixture = containerMap.get(container);
      if (!fixture) throw new Error(`Unknown container: ${container}`);

      // .gitignore lookup — path relative to the storagePrefix passed to
      // iterateBlobsFlat. For simplicity, the test fixtures store it as
      // ".gitignore" (no prefix) for container-scope tests and
      // "<prefix>.gitignore" for prefix-scope tests — the enumerator
      // concatenates (storagePrefix || "") + ".gitignore" internally.
      if (fixture.gitignoreContent !== undefined) {
        return {
          content: fixture.gitignoreContent,
          contentType: 'text/plain',
          size: fixture.gitignoreContent.length,
          name: blobName,
        };
      }
      throw new Error(`getBlobContent: no gitignore fixture for ${container}/${blobName}`);
    }),
  };

  return stub as unknown as BlobClient;
}

/** Helper: drain the async generator into an array. */
async function collect(
  gen: AsyncGenerator<EnumeratedBlob>,
): Promise<EnumeratedBlob[]> {
  const out: EnumeratedBlob[] = [];
  for await (const b of gen) out.push(b);
  return out;
}

/** Default options — no exclusions, no gitignore, no repoSubPath. */
function defaultOpts(overrides: Partial<EnumerateScopeOptions> = {}): EnumerateScopeOptions {
  return {
    exclusionPatterns: [],
    respectGitignore: false,
    repoSubPath: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Container scope — 1:1 path mapping (R5.1)
// ---------------------------------------------------------------------------

describe('container scope — 1:1 path mapping', () => {
  it('maps each blob name directly to repoPath', async () => {
    const client = makeStubBlobClient([
      {
        name: 'my-container',
        blobs: [
          { name: 'README.md' },
          { name: 'src/index.ts' },
          { name: 'docs/guide.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = {
      kind: 'container',
      account: 'acct',
      container: 'my-container',
    };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));

    const repoPaths = results.map((r) => r.repoPath).sort();
    expect(repoPaths).toEqual(['README.md', 'docs/guide.txt', 'src/index.ts']);
  });

  it('storagePath is container/blobName', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'a/b.txt' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results[0].storagePath).toBe('c1/a/b.txt');
  });

  it('includes etag and size from getBlobProperties', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'x.txt', etag: '"custom-etag"' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results[0].etag).toBe('"custom-etag"');
    expect(results[0].size).toBe(100);
  });

  it('prepends repoSubPath when set', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'file.txt' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ repoSubPath: 'sub/dir' })),
    );
    expect(results[0].repoPath).toBe('sub/dir/file.txt');
  });

  it('normalises leading/trailing slashes in repoSubPath', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'file.txt' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ repoSubPath: '/sub/' })),
    );
    expect(results[0].repoPath).toBe('sub/file.txt');
  });
});

// ---------------------------------------------------------------------------
// Prefix scope — strips scope-root prefix (R5.2)
// ---------------------------------------------------------------------------

describe('prefix scope — strips scope-root prefix', () => {
  it('strips the prefix from repoPath', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'data/file1.csv' },
          { name: 'data/nested/file2.csv' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = {
      kind: 'prefix',
      account: 'a',
      container: 'c1',
      prefix: 'data',
    };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    const repoPaths = results.map((r) => r.repoPath).sort();
    expect(repoPaths).toEqual(['file1.csv', 'nested/file2.csv']);
  });

  it('strips prefix with trailing slash when provided', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'reports/q1.pdf' }] },
    ]);
    const scope: ReverseLinkScope = {
      kind: 'prefix',
      account: 'a',
      container: 'c1',
      prefix: 'reports/',
    };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results[0].repoPath).toBe('q1.pdf');
  });

  it('storagePath still includes the full blob name (with prefix)', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'data/item.json' }] },
    ]);
    const scope: ReverseLinkScope = {
      kind: 'prefix',
      account: 'a',
      container: 'c1',
      prefix: 'data',
    };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results[0].storagePath).toBe('c1/data/item.json');
  });
});

// ---------------------------------------------------------------------------
// Account scope — prepends container as top-level folder (R5.3)
// ---------------------------------------------------------------------------

describe('account scope — container name as top-level folder', () => {
  it('prepends container name to every repoPath', async () => {
    const client = makeStubBlobClient([
      { name: 'cont-a', blobs: [{ name: 'file.txt' }] },
      { name: 'cont-b', blobs: [{ name: 'doc.md' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'account', account: 'acct' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    const repoPaths = results.map((r) => r.repoPath).sort();
    expect(repoPaths).toEqual(['cont-a/file.txt', 'cont-b/doc.md']);
  });

  it('iterates over all listed containers', async () => {
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'a.txt' }, { name: 'b.txt' }] },
      { name: 'c2', blobs: [{ name: 'c.txt' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'account', account: 'acct' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// EXCLUDED_BLOB_NAMES always filtered (R6.3 / R6.4)
// ---------------------------------------------------------------------------

describe('EXCLUDED_BLOB_NAMES — always filtered', () => {
  const EXCLUDED = [
    '.repo-links.json',
    '.reverse-git-links.json',
    '.repo-sync-meta.json',
  ];

  for (const name of EXCLUDED) {
    it(`excludes "${name}" unconditionally`, async () => {
      const client = makeStubBlobClient([
        {
          name: 'c1',
          blobs: [
            { name: 'keep.txt' },
            { name },
          ],
        },
      ]);
      const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
      const results = await collect(enumerateScope(client, scope, defaultOpts()));
      const repoPaths = results.map((r) => r.repoPath);
      expect(repoPaths).toContain('keep.txt');
      expect(repoPaths).not.toContain(name);
    });
  }

  it('excludes metadata blobs nested inside subdirectories too', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'sub/.repo-links.json' },
          { name: 'sub/legit.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    const repoPaths = results.map((r) => r.repoPath);
    expect(repoPaths).not.toContain('sub/.repo-links.json');
    expect(repoPaths).toContain('sub/legit.txt');
  });
});

// ---------------------------------------------------------------------------
// Illegal path detection (R5.4)
// ---------------------------------------------------------------------------

describe('illegal path detection', () => {
  it('skips blobs with backslash in name and emits onWarn', async () => {
    const warns: string[] = [];
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'bad\\path.txt' },
          { name: 'good.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ onWarn: (m) => warns.push(m) })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['good.txt']);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/backslash/);
  });

  it('skips .git root blob and emits onWarn', async () => {
    const warns: string[] = [];
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: '.git' }, { name: 'ok.txt' }] },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ onWarn: (m) => warns.push(m) })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['ok.txt']);
    expect(warns[0]).toMatch(/\.git/);
  });

  it('skips blobs with .git/ segment and emits onWarn', async () => {
    const warns: string[] = [];
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: '.git/config' },
          { name: 'ok.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ onWarn: (m) => warns.push(m) })),
    );
    expect(results.map((r) => r.repoPath)).not.toContain('.git/config');
    expect(warns[0]).toMatch(/\.git/);
  });

  it('skips blobs with ASCII control characters and emits onWarn', async () => {
    const warns: string[] = [];
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'badchar.txt' },
          { name: 'clean.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ onWarn: (m) => warns.push(m) })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['clean.txt']);
    expect(warns[0]).toMatch(/control/);
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive path collision → PathCollisionError (R5.5)
// ---------------------------------------------------------------------------

describe('PathCollisionError on case-insensitive collision', () => {
  it('throws PathCollisionError when two blobs map to same repo path (different case)', async () => {
    // Two blobs with differently-cased names that would map to the same
    // lower-cased repo path.
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'README.md' },
          { name: 'readme.md' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    await expect(
      collect(enumerateScope(client, scope, defaultOpts())),
    ).rejects.toBeInstanceOf(PathCollisionError);
  });

  it('does not throw for two blobs with distinct lower-cased paths', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'README.md' },
          { name: 'src/index.ts' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    await expect(
      collect(enumerateScope(client, scope, defaultOpts())),
    ).resolves.toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Exclusion patterns (R6.1)
// ---------------------------------------------------------------------------

describe('exclusionPatterns', () => {
  it('excludes blobs matching a literal filename pattern', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'secret.key' },
          { name: 'public.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['secret.key'] })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['public.txt']);
  });

  it('excludes blobs matching a wildcard * pattern', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'log-2024.log' },
          { name: 'log-2025.log' },
          { name: 'data.csv' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['*.log'] })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['data.csv']);
  });

  it('excludes blobs matching a directory-style trailing slash pattern', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'temp/a.txt' },
          { name: 'temp/b.txt' },
          { name: 'src/main.ts' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['temp/'] })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['src/main.ts']);
  });

  it('excludes blobs matching a rooted / pattern', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'build/output.js' },
          { name: 'src/main.ts' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['/build'] })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['src/main.ts']);
  });

  it('excludes blobs matching a ** glob at any depth', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'a/b/c/secret.env' },
          { name: 'top.env' },
          { name: 'keep.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['**/*.env'] })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['keep.txt']);
  });

  it('excludes blobs matching a ? wildcard pattern', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'logA.log' },
          { name: 'logB.log' },
          { name: 'logging.log' }, // 3 chars before .log — should NOT match log?.log
          { name: 'other.txt' },
        ],
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ exclusionPatterns: ['log?.log'] })),
    );
    const paths = results.map((r) => r.repoPath);
    expect(paths).not.toContain('logA.log');
    expect(paths).not.toContain('logB.log');
    // logging.log has 4 chars after "log" (before .log) so must NOT match log?.log
    expect(paths).toContain('logging.log');
    expect(paths).toContain('other.txt');
  });
});

// ---------------------------------------------------------------------------
// .gitignore evaluation (R6.2 / AC-D6)
// ---------------------------------------------------------------------------

describe('respectGitignore evaluation', () => {
  it('ignores blobs matched by .gitignore patterns', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: '.gitignore' },
          { name: 'node_modules/pkg/index.js' },
          { name: 'src/main.ts' },
        ],
        gitignoreContent: 'node_modules/',
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: true })),
    );
    const paths = results.map((r) => r.repoPath);
    expect(paths).not.toContain('node_modules/pkg/index.js');
    expect(paths).toContain('src/main.ts');
  });

  it('the .gitignore file itself is NEVER excluded by its own rules (AC-D6)', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: '.gitignore' },
          { name: 'README.md' },
        ],
        // Attempt to self-exclude .gitignore
        gitignoreContent: '.gitignore\n*.md',
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: true })),
    );
    const paths = results.map((r) => r.repoPath);
    // .gitignore must survive regardless
    expect(paths).toContain('.gitignore');
    // README.md is matched by *.md pattern — it should be excluded
    expect(paths).not.toContain('README.md');
  });

  it('honours negation (!) rules inside .gitignore', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'dist/bundle.js' },
          { name: 'dist/important.js' },
          { name: '.gitignore' },
        ],
        gitignoreContent: 'dist/\n!dist/important.js',
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: true })),
    );
    const paths = results.map((r) => r.repoPath);
    // dist/bundle.js should be excluded
    expect(paths).not.toContain('dist/bundle.js');
    // dist/important.js is un-ignored by the ! rule
    expect(paths).toContain('dist/important.js');
  });

  it('skips gitignore evaluation entirely when respectGitignore=false', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'node_modules/pkg/index.js' },
          { name: 'src/main.ts' },
        ],
        gitignoreContent: 'node_modules/',
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: false })),
    );
    const paths = results.map((r) => r.repoPath);
    // With respectGitignore=false, node_modules blobs are NOT filtered
    expect(paths).toContain('node_modules/pkg/index.js');
    expect(paths).toContain('src/main.ts');
  });

  it('does not load .gitignore when respectGitignore=false (getBlobContent not called)', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [{ name: 'a.txt' }],
        gitignoreContent: '*.txt',
      },
    ]);
    const getBlobContentSpy = vi.spyOn(client, 'getBlobContent');
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    await collect(enumerateScope(client, scope, defaultOpts({ respectGitignore: false })));
    expect(getBlobContentSpy).not.toHaveBeenCalled();
  });

  it('handles missing .gitignore gracefully (no 404 propagation)', async () => {
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [{ name: 'a.txt' }],
        // No gitignoreContent — getBlobContent will throw
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    // Should NOT throw even though getBlobContent throws internally
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: true })),
    );
    expect(results[0].repoPath).toBe('a.txt');
  });

  it('evaluates patterns relative to the scope root (not the full blob path)', async () => {
    // Pattern "*.ts" should match files at any depth (no leading slash in pattern)
    const client = makeStubBlobClient([
      {
        name: 'c1',
        blobs: [
          { name: 'deep/nested/file.ts' },
          { name: 'deep/nested/file.txt' },
        ],
        gitignoreContent: '*.ts',
      },
    ]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ respectGitignore: true })),
    );
    const paths = results.map((r) => r.repoPath);
    expect(paths).not.toContain('deep/nested/file.ts');
    expect(paths).toContain('deep/nested/file.txt');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('yields nothing for an empty container', async () => {
    const client = makeStubBlobClient([{ name: 'c1', blobs: [] }]);
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results).toHaveLength(0);
  });

  it('yields nothing for an account with no containers', async () => {
    const client = makeStubBlobClient([]);
    const scope: ReverseLinkScope = { kind: 'account', account: 'empty-acct' };
    const results = await collect(enumerateScope(client, scope, defaultOpts()));
    expect(results).toHaveLength(0);
  });

  it('skips blobs with no ETag returned by getBlobProperties and emits onWarn', async () => {
    const warns: string[] = [];
    // Override getBlobProperties to return no etag for one specific blob
    const client = makeStubBlobClient([
      { name: 'c1', blobs: [{ name: 'no-etag.txt' }, { name: 'has-etag.txt' }] },
    ]);
    vi.spyOn(client, 'getBlobProperties').mockImplementation(
      async (_container: string, blobName: string) => {
        if (blobName === 'no-etag.txt') return { size: 50 }; // no etag
        return { etag: '"some-etag"', size: 50 };
      },
    );
    const scope: ReverseLinkScope = { kind: 'container', account: 'a', container: 'c1' };
    const results = await collect(
      enumerateScope(client, scope, defaultOpts({ onWarn: (m) => warns.push(m) })),
    );
    expect(results.map((r) => r.repoPath)).toEqual(['has-etag.txt']);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/no ETag/i);
  });
});
