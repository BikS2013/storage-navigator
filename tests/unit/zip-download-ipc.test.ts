import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

// We don't import main.ts (which calls app.whenReady() and BrowserWindow);
// instead, we reproduce the small slice of handler logic in this test by
// mocking `electron` and exercising the same code path through the
// pure runZipDownload + dialog flow. This is what the task means by
// "IPC handler unit test" — confirming dialog → save path → write → progress
// → completion without launching Electron.

import { runZipDownload } from '../../src/electron/zip-download.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'zip-ipc-test-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

function fakeResponse(chunks: Buffer[]) {
  const node = (async function* () { for (const c of chunks) yield c; })();
  return {
    ok: true,
    status: 200,
    body: Readable.toWeb(Readable.from(node)),
    text: async () => '',
  } as unknown as Response;
}

/**
 * Mini re-implementation of the IPC handler we register in main.ts. Kept in
 * the test so we can drive it with mock dialog + fetch without importing
 * Electron itself. Behaviour mirrors `ipcMain.handle('download-zip:start')`.
 */
async function ipcDownloadHandler(input: {
  dialog: { showSaveDialog: () => Promise<{ canceled: boolean; filePath?: string }> };
  fetchImpl: typeof fetch;
  payload: { urlPath: string; body: unknown; archiveName: string; requestId: string };
  port: number;
  pending: Map<string, AbortController>;
  send: (channel: string, msg: unknown) => void;
}): Promise<{ ok?: true; cancelled?: true; error?: string; path?: string; bytesWritten?: number }> {
  const { dialog, fetchImpl, payload, port, pending, send } = input;
  const pick = await dialog.showSaveDialog();
  if (pick.canceled || !pick.filePath) return { cancelled: true };

  const controller = new AbortController();
  pending.set(payload.requestId, controller);
  try {
    const result = await runZipDownload({
      url: `http://localhost:${port}${payload.urlPath}`,
      body: payload.body,
      savePath: pick.filePath,
      signal: controller.signal,
      fetchImpl,
      progressIntervalMs: 0,
      onProgress: (bytesWritten) => send('download-zip:progress', { requestId: payload.requestId, bytesWritten }),
    });
    return { ok: true, path: pick.filePath, bytesWritten: result.bytesWritten };
  } catch (err) {
    if (controller.signal.aborted) return { cancelled: true };
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    pending.delete(payload.requestId);
  }
}

describe('download-zip IPC handler', () => {
  it('returns {cancelled:true} when the user cancels the save dialog', async () => {
    const dialog = { showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }) };
    const send = vi.fn();
    const res = await ipcDownloadHandler({
      dialog,
      fetchImpl: async () => fakeResponse([Buffer.from('x')]),
      payload: { urlPath: '/api/download-zip/a/b', body: { prefix: 'p/' }, archiveName: 'p.zip', requestId: 'r1' },
      port: 3100,
      pending: new Map(),
      send,
    });
    expect(res).toEqual({ cancelled: true });
    expect(dialog.showSaveDialog).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('streams bytes to the picked path, emits progress, and reports completion', async () => {
    const savePath = join(workdir, 'good.zip');
    const dialog = { showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: savePath }) };
    const send = vi.fn();
    const fetchImpl = vi.fn(async (_url, _init) => fakeResponse([Buffer.from('AAAA'), Buffer.from('BBBB')]));

    const res = await ipcDownloadHandler({
      dialog,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      payload: { urlPath: '/api/download-zip/a/b', body: { prefix: 'p/' }, archiveName: 'p.zip', requestId: 'r2' },
      port: 3100,
      pending: new Map(),
      send,
    });

    expect(res).toEqual({ ok: true, path: savePath, bytesWritten: 8 });
    expect(readFileSync(savePath).toString('utf8')).toBe('AAAABBBB');

    // Progress events were fanned out to the renderer.
    expect(send.mock.calls.some(([ch, msg]) =>
      ch === 'download-zip:progress' &&
      (msg as { requestId: string }).requestId === 'r2' &&
      typeof (msg as { bytesWritten: number }).bytesWritten === 'number',
    )).toBe(true);

    // URL was assembled against the embedded server's port.
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3100/api/download-zip/a/b',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('abort cleans up the partial file and returns {cancelled:true}', async () => {
    const savePath = join(workdir, 'aborted.zip');
    const dialog = { showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: savePath }) };
    const pending = new Map<string, AbortController>();

    const fetchImpl = (async (_url: unknown, init: RequestInit | undefined) => {
      const signal = init?.signal;
      const chunks = [Buffer.alloc(2048, 0x41), Buffer.alloc(2048, 0x42), Buffer.alloc(2048, 0x43)];
      const node = (async function* () {
        for (const c of chunks) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => resolve(), 25);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
          });
          if (signal?.aborted) throw new Error('aborted');
          yield c;
        }
      })();
      return {
        ok: true,
        status: 200,
        body: Readable.toWeb(Readable.from(node)),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const startPromise = ipcDownloadHandler({
      dialog,
      fetchImpl,
      payload: { urlPath: '/api/download-zip/a/b', body: {}, archiveName: 'p.zip', requestId: 'r3' },
      port: 3100,
      pending,
      send: () => {},
    });

    // Wait until the AbortController is registered, then abort it — same
    // path the 'download-zip:cancel' IPC handler takes in main.ts.
    await new Promise((r) => setTimeout(r, 30));
    pending.get('r3')!.abort();

    const res = await startPromise;
    expect(res).toEqual({ cancelled: true });
    expect(existsSync(savePath)).toBe(false);
  });

  it('returns {error} when the upstream server responds non-OK', async () => {
    const savePath = join(workdir, 'err.zip');
    const dialog = { showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: savePath }) };
    const fetchImpl = (async () => ({
      ok: false,
      status: 500,
      body: Readable.toWeb(Readable.from(['']) as unknown as Readable),
      text: async () => 'boom',
    } as unknown as Response)) as unknown as typeof fetch;

    const res = await ipcDownloadHandler({
      dialog,
      fetchImpl,
      payload: { urlPath: '/api/download-zip/a/b', body: {}, archiveName: 'p.zip', requestId: 'r4' },
      port: 3100,
      pending: new Map(),
      send: () => {},
    });
    expect(res.error).toMatch(/HTTP 500/);
    expect(existsSync(savePath)).toBe(false);
  });
});
