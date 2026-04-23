/**
 * Electron main process — launched via the `electron` binary.
 *
 * This file is invoked as: electron <this-file> [--port <port>]
 * It starts an Express server and opens a BrowserWindow pointing at it.
 */
import { app, BrowserWindow, ipcMain, shell, safeStorage } from "electron";
import * as path from "path";
import { createServer } from "./server.js";
import { generatePkce, buildAuthorizeUrl, exchangeCode } from "../core/backend/auth/oidc-client.js";
import { startLoopback } from "./oidc-loopback.js";
import { TokenStore } from "../core/backend/auth/token-store.js";
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

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Storage Navigator — port ${port}`,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      plugins: true,
    },
  });

  win.loadURL(`http://localhost:${port}`);

  win.on("closed", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
