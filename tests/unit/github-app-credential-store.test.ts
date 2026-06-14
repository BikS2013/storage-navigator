import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from '../../src/core/credential-store.js';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-github-app-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmpHome;
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('CredentialStore GitHub App CRUD', () => {
  const samplePem = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z8...sample...
-----END RSA PRIVATE KEY-----`;

  it('add then get round-trip returns privateKeyPem', () => {
    const store = new CredentialStore();
    store.addGitHubApp({
      name: 'test-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
    });

    const retrieved = store.getGitHubApp('test-app');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('test-app');
    expect(retrieved?.appId).toBe('12345');
    expect(retrieved?.installationId).toBe('67890');
    expect(retrieved?.privateKeyPem).toBe(samplePem);
    expect(retrieved?.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
  });

  it('add with existing name UPDATES rather than duplicates', () => {
    const store = new CredentialStore();
    store.addGitHubApp({
      name: 'test-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
    });

    // Add again with same name but different appId
    store.addGitHubApp({
      name: 'test-app',
      appId: '99999',
      installationId: '11111',
      privateKeyPem: 'new-pem',
    });

    const retrieved = store.getGitHubApp('test-app');
    expect(retrieved?.appId).toBe('99999'); // updated
    expect(retrieved?.installationId).toBe('11111'); // updated
    expect(retrieved?.privateKeyPem).toBe('new-pem'); // updated

    const list = store.listGitHubApps();
    expect(list).toHaveLength(1); // no duplicate
    expect(list[0].name).toBe('test-app');
  });

  it('listGitHubApps NEVER includes privateKeyPem or clientSecret', () => {
    const store = new CredentialStore();
    store.addGitHubApp({
      name: 'app1',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
      clientSecret: 'super-secret',
      companionPatTokenName: 'my-pat',
    });

    const list = store.listGitHubApps();
    expect(list).toHaveLength(1);
    const item = list[0];
    
    // Check that secrets are NOT in the list
    expect(item).not.toHaveProperty('privateKeyPem');
    expect(item).not.toHaveProperty('clientSecret');
    
    // Check safe properties are present
    expect(item.name).toBe('app1');
    expect(item.appId).toBe('12345');
    expect(item.installationId).toBe('67890');
    expect(item.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.hasCompanionPat).toBe(true);
  });

  it('listGitHubApps computes isExpired from expiresAt', () => {
    const store = new CredentialStore();
    
    // Add app with expired date
    store.addGitHubApp({
      name: 'expired-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
      expiresAt: '2020-01-01T00:00:00Z',
    });

    // Add app with future date
    store.addGitHubApp({
      name: 'valid-app',
      appId: '11111',
      installationId: '22222',
      privateKeyPem: samplePem,
      expiresAt: '2099-12-31T23:59:59Z',
    });

    // Add app with no expiry
    store.addGitHubApp({
      name: 'no-expiry-app',
      appId: '33333',
      installationId: '44444',
      privateKeyPem: samplePem,
    });

    const list = store.listGitHubApps();
    expect(list).toHaveLength(3);

    const expired = list.find(a => a.name === 'expired-app');
    expect(expired?.isExpired).toBe(true);
    expect(expired?.expiresAt).toBe('2020-01-01T00:00:00Z');

    const valid = list.find(a => a.name === 'valid-app');
    expect(valid?.isExpired).toBe(false);
    expect(valid?.expiresAt).toBe('2099-12-31T23:59:59Z');

    const noExpiry = list.find(a => a.name === 'no-expiry-app');
    expect(noExpiry?.isExpired).toBe(false);
    expect(noExpiry?.expiresAt).toBe(null);
  });

  it('removeGitHubApp returns true when present, false when absent', () => {
    const store = new CredentialStore();
    store.addGitHubApp({
      name: 'test-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
    });

    expect(store.removeGitHubApp('test-app')).toBe(true);
    expect(store.getGitHubApp('test-app')).toBeUndefined();
    expect(store.removeGitHubApp('test-app')).toBe(false); // already removed
    expect(store.removeGitHubApp('never-existed')).toBe(false);
  });

  it('backward compat: no githubApps field returns empty array and does not crash', () => {
    const store = new CredentialStore();
    // Don't add any apps, just query
    const list = store.listGitHubApps();
    expect(list).toEqual([]);
    expect(store.getGitHubApp('anything')).toBeUndefined();
    expect(store.removeGitHubApp('anything')).toBe(false);
  });

  it('addGitHubApp lazily initializes the array', () => {
    const store = new CredentialStore();
    // Start with no apps
    expect(store.listGitHubApps()).toEqual([]);
    
    // Add one
    store.addGitHubApp({
      name: 'first-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
    });

    const list = store.listGitHubApps();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('first-app');
  });

  it('persistence round-trip with encryption', () => {
    const store1 = new CredentialStore();
    store1.addGitHubApp({
      name: 'persist-app',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
      companionPatTokenName: 'my-pat',
      expiresAt: '2099-12-31T23:59:59Z',
    });

    // Create a second store instance pointing at the same temp dir
    const store2 = new CredentialStore();
    const retrieved = store2.getGitHubApp('persist-app');
    
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('persist-app');
    expect(retrieved?.appId).toBe('12345');
    expect(retrieved?.installationId).toBe('67890');
    expect(retrieved?.privateKeyPem).toBe(samplePem);
    expect(retrieved?.companionPatTokenName).toBe('my-pat');
    expect(retrieved?.expiresAt).toBe('2099-12-31T23:59:59Z');
    expect(retrieved?.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('hasCompanionPat reflects presence of companionPatTokenName', () => {
    const store = new CredentialStore();
    
    store.addGitHubApp({
      name: 'with-pat',
      appId: '12345',
      installationId: '67890',
      privateKeyPem: samplePem,
      companionPatTokenName: 'my-pat',
    });

    store.addGitHubApp({
      name: 'without-pat',
      appId: '11111',
      installationId: '22222',
      privateKeyPem: samplePem,
    });

    const list = store.listGitHubApps();
    const withPat = list.find(a => a.name === 'with-pat');
    const withoutPat = list.find(a => a.name === 'without-pat');

    expect(withPat?.hasCompanionPat).toBe(true);
    expect(withoutPat?.hasCompanionPat).toBe(false);
  });

  it('multiple apps can coexist', () => {
    const store = new CredentialStore();
    
    store.addGitHubApp({
      name: 'app1',
      appId: '111',
      installationId: '1111',
      privateKeyPem: 'pem1',
    });

    store.addGitHubApp({
      name: 'app2',
      appId: '222',
      installationId: '2222',
      privateKeyPem: 'pem2',
    });

    store.addGitHubApp({
      name: 'app3',
      appId: '333',
      installationId: '3333',
      privateKeyPem: 'pem3',
    });

    const list = store.listGitHubApps();
    expect(list).toHaveLength(3);
    expect(list.map(a => a.name).sort()).toEqual(['app1', 'app2', 'app3']);

    expect(store.getGitHubApp('app1')?.privateKeyPem).toBe('pem1');
    expect(store.getGitHubApp('app2')?.privateKeyPem).toBe('pem2');
    expect(store.getGitHubApp('app3')?.privateKeyPem).toBe('pem3');
  });
});
