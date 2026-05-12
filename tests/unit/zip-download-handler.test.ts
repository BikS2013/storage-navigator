import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { runZipDownload } from '../../src/electron/zip-download.js';

// Build a minimal Response-like object that runZipDownload can consume —
// `ok`, `status`, `text`, and a `body` exposing a Web ReadableStream view.
// Using a real Response on Node 22 is also valid; this synthetic version
// gives us tighter control over chunk timing for the abort test.
function fakeResponse(
  chunks: Buffer[],
  opts: { ok?: boolean; status?: number; text?: string; delayMs?: number; signal?: AbortSignal } = {},
) {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  const node = (async function* () {
    for (const c of chunks) {
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), opts.delayMs);
          opts.signal?.addEventListener(
            'abort',
            () => { clearTimeout(t); reject(new Error('aborted')); },
            { once: true },
          );
        });
      }
      // Re-check on each iteration so an abort between chunks still kills
      // the stream promptly.
      if (opts.signal?.aborted) throw new Error('aborted');
      yield c;
    }
  })();
  const body = Readable.toWeb(Readable.from(node));
  return {
    ok,
    status,
    body,
    text: async () => opts.text ?? '',
  } as unknown as Response;
}

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'zip-dl-test-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('runZipDownload', () => {
  it('streams response body to disk and reports progress', async () => {
    const payload = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('!')];
    const savePath = join(workdir, 'out.zip');
    const progressUpdates: number[] = [];

    const result = await runZipDownload({
      url: 'http://stub.local/x',
      body: { prefix: 'p/' },
      savePath,
      onProgress: (n) => progressUpdates.push(n),
      // Force every chunk to emit a progress update.
      progressIntervalMs: 0,
      fetchImpl: async (_url, _init) => fakeResponse(payload),
    });

    expect(result).toEqual({ ok: true, bytesWritten: 12 });
    expect(readFileSync(savePath).toString('utf8')).toBe('hello world!');
    expect(progressUpdates.length).toBeGreaterThan(0);
    // Final emit is the full byte count.
    expect(progressUpdates[progressUpdates.length - 1]).toBe(12);
    // Progress is monotonically non-decreasing.
    for (let i = 1; i < progressUpdates.length; i++) {
      expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
    }
  });

  it('throws and deletes the partial file when the upstream response is not ok', async () => {
    const savePath = join(workdir, 'fail.zip');
    await expect(
      runZipDownload({
        url: 'http://stub.local/x',
        body: {},
        savePath,
        fetchImpl: async () => fakeResponse([], { ok: false, status: 500, text: 'boom' }),
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(existsSync(savePath)).toBe(false);
  });

  it('aborts via signal, deletes the partial file, and re-throws AbortError', async () => {
    const chunks = [Buffer.alloc(8192, 0x41), Buffer.alloc(8192, 0x42), Buffer.alloc(8192, 0x43)];
    const savePath = join(workdir, 'abort.zip');
    const controller = new AbortController();
    // Kick off the download, then abort after a tick so at least the first
    // chunk has had a chance to land.
    const p = runZipDownload({
      url: 'http://stub.local/x',
      body: {},
      savePath,
      signal: controller.signal,
      progressIntervalMs: 0,
      // Plumb the same signal into the fake response so the upstream
      // generator stops emitting chunks when the user aborts — matches
      // what fetch does in production when it sees AbortSignal.
      fetchImpl: async (_url, init) =>
        fakeResponse(chunks, { delayMs: 30, signal: (init as RequestInit | undefined)?.signal as AbortSignal | undefined }),
    });
    setTimeout(() => controller.abort(), 25);
    await expect(p).rejects.toThrow();
    expect(existsSync(savePath)).toBe(false);
  });

  it('passes auth headers and the JSON body through to fetch', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const savePath = join(workdir, 'hdr.zip');
    await runZipDownload({
      url: 'http://stub.local/y',
      body: { prefix: 'parent/' },
      headers: { Authorization: 'Bearer xyz', 'X-Test': '1' },
      savePath,
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init: init as RequestInit };
        return fakeResponse([Buffer.from('ok')]);
      },
    });
    expect(captured!.url).toBe('http://stub.local/y');
    expect(captured!.init.method).toBe('POST');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer xyz');
    expect(headers['X-Test']).toBe('1');
    expect(JSON.parse(String(captured!.init.body))).toEqual({ prefix: 'parent/' });
  });
});
