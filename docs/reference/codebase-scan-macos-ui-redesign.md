---
language: TypeScript
framework: Electron (desktop shell) + Express (embedded server) — renderer under src/electron/public/ is framework-free vanilla HTML/CSS/JS
package_manager: npm
build_command: npm run build
test_command: npm test
lint_command: null
entry_points:
  - src/cli/index.ts
  - src/electron/launch.ts
  - src/electron/main.ts
  - src/electron/server.ts
  - src/electron/public/index.html
  - src/electron/public/app.js
last_scanned_commit: 008ddaeee515af7e4082478626333ae787b63444
scanned_for_request: macos-ui-redesign
scanned_at: 2026-07-04T02:52:16Z
---

# Codebase Scan — Storage Navigator (macOS UI Redesign)

## 1. Project Overview

Storage Navigator is a TypeScript project (npm/`tsc`, Node ESM, `type: module`) providing a CLI (`src/cli`), a LangGraph agent (`src/agent`), a terminal UI (`src/tui`), a core backend abstraction (`src/core`, two backends: direct Azure SDK and remote `storage-nav-api`), and an Electron desktop app (`src/electron`). Tests run under Vitest (`npm test` → `vitest run`, config at `vitest.config.ts`, `tests/unit/**`). Packaging for macOS uses `electron-builder` (`npm run dist:mac` → `tsc` then `electron-builder --mac --arm64`). The renderer that this request targets — `src/electron/public/` — is **not** compiled/bundled: `index.html`, `styles.css`, `app.js`, `html-view.js`, `zip-download-ui.js`, `favicon.png` are served verbatim by the embedded Express server in dev and copied verbatim into `Contents/Resources/public/` via `extraResources` when packaged. No build step touches these files; editing them requires no `tsc`/`esbuild` run, only an app reload. Only `main.ts` (and other `.ts` files under `src/electron/`) require `tsc`/esbuild rebundling.

## 2. Module Map

Full top-level map (all non-focal modules are noted briefly per the request's out-of-scope framing; `src/electron` and `src/electron/public` are expanded in depth since they are the scan focus):

| Path | Purpose | Representative symbols |
|---|---|---|
| `src/cli/` | Commander-based CLI (`index.ts` + `commands/`), incl. `ui` subcommand that calls `launchElectronApp` | `program`, `commands/*` |
| `src/agent/` | LangGraph ReAct agent wrapping CLI ops as LLM tools (`graph.ts`, `providers/`, `tools/`) | `buildGraph`, `run.ts` |
| `src/tui/` | Terminal UI (ANSI rendering, slash commands, memory) | `index.ts`, `slash/` |
| `src/config/` | Agent configuration loader | `agent-config.ts` |
| `src/util/` | Shared helpers: redaction, site-path resolution, text-type detection, zip streaming | `redact.ts`, `site-path.ts`, `text-detect.ts`, `zip-stream.ts` |
| `src/core/` | Backend-agnostic domain logic: blob/file-share clients, credential store, GitHub/DevOps write clients, reverse-git engine (diff/sync/link-registry) | `backend/` (factory, direct-backend, api-backend), `reverse-*-engine.ts` |
| `API/` | Separate standalone HTTP API sub-project (own `package.json`, Dockerfile, OpenAPI spec) — a third backend type consumed by `src/core/backend/api-backend.ts` | (own module tree, not scanned in depth — out of scope for this request) |
| **`src/electron/`** | **Electron main-process + embedded server + renderer (scan focus, expanded below)** | see below |
| `tests/unit/` | Vitest unit tests (`happy-dom` environment annotated per-file via `// @vitest-environment happy-dom`) | e.g. `zip-download-ui.test.ts`, `html-view.test.ts` |
| `test_scripts/` | Ad hoc test/verification scripts (project convention per CLAUDE.md) | — |
| `docs/design/`, `docs/reference/`, `docs/research/` | Plans, project design, reference/investigation artifacts | `project-design.md`, `plan-013-macos-standalone-app.md` |
| `assets/` | App icon sources (`icon.icns`, `icon.png`, `icon.iconset/`) | packaged via `extraResources` |
| `bin/` | `storage-nav` CLI shim (`storage-nav.mjs`) | npm `bin` entry |

### `src/electron/` (expanded)

| File | Role |
|---|---|
| `main.ts` (233 lines) | Electron main process. Registers `oidc:login`, `download-zip:start/cancel`, `shell:open-external` IPC handlers; sets `app.name`; resolves `RES_BASE`/`ASSET_BASE` (dev vs packaged paths); creates the single `BrowserWindow` (lines 192–203: `width:1400, height:900`, stock title bar — no `titleBarStyle`, no `vibrancy`, no `nativeTheme` wiring); loads `http://localhost:<port>`; intercepts `window.open`/`target=_blank` to route external URLs to the OS browser (deny in-app popups) — this must be preserved verbatim regardless of chrome changes. |
| `launch.ts` (148 lines) | Dev launch path invoked by `npm run ui` (via `src/cli/index.ts ui` → this module): esbuild-bundles `main.ts` → `.electron-main.mjs` (`--bundle --platform=node --format=esm --packages=external`), on macOS renames the ad-hoc `Electron.app` bundle to `"Storage Navigator.app"` (dock/app-switcher naming hack), patches `Info.plist`, copies the icon, flushes Launch Services cache, then spawns the renamed binary with `--port`. Restores the rename on exit/SIGINT/SIGTERM. **Not touched by this redesign** (no chrome-related logic here) but is the mechanism by which `main.ts` edits reach a running dev instance — any `main.ts` change requires this bundling step to pick it up (it always runs on `npm run ui`, no separate manual rebuild needed for dev). |
| `server.ts` (1511 lines) | Express server. Relevant slice only: `createServer(port, publicDirOverride?)` (line 75) mounts `express.static(publicDir)` (line 87) where `publicDir = publicDirOverride ?? path.join(__dirname, "public")`; `main.ts` passes the resolved `RES_BASE/public` dir. All other routes (blob/file APIs, reverse-git, trust, site-file serving) are out of scope for this request. |
| `preload.cjs` (48 lines) | CommonJS preload (Electron requires CJS here). Exposes `window.electron.invoke`/`.on` restricted to an explicit allowlist: `INVOKE_CHANNELS = {oidc:login, download-zip:start, download-zip:cancel, shell:open-external}`, `EVENT_CHANNELS = {download-zip:progress}`. Any new main↔renderer channel (e.g. for native `nativeTheme` sync, if chosen) must be added to both allowlists here. |
| `site-routes.ts`, `zip-download.ts`, `oidc-loopback.ts` | Backend logic — out of scope. |

### `src/electron/public/` (the DOM contract — expanded per request focus)

| File | Lines | Role |
|---|---|---|
| `index.html` | 383 | Single-page markup: header toolbar, `#main` (tree sidebar + `#resizer` + content pane), 13 modals (`#add-modal`, `#rename-modal`, `#delete-modal`, `#delete-storage-modal`, `#delete-folder-modal`, `#create-modal`, `#sync-modal`, `#link-modal`, `#links-panel-modal`, `#publish-modal`, `#reverse-links-panel-modal`, `#add-token-modal`, `#github-apps-modal`, `#add-github-app-modal`), 4 context menus (`#context-menu`, `#folder-context-menu`, `#container-context-menu`, `#storage-account-context-menu`). Loads highlight.js 11.9.0 and marked 12.0.0 from `cdnjs.cloudflare.com` with SRI `integrity` hashes (lines 9–10, 377–378) — confirmed these are **not** bundled npm copies despite `highlight.js`/`marked` being listed in `package.json` `dependencies` (grep found zero `import`/`require` of either package anywhere under `src/**/*.ts` — the npm copies appear currently unused; see Notes). Numerous inline `style="..."` attributes remain in modal markup (confirmed, e.g. lines 72, 118–119, 131–133, 145–146, 159, 164, 176, 189, 229, 231, 239–262, 311, 313–315, 325, 331, 335 — far more than a handful; every `<select>`/status line/label in the Publish, Add-Storage, Create-File, Add-Token, GitHub-Apps and Add-GitHub-App modals carries inline styling). |
| `styles.css` | 667 | Two themes via CSS custom properties: `:root` = dark (default, lines 4–30), `[data-theme="light"]` override (lines 32–58) — **29 variables per theme confirmed** (`--bg-primary/secondary/tertiary/hover/active`, `--border`, `--text`, `--text-dim`, `--text-accent`, `--text-filename`, `--btn-bg`, `--btn-primary(-hover)`, `--input-bg`, `--json-*`, `--code-bg`, `--table-*`, `--expiry-*`, `--scrollbar-thumb`). Flat palette, 3–8px radii, no `backdrop-filter`/materials, no macOS control styling anywhere in the file. Confirmed dead/undefined variable references used elsewhere but never declared here: `var(--text-muted)` and `var(--link)` (see Notes and Integration Points). |
| `app.js` | 2,917 | Single IIFE (`(function () { ... })()`, line 1–2), double-quoted string style, all state as top-of-closure `const` DOM handles via `document.getElementById(...)` (204 total `getElementById`/`querySelector` call sites confirmed) plus 148 `createElement`/`classList`/`className` sites for dynamically built tree items, table rows, badges, diff panels, etc. Theme mechanism at lines 163–175: reads `localStorage.getItem("sn-theme") || "dark"`, `applyTheme(t)` sets `document.documentElement.setAttribute("data-theme", t)`, persists via `localStorage.setItem("sn-theme", t)`, and toggles `#hljs-dark`/`#hljs-light` `<link>` `.disabled` flags (lines 171–172) to swap the highlight.js stylesheet; `themeBtn` click handler toggles dark↔light (line 175). No system-appearance (`prefers-color-scheme`/`nativeTheme`) detection exists anywhere in the file today. |
| `html-view.js` | 121 | UMD-ish, attaches `window.htmlView.render(...)`. Builds a toolbar (`.html-view-toolbar` with 3 buttons: Trust/Untrust, "Open in browser", "View source") and a sandboxed `<iframe class="html-view">` via `createElement` (5 element-creation sites: `bar`, `trustBtn`, `openBtn`, `sourceBtn`, `iframe`). Single-quoted string style (differs from `app.js`'s double-quoted style — note the inconsistency). Injects DOM into whatever `contentBody` element `app.js` passes it. |
| `zip-download-ui.js` | 196 | IIFE exposing `window.zipDownload.downloadZipByPrefix(...)`. Lazily creates `#zip-download-indicator` (`.zip-dl-indicator`) containing `.zip-dl-box`, `.zip-dl-spinner`, `.zip-dl-text`/`.zip-dl-label`/`.zip-dl-detail` (`#zip-dl-detail`), and `#zip-dl-cancel` button — 5 `createElement`/`classList`/`className` sites plus `querySelector`/`getElementById` lookups for the detail/cancel nodes. Double-quoted string style (matches `app.js`). Has both an Electron-bridge path (`window.electron.invoke('download-zip:start'/'download-zip:cancel')`, listens on `'download-zip:progress'`) and a browser-only `fetch`+`Blob`+`<a download>` fallback path. |
| `favicon.png` | — | Static asset, unaffected. |

## 3. Conventions

- **DOM-handle-at-closure-top pattern**: `app.js` resolves every static element once via `document.getElementById(...)` into `const` bindings at the top of its single IIFE (`app.js:3-30` and continuing well beyond), then references those bindings throughout the rest of the file rather than re-querying. Any redesign that renames/removes an ID must update the corresponding `const` line in this same block, not just the markup.
- **Kebab-case IDs/classes, camelCase JS bindings**: markup uses kebab-case (`id="delete-storage-modal"`, `class="modal-actions"`) while `app.js` binds them to camelCase locals (`deleteStorageModal`, `modalActions` pattern) — e.g. `index.html:128` (`#delete-storage-modal`) ↔ `app.js:6` (`deleteStorageModal`). Preserve this mapping convention for any new IDs.
- **Theme is a single `data-theme` attribute + localStorage flag, not per-component classes**: `app.js:163-175` — `document.documentElement.setAttribute("data-theme", t)` plus `localStorage["sn-theme"]`, with the highlight.js stylesheet swap done by toggling the `disabled` property on `#hljs-dark`/`#hljs-light` `<link>` tags (`app.js:171-172`, tags defined `index.html:9-10`). No system-appearance detection exists today — this is a genuinely new integration point (Section 4).
- **Inline `style="..."` is the current pattern for one-off layout, not CSS classes**: `index.html` embeds raw `style="..."` extensively in modal bodies (e.g. `index.html:72,118-119,131-133,159,164,176,189,229,231,239-262,311,325,331,335`) rather than dedicated classes in `styles.css`. AC-7/Requirement 6 explicitly require eliminating this pattern — every one of these sites is an in-scope migration target.
- **IIFE-per-file, no shared module system, but inconsistent quote style across renderer files**: `app.js` and `zip-download-ui.js` use double-quoted strings (`app.js:3`, `zip-download-ui.js` throughout); `html-view.js` uses single-quoted strings (`html-view.js:5,13-16`) despite being loaded in the same page via plain `<script src>` tags (`index.html:379-381`, load order: `zip-download-ui.js` → `html-view.js` → `app.js`). No bundler enforces consistency — a redesign touching these files should not "fix" this stylistic drift unless asked, but should not introduce a third style either.
- **Error handling is local try/catch with inline UI status text, not thrown/propagated exceptions**: `app.js` has 20 `catch (e)`/`catch (err)` blocks in the first ~1450 lines alone (e.g. `app.js:322,348,395,440,496,555,649,730,765,798,841,979,1003,1052,1153,1195,1270,1342,1356,1446`), each typically setting a `.textContent`/status-line class (`status-error`, mirrored in `styles.css:551-554`) rather than throwing — any redesigned status/error UI must preserve this "inline status line" convention rather than introducing toasts/alerts.

## 4. Integration Points

### In-Scope (files this request modifies)

- `src/electron/public/index.html` — full visual/structural rebuild: all layout regions, all 13 modals, all 4 context menus, inline-style elimination (AC-7), icon-glyph replacement (Requirement 7).
- `src/electron/public/styles.css` — full theme-token and component redesign (both `:root` dark and `[data-theme="light"]` blocks); must additionally **define** the currently-undefined `--text-muted` and `--link` custom properties consumed elsewhere (see Notes).
- `src/electron/public/app.js` — lockstep edits **only** where an ID/class the file queries (204 sites) is renamed/restructured, plus the `applyTheme`/theme-toggle logic (`app.js:163-175`) if system-appearance default behavior changes (Requirement 3, Open Question Q2/Q3).
- `src/electron/public/html-view.js` — restyle the toolbar/iframe DOM it creates (`html-view.js:43-94`); update class names only if the contract changes.
- `src/electron/public/zip-download-ui.js` — restyle the indicator/spinner/cancel DOM it creates (`zip-download-ui.js:24-44`); update selectors only if the contract changes.
- `src/electron/main.ts` (`BrowserWindow` constructor, lines 192-203) — minimal window-chrome changes: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition`, optional `vibrancy`/`nativeTheme` wiring per Open Question Q1. The external-link routing (`routeExternal`, lines 212-224) and IPC handlers above must be preserved untouched.
- `src/electron/preload.cjs` — only if a new IPC channel is introduced (e.g. main-process `nativeTheme` change forwarding); both `INVOKE_CHANNELS`/`EVENT_CHANNELS` allowlists would need the new channel name added.
- `tests/unit/html-view.test.ts`, `tests/unit/zip-download-ui.test.ts` — these load the renderer JS source directly into `happy-dom` (via `new Function(src)`) and assert on the DOM it creates; any class/ID rename in `html-view.js`/`zip-download-ui.js` requires matching updates here to keep them green.
- A new automated DOM-contract check under `test_scripts/` (Requirement/AC-4 mandates a script here, per project convention that all test scripts live in `test_scripts/`).
- `package.json` `build.extraResources` (`{"from": "src/electron/public", "to": "public"}`) — no path change expected since `public/` ships verbatim, but confirm no new sibling directories (e.g. a `public/icons/`) are introduced without updating this block if electron-builder needs an explicit new resource path (typically unnecessary since the whole `public/` folder is already copied recursively).
- `docs/design/plan-013-macos-standalone-app.md` / `docs/design/project-design.md` / `docs/design/project-functions.md` — process-mandated documentation updates (CLAUDE.md pipeline rules) once the plan/design phases run.

### Out-of-Scope (explicitly untouched)

- `src/core/**` (blob/file-share clients, credential store, reverse-git diff/sync engines, GitHub/DevOps write clients) — no functional change permitted (Requirement 10 / Scope).
- `src/agent/**` (LangGraph agent) and `src/tui/**` (terminal UI) — separate surfaces, not part of the Electron renderer.
- `src/cli/**` — CLI subcommands untouched (the `ui` subcommand only invokes `launch.ts`, which is itself out of scope beyond being the bundling mechanism for any `main.ts` edits).
- `API/**` — standalone HTTP API sub-project, a different backend type; untouched.
- `src/electron/server.ts` route/business logic (beyond the already-documented static-file mount at line 87), `src/electron/site-routes.ts`, `src/electron/zip-download.ts`, `src/electron/oidc-loopback.ts` — backend logic, not the visual layer.
- Windows/Linux chrome parity — explicitly "must not crash" only, no styling work.
- CDN-hosted highlight.js 11.9.0 / marked 12.0.0 — stay CDN-loaded; bundling them is explicitly out of scope.

### New Integration Points (no existing module to extend — land fresh)

- **System-appearance detection**: nothing in the codebase currently reads `prefers-color-scheme` or Electron's `nativeTheme`. If implemented in the renderer, it lands as an extension of `applyTheme()`/the theme-init block in `app.js:163-175` (e.g. `matchMedia('(prefers-color-scheme: dark)')` used only when no `sn-theme` value is stored yet — consistent with Requirement 3/AC-5 and the recommended default in Open Question Q2). If implemented via the main process instead (`nativeTheme.shouldUseDarkColors`), it requires a **new** IPC channel added to both `main.ts` and `preload.cjs`'s allowlists — there is no existing appearance-related channel to extend.
- **Icon asset system**: today's "icons" are inline Unicode glyph characters embedded directly in `index.html` button text (e.g. `&#128465;`, `&#9998;`, `&#8635;`, `&#8681;`, `&#128273;`, `&#9788;` at `index.html:20-26`) and a CSS `::before { content: "🔗 "; }` (`styles.css:579`) — there is no SVG-icon module or sprite sheet to extend. A coherent inline-SVG icon set (Requirement 7) is a genuinely new asset convention; given the zero-build-step constraint, the natural landing spot is either inline `<svg>` markup directly in `index.html`/`app.js` template strings (consistent with the current no-bundler pattern) or a small set of standalone `.svg` files under a new `src/electron/public/icons/` directory (ships automatically since the whole `public/` tree is copied verbatim via `extraResources`).
- **Undefined CSS custom properties `--text-muted` and `--link`**: referenced today at `app.js:2209`, `app.js:2218`, `app.js:2219`, and `index.html:335`, but **never declared** in either theme block of `styles.css`. These currently resolve to the browser's initial/inherited value (effectively invisible styling bugs, likely rendering as default black/inherited text color instead of a dim/link color). The redesign's new token system must define both variables in the same convention as the existing 29-per-theme set, closing this pre-existing gap as part of the rebuild rather than as separate scope.

## 5. Notes

- **`highlight.js` and `marked` are declared as npm `dependencies` in `package.json` but appear unused in any `src/**/*.ts` import** (`grep` for `from "marked"`/`from "highlight.js"`/`require(...)` across `src/` returned zero matches). The renderer instead loads both from `cdnjs.cloudflare.com` with pinned versions (11.9.0 / 12.0.0) and SRI hashes (`index.html:9-10,377-378`), which do not match the npm-pinned versions (`^11.11.1` / `^17.0.5`). This pre-existing drift is orthogonal to this request (bundling is explicitly out of scope) but worth flagging for a future dependency-hygiene pass.
- **No ESLint/Prettier/lint tooling detected** anywhere in the repo root (no `.eslintrc*`, `.prettierrc*`, no `lint` script in `package.json`) — `lint_command` is genuinely `null`, not undetected; there is no lint gate to run before/after this redesign.
- **`docs/design/plan-013-macos-standalone-app.md` does not mention window chrome** (`titleBarStyle`, traffic lights, vibrancy) at all — it only covers `electron-builder` packaging (`extraResources`, `dist:mac` script, DMG output). The redesign's window-chrome requirement (Requirement 2 / AC-2) is new ground relative to that plan and should be recorded as a plan addendum or new plan file per the project's `docs/design/plan-NNN-...` convention, not folded silently into plan-013.
- **Renderer test coverage exists but is narrow**: only `tests/unit/html-view.test.ts` and `tests/unit/zip-download-ui.test.ts` exercise renderer JS (via `happy-dom` + `new Function(source)` eval of the raw file) — `app.js` itself (2,917 lines, the bulk of the DOM contract) has **no** existing unit test. AC-4's mandated DOM-contract check (a new `test_scripts/` script) will be the first automated coverage over `app.js`'s selector surface.
