---
name: electron-app-branding
description: How to properly rename and brand an Electron app on macOS so the dock, app switcher (Cmd+Tab), menu bar, and Activity Monitor all show the correct application name and icon instead of "Electron".
---

# Electron App Branding on macOS

## The Problem

When running an unpackaged Electron app (i.e. launching via the `electron` binary from `node_modules`), macOS shows **"Electron"** everywhere: dock tooltip, Cmd+Tab app switcher, menu bar, and Activity Monitor. Setting `app.name`, patching `Info.plist` fields (`CFBundleDisplayName`, `CFBundleName`), writing localized `InfoPlist.strings`, and flushing the Launch Services cache with `lsregister` are all **insufficient** on their own.

## Root Cause

macOS derives the dock tooltip and app switcher name from the **`.app` bundle folder name**. The Electron binary lives inside `Electron.app/Contents/MacOS/Electron`. No amount of plist editing changes the folder name that macOS reads.

## The Solution

Rename the `.app` folder itself before launching, then restore the original name on exit.

### Step-by-step Implementation

#### 1. Rename the `.app` bundle before launch

```typescript
// electronBin is resolved via: require("electron")
// Typical path: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron

const contentsDir = path.resolve(path.dirname(electronBin), "..");
const originalAppBundle = path.resolve(contentsDir, "..");
const distDir = path.dirname(originalAppBundle);
const targetAppBundle = path.join(distDir, "Your App Name.app");

// Rename Electron.app -> "Your App Name.app"
if (path.basename(originalAppBundle) !== "Your App Name.app") {
  if (fs.existsSync(targetAppBundle)) {
    fs.rmSync(targetAppBundle, { recursive: true, force: true });
  }
  fs.renameSync(originalAppBundle, targetAppBundle);
}

// Update the binary path to launch from the renamed bundle
const launchBin = path.join(targetAppBundle, "Contents", "MacOS", "Electron");
```

#### 2. Patch Info.plist inside the renamed bundle

Even though the folder name drives the tooltip, patch the plist for consistency in "About" dialogs and other macOS metadata lookups.

```typescript
const plistPath = path.join(targetAppBundle, "Contents", "Info.plist");
let plist = fs.readFileSync(plistPath, "utf-8");

plist = plist.replace(
  /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
  '<key>CFBundleDisplayName</key>\n\t<string>Your App Name</string>'
);
plist = plist.replace(
  /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
  '<key>CFBundleName</key>\n\t<string>Your App Name</string>'
);

fs.writeFileSync(plistPath, plist);
```

#### 3. Replace the app icon

The default Electron icon is at `Contents/Resources/electron.icns`. Replace it with your own `.icns` file.

```typescript
const ourIcon = path.join(projectRoot, "assets", "icon.icns");
const resourcesDir = path.join(targetAppBundle, "Contents", "Resources");
fs.copyFileSync(ourIcon, path.join(resourcesDir, "electron.icns"));
```

**Creating the `.icns` file from a PNG source:**

```bash
# Source must be a real PNG (not JPEG with .png extension)
sips -s format png source.png --out icon.png

# Build the iconset
mkdir icon.iconset
sips -z   16   16 icon.png --out icon.iconset/icon_16x16.png
sips -z   32   32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z   32   32 icon.png --out icon.iconset/icon_32x32.png
sips -z   64   64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z  128  128 icon.png --out icon.iconset/icon_128x128.png
sips -z  256  256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z  256  256 icon.png --out icon.iconset/icon_256x256.png
sips -z  512  512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z  512  512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns icon.iconset -o icon.icns
```

**Important:** `sips` will produce warnings if the source is actually JPEG. Always convert to real PNG first with `sips -s format png`.

#### 4. Flush the macOS Launch Services cache

```typescript
try {
  execSync(
    `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${targetAppBundle}"`,
    { stdio: "pipe" }
  );
} catch {
  // non-critical — changes still apply on next launch
}
```

#### 5. Set app.name in the Electron main process

This controls the macOS application menu title (top-left of the menu bar).

```typescript
import { app } from "electron";
app.name = "Your App Name";
```

#### 6. Set the dock icon programmatically

Belt-and-suspenders for the dock icon, in case the `.icns` replacement didn't take effect immediately.

```typescript
app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(process.cwd(), "assets", "icon.png"));
  }
});
```

#### 7. Restore the original name on exit

The rename must be reversed when the app closes so `node_modules/electron` stays intact for future launches and `npm install` doesn't break.

```typescript
const cleanup = () => {
  const originalName = path.join(distDir, "Electron.app");
  try {
    fs.renameSync(targetAppBundle, originalName);
  } catch {
    // best-effort restore
  }
};

child.on("exit", () => cleanup());
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
```

## What Does NOT Work (and Why)

| Approach | Why it fails |
|---|---|
| `app.name = "..."` in Electron main | Only affects the application menu title, not dock or Cmd+Tab |
| Patching `CFBundleDisplayName` in `Info.plist` | macOS dock tooltip ignores this; uses folder name |
| Patching `CFBundleName` in `Info.plist` | Same — folder name takes precedence for dock |
| Writing `InfoPlist.strings` in `en.lproj` | Only consulted after folder name; dock ignores it |
| `lsregister -f` cache flush alone | Flushes cache but still reads the same folder name |
| All of the above combined without renaming | Still shows "Electron" in dock tooltip and Cmd+Tab |

## Checklist

When branding an unpackaged Electron app on macOS:

- [ ] Rename `Electron.app` folder to `Your App Name.app` before launch
- [ ] Patch `CFBundleDisplayName` and `CFBundleName` in `Info.plist`
- [ ] Replace `electron.icns` in `Contents/Resources/`
- [ ] Run `lsregister -f` on the renamed bundle
- [ ] Set `app.name` in the Electron main process
- [ ] Set `app.dock.setIcon()` with the PNG icon
- [ ] Restore original `Electron.app` name on exit, SIGINT, and SIGTERM
- [ ] Ensure `.icns` is built from a real PNG (not a renamed JPEG)

## Reference Implementation

See `src/electron/launch.ts` and `src/electron/main.ts` in this project for a working example.
