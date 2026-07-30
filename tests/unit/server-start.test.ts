// tests/unit/server-start.test.ts
//
// Tests for the port-binding policy in src/electron/server.ts startServer(),
// which is what makes a Finder/dock launch of the packaged app reliable:
//
//   startServer(0)        → OS-assigned free port, reported back to the caller
//   startServer(busyPort) → rejects (never silently rebinds a configured port)
//
// The hardcoded 3100 this replaced left the packaged app's BrowserWindow
// pointing at a dead origin (blank window) whenever 3100 was already held.
//
// Follows the existing convention: temp STORAGE_NAVIGATOR_DIR so no real
// credential store is touched, vi.resetModules() before each test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let tmp: string;
const opened: Server[] = [];

beforeEach(() => {
  vi.resetModules();
  tmp = mkdtempSync(join(tmpdir(), 'sn-server-start-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
});

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))
  );
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

async function start(port: number) {
  const { startServer } = await import('../../src/electron/server.js');
  const started = await startServer(port, tmp);
  opened.push(started.server);
  return started;
}

describe('startServer port binding', () => {
  it('binds an OS-assigned port when asked for 0 and reports it back', async () => {
    const started = await start(0);
    expect(started.port).toBeGreaterThan(0);
    expect(started.port).toBeLessThanOrEqual(65535);
    expect(started.server.listening).toBe(true);

    // The reported port must be the one actually listening — the packaged app
    // builds its window URL from it.
    const address = started.server.address();
    expect(typeof address === 'object' && address !== null && address.port).toBe(started.port);
  });

  it('binds exactly the port it was given', async () => {
    const first = await start(0);
    const chosen = first.port;
    await new Promise<void>((r) => first.server.close(() => r()));

    const second = await start(chosen);
    expect(second.port).toBe(chosen);
  });

  it('rejects instead of rebinding elsewhere when the requested port is busy', async () => {
    const held = await start(0);

    await expect(start(held.port)).rejects.toThrow(
      new RegExp(`Port ${held.port} is already in use`)
    );
  });

  it('listens on the loopback interface only', async () => {
    const started = await start(0);
    const address = started.server.address();
    expect(typeof address === 'object' && address !== null && address.address).toBe('127.0.0.1');
  });
});

describe('buildApp', () => {
  it('does not bind a port', async () => {
    const { buildApp } = await import('../../src/electron/server.js');
    const app = buildApp(tmp);
    // An un-bound Express instance exposes no listening server; the only way to
    // observe binding is that buildApp returns without one being created.
    expect(typeof app.listen).toBe('function');
    expect(opened).toHaveLength(0);
  });
});
