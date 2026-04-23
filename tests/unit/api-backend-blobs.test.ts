import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiBackend } from '../../src/core/backend/api-backend.js';
import type { ApiBackendEntry } from '../../src/core/types.js';
import { Readable } from 'node:stream';

const entry: ApiBackendEntry = {
  kind: 'api', name: 'nbg', baseUrl: 'https://api.example.com',
  authEnabled: false, addedAt: '2025-01-01',
};
const acct = 'sadirectusersgeneric';

beforeEach(() => { vi.restoreAllMocks(); });

describe('ApiBackend (blobs)', () => {
  it('listContainers calls /storages/{a}/containers and returns Page shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ name: 'c1' }, { name: 'c2' }], continuationToken: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    const r = await b.listContainers({ pageSize: 10 });
    expect(r.items.map((c) => c.name)).toEqual(['c1', 'c2']);
    expect(r.continuationToken).toBeNull();
    const url = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain('/storages/sadirectusersgeneric/containers');
    expect(url).toContain('pageSize=10');
  });

  it('readBlob streams the response body', async () => {
    const body = Readable.from(Buffer.from('hello world'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body as unknown as ReadableStream, {
      status: 200,
      headers: { 'content-type': 'text/plain', 'content-length': '11', 'etag': 'e1', 'last-modified': '2026-04-23' },
    })));
    const b = new ApiBackend(entry, acct);
    const r = await b.readBlob('c1', 'docs/x.txt');
    expect(r.contentType).toBe('text/plain');
    expect(r.contentLength).toBe(11);
    expect(r.etag).toBe('e1');
    let data = '';
    for await (const chunk of r.stream) data += chunk.toString();
    expect(data).toBe('hello world');
  });

  it('uploadBlob PUTs body with Content-Type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ etag: 'e2' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    })));
    const b = new ApiBackend(entry, acct);
    const r = await b.uploadBlob('c1', 'x.json', Buffer.from('{}'), 2, 'application/json');
    expect(r.etag).toBe('e2');
    const init = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deleteBlob throws NotFoundError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'NOT_FOUND', message: "no", correlationId: 'cid' },
    }), { status: 404, headers: { 'content-type': 'application/json' } })));
    const b = new ApiBackend(entry, acct);
    await expect(b.deleteBlob('c1', 'gone.txt')).rejects.toMatchObject({ status: 404 });
  });

  it('throws NeedsLoginError on 401 when authEnabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'no', correlationId: 'cid' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const authEntry: ApiBackendEntry = {
      ...entry, authEnabled: true,
      oidc: { issuer: 'https://idp', clientId: 'cid', audience: 'a', scopes: ['openid'] },
    };
    const b = new ApiBackend(authEntry, acct);
    await expect(b.listContainers()).rejects.toThrow(/login required/);
  });
});
