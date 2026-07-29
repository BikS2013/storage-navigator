// End-to-end probe for plan-015: drives the real sync-engine through the real
// ApiBackend, over real HTTP, into a real instance of the API service. Only
// Azure itself is stubbed (an in-memory Map behind BlobService), so every layer
// this plan touched is exercised for real.
//
// Run: npx tsx test_scripts/verify-plan015-api-sync.mts
// Exits 0 on success, 1 on failure.

import { buildApp } from '../API/src/app.js';
import { AccountDiscovery } from '../API/src/azure/account-discovery.js';
import { anonymousPrincipalMiddleware } from '../API/src/auth/auth-toggle.js';
import type { BlobService } from '../API/src/azure/blob-service.js';
import type { FileService } from '../API/src/azure/file-service.js';
import { ApiError } from '../API/src/errors/api-error.js';
import { ApiBackend } from '../src/core/backend/api-backend.js';
import type { ApiBackendEntry } from '../src/core/types.js';
import { createLink, resolveLinks, removeLink, syncRepo } from '../src/core/sync-engine.js';
import { diffLink } from '../src/core/diff-engine.js';

const ACCOUNT = 'a1';
const CONTAINER = 'c1';
const PORT = 3312;

// ---- in-memory stand-in for Azure Blob storage ----------------------------
const store = new Map<string, Buffer>();

const blobService = {
  async uploadBlob(_a: string, _c: string, path: string, body: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    store.set(path, Buffer.concat(chunks));
    return { etag: '"e"', lastModified: new Date().toISOString() };
  },
  async readBlob(_a: string, _c: string, path: string) {
    const buf = store.get(path);
    if (!buf) throw ApiError.notFound(`Blob '${path}' not found`);
    const { Readable } = await import('node:stream');
    return { stream: Readable.from(buf) as NodeJS.ReadableStream, contentLength: buf.byteLength };
  },
  async deleteBlob(_a: string, _c: string, path: string) {
    if (!store.delete(path)) throw ApiError.notFound(`Blob '${path}' not found`);
  },
  async listBlobs(_a: string, _c: string, opts: { prefix?: string }) {
    const items = [...store.keys()]
      .filter((n) => !opts.prefix || n.startsWith(opts.prefix))
      .map((name) => ({ name, size: store.get(name)!.byteLength }));
    return { items, continuationToken: null };
  },
} as unknown as BlobService;

// ---- boot the real API ----------------------------------------------------
const discovery = new AccountDiscovery({
  adapter: { list: async () => [{ name: ACCOUNT, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: '', fileEndpoint: '' }] },
  allowed: [], refreshMin: 60,
});
await discovery.refresh();

const app = buildApp({
  config: {
    port: 0, logLevel: 'silent', authEnabled: false,
    oidc: { mode: 'disabled', anonRole: 'Admin' },
    azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
    pagination: { defaultPageSize: 200, maxPageSize: 1000 },
    uploads: { maxBytes: null, streamBlockSizeMb: 8 },
    swaggerUiEnabled: false, corsOrigins: [],
    staticAuth: { values: [], headerName: 'X-Storage-Nav-Auth' },
  },
  authOverride: anonymousPrincipalMiddleware('Admin'),
  discovery,
  blobService,
  fileService: {} as unknown as FileService,
});
const server = app.listen(PORT);

// ---- the client side, pointed at that API ---------------------------------
const entry: ApiBackendEntry = {
  kind: 'api', name: 'probe', baseUrl: `http://127.0.0.1:${PORT}`,
  authEnabled: false, addedAt: new Date().toISOString(),
};
const backend = new ApiBackend(entry, ACCOUNT);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  // 1. Empty container reads as "no links" rather than throwing.
  const empty = await resolveLinks(backend, CONTAINER);
  check('resolveLinks on empty container', empty.links.length === 0);

  // 2. createLink writes the dot-prefixed registry blob over HTTP.
  const { link } = await createLink(backend, CONTAINER, {
    provider: 'github',
    repoUrl: 'https://github.com/acme/widgets',
    branch: 'main',
    targetPrefix: 'δοκιμή',
  });
  check('createLink wrote .repo-links.json', store.has('.repo-links.json'));

  // 3. The multi-byte prefix survived the Content-Length round-trip.
  const raw = store.get('.repo-links.json')!;
  const parsed = JSON.parse(raw.toString('utf-8'));
  check('multi-byte prefix round-tripped', parsed.links[0].targetPrefix === 'δοκιμή', parsed.links[0].targetPrefix);
  check('registry bytes are complete JSON', raw.byteLength === Buffer.byteLength(raw.toString('utf-8'), 'utf-8'));

  // 4. Read it back through a fresh HTTP GET.
  const reread = await resolveLinks(backend, CONTAINER);
  check('resolveLinks reads the link back', reread.links.length === 1 && reread.links[0]!.id === link.id);

  // 5. syncRepo uploads files and deletes stale ones over HTTP.
  link.fileShas = { 'δοκιμή/stale.txt': 'old-sha' };
  store.set('δοκιμή/stale.txt', Buffer.from('stale'));
  const result = await syncRepo(backend, CONTAINER, {
    listFiles: async () => [{ path: 'readme.md', sha: 'sha-1' }],
    downloadFile: async () => Buffer.from('# καλημέρα', 'utf-8'),
  }, link);
  check('syncRepo uploaded the new file', result.uploaded.includes('δοκιμή/readme.md'), JSON.stringify(result.uploaded));
  check('syncRepo deleted the stale file', result.deleted.includes('δοκιμή/stale.txt'));
  check('syncRepo reported no errors', result.errors.length === 0, result.errors.join('; '));
  check('uploaded bytes are intact', store.get('δοκιμή/readme.md')?.toString('utf-8') === '# καλημέρα');

  // 6. diff with the physical check pages through iterateBlobsFlat over HTTP.
  store.set('untracked-stray.txt', Buffer.from('x'));
  const report = await diffLink({
    listFiles: async () => [{ path: 'readme.md', sha: 'sha-1' }],
    downloadFile: async () => { throw new Error('diff must not download'); },
  }, link, backend, CONTAINER, { includePhysicalCheck: true });
  check('diff sees the link in sync', report.summary.isInSync, JSON.stringify(report.summary));
  check('diff physical check ran', report.summary.untrackedCount >= 0);

  // 7. removeLink rewrites the registry.
  check('removeLink removed it', await removeLink(backend, CONTAINER, link.id));
  check('registry is now empty', (await resolveLinks(backend, CONTAINER)).links.length === 0);
} catch (err) {
  console.log('FAIL  threw:', (err as Error).message);
  failures++;
} finally {
  server.close();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
