import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export type AzuriteHandle = {
  blobUrl: string;
  fileUrl: string;
  accountName: string;
  accountKey: string;
  shutdown: () => Promise<void>;
};

const ACCOUNT = 'devstoreaccount1';
// Well-known Azurite default key; safe to commit (used only by emulator)
const KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

export async function startAzurite(): Promise<AzuriteHandle> {
  const workdir = mkdtempSync(join(tmpdir(), 'azurite-'));
  const blobPort = 10000 + Math.floor(Math.random() * 50000);
  const queuePort = blobPort + 1;
  const tablePort = blobPort + 2;

  const proc: ChildProcess = spawn(
    'npx',
    [
      'azurite',
      '--silent',
      // @azure/storage-blob 12.31 sends API version 2026-02-06; Azurite 3.35
      // (latest at plan date) only knows 2025-11-05. Skip the version check
      // until Azurite catches up — without this the smoke + service tests fail
      // with "RestError: The API version 2026-02-06 is not supported".
      '--skipApiVersionCheck',
      '--location', workdir,
      '--blobHost', '127.0.0.1',
      '--blobPort', String(blobPort),
      '--queueHost', '127.0.0.1',
      '--queuePort', String(queuePort),
      '--tableHost', '127.0.0.1',
      '--tablePort', String(tablePort),
    ],
    { stdio: 'ignore' }
  );

  // Wait for the blob endpoint to accept connections.
  const blobUrl = `http://127.0.0.1:${blobPort}/${ACCOUNT}`;
  const fileUrl = `http://127.0.0.1:${blobPort}/${ACCOUNT}`; // Azurite supports both via separate ports
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${blobPort}/`);
      if (r.status === 400 || r.status === 403 || r.status === 200) break;
    } catch { /* not yet */ }
    await sleep(100);
  }

  return {
    blobUrl,
    fileUrl,
    accountName: ACCOUNT,
    accountKey: KEY,
    shutdown: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
      rmSync(workdir, { recursive: true, force: true });
    },
  };
}
