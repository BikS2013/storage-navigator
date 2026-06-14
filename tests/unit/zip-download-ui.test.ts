// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The controller is loaded via a script tag in production, so we drop the
// source into the jsdom document the same way: evaluate it in the global
// scope. After this, window.zipDownload is populated.
const controllerSource = readFileSync(
  join(__dirname, '..', '..', 'src', 'electron', 'public', 'zip-download-ui.js'),
  'utf8',
);

function loadController() {
  // Fresh document for every test — wipe any prior indicator + module state.
  document.body.innerHTML = '';
  (window as unknown as { zipDownload?: unknown }).zipDownload = undefined;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function(controllerSource).call(window);
}

type ElectronBridge = {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

function installElectronBridge(): { bridge: ElectronBridge; progressListeners: Array<(msg: unknown) => void> } {
  const progressListeners: Array<(msg: unknown) => void> = [];
  const bridge: ElectronBridge = {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (msg: unknown) => void) => {
      if (channel === 'download-zip:progress') progressListeners.push(listener);
      return () => {
        const i = progressListeners.indexOf(listener);
        if (i >= 0) progressListeners.splice(i, 1);
      };
    }),
  };
  (window as unknown as { electron: ElectronBridge }).electron = bridge;
  return { bridge, progressListeners };
}

function uninstallElectronBridge() {
  delete (window as unknown as { electron?: unknown }).electron;
}

describe('zip-download-ui controller', () => {
  beforeEach(() => {
    loadController();
  });

  it('exposes window.zipDownload with the expected surface', () => {
    const zd = (window as unknown as { zipDownload?: { downloadZipByPrefix: unknown } }).zipDownload;
    expect(typeof zd?.downloadZipByPrefix).toBe('function');
  });

  it('shows the indicator while the IPC roundtrip is in flight and hides it on completion', async () => {
    const { bridge, progressListeners } = installElectronBridge();
    bridge.invoke.mockImplementation(async (channel: string, payload: { requestId: string }) => {
      if (channel === 'download-zip:start') {
        // Simulate a progress event mid-flight so the renderer updates the
        // indicator text.
        progressListeners.forEach((l) => l({ requestId: payload.requestId, bytesWritten: 1024 }));
        return { ok: true, path: '/tmp/out.zip', bytesWritten: 1024 };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    const promise = (window as unknown as { zipDownload: { downloadZipByPrefix: (a: { urlPath: string; prefix: string; archiveName: string }) => Promise<unknown> } })
      .zipDownload.downloadZipByPrefix({ urlPath: '/api/download-zip/x/y', prefix: 'parent/', archiveName: 'parent.zip' });

    // Indicator should be visible immediately while the start IPC is
    // still in flight (we await microtask once so the call has begun).
    await Promise.resolve();
    const indicator = document.getElementById('zip-download-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator!.classList.contains('hidden')).toBe(false);

    const result = await promise;
    expect(result).toEqual({ ok: true, path: '/tmp/out.zip' });

    // Hide is scheduled with a small delay so the user can read the final
    // state; vi.useFakeTimers isn't necessary — just await past the timer.
    await new Promise((r) => setTimeout(r, 1000));
    expect(indicator!.classList.contains('hidden')).toBe(true);

    expect(bridge.invoke).toHaveBeenCalledWith('download-zip:start', expect.objectContaining({
      urlPath: '/api/download-zip/x/y',
      archiveName: 'parent.zip',
      body: { prefix: 'parent/', archiveName: 'parent.zip' },
      requestId: expect.any(String),
    }));

    uninstallElectronBridge();
  });

  it('hides the indicator immediately when the user cancels', async () => {
    const { bridge } = installElectronBridge();
    let resolveStart: (v: unknown) => void = () => {};
    bridge.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'download-zip:start') {
        return new Promise((resolve) => { resolveStart = resolve; });
      }
      if (channel === 'download-zip:cancel') {
        // Simulate main acknowledging the cancel, then the start invoke
        // resolves with {cancelled:true}.
        resolveStart({ cancelled: true });
        return { cancelled: true };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });

    const promise = (window as unknown as { zipDownload: { downloadZipByPrefix: (a: { urlPath: string; prefix: string; archiveName: string }) => Promise<unknown> } })
      .zipDownload.downloadZipByPrefix({ urlPath: '/api/download-zip/x/y', prefix: 'parent/', archiveName: 'parent.zip' });

    await Promise.resolve();
    const indicator = document.getElementById('zip-download-indicator');
    expect(indicator!.classList.contains('hidden')).toBe(false);

    const cancelBtn = indicator!.querySelector('#zip-dl-cancel') as HTMLButtonElement;
    cancelBtn.click();

    const result = await promise;
    expect(result).toEqual({ cancelled: true });
    // No 800ms grace on cancellation — indicator should be hidden right away.
    expect(indicator!.classList.contains('hidden')).toBe(true);
    expect(bridge.invoke).toHaveBeenCalledWith('download-zip:cancel', expect.objectContaining({ requestId: expect.any(String) }));

    uninstallElectronBridge();
  });

  it('falls back to the browser fetch path when window.electron is absent', async () => {
    // Make sure no bridge is installed.
    uninstallElectronBridge();

    const mockBlob = new Blob(['fake zip bytes'], { type: 'application/zip' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => mockBlob,
    } as unknown as Response);
    (window as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    // jsdom URL.createObjectURL isn't implemented out of the box.
    let revoked = '';
    (window.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake';
    (window.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => { revoked = u; };

    const result = await (window as unknown as { zipDownload: { downloadZipByPrefix: (a: { urlPath: string; prefix: string; archiveName: string }) => Promise<unknown> } })
      .zipDownload.downloadZipByPrefix({ urlPath: '/api/download-zip/x/y', prefix: 'parent', archiveName: 'parent.zip' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/download-zip/x/y', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prefix: 'parent/', archiveName: 'parent.zip' }),
    }));
    // Indicator hidden after completion.
    const indicator = document.getElementById('zip-download-indicator');
    expect(indicator!.classList.contains('hidden')).toBe(true);
    // The revoke happens on a delayed timer; not asserting on it.
    void revoked;
  });

  it('sends wholeContainer (not prefix) for an empty-prefix container download', async () => {
    uninstallElectronBridge();

    const mockBlob = new Blob(['fake zip bytes'], { type: 'application/zip' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => mockBlob,
    } as unknown as Response);
    (window as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    (window.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake';
    (window.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};

    const result = await (window as unknown as { zipDownload: { downloadZipByPrefix: (a: { urlPath: string; prefix: string; archiveName: string }) => Promise<unknown> } })
      .zipDownload.downloadZipByPrefix({ urlPath: '/api/download-zip/x/y', prefix: '', archiveName: 'y.zip' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/download-zip/x/y', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ wholeContainer: true, archiveName: 'y.zip' }),
    }));
  });
});
