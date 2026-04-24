import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { TokenStore, type TokenSet } from '../../src/core/backend/auth/token-store.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-tok-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});
afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

const sample: TokenSet = {
  accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000, scope: 'openid',
};

describe('TokenStore (fs)', () => {
  it('save then load round-trips', async () => {
    const s = new TokenStore();
    await s.save('nbg-dev', sample);
    const loaded = await s.load('nbg-dev');
    expect(loaded?.accessToken).toBe('a');
  });

  it('keys multiple backends independently', async () => {
    const s = new TokenStore();
    await s.save('nbg-dev', sample);
    await s.save('nbg-prod', { ...sample, accessToken: 'b' });
    expect((await s.load('nbg-dev'))?.accessToken).toBe('a');
    expect((await s.load('nbg-prod'))?.accessToken).toBe('b');
  });

  it('delete removes only one entry', async () => {
    const s = new TokenStore();
    await s.save('a', sample);
    await s.save('b', sample);
    await s.delete('a');
    expect(await s.load('a')).toBeNull();
    expect(await s.load('b')).not.toBeNull();
  });

  it('returns null for missing entry', async () => {
    const s = new TokenStore();
    expect(await s.load('ghost')).toBeNull();
  });

  it('chmods the file 0600 on POSIX', async () => {
    if (platform() === 'win32') return;
    const s = new TokenStore();
    await s.save('x', sample);
    const file = join(tmp, 'oidc-tokens.json');
    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
