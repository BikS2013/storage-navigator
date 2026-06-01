import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from '../../src/core/credential-store.js';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-trust-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmpHome;
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('CredentialStore HTML trust', () => {
  it('defaults to untrusted', () => {
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(false);
    expect(store.isHtmlTrusted('s1', 'share', 'sh1')).toBe(false);
  });

  it('round-trips trust for containers', () => {
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'container', 'c1', true);
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(true);
    const store2 = new CredentialStore();
    expect(store2.isHtmlTrusted('s1', 'container', 'c1')).toBe(true);
  });

  it('round-trips trust for shares independently from containers', () => {
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'share', 'sh1', true);
    expect(store.isHtmlTrusted('s1', 'share', 'sh1')).toBe(true);
    expect(store.isHtmlTrusted('s1', 'container', 'sh1')).toBe(false);
  });

  it('setHtmlTrust(false) removes the entry without leaving duplicates', () => {
    const store = new CredentialStore();
    store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });
    store.setHtmlTrust('s1', 'container', 'c1', true);
    store.setHtmlTrust('s1', 'container', 'c1', true);
    store.setHtmlTrust('s1', 'container', 'c1', false);
    expect(store.isHtmlTrusted('s1', 'container', 'c1')).toBe(false);
    const entry = store.getStorage('s1') as { trustedHtmlContainers?: string[] };
    expect(entry.trustedHtmlContainers ?? []).toEqual([]);
  });

  it('throws when storage name does not exist', () => {
    const store = new CredentialStore();
    expect(() => store.setHtmlTrust('nope', 'container', 'c1', true))
      .toThrow(/Storage 'nope' not found/);
  });
});
