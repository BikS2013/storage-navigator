import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Streams a ZIP archive from the server straight to disk.
 *
 * The IPC handler in main.ts wraps this with a save-dialog and progress
 * events. Pulled into its own module so the streaming logic is unit-testable
 * without spinning up Electron — tests pass a synthetic fetchImpl, a tmp file
 * path, and observe progress callbacks + the bytes that land on disk.
 *
 * Errors and aborts both delete the partial file before re-throwing so the
 * user never ends up with a corrupt half-written archive.
 */

export type ZipDownloadResult = {
  ok: true;
  bytesWritten: number;
};

export type ZipDownloadInput = {
  /** Absolute or fetch-acceptable URL of the server endpoint. */
  url: string;
  /** JSON body — typically `{ prefix, archiveName }` or `{ paths, ... }`. */
  body: unknown;
  /** Extra request headers (auth, etc). Content-Type is set automatically. */
  headers?: Record<string, string>;
  /** Destination path on disk. Created/overwritten. */
  savePath: string;
  /** AbortSignal — when aborted, the request is cancelled and the partial
   *  file is deleted. */
  signal?: AbortSignal;
  /** Called periodically with the running byte count. Best-effort, throttled. */
  onProgress?: (bytesWritten: number) => void;
  /** Injection point for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** How often (ms) to coalesce onProgress invocations. Default 100ms. */
  progressIntervalMs?: number;
};

export async function runZipDownload(input: ZipDownloadInput): Promise<ZipDownloadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const progressIntervalMs = input.progressIntervalMs ?? 100;

  const res = await fetchImpl(input.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(input.headers ?? {}) },
    body: JSON.stringify(input.body),
    signal: input.signal,
  } as RequestInit);

  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 300)}` : ""}`);
  }
  if (!res.body) throw new Error("response has no body");

  let bytesWritten = 0;
  let lastEmit = 0;
  const emit = (): void => {
    const now = Date.now();
    if (now - lastEmit < progressIntervalMs) return;
    lastEmit = now;
    input.onProgress?.(bytesWritten);
  };

  // Convert the Web ReadableStream to a Node Readable. fromWeb returns a
  // typed Web stream; Readable.fromWeb expects ReadableStream<Uint8Array>.
  // Node's `fetch` already returns that, so the cast is a TS quirk.
  const nodeStream = Readable.fromWeb(res.body as never) as Readable;
  const writer = createWriteStream(input.savePath);

  // Tee the byte count out of the pipeline without buffering — listen on
  // 'data' on the upstream stream BEFORE pipeline() takes ownership. Pipeline
  // forwards backpressure correctly so the upstream pauses if disk is slow.
  nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
    bytesWritten += chunk.byteLength;
    emit();
  });

  try {
    await pipeline(nodeStream, writer);
  } catch (err) {
    // Always best-effort delete on failure (abort, network error, disk
    // full…). If the unlink itself fails we don't want to mask the real
    // error.
    await safeUnlink(input.savePath);
    throw err;
  }

  // Flush a final progress emit so the UI sees the final byte count.
  input.onProgress?.(bytesWritten);
  return { ok: true, bytesWritten };
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}

async function safeUnlink(p: string): Promise<void> {
  try { await unlink(p); } catch { /* file may not exist yet */ }
}
