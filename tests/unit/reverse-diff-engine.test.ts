// ===========================================================================
// tests/unit/reverse-diff-engine.test.ts
//
// Unit tests for src/core/reverse-diff-engine.ts
//
// Scope: computeReverseDiff (pure function), buildRepoChanges (content-loader
// contract), collectSnapshot (async iterable drain).
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  computeReverseDiff,
  buildRepoChanges,
  collectSnapshot,
} from '../../src/core/reverse-diff-engine.js';
import type { ReverseDiffResult, EnumeratedBlob } from '../../src/core/reverse-git-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

async function* makeBlobs(blobs: EnumeratedBlob[]): AsyncGenerator<EnumeratedBlob> {
  for (const b of blobs) yield b;
}

// ---------------------------------------------------------------------------
// computeReverseDiff — classification
// ---------------------------------------------------------------------------

describe('computeReverseDiff — basic classification', () => {
  it('classifies a path present only in current as added', () => {
    const current = makeSnapshot({ 'docs/a.txt': 'etag-1' });
    const last: Record<string, string> = {};
    const result = computeReverseDiff('link-1', current, last);

    expect(result.added).toEqual(['docs/a.txt']);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.counts.added).toBe(1);
    expect(result.counts.modified).toBe(0);
    expect(result.counts.deleted).toBe(0);
    expect(result.counts.unchanged).toBe(0);
  });

  it('classifies a path present only in last as deleted', () => {
    const current = makeSnapshot({});
    const last: Record<string, string> = { 'docs/a.txt': 'etag-1' };
    const result = computeReverseDiff('link-1', current, last);

    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual(['docs/a.txt']);
    expect(result.unchanged).toEqual([]);
    expect(result.counts.deleted).toBe(1);
  });

  it('classifies a path with the same ETag as unchanged', () => {
    const etag = '"abc-123"';
    const current = makeSnapshot({ 'src/index.ts': etag });
    const last: Record<string, string> = { 'src/index.ts': etag };
    const result = computeReverseDiff('link-2', current, last);

    expect(result.unchanged).toEqual(['src/index.ts']);
    expect(result.modified).toEqual([]);
    expect(result.counts.unchanged).toBe(1);
  });

  it('classifies a path with a changed ETag as modified', () => {
    const current = makeSnapshot({ 'src/index.ts': '"etag-new"' });
    const last: Record<string, string> = { 'src/index.ts': '"etag-old"' };
    const result = computeReverseDiff('link-2', current, last);

    expect(result.modified).toEqual(['src/index.ts']);
    expect(result.unchanged).toEqual([]);
    expect(result.counts.modified).toBe(1);
  });

  it('handles mixed added / modified / deleted / unchanged in one call', () => {
    const current = makeSnapshot({
      'a.txt': '"etag-a"',    // unchanged
      'b.txt': '"etag-b-new"', // modified (etag changed)
      'c.txt': '"etag-c"',    // added (not in last)
    });
    const last: Record<string, string> = {
      'a.txt': '"etag-a"',     // unchanged
      'b.txt': '"etag-b-old"', // modified
      'd.txt': '"etag-d"',     // deleted
    };
    const result = computeReverseDiff('link-3', current, last);

    expect(result.added).toEqual(['c.txt']);
    expect(result.modified).toEqual(['b.txt']);
    expect(result.deleted).toEqual(['d.txt']);
    expect(result.unchanged).toEqual(['a.txt']);
  });

  it('copies linkId into the result unchanged', () => {
    const result = computeReverseDiff('my-link-id', makeSnapshot({}), {});
    expect(result.linkId).toBe('my-link-id');
  });

  it('returns all empty arrays and zero counts for identical empty snapshots', () => {
    const result = computeReverseDiff('x', makeSnapshot({}), {});
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.counts).toEqual({ added: 0, modified: 0, deleted: 0, unchanged: 0 });
  });

  it('treats first publish (empty lastSnapshot) as all added', () => {
    const current = makeSnapshot({
      'README.md': '"e1"',
      'src/main.ts': '"e2"',
    });
    const result = computeReverseDiff('link-4', current, {});
    expect(result.added).toHaveLength(2);
    expect(result.added).toContain('README.md');
    expect(result.added).toContain('src/main.ts');
    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.modified).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeReverseDiff — force option
// ---------------------------------------------------------------------------

describe('computeReverseDiff — force option', () => {
  it('promotes unchanged paths to modified when force=true', () => {
    const current = makeSnapshot({
      'a.txt': '"etag-a"',
      'b.txt': '"etag-b"',
    });
    const last: Record<string, string> = {
      'a.txt': '"etag-a"', // same => would be unchanged
      'b.txt': '"etag-b"', // same => would be unchanged
    };
    const result = computeReverseDiff('link-5', current, last, { force: true });

    // Both paths promoted to modified
    expect(result.modified).toHaveLength(2);
    expect(result.modified).toContain('a.txt');
    expect(result.modified).toContain('b.txt');
    // unchanged must be empty
    expect(result.unchanged).toEqual([]);
    expect(result.counts.modified).toBe(2);
    expect(result.counts.unchanged).toBe(0);
  });

  it('does not affect added or deleted under force=true', () => {
    const current = makeSnapshot({
      'new.txt': '"etag-n"',
      'same.txt': '"etag-s"',
    });
    const last: Record<string, string> = {
      'same.txt': '"etag-s"',
      'gone.txt': '"etag-g"',
    };
    const result = computeReverseDiff('link-6', current, last, { force: true });

    expect(result.added).toEqual(['new.txt']);
    expect(result.deleted).toEqual(['gone.txt']);
    // same.txt was unchanged, now promoted to modified
    expect(result.modified).toContain('same.txt');
    expect(result.unchanged).toEqual([]);
  });

  it('defaults force to false when option is omitted', () => {
    const current = makeSnapshot({ 'x.txt': '"e"' });
    const last: Record<string, string> = { 'x.txt': '"e"' };
    const result = computeReverseDiff('link-7', current, last);
    expect(result.unchanged).toEqual(['x.txt']);
    expect(result.modified).toEqual([]);
  });

  it('defaults force to false when force=false explicitly', () => {
    const current = makeSnapshot({ 'x.txt': '"e"' });
    const last: Record<string, string> = { 'x.txt': '"e"' };
    const result = computeReverseDiff('link-7', current, last, { force: false });
    expect(result.unchanged).toEqual(['x.txt']);
    expect(result.modified).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeReverseDiff — lexicographic sort (deterministic output)
// ---------------------------------------------------------------------------

describe('computeReverseDiff — sorted output arrays', () => {
  it('sorts added lexicographically', () => {
    const current = makeSnapshot({
      'z.txt': '"e1"',
      'a.txt': '"e2"',
      'm.txt': '"e3"',
    });
    const result = computeReverseDiff('link-8', current, {});
    expect(result.added).toEqual(['a.txt', 'm.txt', 'z.txt']);
  });

  it('sorts modified lexicographically', () => {
    const current = makeSnapshot({
      'z.txt': '"new-z"',
      'a.txt': '"new-a"',
    });
    const last: Record<string, string> = {
      'z.txt': '"old-z"',
      'a.txt': '"old-a"',
    };
    const result = computeReverseDiff('link-9', current, last);
    expect(result.modified).toEqual(['a.txt', 'z.txt']);
  });

  it('sorts deleted lexicographically', () => {
    const last: Record<string, string> = {
      'z.txt': '"e1"',
      'a.txt': '"e2"',
      'm.txt': '"e3"',
    };
    const result = computeReverseDiff('link-10', makeSnapshot({}), last);
    expect(result.deleted).toEqual(['a.txt', 'm.txt', 'z.txt']);
  });

  it('sorts unchanged lexicographically', () => {
    const etag = '"same"';
    const current = makeSnapshot({
      'z.txt': etag,
      'a.txt': etag,
      'm.txt': etag,
    });
    const last: Record<string, string> = {
      'z.txt': etag,
      'a.txt': etag,
      'm.txt': etag,
    };
    const result = computeReverseDiff('link-11', current, last);
    expect(result.unchanged).toEqual(['a.txt', 'm.txt', 'z.txt']);
  });

  it('produces identical output for the same inputs on two consecutive calls', () => {
    const current = makeSnapshot({ 'b.txt': '"e-b"', 'a.txt': '"e-a"' });
    const last: Record<string, string> = { 'a.txt': '"e-a"', 'c.txt': '"e-c"' };
    const r1 = computeReverseDiff('link-12', current, last);
    const r2 = computeReverseDiff('link-12', current, last);
    expect(r1.added).toEqual(r2.added);
    expect(r1.modified).toEqual(r2.modified);
    expect(r1.deleted).toEqual(r2.deleted);
    expect(r1.unchanged).toEqual(r2.unchanged);
  });
});

// ---------------------------------------------------------------------------
// buildRepoChanges — content loader contract
// ---------------------------------------------------------------------------

describe('buildRepoChanges — content loader invocation', () => {
  it('calls contentLoader for added paths and produces kind="add" entries', async () => {
    const loader = vi.fn(async (path: string) => new TextEncoder().encode(path));
    const diff: ReverseDiffResult = {
      linkId: 'l1',
      added: ['a.txt'],
      modified: [],
      deleted: [],
      unchanged: [],
      counts: { added: 1, modified: 0, deleted: 0, unchanged: 0 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(loader).toHaveBeenCalledWith('a.txt');
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('add');
    expect(changes[0].path).toBe('a.txt');
    // contentBytes should be the encoded path
    expect(changes[0]).toMatchObject({ kind: 'add', path: 'a.txt' });
  });

  it('calls contentLoader for modified paths and produces kind="edit" entries', async () => {
    const loader = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const diff: ReverseDiffResult = {
      linkId: 'l2',
      added: [],
      modified: ['b.txt'],
      deleted: [],
      unchanged: [],
      counts: { added: 0, modified: 1, deleted: 0, unchanged: 0 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(loader).toHaveBeenCalledWith('b.txt');
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('edit');
    expect(changes[0].path).toBe('b.txt');
  });

  it('does NOT call contentLoader for deleted paths and produces kind="delete" entries without contentBytes', async () => {
    const loader = vi.fn(async () => new Uint8Array());
    const diff: ReverseDiffResult = {
      linkId: 'l3',
      added: [],
      modified: [],
      deleted: ['gone.txt'],
      unchanged: [],
      counts: { added: 0, modified: 0, deleted: 1, unchanged: 0 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(loader).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('delete');
    expect(changes[0].path).toBe('gone.txt');
    // delete entries must NOT carry contentBytes
    expect('contentBytes' in changes[0]).toBe(false);
  });

  it('does NOT call contentLoader for unchanged paths', async () => {
    const loader = vi.fn(async () => new Uint8Array());
    const diff: ReverseDiffResult = {
      linkId: 'l4',
      added: [],
      modified: [],
      deleted: [],
      unchanged: ['unchanged.txt'],
      counts: { added: 0, modified: 0, deleted: 0, unchanged: 1 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(loader).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
  });

  it('orders output: all adds first, then edits, then deletes', async () => {
    const loader = vi.fn(async (path: string) => new TextEncoder().encode(path));
    const diff: ReverseDiffResult = {
      linkId: 'l5',
      added: ['added.txt'],
      modified: ['edited.txt'],
      deleted: ['deleted.txt'],
      unchanged: [],
      counts: { added: 1, modified: 1, deleted: 1, unchanged: 0 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(changes).toHaveLength(3);
    expect(changes[0].kind).toBe('add');
    expect(changes[1].kind).toBe('edit');
    expect(changes[2].kind).toBe('delete');
  });

  it('returns an empty array when the diff has no changes at all', async () => {
    const loader = vi.fn(async () => new Uint8Array());
    const diff: ReverseDiffResult = {
      linkId: 'l6',
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
      counts: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
    };
    const changes = await buildRepoChanges(diff, loader);
    expect(changes).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// collectSnapshot
// ---------------------------------------------------------------------------

describe('collectSnapshot', () => {
  it('drains async iterable into snapshot and repoPathToStoragePath maps', async () => {
    const blobs: EnumeratedBlob[] = [
      { storagePath: 'my-container/docs/a.txt', repoPath: 'docs/a.txt', etag: '"e1"', size: 10 },
      { storagePath: 'my-container/src/b.ts', repoPath: 'src/b.ts', etag: '"e2"', size: 20 },
    ];
    const { snapshot, repoPathToStoragePath } = await collectSnapshot(makeBlobs(blobs));

    expect(snapshot.get('docs/a.txt')).toBe('"e1"');
    expect(snapshot.get('src/b.ts')).toBe('"e2"');
    expect(repoPathToStoragePath.get('docs/a.txt')).toBe('my-container/docs/a.txt');
    expect(repoPathToStoragePath.get('src/b.ts')).toBe('my-container/src/b.ts');
    expect(snapshot.size).toBe(2);
    expect(repoPathToStoragePath.size).toBe(2);
  });

  it('returns empty maps for empty iterable', async () => {
    const { snapshot, repoPathToStoragePath } = await collectSnapshot(makeBlobs([]));
    expect(snapshot.size).toBe(0);
    expect(repoPathToStoragePath.size).toBe(0);
  });

  it('later blob overwrites earlier blob with the same repoPath in both maps', async () => {
    const blobs: EnumeratedBlob[] = [
      { storagePath: 'c1/a.txt', repoPath: 'a.txt', etag: '"e-first"', size: 1 },
      { storagePath: 'c2/a.txt', repoPath: 'a.txt', etag: '"e-second"', size: 2 },
    ];
    const { snapshot, repoPathToStoragePath } = await collectSnapshot(makeBlobs(blobs));
    // Last writer wins
    expect(snapshot.get('a.txt')).toBe('"e-second"');
    expect(repoPathToStoragePath.get('a.txt')).toBe('c2/a.txt');
    expect(snapshot.size).toBe(1);
  });
});
