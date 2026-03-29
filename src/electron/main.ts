/**
 * Electron main process — launched via the `electron` binary.
 *
 * This file is invoked as: electron <this-file> [--port <port>]
 * It starts an Express server and opens a BrowserWindow pointing at it.
 */
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { createServer } from "./server.js";

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
