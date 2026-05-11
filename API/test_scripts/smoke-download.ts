/**
 * Manual smoke run for the new download endpoints. Boots Azurite, builds the
 * API with auth disabled and an anon Admin role, uploads two test blobs, then
 * hits the new endpoints over real HTTP (so the smoke is equivalent to curl).
 *
 *   npx tsx test_scripts/smoke-download.ts
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { BlobService } from '../src/azure/blob-service.js';
import { FileService } from '../src/azure/file-service.js';
import { AccountDiscovery } from '../src/azure/account-discovery.js';
import { buildApp } from '../src/app.js';
import { anonymousPrincipalMiddleware } from '../src/auth/auth-toggle.js';
import type { Config } from '../src/config.js';

const ACCT = 'devstoreaccount1';
const KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

async function main(): Promise<void> {
  const workdir = mkdtempSync(join(tmpdir(), 'azurite-smoke-'));
  const blobPort = 10000 + Math.floor(Math.random() * 50000);
  const azurite = spawn('npx', ['azurite', '--silent', '--skipApiVersionCheck',
    '--location', workdir, '--blobHost', '127.0.0.1', '--blobPort', String(blobPort),
    '--queueHost', '127.0.0.1', '--queuePort', String(blobPort + 1),
    '--tableHost', '127.0.0.1', '--tablePort', String(blobPort + 2),
  ], { stdio: 'ignore' });

  const blobUrl = `http://127.0.0.1:${blobPort}/${ACCT}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${blobPort}/`);
      if (r.status === 400 || r.status === 403 || r.status === 200) break;
    } catch { /* not yet */ }
    await sleep(100);
  }

  const cred = new StorageSharedKeyCredential(ACCT, KEY);
  const blobService = new BlobService(cred as unknown as never, () => blobUrl);
  const fileService = new FileService(cred as unknown as never, () => blobUrl);
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [{ name: ACCT, subscriptionId: 's', resourceGroup: 'r', blobEndpoint: blobUrl, fileEndpoint: blobUrl }] },
    allowed: [], refreshMin: 60,
  });
  await discovery.refresh();

  const cfg: Config = {
    port: 0,
    logLevel: 'silent',
    authEnabled: false,
    oidc: { mode: 'disabled', anonRole: 'Admin' },
    azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
    pagination: { defaultPageSize: 200, maxPageSize: 1000 },
    uploads: { maxBytes: null, streamBlockSizeMb: 8 },
    swaggerUiEnabled: false,
    corsOrigins: [],
    staticAuth: { values: [], headerName: 'X-Storage-Nav-Auth' },
  };

  const app = buildApp({
    config: cfg,
    authOverride: anonymousPrincipalMiddleware('Admin'),
    discovery, blobService, fileService,
  });

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[smoke] API up on ${base}`);

  async function req(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; headers: Headers; text?: string; bytes?: Buffer }> {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) {
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, headers: r.headers, bytes: buf };
    }
    return { status: r.status, headers: r.headers, text: await r.text() };
  }

  console.log('[smoke] create container');
  await req('POST', `/storages/${ACCT}/containers`, { name: 'smoke' });

  console.log('[smoke] upload two blobs via raw HTTP');
  for (const [path, body] of [['docs/one.txt', 'first file'], ['docs/two.txt', 'second blob body']] as const) {
    const u = await fetch(`${base}/storages/${ACCT}/containers/smoke/blobs/${path}`, {
      method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body,
    });
    if (u.status !== 201) throw new Error(`upload ${path} -> ${u.status}`);
  }

  console.log('[smoke] GET single blob with ?download=1');
  const single = await req('GET', `/storages/${ACCT}/containers/smoke/blobs/docs/one.txt?download=1`);
  console.log(`  status=${single.status} CT=${single.headers.get('content-type')} CD=${single.headers.get('content-disposition')}`);
  if (single.status !== 200) throw new Error('single download failed');
  if (!/attachment/.test(single.headers.get('content-disposition') ?? '')) throw new Error('missing Content-Disposition');

  console.log('[smoke] POST blobs:download-zip (multi-file)');
  const zip = await req('POST', `/storages/${ACCT}/containers/smoke/blobs:download-zip`,
    { paths: ['docs/one.txt', 'docs/two.txt'], basePath: 'docs', archiveName: 'pack.zip' }, true);
  console.log(`  status=${zip.status} CT=${zip.headers.get('content-type')} CD=${zip.headers.get('content-disposition')} bytes=${zip.bytes!.length} transfer=${zip.headers.get('transfer-encoding')}`);
  if (zip.status !== 200) throw new Error('zip download failed');
  if (zip.headers.get('content-type') !== 'application/zip') throw new Error('wrong content-type');
  if (zip.headers.get('transfer-encoding') !== 'chunked') throw new Error('not chunked — server may have buffered');
  // PK signature
  if (zip.bytes![0] !== 0x50 || zip.bytes![1] !== 0x4b) throw new Error('not a valid zip (missing PK header)');

  // Write to disk so `unzip -l /tmp/smoke.zip` can inspect it externally.
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/smoke.zip', zip.bytes!);
  console.log('[smoke] wrote /tmp/smoke.zip — verify with `unzip -l /tmp/smoke.zip`');

  console.log('[smoke] OK — single download + streamed zip both work.');
  server.close();
  azurite.kill('SIGTERM');
  await new Promise((r) => azurite.once('exit', r));
  rmSync(workdir, { recursive: true, force: true });
}

main().catch((err) => { console.error('[smoke] FAILED:', err); process.exit(1); });
