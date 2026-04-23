import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../src/core/credential-store.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-cred-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});
afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe('CredentialStore migration', () => {
  it('marks pre-existing entries (no kind) as kind="direct"', () => {
    const store = new CredentialStore();
    const legacy: any = {
      storages: [
        { name: 'a', accountName: 'a', accountKey: 'k', addedAt: '2025-01-01' },
        { name: 'b', accountName: 'b', sasToken: 't', addedAt: '2025-01-02' },
      ],
      tokens: [],
    };
    const migrated = (store as any).migrate(legacy);
    expect(migrated.storages[0].kind).toBe('direct');
    expect(migrated.storages[1].kind).toBe('direct');
  });

  it('leaves entries that already have kind unchanged', () => {
    const store = new CredentialStore();
    const data: any = {
      storages: [
        { kind: 'api', name: 'x', baseUrl: 'https://x', authEnabled: false, addedAt: '2025-01-03' },
        { kind: 'direct', name: 'y', accountName: 'y', accountKey: 'k', addedAt: '2025-01-04' },
      ],
    };
    const migrated = (store as any).migrate(data);
    expect(migrated.storages[0].kind).toBe('api');
    expect(migrated.storages[1].kind).toBe('direct');
  });
});
