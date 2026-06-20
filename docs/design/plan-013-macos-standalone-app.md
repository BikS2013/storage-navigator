# plan-013 — Standalone macOS App (`/Applications`)

**Status:** done (2026-06-20) — built, ad-hoc signed, installed to /Applications, launch-verified
**Date:** 2026-06-20
**Scope:** Package the Storage Navigator Electron UI as a standalone, double-clickable macOS `.app` that installs into `/Applications` (and so appears in Launchpad/Spotlight), using the already-present `electron-builder`.

**Decisions (confirmed with user):**
- Distribution: **personal use only** — no Developer ID / no Apple notarization. Build locally (no quarantine attribute is applied to locally-built apps, so Gatekeeper does not block first launch).
- Architecture: **Apple Silicon only (`arm64`)**.
- Mode: write this plan, then implement.

---

## 1. Background — current launch model

`storage-nav ui` (`src/cli/index.ts:821`) → `launchElectronApp()` (`src/electron/launch.ts`):
1. At runtime, esbuild-bundles `src/electron/main.ts` → `.electron-main.mjs`.
2. Spawns the `electron` binary from `node_modules`.
3. On macOS, **renames** `node_modules/electron/dist/Electron.app` → `Storage Navigator.app` to fix the dock tooltip / Cmd-Tab name, then restores it on exit (see `.claude/skills/electron-app-branding.md`).

This is an *unpackaged* dev launch. It requires the source tree, Node, and `node_modules` to be present, and cannot be installed in `/Applications`.

`electron-builder ^26.8.2` + `electron ^41.1.1` are already in `devDependencies` (`package.json:58-59`). The package `main` is already `dist/electron/main.js`. There is **no build config yet**.

## 2. Blockers in the current code

The packaged app double-clicked from `/Applications` has `cwd = /`. These `process.cwd()`-relative resolutions break:

| File:line | Code | Fix |
|---|---|---|
| `src/electron/main.ts:163` | `publicDir = join(process.cwd(), "src/electron/public")` | resolve from `process.resourcesPath` when packaged |
| `src/electron/main.ts:180` | `preloadPath = join(process.cwd(), "src/electron/preload.cjs")` | same |
| `src/electron/main.ts:169` | `iconPath = join(process.cwd(), "assets/icon.png")` | same |

Additional facts:
- `public/`, `preload.cjs`, `assets/` live under `src/`, **not** `dist/` — must be bundled explicitly via `extraResources`.
- `launch.ts` (runtime esbuild + bundle rename) is **not used** by a packaged app — Electron runs `dist/electron/main.js` directly. `launch.ts` stays untouched for the `npm run ui` dev flow.
- `createServer(port, publicDir)` (`src/electron/server.ts:75`) listens on a fixed port (`app.listen(port, "127.0.0.1")`, line 1498) and returns the Express app. The packaged app uses the default port **3100**.

## 3. Design

### 3.1 Path resolution (the only production-code change)

In `src/electron/main.ts`, introduce a resource base that depends on `app.isPackaged`:

```ts
// Dev (npm run ui): files come from the source tree (cwd = project root).
// Packaged: extraResources land in Contents/Resources (process.resourcesPath).
const RES_BASE = app.isPackaged
  ? process.resourcesPath
  : path.join(process.cwd(), "src", "electron");
const ASSET_BASE = app.isPackaged
  ? process.resourcesPath
  : process.cwd();

const publicDir   = path.join(RES_BASE, "public");
const preloadPath = path.join(RES_BASE, "preload.cjs");
const iconPng     = path.join(ASSET_BASE, "assets", "icon.png");
```

`extraResources` is configured so the packaged layout matches:
`Contents/Resources/public/`, `Contents/Resources/preload.cjs`, `Contents/Resources/assets/icon.png`.

Dev mode is unchanged (`src/electron/public`, `src/electron/preload.cjs`, `assets/icon.png` from cwd).

### 3.2 `electron-builder` config (in `package.json` `build` block)

```jsonc
"build": {
  "appId": "com.giorgosmarinos.storage-navigator",
  "productName": "Storage Navigator",
  "directories": { "output": "release", "buildResources": "assets" },
  "files": ["dist/**/*", "package.json"],
  "extraResources": [
    { "from": "src/electron/public",      "to": "public" },
    { "from": "src/electron/preload.cjs", "to": "preload.cjs" },
    { "from": "assets",                   "to": "assets" }
  ],
  "mac": {
    "target": [{ "target": "dmg", "arch": ["arm64"] }],
    "category": "public.app-category.developer-tools",
    "icon": "assets/icon.icns",
    "identity": null
  }
}
```

- `identity: null` → skip code signing (personal/local use).
- `productName: "Storage Navigator"` → electron-builder names the bundle `Storage Navigator.app` automatically — **the launch.ts rename hack is irrelevant to the packaged app.**
- `files` ships compiled `dist/**` + `package.json`; electron-builder auto-includes production `dependencies` from `node_modules`.

### 3.3 Build scripts (in `package.json` `scripts`)

```jsonc
"build:electron": "tsc",
"dist:mac": "npm run build:electron && electron-builder --mac --arm64"
```

### 3.4 Output & install

`electron-builder` writes to `release/`:
- `release/Storage Navigator-1.0.0-arm64.dmg`
- `release/mac-arm64/Storage Navigator.app`

Install: open the DMG and drag `Storage Navigator.app` to `/Applications` (or `cp -R` the built `.app`). It then shows in Launchpad/Spotlight. The `storage-nav` CLI (`bin`) remains independent.

## 4. Known limitations (personal-use scope)

- **Fixed port 3100.** If 3100 is busy, the packaged app's embedded server fails to bind. (Dev flow picks a port via the CLI.) Optional future enhancement: bind to an ephemeral port (`listen(0)`) and load the assigned port — requires `createServer` to return the `http.Server`. Out of scope here; recorded in `Issues - Pending Items.md`.
- **Unsigned.** Fine for locally-built personal use. Sharing the DMG with others would require right-click→Open or `xattr -dr com.apple.quarantine`, and proper distribution would require Developer ID signing + notarization (separate effort).
- **Bundle size.** `dependencies` include LangChain packages used by the agent/TUI, not the UI; they inflate the `.app`. Acceptable for personal use; pruning is a possible later optimization.

## 5. Steps

1. Patch `src/electron/main.ts` path resolution (§3.1).
2. Add `build` block + scripts to `package.json` (§3.2, §3.3).
3. `npm run dist:mac` → produce DMG + `.app`.
4. Verify the `.app` launches (window loads, blob browsing works), then copy to `/Applications`.
5. Update `Issues - Pending Items.md` (port-3100 limitation) and note the design change in `docs/design/project-design.md`.

## 6. Acceptance criteria

- `Storage Navigator.app` exists, launches by double-click from `/Applications`, shows the correct name + icon in dock/Cmd-Tab/Launchpad.
- The UI window loads and can list storages/containers (server + public assets resolve correctly when launched from `/Applications`).
- The `npm run ui` dev flow still works unchanged.
</content>
</invoke>
