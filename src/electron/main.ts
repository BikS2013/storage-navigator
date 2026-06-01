/**
 * Electron main process — launched via the `electron` binary.
 *
 * This file is invoked as: electron <this-file> [--port <port>]
 * It starts an Express server and opens a BrowserWindow pointing at it.
 */
import { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, type IpcMainInvokeEvent } from "electron";
import * as path from "path";
import { createServer } from "./server.js";
import { generatePkce, buildAuthorizeUrl, exchangeCode } from "../core/backend/auth/oidc-client.js";
import { startLoopback } from "./oidc-loopback.js";
import { TokenStore } from "../core/backend/auth/token-store.js";
import { runZipDownload } from "./zip-download.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

ipcMain.handle('oidc:login', async (_event, args: { name: string; issuer: string; clientId: string; audience: string; scopes: string[] }) => {
  const lp = await startLoopback();
  const pkce = generatePkce();
  const state = Math.random().toString(36).slice(2);
  const url = buildAuthorizeUrl({
    issuer: args.issuer, clientId: args.clientId, scopes: args.scopes, audience: args.audience,
    redirectUri: lp.redirectUri, codeChallenge: pkce.codeChallenge, state,
  });
  await shell.openExternal(url.toString());
  const cb = await lp.waitForCallback();
  if (cb.state !== state) throw new Error('OIDC state mismatch');
  const tokens = await exchangeCode({
    issuer: args.issuer, clientId: args.clientId, code: cb.code,
    redirectUri: lp.redirectUri, codeVerifier: pkce.codeVerifier,
  });
  lp.close();
  // Encrypt with safeStorage and write to ~/.storage-navigator/oidc-tokens.bin
  // (Electron-side store; CLI uses the JSON path. The map structure is the same.)
  const dir = join(homedir(), '.storage-navigator');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'oidc-tokens.bin');
  let map: Record<string, unknown> = {};
  if (existsSync(file)) {
    const enc = readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      try { map = JSON.parse(safeStorage.decryptString(enc)) as Record<string, unknown>; } catch { map = {}; }
    }
  }
  map[args.name] = tokens;
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(file, safeStorage.encryptString(JSON.stringify(map)) as Buffer);
  } else {
    // Fall back to fs-backed plaintext (TokenStore default behavior)
    await new TokenStore().save(args.name, tokens);
  }
  return { ok: true };
});

// ----------------------------------------------------------------------------
// download-zip IPC — renderer asks main to stream the archive straight to
// disk via a native save dialog. Streaming through main keeps the renderer
// out of the heap-bloat path for big archives and lets us use the OS save-as
// picker instead of the browser's blob-save fallback.
// ----------------------------------------------------------------------------

type DownloadZipPayload = {
  /** Either a fully-qualified URL or a path that we resolve against the
   *  embedded server's origin. */
  url?: string;
  urlPath?: string;
  body: unknown;
  headers?: Record<string, string>;
  /** Default filename for the save dialog. */
  archiveName: string;
  /** Caller-supplied id so renderer can correlate progress events and cancel. */
  requestId: string;
};

const pendingDownloads = new Map<string, AbortController>();

function resolveDownloadUrl(payload: DownloadZipPayload): string {
  if (payload.url) return payload.url;
  const p = payload.urlPath ?? "";
  if (!p.startsWith("/")) throw new Error("download-zip: url or urlPath required");
  return `http://localhost:${port}${p}`;
}

ipcMain.handle('download-zip:start', async (event: IpcMainInvokeEvent, payload: DownloadZipPayload) => {
  if (!payload || typeof payload !== "object") throw new Error("invalid payload");
  if (!payload.requestId) throw new Error("requestId required");
  if (pendingDownloads.has(payload.requestId)) {
    throw new Error(`download already in flight for requestId=${payload.requestId}`);
  }

  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const safeName = payload.archiveName.replace(/[\r\n"\\/]+/g, "_") || "download.zip";
  const pick = await dialog.showSaveDialog(win as BrowserWindow, {
    title: "Save archive as",
    defaultPath: safeName,
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (pick.canceled || !pick.filePath) return { cancelled: true } as const;

  const controller = new AbortController();
  pendingDownloads.set(payload.requestId, controller);
  try {
    const result = await runZipDownload({
      url: resolveDownloadUrl(payload),
      body: payload.body,
      headers: payload.headers,
      savePath: pick.filePath,
      signal: controller.signal,
      onProgress: (bytesWritten) => {
        // Best-effort — silently drop if the webContents is already gone
        // (window closed mid-download), since the awaited pipeline will
        // settle and clean up regardless.
        if (event.sender.isDestroyed()) return;
        event.sender.send('download-zip:progress', {
          requestId: payload.requestId,
          bytesWritten,
        });
      },
    });
    return { ok: true, path: pick.filePath, bytesWritten: result.bytesWritten } as const;
  } catch (err) {
    if (controller.signal.aborted) return { cancelled: true } as const;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message } as const;
  } finally {
    pendingDownloads.delete(payload.requestId);
  }
});

ipcMain.handle('download-zip:cancel', async (_event, payload: { requestId: string }) => {
  const c = pendingDownloads.get(payload?.requestId);
  if (!c) return { cancelled: false } as const;
  c.abort();
  return { cancelled: true } as const;
});

// Open an http(s) URL in the user's OS default browser. The renderer uses
// this for the "Open in browser" button on the HTML viewer toolbar — so that
// a stored static site can be navigated outside the sandboxed iframe.
// Protocol is restricted to http/https to prevent file:/javascript:/etc.
ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error('invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refused protocol: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.toString());
});

// Set app name so macOS shows "Storage Navigator" in the app switcher/menu bar
app.name = "Storage Navigator";

// Parse port from command args (electron strips its own args, remaining are ours)
let port = 3100;
const portIdx = process.argv.indexOf("--port");
if (portIdx !== -1 && process.argv[portIdx + 1]) {
  port = parseInt(process.argv[portIdx + 1], 10);
}

// Resolve the public directory from CWD (project root) since esbuild bundles
// rewrite __dirname to point at the bundle location, not the source tree.
const publicDir = path.join(process.cwd(), "src", "electron", "public");

// Start Express server
createServer(port, publicDir);

app.whenReady().then(() => {
  const iconPath = path.join(process.cwd(), "assets", "icon.png");

  // Set macOS dock icon
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconPath);
  }

  // Preload script — exposes the allowlisted IPC surface on
  // `window.electron`. Resolved from the project root the same way as
  // publicDir, since the bundled main process runs from the project root
  // (.electron-main.mjs in launch.ts).
  const preloadPath = path.join(process.cwd(), "src", "electron", "preload.cjs");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Storage Navigator — port ${port}`,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      plugins: true,
      preload: preloadPath,
    },
  });

  win.loadURL(`http://localhost:${port}`);

  // Any <a target="_blank"> or window.open() from the renderer (including from
  // inside the sandboxed iframe used by the HTML viewer) would otherwise spawn
  // a new BrowserWindow with the same preload — effectively "another Storage
  // Navigator window" pointing at the external URL. Intercept here and route
  // http(s) URLs to the OS default browser; deny everything else.
  const routeExternal = (url: string): { action: 'deny' } => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch { /* malformed URL — swallow */ }
    return { action: 'deny' };
  };
  win.webContents.setWindowOpenHandler(({ url }) => routeExternal(url));
  win.webContents.on('did-attach-webview', (_event, wc) => {
    wc.setWindowOpenHandler(({ url }) => routeExternal(url));
  });

  win.on("closed", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
