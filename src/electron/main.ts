/**
 * Electron main process — launched via the `electron` binary.
 *
 * This file is invoked as: electron <this-file> [--port <port>]
 * It starts an Express server and opens a BrowserWindow pointing at it.
 */
import { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, type IpcMainInvokeEvent } from "electron";
import * as path from "path";
import { startServer } from "./server.js";
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

// Parse port from command args (electron strips its own args, remaining are ours).
//
// A port is OPTIONAL. When one is given (`--port N`, i.e. the user configured
// it) we bind exactly that port and fail loudly if it is taken — never
// silently substituting a configured value. When none is given — which is
// every Finder/dock launch of the packaged app, where nothing has been
// configured — we ask the OS for a free port. The previous hardcoded 3100
// default made the app unlaunchable from the OS whenever 3100 was in use: the
// unhandled EADDRINUSE left the window pointing at a dead origin (blank page).
const requestedPort: number | null = (() => {
  const idx = process.argv.indexOf("--port");
  if (idx === -1 || !process.argv[idx + 1]) return null;
  const parsed = Number.parseInt(process.argv[idx + 1], 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid --port value: ${process.argv[idx + 1]}`);
  }
  return parsed;
})();

/** The port actually bound; set once the server is listening. */
let port = 0;

// Resolve runtime resources depending on whether we run packaged or in dev.
//
//  - Dev (`npm run ui`): esbuild bundles rewrite __dirname, and cwd is the
//    project root, so files come from the source tree under src/electron and
//    the project-root assets/ folder.
//  - Packaged (.app from /Applications): cwd is "/". electron-builder copies
//    `extraResources` into Contents/Resources (process.resourcesPath), so
//    public/, preload.cjs and assets/ are resolved from there.
const RES_BASE = app.isPackaged
  ? process.resourcesPath
  : path.join(process.cwd(), "src", "electron");
const ASSET_BASE = app.isPackaged ? process.resourcesPath : process.cwd();

const publicDir = path.join(RES_BASE, "public");

app.whenReady().then(async () => {
  // Bind the server BEFORE creating the window: the window's URL depends on the
  // port the OS actually gave us, and a bind failure must surface as a dialog
  // rather than a window pointing at nothing.
  try {
    const started = await startServer(requestedPort ?? 0, publicDir);
    port = started.port;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      "Storage Navigator could not start",
      `${detail}\n\n` +
        (requestedPort !== null
          ? `Retry without --port to let the app pick a free port automatically.`
          : `The local server could not bind to a port on 127.0.0.1.`)
    );
    app.quit();
    return;
  }

  const iconPath = path.join(ASSET_BASE, "assets", "icon.png");

  // Set macOS dock icon
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconPath);
  }

  // Preload script — exposes the allowlisted IPC surface on
  // `window.electron`. Resolved from the same base as publicDir so it works
  // both in dev (source tree) and packaged (Contents/Resources).
  const preloadPath = path.join(RES_BASE, "preload.cjs");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Storage Navigator — port ${port}`,
    icon: iconPath,
    // macOS: hide the stock title bar and inset the traffic lights so they sit
    // inside the renderer's 52px toolbar row (which declares the drag region).
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      plugins: true,
      preload: preloadPath,
    },
  });

  // A failed first load used to leave an unexplained blank window. Report it
  // instead — the renderer's own origin is the only thing being loaded here, so
  // a failure means the embedded server or its files are unreachable.
  win.webContents.once("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox(
      "Storage Navigator could not load its interface",
      `Failed to load ${validatedURL}\n\n${errorDescription} (${errorCode})\n\n` +
        `Expected the interface files at:\n${publicDir}`
    );
  });

  win.loadURL(`http://127.0.0.1:${port}`);

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
