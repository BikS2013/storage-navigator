import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiBackend } from '../../src/core/backend/api-backend.js';
import type { ApiBackendEntry } from '../../src/core/types.js';

const entry: ApiBackendEntry = {
  kind: 'api', name: 'nbg', baseUrl: 'https://api.example.com',
  authEnabled: false, addedAt: '2025-01-01',
};
const acct = 'sadirectusersgeneric';

beforeEach(() => { vi.restoreAllMocks(); });

describe('ApiBackend (shares + files)', () => {
  it('listShares calls /storages/{a}/shares', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 's1', quotaGiB: 5 }], continuationToken: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listShares();
    expect(r.items[0]).toEqual({ name: 's1', quotaGiB: 5 });
  });

  it('listDir uses ?path= query parameter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 'a.txt', isDirectory: false, size: 5 }], continuationToken: '',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listDir('s1', 'logs');
    expect(r.items[0].name).toBe('a.txt');
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('/storages/sadirectusersgeneric/shares/s1/files?path=logs');
  });

  it('deleteFileFolder requires confirm=true in the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ deleted: 3 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const b = new ApiBackend(entry, acct);
    const n = await b.deleteFileFolder('s1', 'old/');
    expect(n).toBe(3);
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('confirm=true');
  });
});
