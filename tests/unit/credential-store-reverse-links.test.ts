// ===========================================================================
// tests/unit/credential-store-reverse-links.test.ts
// Tests for the 5 new reverse-git methods on CredentialStore:
//   - getAccountReverseLinks
//   - setAccountReverseLinks
//   - getReverseLinkPAT
//   - addReverseLinkPATBinding
//   - removeReverseLinkPATBinding
//
// Uses an isolated temp directory (STORAGE_NAVIGATOR_DIR) so tests are
// hermetically isolated from each other and from the host machine's store.
// ===========================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../src/core/credential-store.js';
import type { ReverseLink } from '../../src/core/reverse-git-types.js';

// ---------------------------------------------------------------------------
// Per-test isolated filesystem
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-rltest-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLink(id: string, overrides: Partial<ReverseLink> = {}): ReverseLink {
  return {
    id,
    scope: { kind: 'account', account: 'sa1' },
    provider: 'github',
    repoUrl: 'owner/repo',
    branch: 'main',
    repoSubPath: '',
    tokenName: 'pat1',
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
// getAccountReverseLinks
// ---------------------------------------------------------------------------

describe('CredentialStore.getAccountReverseLinks', () => {
  it('returns [] on a fresh store (no reverseLinks field)', () => {
    const store = new CredentialStore();
    expect(store.getAccountReverseLinks('sa1')).toEqual([]);
  });

  it('returns [] for an account with no stored links even after other accounts have links', async () => {
    const store = new CredentialStore();
    await store.setAccountReverseLinks('sa1', [makeLink('l1')]);
    expect(store.getAccountReverseLinks('sa2')).toEqual([]);
  });

  it('returns a copy — mutating the result does not affect the stored data', async () => {
    const store = new CredentialStore();
    await store.setAccountReverseLinks('sa1', [makeLink('immutable')]);
    const copy = store.getAccountReverseLinks('sa1');
    copy.pop();
    expect(store.getAccountReverseLinks('sa1')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setAccountReverseLinks
// ---------------------------------------------------------------------------

describe('CredentialStore.setAccountReverseLinks', () => {
  it('round-trips through save/load (disk persistence)', async () => {
    const store = new CredentialStore();
    const link = makeLink('persist');
    await store.setAccountReverseLinks('sa1', [link]);

    // New instance reads from disk
    const store2 = new CredentialStore();
    const links = store2.getAccountReverseLinks('sa1');
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe('persist');
  });

  it('initialises reverseLinks lazily on first write', async () => {
    const store = new CredentialStore();
    // Before any write: field is absent
    expect(store.getAccountReverseLinks('sa1')).toEqual([]);
    // After write: initialised
    await store.setAccountReverseLinks('sa1', [makeLink('lazy-init')]);
    expect(store.getAccountReverseLinks('sa1')).toHaveLength(1);
  });

  it('overwrites the full list for the given account', async () => {
    const store = new CredentialStore();
    await store.setAccountReverseLinks('sa1', [makeLink('old1'), makeLink('old2')]);
    await store.setAccountReverseLinks('sa1', [makeLink('new')]);
    expect(store.getAccountReverseLinks('sa1').map((l) => l.id)).toEqual(['new']);
  });

  it('persists an empty array (explicit "no links" state survives round-trip)', async () => {
    const store = new CredentialStore();
    await store.setAccountReverseLinks('sa1', [makeLink('x')]);
    await store.setAccountReverseLinks('sa1', []);
    const store2 = new CredentialStore();
    expect(store2.getAccountReverseLinks('sa1')).toEqual([]);
  });

  it('isolates separate accounts', async () => {
    const store = new CredentialStore();
    await store.setAccountReverseLinks('sa1', [makeLink('a1')]);
    await store.setAccountReverseLinks('sa2', [makeLink('a2'), makeLink('a3')]);

    expect(store.getAccountReverseLinks('sa1').map((l) => l.id)).toEqual(['a1']);
    expect(store.getAccountReverseLinks('sa2').map((l) => l.id)).toEqual(['a2', 'a3']);
  });

  it('does not disturb existing tokens when writing reverseLinks', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'my-pat', provider: 'github', token: 'ghp_secret' });
    await store.setAccountReverseLinks('sa1', [makeLink('l1')]);

    const store2 = new CredentialStore();
    expect(store2.getToken('my-pat')?.token).toBe('ghp_secret');
  });
});

// ---------------------------------------------------------------------------
// addReverseLinkPATBinding
// ---------------------------------------------------------------------------

describe('CredentialStore.addReverseLinkPATBinding', () => {
  it('stores a new binding', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'my-pat', provider: 'github', token: 'ghp_abc' });
    await store.addReverseLinkPATBinding('link-1', 'my-pat');

    // Verify via getReverseLinkPAT
    expect(store.getReverseLinkPAT('link-1')).toBe('ghp_abc');
  });

  it('persists through save/load', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'my-pat', provider: 'github', token: 'ghp_xyz' });
    await store.addReverseLinkPATBinding('link-persist', 'my-pat');

    const store2 = new CredentialStore();
    expect(store2.getReverseLinkPAT('link-persist')).toBe('ghp_xyz');
  });

  it('rebinding the same linkId replaces the previous tokenName (idempotent)', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'pat-a', provider: 'github', token: 'ghp_aaa' });
    store.addToken({ name: 'pat-b', provider: 'github', token: 'ghp_bbb' });
    await store.addReverseLinkPATBinding('link-rebind', 'pat-a');
    await store.addReverseLinkPATBinding('link-rebind', 'pat-b');

    // Only one binding must exist for this linkId
    const store2 = new CredentialStore();
    expect(store2.getReverseLinkPAT('link-rebind')).toBe('ghp_bbb');
  });

  it('does not create duplicate binding entries for the same linkId', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'p', provider: 'github', token: 'ghp_dup' });
    await store.addReverseLinkPATBinding('dup-link', 'p');
    await store.addReverseLinkPATBinding('dup-link', 'p');
    await store.addReverseLinkPATBinding('dup-link', 'p');

    const store2 = new CredentialStore();
    // Access the private field to count bindings
    const bindings: Array<{ linkId: string; tokenName: string }> =
      (store2 as any).data.reverseLinkPatBindings ?? [];
    const count = bindings.filter((b) => b.linkId === 'dup-link').length;
    expect(count).toBe(1);
  });

  it('bindings are independent per linkId', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'pa', provider: 'github', token: 'ghp_pa' });
    store.addToken({ name: 'pb', provider: 'github', token: 'ghp_pb' });
    await store.addReverseLinkPATBinding('link-x', 'pa');
    await store.addReverseLinkPATBinding('link-y', 'pb');

    expect(store.getReverseLinkPAT('link-x')).toBe('ghp_pa');
    expect(store.getReverseLinkPAT('link-y')).toBe('ghp_pb');
  });
});

// ---------------------------------------------------------------------------
// getReverseLinkPAT
// ---------------------------------------------------------------------------

describe('CredentialStore.getReverseLinkPAT', () => {
  it('returns undefined when no binding exists for the linkId (no fallback)', () => {
    const store = new CredentialStore();
    // Per the no-fallback rule: undefined signals "no PAT", not a silent default
    expect(store.getReverseLinkPAT('no-binding')).toBeUndefined();
  });

  it('returns undefined when binding exists but tokenName resolves to nothing', async () => {
    const store = new CredentialStore();
    // Bind to a token name that does NOT exist in the store
    await store.addReverseLinkPATBinding('link-orphan', 'nonexistent-pat');
    expect(store.getReverseLinkPAT('link-orphan')).toBeUndefined();
  });

  it('returns the raw PAT secret (not just the token entry)', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'the-pat', provider: 'github', token: 'ghp_secret_value' });
    await store.addReverseLinkPATBinding('my-link', 'the-pat');
    const result = store.getReverseLinkPAT('my-link');
    expect(result).toBe('ghp_secret_value');
  });

  it('returns undefined after the bound token is removed', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'removable-pat', provider: 'github', token: 'ghp_removable' });
    await store.addReverseLinkPATBinding('bound-link', 'removable-pat');
    store.removeToken('removable-pat');
    // Binding still exists but token is gone → undefined
    expect(store.getReverseLinkPAT('bound-link')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeReverseLinkPATBinding
// ---------------------------------------------------------------------------

describe('CredentialStore.removeReverseLinkPATBinding', () => {
  it('returns false when no binding exists for the linkId (graceful no-op)', async () => {
    const store = new CredentialStore();
    const result = await store.removeReverseLinkPATBinding('ghost-link');
    expect(result).toBe(false);
  });

  it('removes the binding and returns true', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'p', provider: 'github', token: 'ghp_x' });
    await store.addReverseLinkPATBinding('link-to-remove', 'p');
    const result = await store.removeReverseLinkPATBinding('link-to-remove');
    expect(result).toBe(true);
    expect(store.getReverseLinkPAT('link-to-remove')).toBeUndefined();
  });

  it('persists the removal through save/load', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'p', provider: 'github', token: 'ghp_y' });
    await store.addReverseLinkPATBinding('link-del', 'p');
    await store.removeReverseLinkPATBinding('link-del');

    const store2 = new CredentialStore();
    expect(store2.getReverseLinkPAT('link-del')).toBeUndefined();
  });

  it('removes only the targeted binding, leaving others intact', async () => {
    const store = new CredentialStore();
    store.addToken({ name: 'p', provider: 'github', token: 'ghp_keep' });
    await store.addReverseLinkPATBinding('link-keep', 'p');
    await store.addReverseLinkPATBinding('link-remove', 'p');
    await store.removeReverseLinkPATBinding('link-remove');

    expect(store.getReverseLinkPAT('link-keep')).toBe('ghp_keep');
    expect(store.getReverseLinkPAT('link-remove')).toBeUndefined();
  });

  it('returns false when reverseLinkPatBindings field is absent on older config', () => {
    const store = new CredentialStore();
    // Access private data to simulate an old config file without the field
    (store as any).data.reverseLinkPatBindings = undefined;
    return store.removeReverseLinkPATBinding('anything').then((result) => {
      expect(result).toBe(false);
    });
  });
});
