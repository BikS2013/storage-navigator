// An Azure DevOps repo with no commits has no branches, so listFiles' branch
// query 404s with VS403403 and getDefaultBranch gets no `defaultBranch` field.
// Both used to surface as noise: a raw JSON blob in the first case, an opaque
// "Cannot read properties of undefined" TypeError in the second.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DevOpsClient } from '../../src/core/devops-client.js';

const VS403403 = JSON.stringify({
  $id: '1',
  message: 'VS403403: Cannot find any branches for the test repository.',
  typeName: 'Microsoft.TeamFoundation.Git.Server.GitItemNotFoundException, Microsoft.TeamFoundation.Git.Server',
  typeKey: 'GitItemNotFoundException',
});

function mockFetch(res: { ok: boolean; status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: res.ok,
    status: res.status,
    headers: new Headers(),
    text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
    json: async () => (typeof res.body === 'string' ? JSON.parse(res.body) : res.body),
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('DevOpsClient empty-repository handling', () => {
  it('listFiles turns VS403403 into an actionable message', async () => {
    mockFetch({ ok: false, status: 404, body: VS403403 });
    const client = new DevOpsClient('pat', 'NBGIDP');

    await expect(client.listFiles('DevOps_Private', 'test', 'main'))
      .rejects.toThrow("Repository 'test' has no branches yet (empty repository). Push an initial commit before syncing.");
  });

  it('listFiles still reports unrelated 404s verbatim', async () => {
    mockFetch({ ok: false, status: 404, body: '{"message":"TF401019: repo does not exist"}' });
    const client = new DevOpsClient('pat', 'NBGIDP');

    const err = await client.listFiles('DevOps_Private', 'ghost', 'main').catch((e) => e as Error);
    expect(err.message).toContain('Azure DevOps API error: 404');
    expect(err.message).toContain('TF401019');
  });

  it('getDefaultBranch reports an empty repo instead of a TypeError', async () => {
    mockFetch({ ok: true, status: 200, body: { name: 'test', size: 0 } });
    const client = new DevOpsClient('pat', 'NBGIDP');

    const err = await client.getDefaultBranch('DevOps_Private', 'test').catch((e) => e as Error);
    expect(err.message).toContain('has no branches yet');
    expect(err.message).not.toMatch(/undefined|TypeError/);
  });

  it('getDefaultBranch strips the refs/heads prefix on a normal repo', async () => {
    mockFetch({ ok: true, status: 200, body: { defaultBranch: 'refs/heads/main' } });
    const client = new DevOpsClient('pat', 'NBGIDP');

    await expect(client.getDefaultBranch('DevOps_Private', 'storage-navigator')).resolves.toBe('main');
  });
});
