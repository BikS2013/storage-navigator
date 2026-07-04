---
slug: macos-ui-redesign
category: Development
created: 2026-07-04
refined_by: request-refiner
status: refined
source: user (verbatim in "Original Request")
---

# Refined Request: Modern macOS-Native UI Redesign of the Storage Navigator Electron App

## Category
Development (frontend/renderer visual and structural rebuild)

## Objective
Rebuild the visual layer of the Storage Navigator Electron desktop app — currently a flat, VS-Code-style vanilla HTML/CSS/JS renderer under `src/electron/public/` — into a modern, visually interesting interface aligned with the macOS 26 (Tahoe) design language: Liquid-Glass-style translucent materials, refreshed toolbar and sidebar treatments, SF Pro system typography, full light + dark appearance support, and native traffic-light window-chrome integration. Every existing feature must keep working exactly as it does today; this is a redesign of HOW the app looks and feels, not WHAT it does.

## Current State (baseline established during refinement)

| Asset | Location | Facts relevant to the redesign |
|---|---|---|
| Markup | `src/electron/public/index.html` (383 lines) | Header toolbar, tree sidebar + drag resizer + content pane, **13 modals**, **4 context menus**. Significant inline `style="..."` attributes scattered through modal markup. Unicode glyphs (✎ ↻ 🗑 🔑 ☀ …) used as button icons. Loads highlight.js 11.9.0 (github-dark + github light stylesheets, swapped by theme) and marked 12.0.0 from CDN. |
| Styles | `src/electron/public/styles.css` (667 lines) | ~29 CSS custom properties per theme; dark is `:root` default, light via `[data-theme="light"]`. Flat dark palette, 3–4 px radii, no materials/translucency, no macOS control styling. |
| Behavior | `src/electron/public/app.js` (~2,917 lines vanilla JS) | **204** `getElementById`/`querySelector` references and **148** `createElement`/`className`/`classList` sites — the DOM contract is ID/class-based and tightly coupled. Theme persisted in `localStorage["sn-theme"]` (default `"dark"`), applied as `data-theme` on `documentElement` (app.js:163–169). |
| Aux renderer JS | `src/electron/public/html-view.js` (5 DOM refs), `src/electron/public/zip-download-ui.js` (9 class/createElement sites) | Both inject styled DOM (HTML-viewer toolbar, ZIP progress UI) that must be restyled consistently. |
| Window chrome | `src/electron/main.ts` (BrowserWindow at lines 192–203) | 1400×900, stock title bar, title `"Storage Navigator — port <port>"`, no `titleBarStyle`, no vibrancy, no `nativeTheme` integration. |
| Packaging | `release/mac-arm64`, plan-013 | electron-builder mac-arm64 build; `src/electron/public/` ships verbatim via `extraResources`, so renderer-only changes need no TS rebuild; `main.ts` changes require `tsc`. |

## Scope

**In scope**
- Full visual/structural rebuild of `index.html` and `styles.css` (layout regions, all 13 modals, all 4 context menus, all interactive states, empty/placeholder states).
- Lockstep updates to `app.js`, `html-view.js`, and `zip-download-ui.js` **only where** the DOM structure or class/ID contract changes, plus restyling of the DOM those scripts inject (tree items, viewers, links panels, ZIP progress, HTML-viewer toolbar).
- Minimal `src/electron/main.ts` window-chrome changes needed for macOS-native integration: hidden-inset title bar with traffic lights overlaying the app toolbar, renderer drag regions, and (optionally) system-appearance detection.
- A coherent replacement icon set (SF-Symbols-style inline SVG) for the current Unicode glyph buttons and tree/context-menu icons.
- Full light + dark theme token systems redesigned for the new visual language, including the highlight.js light/dark stylesheet swap and all content viewers (markdown, code, JSON, tables, DOCX, HTML iframe, images).

**Out of scope**
- Any framework migration (React/Vue/Svelte/etc.) — the renderer stays vanilla HTML/CSS/JS.
- Any functional or behavioral change to features (browsing, editing, create/rename/delete, ZIP download, repo link/sync/diff, publish/reverse-links, tokens, GitHub Apps, storage add/delete, API-backend connect, OIDC login).
- CLI, TUI, agent, `API/` service, `src/electron/server.ts` backend logic, core modules, and IPC surface.
- Windows/Linux chrome parity (the shipped target is macOS arm64; the app must merely not crash elsewhere).
- Code signing / notarization / packaging changes beyond what window-chrome changes require.
- Replacing the CDN-hosted highlight.js/marked assets with bundled copies.
- Fixing pre-existing functional pending items in `Issues - Pending Items.md` (e.g., token-expiry badge in UI, link-dialog token dropdown) — unless a chosen layout naturally accommodates them at zero extra cost, they remain separate work items.

## Requirements

1. **macOS 26 (Tahoe) design language.** The redesigned UI must exhibit: translucent "glass" materials (CSS `backdrop-filter` blur/saturation) on the toolbar, sidebar, modals, and context menus; continuous, larger corner radii; layered depth (shadow + material hierarchy); SF Pro via the system font stack (`-apple-system` first); and macOS-styled controls (buttons, selects, text inputs, checkboxes, focus rings) in place of the current flat generic controls.
2. **Native window-chrome integration.** The BrowserWindow must use a hidden-inset title bar so the macOS traffic lights sit inside the app's toolbar row; the toolbar must declare a draggable region (`-webkit-app-region: drag`) with interactive controls excluded; window content must render correctly in normal, maximized, and native fullscreen states.
3. **Complete light + dark appearance support.** Both themes must be fully redesigned (no leftover legacy tokens); on first launch the app follows the system appearance, and the existing manual toggle is retained as an override persisted under the existing `sn-theme` mechanism (or a documented migration of it). The highlight.js theme swap must keep tracking the active appearance.
4. **DOM-contract integrity.** Every element ID and class hook referenced by `app.js` (204 query sites), `html-view.js`, and `zip-download-ui.js` must resolve after the rebuild — preserved verbatim or updated in lockstep in the same change. No orphaned selectors.
5. **All 13 modals restyled as macOS-style sheets/panels** (material background, standard title/body/action layout, consistent button ordering with the primary action rightmost) and **all 4 context menus restyled as macOS-style menus** (material, rounded, hover highlight, destructive items visually distinct).
6. **Inline-style elimination.** The inline `style="..."` attributes currently embedded in `index.html` modal markup are moved into `styles.css` classes as part of the rebuild.
7. **Iconography.** Unicode glyph buttons are replaced by a consistent inline-SVG icon set with SF-Symbols-like weight and sizing; icons must render crisply at 1x/2x and recolor correctly in both themes.
8. **Content-viewer consistency.** Markdown, code (highlight.js), JSON, table, DOCX, HTML-iframe, and image views — plus the editor (Edit/Save/Cancel) state — must be restyled to match the new language in both themes, including the ZIP-download progress UI and the HTML-viewer toolbar injected from JS.
9. **Accessibility floor.** Body text and interactive labels meet WCAG AA contrast (≥ 4.5:1) in both themes; keyboard focus is visibly indicated on all interactive controls; existing keyboard behaviors (e.g., Esc/Enter in modals, tree interaction) are preserved.
10. **Zero functional regression.** Every feature in the smoke checklist (Acceptance Criteria, AC-3) works identically before and after.
11. **Performance.** Translucent materials must be applied judiciously so tree scrolling and large file rendering remain smooth; no perceptible interaction lag versus the current UI on the mac-arm64 target.
12. **Dependency discipline.** Prefer zero new runtime dependencies (inline SVG, plain CSS). Any dependency that is added must pass the project's dependency-vetting procedure (CLAUDE.md `<dependency-vetting>`) before entering `package.json`.

## Constraints

- **Technical**: renderer remains vanilla HTML/CSS/JS (no build step for `public/`); Electron main-process changes limited to window-chrome/appearance options in `main.ts`; the `extraResources` packaging path for `public/` must remain valid; changes to `main.ts` require `tsc` (`npm run dist:mac` flow per plan-013).
- **Process** (project CLAUDE.md): downstream phases required before implementation — codebase scan (`codebase-scanner`), plan under `docs/design/plan-NNN-…`, design recorded in `docs/design/project-design.md`, functional notes in `docs/design/project-functions.md`; no version-control operations unless explicitly requested; test scripts go in `test_scripts/`; no configuration fallback values.
- **Platform**: primary and only supported visual target is macOS (darwin/arm64 packaged app + `npm run ui` dev flow).
- **Compatibility**: `localStorage["sn-theme"]` persistence must not be silently discarded — existing users' theme choice is respected or migrated deliberately.

## Acceptance Criteria

- **AC-1 — Visual language**: Side-by-side inspection of toolbar, sidebar, content pane, one representative modal, and one context menu shows translucent material backgrounds, macOS-style controls, SF Pro system typography, and continuous rounded corners, in BOTH light and dark appearance. (Demonstrable via screenshots of both themes.)
- **AC-2 — Window chrome**: Launching the app on macOS shows traffic lights embedded in the app toolbar (no separate stock title bar); the toolbar area drags the window; buttons/selects inside it remain clickable; fullscreen and restore render without layout breakage.
- **AC-3 — Feature smoke checklist (all pass, no console errors)**: select/add/delete storage (both Direct and API tabs); expand containers/folders in the tree; drag the panel resizer; open a text, JSON, markdown, code, HTML, and image file; edit-save-cancel a file; create, rename, delete a file; delete a folder; download a file; download a folder and a container as ZIP with visible progress; open Link-to-Repo, Links panel (Diff All / Sync All buttons render), Sync confirm; open Publish modal and Reverse Links panel; add a PAT token; open GitHub Apps and Add GitHub App modals; open all four context menus (file, folder, container, storage-account); toggle theme.
- **AC-4 — DOM contract**: an automated check (script in `test_scripts/`) confirms every ID queried in `app.js`, `html-view.js`, and `zip-download-ui.js` exists in the final `index.html` or is created at runtime by the same scripts; zero unresolved selectors.
- **AC-5 — Appearance behavior**: with no stored preference the app matches the current macOS system appearance on launch; the manual toggle overrides it and survives an app restart.
- **AC-6 — Accessibility**: contrast measurements for body text, dimmed text, and primary buttons meet ≥ 4.5:1 in both themes; tabbing through a modal shows a visible focus indicator on every control.
- **AC-7 — Hygiene**: `index.html` contains no inline `style="..."` attributes; no Unicode-glyph icon buttons remain.
- **AC-8 — Packaging**: the mac-arm64 packaged app (`npm run dist:mac`, per plan-013) launches and renders the new UI identically to the dev flow (`npm run ui`).

## Assumptions

- **Renderer-only rebuild, no framework**: The redesign rebuilds HTML/CSS with lockstep JS selector updates; no framework migration. (Basis: explicit dispatch context; also proportional — app.js's 2,917 lines of working logic are out of redesign scope.)
- **"Latest macOS design guidelines" = macOS 26 Tahoe / Liquid Glass**: interpreted as translucent materials, refreshed toolbar/sidebar, SF Pro, light+dark, traffic-light chrome integration. (Basis: dispatch context definition; current date mid-2026.)
- **Glass effect is CSS-emulated by default**: `backdrop-filter` within an opaque window, with hidden-inset title bar, rather than a fully transparent/vibrancy BrowserWindow — native vibrancy risks content readability and is left as an implementation-phase option. (Basis: HOW-level decision deferred per refinement rules; see Open Question Q1.)
- **System-appearance default is a deliberate small behavior change**: today's default is hard-coded `"dark"`; following the OS by default better matches macOS guidelines. Manual toggle retained. (Basis: requirement 3; flagged in Q2 for override.)
- **Minimal main.ts changes are in scope** even though the request says "UI": traffic-light integration is unattainable from the renderer alone. (Basis: dispatch context names native window chrome as part of the target language.)
- **CDN-loaded highlight.js/marked stay as-is**: already the status quo; bundling them is orthogonal to the redesign.
- **Existing window title string ("Storage Navigator — port N") may be visually hidden** by the hidden-inset chrome; the port remains discoverable via the window title (mission control / app switcher). No new port indicator is required.
- **Windows/Linux appearance is untested and unsupported**: only "does not crash" applies off-macOS. (Basis: only a mac-arm64 build exists.)
- **Pre-existing UI pending items** (token-expiry badge, link-dialog token dropdown) are NOT folded into this request. (Basis: scope discipline; they are functional additions, not restyling.)

## Open Questions

- **Q1 — Native vibrancy vs CSS-only glass**
  - **Question**: Should the redesign use Electron's native `vibrancy`/transparent-window materials, or emulate Liquid Glass purely with CSS `backdrop-filter` inside an opaque window?
  - **Why it matters**: Native vibrancy shows the desktop through the window (truest to macOS 26) but risks readability, complicates screenshots/screen-sharing, and adds main-process/window-lifecycle complexity. CSS emulation is lower-risk and fully renderer-controlled but the translucency only reveals in-app layers, not the desktop.
  - **Recommended default**: CSS-emulated glass with hidden-inset title bar; native vibrancy only as an optional enhancement if it proves stable during implementation.
- **Q2 — Default appearance behavior**
  - **Question**: Confirm switching the first-launch default from hard-coded dark to follow-the-system appearance (manual toggle retained as override).
  - **Why it matters**: Changes what existing users without a stored preference see after updating; it is the only user-visible behavior change in this request.
  - **Recommended default**: Yes — follow system appearance by default; keep manual override persisted in `sn-theme`.
- **Q3 — Theme toggle form**
  - **Question**: Should the toggle become a three-state control (System / Light / Dark) or stay a two-state Light/Dark switch (where "system" only applies until the first manual toggle)?
  - **Why it matters**: Three-state matches macOS conventions but slightly changes the stored-preference semantics; two-state is the minimal-change option.
  - **Recommended default**: Two-state toggle; unset preference means "follow system". (Cheapest; can be upgraded later.)

## Original Request

> I want you to examine the ui of the current application and rebuild it to make it modern, visually interesting, and aligned to the latest macos design guidelines
