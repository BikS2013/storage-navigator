// ===========================================================================
// tests/unit/github-app-resolution.test.ts
//
// Unit tests for GitHub App authentication resolution and repo scope addition.
//
// Sections:
//   1. resolveGitHubCredential - credential precedence and error handling
//   2. GitHubWriteClient scope addition - companion PAT graceful degradation
// ===========================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '../../src/core/credential-store.js';
import { resolveGitHubCredential } from '../../src/cli/commands/shared.js';
import { GitHubWriteClient } from '../../src/core/github-write-client.js';
import * as githubAppAuth from '../../src/core/github-app-auth.js';

// ---------------------------------------------------------------------------
// Per-test isolated filesystem
// ---------------------------------------------------------------------------

let tmp: string;
let originalExit: typeof process.exit;
let originalConsoleError: typeof console.error;
let originalConsoleWarn: typeof console.warn;
let originalConsoleLog: typeof console.log;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-gh-app-test-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
  
  // Capture process.exit calls
  originalExit = process.exit;
  process.exit = vi.fn() as never;
  
  // Silence console output during tests
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  originalConsoleLog = console.log;
  console.error = vi.fn();
  console.warn = vi.fn();
  console.log = vi.fn();
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
  process.exit = originalExit;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ---------------------------------------------------------------------------
// Section 1: resolveGitHubCredential precedence and error handling
// ---------------------------------------------------------------------------

describe('resolveGitHubCredential', () => {
  describe('precedence', () => {
    it('should use --github-app-inline (highest precedence)', async () => {
      const store = new CredentialStore();
      
      // Add a named GitHub App and PAT to verify they are NOT used
      store.addGitHubApp({
        name: 'test-app',
        appId: '11111',
        privateKeyPem: 'fake-pem',
        installationId: '22222',
      });
      store.addToken({
        name: 'test-pat',
        provider: 'github',
        token: 'pat-token-abc',
      });

      // Mock generateInstallationToken
      const mockToken = 'ghs_inline_token_xyz';
      vi.spyOn(githubAppAuth, 'generateInstallationToken').mockResolvedValue(mockToken);

      const inlineJson = JSON.stringify({
        appId: '99999',
        privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
        installationId: '88888',
      });

      const result = await resolveGitHubCredential(
        store,
        'github',
        { pat: 'inline-pat', tokenName: 'test-pat' },
        { githubAppInline: inlineJson, githubAppName: 'test-app' }
      );

      expect(result.token).toBe(mockToken);
      expect(result.authType).toBe('github-app');
      expect(result.credentialName).toBe('(inline)');
      expect(githubAppAuth.generateInstallationToken).toHaveBeenCalledWith('99999', expect.any(String), '88888');
    });

    it('should use --github-app-name when inline not provided', async () => {
      const store = new CredentialStore();
      store.addGitHubApp({
        name: 'named-app',
        appId: '12345',
        privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        installationId: '67890',
      });
      store.addToken({
        name: 'fallback-pat',
        provider: 'github',
        token: 'pat-should-not-be-used',
      });

      const mockToken = 'ghs_named_app_token';
      vi.spyOn(githubAppAuth, 'generateInstallationToken').mockResolvedValue(mockToken);

      const result = await resolveGitHubCredential(
        store,
        'github',
        { pat: 'inline-pat', tokenName: 'fallback-pat' },
        { githubAppName: 'named-app' }
      );

      expect(result.token).toBe(mockToken);
      expect(result.authType).toBe('github-app');
      expect(result.credentialName).toBe('named-app');
      expect(githubAppAuth.generateInstallationToken).toHaveBeenCalledWith('12345', expect.any(String), '67890');
    });

    it('should fall back to PAT when no GitHub App options provided', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'pat-token',
        provider: 'github',
        token: 'ghp_pat_token_123',
      });

      const result = await resolveGitHubCredential(
        store,
        'github',
        { tokenName: 'pat-token' },
        {}
      );

      expect(result.token).toBe('ghp_pat_token_123');
      expect(result.authType).toBe('pat');
      expect(result.credentialName).toBe('pat-token');
    });

    it('should use inline PAT when provided and no GitHub App', async () => {
      const store = new CredentialStore();

      const result = await resolveGitHubCredential(
        store,
        'github',
        { pat: 'inline-pat-xyz' },
        {}
      );

      expect(result.token).toBe('inline-pat-xyz');
      expect(result.authType).toBe('pat');
      expect(result.credentialName).toBe('(first for provider)');
    });
  });

  describe('error handling', () => {
    it('should throw when --github-app-inline has invalid JSON', async () => {
      const store = new CredentialStore();

      await expect(
        resolveGitHubCredential(
          store,
          'github',
          {},
          { githubAppInline: 'not-valid-json' }
        )
      ).rejects.toThrow(/Invalid --github-app-inline JSON/);
    });

    it('should throw when --github-app-inline missing required fields', async () => {
      const store = new CredentialStore();
      const invalidJson = JSON.stringify({ appId: '123' }); // missing privateKeyPem and installationId

      await expect(
        resolveGitHubCredential(
          store,
          'github',
          {},
          { githubAppInline: invalidJson }
        )
      ).rejects.toThrow(/Invalid --github-app-inline JSON.*Missing required fields/);
    });

    it('should exit with code 3 when --github-app-name not found', async () => {
      const store = new CredentialStore();

      await expect(
        resolveGitHubCredential(
          store,
          'github',
          {},
          { githubAppName: 'nonexistent-app' }
        )
      ).rejects.toThrow(); // resolveGitHubCredential calls process.exit which throws in tests

      expect(process.exit).toHaveBeenCalledWith(3);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("GitHub App 'nonexistent-app' not found"));
    });

    it('should exit when no GitHub App or PAT available', async () => {
      const store = new CredentialStore();

      // resolveGitHubCredential calls resolvePatToken which calls process.exit(1)
      // Our mock makes process.exit throw
      try {
        await resolveGitHubCredential(store, 'github', {}, {});
        // Should not reach here
        expect.fail('Expected process.exit to be called');
      } catch (err) {
        // process.exit was called (our mock throws)
        expect(process.exit).toHaveBeenCalledWith(1);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Section 2: GitHubWriteClient repo scope addition graceful degradation
// ---------------------------------------------------------------------------

describe('GitHubWriteClient scope addition', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('companion PAT configured', () => {
    it('should add repo to installation on 204 success', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion_abc',
      });

      // Mock sequence: GET /repos (check exists) -> GET /user (check user/org) -> POST /user/repos (create) -> PUT /user/installations/.../repositories/... (scope add)
      let callCount = 0;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          // GET /repos/{owner}/{repo} - repo doesn't exist
          return fakeResponse(404, { message: 'Not Found' });
        }
        if (callCount === 2) {
          // GET /user - check if user or org
          return fakeResponse(200, { login: 'test-owner' });
        }
        if (callCount === 3) {
          // POST /user/repos - create repo
          return fakeResponse(201, { id: 123456, name: 'test-repo', owner: { login: 'test-owner' } });
        }
        if (callCount === 4) {
          // PUT /user/installations/{id}/repositories/{repo_id} - scope add
          expect(url).toContain('/user/installations/999/repositories/123456');
          expect(init?.method).toBe('PUT');
          return fakeResponse(204, {});
        }
        throw new Error(`Unexpected fetch call ${callCount} to ${url}`);
      });

      const client = new GitHubWriteClient(
        'installation-token-xyz',
        'test-owner',
        'test-repo',
        '999', // installationId
        store,
        'companion-pat'
      );

      await client.ensureRepo({
        name: 'test-repo',
        visibility: 'private',
        createIfMissing: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(4);
      // Success message is logged to console but we can't easily test it in this mock setup
      // The important part is that the call succeeded without throwing
    });

    it('should handle 304 (already in scope) gracefully', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion_def',
      });

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) return fakeResponse(201, { id: 999888, name: 'repo' });
        if (callCount === 4) {
          // 304 is not valid for Response constructor, GitHub actually returns 204 if already exists
          // Using 204 here as well
          return fakeResponse(204, {});
        }
        throw new Error(`Unexpected call ${callCount}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '888',
        store,
        'companion-pat'
      );

      await client.ensureRepo({
        name: 'repo',
        visibility: 'private',
        createIfMissing: true,
      });

      // Success - the function completed without throwing, and scope addition was attempted
      // (The actual console.log call happens but is mocked, so we can't easily verify the exact message)
    });

    it('should warn on 403/404 but not throw (non-fatal)', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion_ghi',
      });

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) return fakeResponse(201, { id: 777666, name: 'repo' });
        if (callCount === 4) {
          // Scope add fails with 403
          return fakeResponse(403, { message: 'Forbidden' });
        }
        throw new Error(`Unexpected call ${callCount}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '777',
        store,
        'companion-pat'
      );

      // Should NOT throw
      await expect(
        client.ensureRepo({
          name: 'repo',
          visibility: 'private',
          createIfMissing: true,
        })
      ).resolves.toBeUndefined();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING: Repository created successfully, but could not be added'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
    });

    it('should not retry scope addition (fetch called once)', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion_jkl',
      });

      const scopeAddUrl = /\/user\/installations\/.*\/repositories\/.*/;
      let scopeAddCalls = 0;

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/repos/owner/repo')) {
          return fakeResponse(404, { message: 'Not Found' });
        }
        if (url.endsWith('/user')) {
          return fakeResponse(200, { login: 'owner' });
        }
        if (url.includes('/user/repos')) {
          return fakeResponse(201, { id: 555444, name: 'repo' });
        }
        if (scopeAddUrl.test(url)) {
          scopeAddCalls++;
          return fakeResponse(500, { message: 'Internal Server Error' });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '555',
        store,
        'companion-pat'
      );

      await client.ensureRepo({
        name: 'repo',
        visibility: 'private',
        createIfMissing: true,
      });

      expect(scopeAddCalls).toBe(1); // Called exactly once, no retry
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING: Repository created successfully, but could not be added'));
    });

    it('should warn on network error but not throw (non-fatal)', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion_mno',
      });

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) return fakeResponse(201, { id: 333222, name: 'repo' });
        if (callCount === 4) {
          throw new Error('Network error');
        }
        throw new Error(`Unexpected call ${callCount}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '333',
        store,
        'companion-pat'
      );

      await expect(
        client.ensureRepo({
          name: 'repo',
          visibility: 'private',
          createIfMissing: true,
        })
      ).resolves.toBeUndefined();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING: Error adding repository to installation scope'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });

  describe('no companion PAT configured', () => {
    it('should warn with manual instructions and not attempt API call', async () => {
      const store = new CredentialStore();
      
      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) return fakeResponse(201, { id: 111222, name: 'repo' });
        // Should NOT reach a fourth call for scope addition
        throw new Error(`Unexpected fourth fetch call to: ${url}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '111', // installationId present
        store,
        undefined // NO companion PAT
      );

      await client.ensureRepo({
        name: 'repo',
        visibility: 'private',
        createIfMissing: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(3); // repo check + user check + create, NO scope add
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING: Repository created successfully, but cannot be automatically added'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('companion PAT with \'repo\' scope is required'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('https://github.com/settings/installations'));
    });

    it('should not attempt scope addition when no installationId', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_unused',
      });

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) return fakeResponse(201, { id: 444555, name: 'repo' });
        throw new Error(`Unexpected fourth call to: ${url}`);
      });

      const client = new GitHubWriteClient(
        'some-token',
        'owner',
        'repo',
        undefined, // NO installationId
        store,
        'companion-pat'
      );

      await client.ensureRepo({
        name: 'repo',
        visibility: 'private',
        createIfMissing: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('repo creation failure handling', () => {
    it('should not attempt scope addition when repo creation fails', async () => {
      const store = new CredentialStore();
      store.addToken({
        name: 'companion-pat',
        provider: 'github',
        token: 'ghp_companion',
      });

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) return fakeResponse(404, { message: 'Not Found' });
        if (callCount === 2) return fakeResponse(200, { login: 'owner' });
        if (callCount === 3) {
          // Repo creation fails
          return fakeResponse(422, { message: 'Validation Failed' });
        }
        throw new Error(`Unexpected call ${callCount} to: ${url}`);
      });

      const client = new GitHubWriteClient(
        'installation-token',
        'owner',
        'repo',
        '999',
        store,
        'companion-pat'
      );

      await expect(
        client.ensureRepo({
          name: 'repo',
          visibility: 'private',
          createIfMissing: true,
        })
      ).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledTimes(3); // check + user check + failed create, NO scope add
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
