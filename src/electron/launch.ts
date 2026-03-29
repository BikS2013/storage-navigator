import { spawn, execSync } from "child_process";
import { createRequire } from "module";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Launch the Electron app as a standalone desktop window.
 *
 * Strategy: Use tsx to compile the Electron main.ts to a temp JS file,
 * then launch the Electron binary with that JS file.
 */
export function launchElectronApp(port: number): void {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const electronMainTs = path.join(__dirname, "main.ts");

  // Resolve the electron binary
  const electronBin: string = require("electron") as unknown as string;

  // Use tsx to compile main.ts + dependencies into a single runnable bundle
  // We use esbuild (bundled with tsx) for this
  const outFile = path.join(projectRoot, ".electron-main.mjs");

  console.log(`Bundling Electron main process...`);
  try {
    execSync(
      `npx esbuild "${electronMainTs}" --bundle --platform=node --format=esm --outfile="${outFile}" --external:electron --external:@azure/storage-blob --external:express --external:marked --external:highlight.js --external:mammoth`,
      { cwd: projectRoot, stdio: "pipe" }
    );
  } catch (err: unknown) {
    // esbuild might not be installed, install it
    console.log("Installing esbuild...");
    execSync("npm install --save-dev esbuild", { cwd: projectRoot, stdio: "inherit" });
    execSync(
      `npx esbuild "${electronMainTs}" --bundle --platform=node --format=esm --outfile="${outFile}" --external:electron --external:@azure/storage-blob --external:express --external:marked --external:highlight.js --external:mammoth`,
      { cwd: projectRoot, stdio: "pipe" }
    );
  }

  // On macOS the dock tooltip is derived from the .app folder name.
  // Rename Electron.app -> "Storage Navigator.app" so macOS shows the right name
  // everywhere: dock tooltip, Cmd+Tab, menu bar, Activity Monitor.
  let launchBin = electronBin;
  let renamedAppBundle: string | null = null;

  if (process.platform === "darwin") {
    // electronBin: .../dist/Electron.app/Contents/MacOS/Electron
    const contentsDir = path.resolve(path.dirname(electronBin), "..");
    const originalAppBundle = path.resolve(contentsDir, "..");
    const distDir = path.dirname(originalAppBundle);
    const targetAppBundle = path.join(distDir, "Storage Navigator.app");

    // Rename Electron.app -> Storage Navigator.app (if not already renamed)
    if (path.basename(originalAppBundle) !== "Storage Navigator.app") {
      // If a stale renamed bundle exists, remove it first
      if (fs.existsSync(targetAppBundle)) {
        fs.rmSync(targetAppBundle, { recursive: true, force: true });
      }
      fs.renameSync(originalAppBundle, targetAppBundle);
      renamedAppBundle = targetAppBundle;
      launchBin = path.join(targetAppBundle, "Contents", "MacOS", "Electron");
    }

    // Patch Info.plist inside the (now renamed) bundle
    const plistPath = path.join(
      renamedAppBundle ?? originalAppBundle, "Contents", "Info.plist"
    );
    if (fs.existsSync(plistPath)) {
      let plist = fs.readFileSync(plistPath, "utf-8");
      plist = plist.replace(
        /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
        "<key>CFBundleDisplayName</key>\n\t<string>Storage Navigator</string>"
      );
      plist = plist.replace(
        /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
        "<key>CFBundleName</key>\n\t<string>Storage Navigator</string>"
      );
      fs.writeFileSync(plistPath, plist);
    }

    // Copy our icon into the bundle
    const ourIcon = path.join(projectRoot, "assets", "icon.icns");
    const resourcesDir = path.join(
      renamedAppBundle ?? originalAppBundle, "Contents", "Resources"
    );
    if (fs.existsSync(ourIcon) && fs.existsSync(resourcesDir)) {
      fs.copyFileSync(ourIcon, path.join(resourcesDir, "electron.icns"));
    }

    // Flush macOS Launch Services cache
    const bundle = renamedAppBundle ?? originalAppBundle;
    try {
      execSync(
        `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${bundle}"`,
        { stdio: "pipe" }
      );
    } catch {
      // non-critical
    }
  }

  console.log(`Launching Storage Navigator (Electron) on port ${port}...`);

  const child = spawn(launchBin, [outFile, "--port", String(port)], {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env },
  });

  const cleanup = () => {
    try { fs.unlinkSync(outFile); } catch {}
    // Restore the original Electron.app name so npm/electron module stays intact
    if (renamedAppBundle) {
      const distDir = path.dirname(renamedAppBundle);
      const originalName = path.join(distDir, "Electron.app");
      try {
        fs.renameSync(renamedAppBundle, originalName);
      } catch {
        // best-effort restore
      }
    }
  };

  child.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    console.error(`Failed to launch Electron: ${err.message}`);
    cleanup();
    process.exit(1);
  });

  // Also restore on SIGINT/SIGTERM so Ctrl+C doesn't leave it renamed
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}
