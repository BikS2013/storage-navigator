---
status: complete
plan_number: 014
slug: macos-ui-redesign
request_file: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-macos-ui-redesign.md
investigation_file: null
research_files:
  - /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/research/macos-tahoe-design-for-electron.md
codebase_scan_file: /Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-macos-ui-redesign.md
based_on_commit: 008ddaeee515af7e4082478626333ae787b63444
scan_commit_match: true
steps: 17
open_questions: 0
files_to_create:
  - test_scripts/check-dom-contract.mjs
files_to_modify:
  - src/electron/main.ts
  - src/electron/public/styles.css
  - src/electron/public/index.html
  - src/electron/public/app.js
  - docs/design/project-design.md
  - docs/design/project-functions.md
  - "Issues - Pending Items.md"
implementation_units:
  - name: window-chrome
    steps: [1]
    files: [src/electron/main.ts]
  - name: dom-contract-tooling
    steps: [2]
    files: [test_scripts/check-dom-contract.mjs]
  - name: renderer-restyle
    steps: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    files:
      - src/electron/public/styles.css
      - src/electron/public/index.html
      - src/electron/public/app.js
  - name: documentation
    steps: [15, 16, 17]
    files:
      - docs/design/project-design.md
      - docs/design/project-functions.md
      - "Issues - Pending Items.md"
build_command: npm run build
test_command: npm test
created_at: 2026-07-04T03:05:49Z
---

# Plan 014 — macOS Tahoe UI Redesign of the Storage Navigator Electron Renderer

## Objective

Rebuild the visual layer of the Electron desktop app (`src/electron/public/`) into a macOS 26 (Tahoe / Golden-Gate-corrected) design: CSS-emulated glass inside an opaque window, hidden-inset title bar with traffic lights in a 52px drag-region toolbar, full light+dark appearance with system-default on first launch, hand-authored inline-SVG iconography, all 13 modals as macOS sheets and all 4 context menus as macOS menus — with zero functional regression and a fully preserved DOM contract. Serves the refined request `macos-ui-redesign` (AC-1 … AC-8).

## Context

- Refined request (scope, 8 acceptance criteria): @/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/refined-request-macos-ui-redesign.md
- Codebase scan (module map, DOM contract, build/test commands, in-scope files): @/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/reference/codebase-scan-macos-ui-redesign.md
- Technical research (metrics, CSS recipes, Electron window options): @/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator/docs/research/macos-tahoe-design-for-electron.md
- Investigation: skipped (single obvious approach — in-place restyle of the vanilla renderer; explicit-skip per pipeline rules).

Scan freshness: `last_scanned_commit` `008ddae…` equals current `HEAD` — the scan is current; all file:line citations below are trustworthy.

**Chosen approach (fixed — decisions already made by the orchestrator, do not reopen):**

1. **Q1 resolved:** CSS-emulated glass inside an OPAQUE window. NO native `vibrancy`, NO `transparent: true`, NO `nativeTheme`/accent IPC, `src/electron/preload.cjs` untouched.
2. **Q2 resolved:** with `localStorage["sn-theme"]` unset, follow the system appearance via `window.matchMedia("(prefers-color-scheme: dark)")` (and keep following it until first manual toggle); the manual toggle persists to `sn-theme` exactly as today.
3. **Q3 resolved:** the theme toggle stays two-state (light/dark).
4. `main.ts` changes are ONLY `titleBarStyle: "hiddenInset"` + `trafficLightPosition` on the existing BrowserWindow options (lines 192–203). The window `title` string stays (hidden by the chrome).
5. Toolbar = 52px drag-region header (`-webkit-app-region: drag`, `no-drag` on all interactive children, ~84px left padding for traffic lights).
6. Icons = hand-authored inline SVG (Lucide-style geometry, `stroke="currentColor"`, stroke-width 1.5, 24×24 viewBox rendered at 16–18px). NO new npm dependency.
7. `styles.css` is REWRITTEN as a macOS design system, but every legacy CSS custom-property name is preserved as an alias; `--text-muted` and `--link` (previously undefined — scan §4 "New Integration Points") are added.
8. Native overlay scrollbars: all `::-webkit-scrollbar` styling removed.
9. All element IDs in `index.html` preserved VERBATIM. Existing class names kept; new classes are additive.
10. `prefers-reduced-transparency` gets opaque fallbacks for every glass surface.
11. AC-4 gate = new Node script `test_scripts/check-dom-contract.mjs`.

**Chevron decision (directive asked the plan to pick ONE approach after checking call sites — verified and decided):** app.js writes the ▶/▼ disclosure glyphs at 20 sites (`app.js:332, 337, 343, 380, 385, 391, 427, 432, 437, 483, 488, 493, 570, 600, 607, 614, 714, 720, 726, 1311`). Every one of these sites toggles the sibling `.tree-children`'s `expanded` class in lockstep (verified, incl. the outlier `app.js:1310–1311`). Therefore: **pure-CSS treatment, zero app.js chevron edits** — hide the glyph text (`.tree-toggle { font-size: 0; }`) and draw a macOS chevron via `::before` keyed off `.tree-node:has(> .tree-children)` (collapsed, pointing right) and `.tree-node:has(> .tree-children.expanded)` (rotated 90°). `:has()` is fully supported in Electron 41's Chromium. Leaf nodes have no `.tree-children` sibling, so they correctly get no chevron.

**Deliberately untouched files (verified feasible):** `src/electron/public/html-view.js` and `src/electron/public/zip-download-ui.js` need NO edits — their injected DOM already carries stable class hooks (`.html-view-toolbar` + plain `button` children at `html-view.js:43–86`, `.zip-dl-indicator/.zip-dl-box/.zip-dl-spinner/.zip-dl-label/.zip-dl-detail/.zip-dl-cancel` at `zip-download-ui.js:24–44`) that steps 6–7 restyle via descendant selectors. This also keeps `tests/unit/html-view.test.ts` and `tests/unit/zip-download-ui.test.ts` green without modification. If implementation discovers a class addition is truly unavoidable there, it is an in-step deviation that MUST include the lockstep test update (see Deviation Rules).

No configuration settings are introduced by this plan; the config-no-fallback project rule is not triggered (the theme-default change is the approved Q2 behavior decision, not a configuration fallback).

## Open Questions

none — all three open questions from the refined request were resolved by the orchestrator per the recommended defaults (see Context).

## Steps

### Step 1 — Window chrome: hidden-inset title bar

- **depends_on:** —
- **files:** `src/electron/main.ts` (modify)
- **action:** In the `BrowserWindow` options object (`src/electron/main.ts:192–203`) add exactly two properties: `titleBarStyle: "hiddenInset"` and `trafficLightPosition: { x: 20, y: 18 }` (tune y ±2px against the final 52px toolbar during step 14's visual check; research §1 derives 18–19). Change NOTHING else: keep `width/height/title/icon/webPreferences` as-is, leave the `routeExternal` handler (`main.ts:212–224`), all IPC handlers, and `preload.cjs` untouched. Do NOT add `vibrancy`, `transparent`, `backgroundColor`, `minWidth`, or `nativeTheme` wiring.
- **verify:** `npm run build` exits 0 (tsc clean); `grep -n "hiddenInset\|trafficLightPosition" src/electron/main.ts` shows both options inside the BrowserWindow constructor and nowhere else.
- **done:** tsc is clean and the BrowserWindow options differ from baseline by exactly the two new properties.

### Step 2 — Create the DOM-contract check script (AC-4 gate, built BEFORE the rebuild so it guards every later step)

- **depends_on:** —
- **files:** `test_scripts/check-dom-contract.mjs` (create)
- **action:** Plain Node ESM script, zero dependencies (project is `"type": "module"`). It must: (a) read `src/electron/public/app.js`, `html-view.js`, `zip-download-ui.js` and extract every ID referenced via `getElementById("…"| '…')` and via `querySelector`/`querySelectorAll` string literals that start with `#` (take the leading ID token, stripping descendant/attribute/class tails); (b) read `src/electron/public/index.html` and collect all `id="…"` definitions; (c) collect dynamically-created IDs from the same three JS files (`.id = "…"`, `setAttribute("id", "…")`, and `id="…"` occurrences inside JS string literals / innerHTML templates — e.g. `zip-download-indicator`, `zip-dl-detail`, `zip-dl-cancel` from `zip-download-ui.js:28–39`); (d) keep an explicit `ALLOWLIST` const (empty initially, each future entry requiring a justification comment) for non-literal cases; (e) print every unresolved ID and exit 1 if any exist, otherwise print the resolved-ID count and exit 0.
- **verify:** `node test_scripts/check-dom-contract.mjs` exits 0 against the CURRENT (pre-redesign) tree — proving zero false positives before any markup changes.
- **done:** script exists, passes on the baseline, and prints a non-trivial resolved count (expect on the order of the scan's 204 query sites deduplicated).

### Step 3 — styles.css rewrite part 1: token system, aliases, typography, base

- **depends_on:** —
- **files:** `src/electron/public/styles.css` (modify — begin full rewrite)
- **action:** Replace the reset/variables/base region (current lines 1–70) with the new design system: **(a) macOS tokens** per research §4 — `--label`, `--label-2`, `--label-3`, `--label-4`, `--separator`, `--content-bg`, `--window-bg`, `--sidebar-tint`, `--toolbar-tint`, `--menu-bg`, `--control-bg`, `--control-border`, `--hover-fill`, `--selected-fill`, `--accent` (static `#007aff` light / `#0a84ff` dark — no accent IPC per decision 1), `--accent-text`, `--destructive`, plus `--font-ui`/`--font-mono` stacks. Dark values live in `:root` (default) AND `[data-theme="dark"]`; light values live in `[data-theme="light"]` AND duplicated inside `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` — comment that the two light blocks must always be edited together. Set `color-scheme: dark`/`light` in the matching blocks. **(b) Legacy alias section** in `:root`: EVERY custom property declared in the old file (`--bg-primary/-secondary/-tertiary/-hover/-active`, `--border`, `--text`, `--text-dim`, `--text-accent`, `--text-filename`, `--btn-bg`, `--btn-primary`, `--btn-primary-hover`, `--input-bg`, `--json-key/-string/-number/-bool`, `--code-bg`, `--table-border`, `--table-header`, `--expiry-ok/-warn/-expired`, `--scrollbar-thumb` — old lines 4–58) is preserved as an alias resolving to new-token `var()` references (aliases then re-resolve per theme automatically), PLUS the previously-undefined `--text-muted` (→ `var(--label-2)`) and `--link` (→ `var(--accent)`), closing the scan-flagged gap consumed at `app.js:2209/2218/2219` and `index.html:335`. JSON/filename/expiry accent hues may keep tuned literal values per theme where no semantic token fits — but the alias NAMES must all exist. **(c) Typography/base:** `body { font-family: var(--font-ui); font-size: 13px; -webkit-font-smoothing: antialiased; }`, global `:focus-visible` accent halo (research §5.5), `accent-color: var(--accent)` for checkbox/radio/range/progress. **(d)** DELETE the `::-webkit-scrollbar` rules (old lines 68–70) and add none anywhere in the rewritten file (decision: native overlay scrollbars).
- **verify:** alias completeness — `for v in $(grep -oh 'var(--[a-z0-9-]*' src/electron/public/app.js src/electron/public/index.html src/electron/public/html-view.js src/electron/public/zip-download-ui.js | sed 's/var(//' | sort -u); do grep -q -- "${v}:" src/electron/public/styles.css || echo "MISSING ${v}"; done` prints nothing (baseline set: `--border --expiry-expired --expiry-warn --input-bg --link --text --text-dim --text-muted`); `grep -c '::-webkit-scrollbar' src/electron/public/styles.css` → 0; `grep -c 'prefers-color-scheme' src/electron/public/styles.css` ≥ 1.
- **done:** new token blocks + full alias set present, scrollbar styling gone, media block for unset `data-theme` present.

### Step 4 — styles.css rewrite part 2: chrome & layout regions

- **depends_on:** 3
- **files:** `src/electron/public/styles.css` (modify)
- **action:** Restyle the layout regions keeping ALL existing selector names: **(a) Toolbar** — `header` becomes the 52px glass toolbar: `-webkit-app-region: drag` + `user-select: none`; `-webkit-app-region: no-drag` on ALL interactive descendants (`header button, header select, header input, header [role="button"]`); `padding-left: 84px` traffic-light reserve; `background: var(--toolbar-tint)` + `backdrop-filter: blur(20px) saturate(1.8)` (+ `-webkit-` twin); hairline bottom `box-shadow: inset 0 -0.5px 0 var(--separator)`; `h1` restyled as the 13px/600 window title. Preferred geometry so the glass visibly reads: fix the header at the top (52px, full width, z-index above `#main`) and give the sidebar/content SCROLL CONTAINERS (`#tree-content`, `#content-body` — inside the scrollable area, not on `#main`) a 52px top inset so tree rows and file content scroll beneath the blur. Fallback if this fights the `#resizer` drag layout: keep the header in flow (glass still reads on menus/sheets/zip indicator). **(b) Sidebar** — `#tree-panel` gets `var(--sidebar-tint)`; `#tree-header` as an 11px/600 `--label-2` section header; tree rows on the EXISTING classes `.tree-item` (28px height, 8px radius, `--hover-fill` hover, accent fill + white text on `.active` — research §5.11), `.tree-name`, `.tree-meta` (footnote 10px `--label-2`), `.tree-icon` sized for 16–17px SVGs, `.tree-children`/`.expanded` show/hide unchanged. **(c) Chevrons (chosen approach, zero JS):** `.tree-toggle { font-size: 0; width: 16px; }` to hide the app.js glyph writes; chevron drawn via `.tree-node:has(> .tree-children) > .tree-item .tree-toggle::before` (CSS-mask or border chevron in `--label-2`, pointing right) rotated 90° under `.tree-node:has(> .tree-children.expanded) > .tree-item .tree-toggle::before`, with a 150ms transform transition (disabled later under reduced motion). **(d)** `#resizer` slimmed with a hover affordance; `#content-panel` opaque `var(--content-bg)` with a 0.5px hairline against the sidebar; `#content-header` with title/meta type per research §3; `.placeholder` empty-state styling.
- **verify:** `grep -n -- '-webkit-app-region: drag' src/electron/public/styles.css` (exactly the header) and `grep -c -- 'no-drag' src/electron/public/styles.css` ≥ 1; `grep -n ':has(> .tree-children' src/electron/public/styles.css` shows both collapsed and `.expanded` rules.
- **done:** all layout-region selectors restyled; drag region + chevron rules present; no `#`-ID or class renamed.

### Step 5 — styles.css rewrite part 3: controls

- **depends_on:** 3
- **files:** `src/electron/public/styles.css` (modify)
- **action:** Restyle every control on its EXISTING selector: `.icon-btn` (28×28 hit area, 16px glyph slot, radius 6, `--hover-fill` hover — research §6); `.primary` modifier = accent-filled per research §5.3 (subtle top-light gradient, white text); generic/`.edit-btn` buttons as capsule bordered buttons (24px height, `border-radius: 999px`, 0.5px `--control-border`); selects — `#storage-select` and a NEW `.form-select` class (for the modal selects that currently carry inline styles) styled as macOS popup buttons per research §5.7; text inputs/textareas per §5.5 (26px, radius 6, focus ring = accent border + 3.5px halo); `.tab-bar`/`.tab-btn` as a segmented control per §5.4 (`aria-pressed`-free variant keyed on the existing `.active` class); REPLACE `styles.css:579` `.tab-btn[data-tab="api"]::before { content: "🔗 "; }` with an inline-SVG mask/background (or drop the icon) — no emoji may remain in the stylesheet; status-line classes (`.status-error` et al., old lines ~551–554) restyled but semantically unchanged (inline-status convention from scan §3 preserved); expiry badge classes fed by the `--expiry-*` aliases; `.sync-badge` as a small accent-tinted capsule badge.
- **verify:** `grep -c '🔗' src/electron/public/styles.css` → 0; `grep -n '\.form-select' src/electron/public/styles.css` present; `grep -n '\.tab-btn\|\.icon-btn\|\.edit-btn\|\.sync-badge\|\.status-error' src/electron/public/styles.css` all present.
- **done:** every control selector from the old file has a restyled rule; `.form-select` exists for step 9's inline-style migration.

### Step 6 — styles.css rewrite part 4: sheets, context menus, inline-style replacement classes, zip indicator

- **depends_on:** 3
- **files:** `src/electron/public/styles.css` (modify)
- **action:** **(a) Modals as sheets:** `.modal` overlay dim (`rgba(0,0,0,.25)` light / `.45` dark), `.modal-content` as macOS sheet per research §5.9 — radius 13, OPAQUE `var(--content-bg)` body, layered shadow + 0.5px ring, `sheet-in` 180ms animation, title 15px/600, body text 13px, `.modal-actions` right-aligned with primary rightmost. **(b) Inline-style replacement utilities (for step 9):** enumerate every one of the 38 `style="…"` sites in the current `index.html` (concentrated at lines 72, 118–119, 131–133, 145–146, 159, 164, 176, 189, 229, 231, 239–262, 311, 313–315, 325, 331, 335 per the scan) and define ONE semantic class per repeated pattern — expected set (final names at implementer's discretion, documented in a CSS section comment): `.form-select` (from step 5), `.field-hint` (the `--text-muted` small print, e.g. line 335), `.modal-status`, `.form-block`, `.modal-subtext`, `.checkbox-row`. **(c) Context menus:** `.context-menu` per research §5.8 — `var(--menu-bg)` + `backdrop-filter: blur(40px) saturate(1.8)`, radius 12, 5px padding, items 26px/radius 6 with SNAP (no transition) full-accent hover + white text, `.destructive` items in `var(--destructive)`, hairline separators. **(d) Zip indicator:** restyle the EXISTING `.zip-dl-indicator`, `.zip-dl-box` (small floating glass panel, radius 12, menu material), `.zip-dl-spinner`, `.zip-dl-label`, `.zip-dl-detail`, `.zip-dl-cancel` classes — `zip-download-ui.js` itself is NOT edited.
- **verify:** `grep -n 'sheet-in\|\.context-menu\|\.destructive\|\.field-hint\|\.zip-dl-box' src/electron/public/styles.css` all present.
- **done:** sheet/menu/utility/zip rules present; the utility-class inventory is documented in a comment block for step 9 to consume.

### Step 7 — styles.css rewrite part 5: content viewers, accessibility media blocks, final sweep

- **depends_on:** 4, 5, 6
- **files:** `src/electron/public/styles.css` (modify — completes the rewrite)
- **action:** **(a) Viewers:** restyle markdown, code (`--code-bg` alias; hljs CDN sheet supplies token colors), JSON (json-* aliases), table (hairline borders, `--table-header`), DOCX, image, and editor (Edit/Save/Cancel states, `#content-edit-controls`, `.edit-status`) surfaces; `.html-view-toolbar` + its buttons styled via DESCENDANT selectors (`.html-view-toolbar button` — `html-view.js:43–86` emits classless buttons; do not touch the JS); `.html-view` iframe frame; monospace content at 12px `var(--font-mono)`. **(b) Accessibility blocks:** `@media (prefers-reduced-transparency: reduce)` — remove `backdrop-filter` and switch toolbar/sidebar/menu/sheet/zip-box backgrounds to opaque `var(--window-bg)`/`var(--content-bg)` (decision 9); `@media (prefers-reduced-motion: reduce)` — kill `sheet-in` and the chevron transition; `@media (prefers-contrast: more)` — bump `--separator` alpha to 0.25 and hairlines to 1px. **(c) Final sweep:** walk the OLD styles.css section-by-section and confirm every class emitted by `app.js`/`html-view.js`/`zip-download-ui.js` `createElement`/`className` sites (148 sites per scan — e.g. `.tree-*`, `.sync-badge`, `.placeholder`, links/diff-panel classes, `.zip-dl-*`, `.html-view*`) still has a rule in the new file; nothing referenced by JS may be dropped. Token contrast check for AC-6: verify `--label` on `--content-bg` and `--accent-text` on `--accent` compute ≥ 4.5:1 in BOTH themes (adjust token values, not structure, if short).
- **verify:** `grep -n 'prefers-reduced-transparency\|prefers-reduced-motion\|prefers-contrast' src/electron/public/styles.css` all present; spot check `grep -n '\.tree-meta\|\.sync-badge\|\.zip-dl-spinner\|\.html-view-toolbar\|\.placeholder' src/electron/public/styles.css` all present.
- **done:** styles.css rewrite complete: tokens + aliases + regions + controls + overlays + viewers + a11y blocks; no emoji, no `::-webkit-scrollbar`, no orphaned JS-emitted class.

### Step 8 — index.html rebuild part 1: head, toolbar, main layout

- **depends_on:** 2, 4, 5
- **files:** `src/electron/public/index.html` (modify)
- **action:** Rebuild the head + header + `#main` region (current lines 1–58). Keep the `<head>` VERBATIM in function: `styles.css` link, favicon, and the two hljs CDN links WITH their `id="hljs-dark"`/`id="hljs-light"`, `disabled` attribute, pinned 11.9.0 URLs and SRI hashes (lines 9–10) — untouched (decision 8); same for the marked/hljs `<script>` tags and the `zip-download-ui.js` → `html-view.js` → `app.js` load order at the bottom (lines 377–381). Toolbar: all seven button IDs verbatim (`#add-storage-btn`, `#delete-storage-btn`, `#create-btn`, `#refresh-btn`, `#export-btn`, `#github-apps-btn`, `#theme-btn`) and `#storage-select`; replace each Unicode glyph content (`+`, `&#128465;`, `&#9998;`, `&#8635;`, `&#8681;`, `&#128273;`, `&#9788;` at lines 20–26) with a hand-authored inline SVG (24×24 viewBox, `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`, rendered 16–18px; Lucide-style geometry: plus, trash, square-pen, rotate-cw, download, key, sun). `#theme-btn`'s SVG is a placeholder — `applyTheme` overwrites it at boot (step 11). Keep every layout ID verbatim: `#app`, `#main`, `#tree-panel`, `#tree-header`, `#tree-content`, `#resizer`, `#content-panel`, `#content-header`, `#content-title`, `#content-meta`, `#content-edit-controls`, `#edit-status`, `#edit-btn`, `#edit-save`, `#edit-cancel`, `#content-body`. Class changes are additive only.
- **verify:** `node test_scripts/check-dom-contract.mjs` exits 0; `grep -c '<svg' src/electron/public/index.html` ≥ 7; hljs links unchanged: `grep -c 'hljs-dark\|hljs-light' src/electron/public/index.html` = 2.
- **done:** toolbar/layout markup rebuilt, seven SVG icon buttons in place, contract script green, head/scripts byte-equivalent in function.

### Step 9 — index.html rebuild part 2: all 13 modals as sheets, inline-style elimination

- **depends_on:** 6, 8
- **files:** `src/electron/public/index.html` (modify)
- **action:** Rebuild all 13 modals — `#add-modal`, `#rename-modal`, `#delete-modal`, `#delete-storage-modal`, `#delete-folder-modal`, `#create-modal`, `#sync-modal`, `#link-modal`, `#links-panel-modal`, `#publish-modal`, `#reverse-links-panel-modal`, `#add-token-modal`, `#github-apps-modal`, `#add-github-app-modal` — to the sheet structure (title / body / `.modal-actions` with the PRIMARY action rightmost; reorder action buttons in markup where Cancel currently sits right). Migrate EVERY inline `style="…"` attribute (38 sites) to the step-6 utility classes (e.g. the `#modal-auth-type` select at line 72 → `.form-select`; the line-335 `<small>` hint → `.field-hint`, now correctly colored since `--text-muted` is defined). Preserve every element ID VERBATIM (all inputs, selects, textareas, status lines, list containers, per-modal buttons — the contract script is the gate). Keep `#add-modal`'s `.tab-bar`/`.tab-btn` `data-tab` attributes and `.tab-body` structure intact (app.js tab switching at `app.js:184+` depends on them). Keep the `.hidden` show/hide mechanism unchanged.
- **verify:** `grep -c 'style="' src/electron/public/index.html` → 0 (AC-7); `node test_scripts/check-dom-contract.mjs` exits 0.
- **done:** 13 sheets rebuilt, zero inline styles in the file, contract green.

### Step 10 — index.html rebuild part 3: the 4 context menus

- **depends_on:** 6, 8
- **files:** `src/electron/public/index.html` (modify)
- **action:** Rebuild `#context-menu` (line 345), `#folder-context-menu` (353), `#container-context-menu` (362), `#storage-account-context-menu` (372) to the macOS menu pattern: keep every menu ID and every menu-item ID verbatim (app.js binds each item — contract script gates this); item rows keep their existing classes with additive styling hooks; add `.destructive` to delete items; optionally prepend 16px inline SVGs from the step-8 icon geometry to items for consistency; separators as hairline elements; the `.hidden` toggle mechanism and the JS-positioned `style.left/top` (set from app.js, not markup) unchanged.
- **verify:** `node test_scripts/check-dom-contract.mjs` exits 0; `grep -c 'destructive' src/electron/public/index.html` ≥ 4; `grep -c 'style="' src/electron/public/index.html` still 0.
- **done:** four menus rebuilt, destructive items marked, contract green.

### Step 11 — app.js surgical patch 1: theme bootstrap (system default) + theme-button SVG

- **depends_on:** 8
- **files:** `src/electron/public/app.js` (modify — ONLY the theme block, lines 163–175)
- **action:** Rework the theme block per resolved Q2/Q3: (a) boot — `const stored = localStorage.getItem("sn-theme");` then resolve `stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")` and apply WITHOUT persisting (replaces line 163's `|| "dark"`). (b) `applyTheme(t, opts)` — keep `document.documentElement.setAttribute("data-theme", t)` and the `#hljs-dark`/`#hljs-light` `.disabled` toggling (lines 171–172) verbatim; replace line 170's `themeBtn.textContent` sun/moon with `themeBtn.innerHTML = <inline sun/moon SVG>` (same icon convention as step 8); call `localStorage.setItem("sn-theme", t)` ONLY when `opts?.persist` is true. (c) click handler (line 175) — toggles and persists (`persist: true`). (d) While NO stored value exists, subscribe to `matchMedia("(prefers-color-scheme: dark)")` `"change"` and re-apply the system theme without persisting; the guard re-checks `localStorage.getItem("sn-theme")` so following stops after the first manual toggle. Keep double-quoted string style (scan §3 conventions). No other app.js region may change in this step.
- **verify:** `grep -n 'prefers-color-scheme' src/electron/public/app.js` shows the bootstrap + listener; `grep -n 'setItem("sn-theme"' src/electron/public/app.js` appears only on the persist path; `node test_scripts/check-dom-contract.mjs` exits 0.
- **done:** unset preference follows the system live; toggle persists exactly as today; theme button renders SVG.

### Step 12 — app.js surgical patch 2: emoji→SVG tree-icon map + sync-badge icon

- **depends_on:** 8
- **files:** `src/electron/public/app.js` (modify)
- **action:** Add a `TREE_ICON_SVG` const map adjacent to `createTreeNode` (`app.js:560`), keyed by the EXISTING emoji strings so all call sites stay untouched — 11 keys (verified inventory): `"🔑"` (key — accounts, `app.js:303`), `"📦"` (container, 356), `"📁"` (folder, 368/457/666), `"📂"` (open share, 415), `"📄"` (file, 462; also `getFileIcon`'s pdf return), `"📋"` (json), `"📝"` (md), `"📃"` (txt), `"📖"` (docx), `"🌐"` (html), `"📎"` (default) — the last six being `getFileIcon`'s returns (`app.js:735–744`, which stays untouched). Values are hand-authored inline-SVG strings in the step-8 convention. In `createTreeNode`, change line 574 from `iconSpan.textContent = icon` to `iconSpan.innerHTML = TREE_ICON_SVG[icon] || TREE_ICON_SVG["📎"]`. Sidebar icons take `color: var(--accent)` tinting from step 4's CSS (Finder-style). Also swap the `.sync-badge` glyph (`badge.textContent = "↻"` at `app.js:630`) to an SVG via `innerHTML`. Chevrons need NO change here (step 4's CSS handles all 20 glyph-write sites). DOCUMENTED EXCEPTION: the `"🔑 "` prefix inside `<option>` HTML at `app.js:2321` STAYS — a native `<option>` cannot render SVG and it is not an icon button, so AC-7 is unaffected; log it in step 17.
- **verify:** `grep -n 'TREE_ICON_SVG' src/electron/public/app.js` present; `node test_scripts/check-dom-contract.mjs` exits 0; `npm test` green (html-view/zip-download-ui suites untouched).
- **done:** tree renders SVG icons from unchanged call sites; badge is SVG; only lines around 560–592 and 630 changed in this step.

### Step 13 — Automated verification gate

- **depends_on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
- **files:** — (verification only)
- **action:** Run the full automated chain (decision 11) and fix nothing new here — regressions route back to the owning step.
- **verify:** `npm run build` exits 0; `node test_scripts/check-dom-contract.mjs` exits 0; `npm test` fully green; AC-7 greps: `grep -c 'style="' src/electron/public/index.html` = 0 and `grep -nE '&#(9998|8635|8681|128273|128465|9788);' src/electron/public/index.html` returns no matches.
- **done:** all four checks pass in one run.

### Step 14 — Manual smoke, appearance behavior, accessibility, packaged app

- **depends_on:** 13
- **files:** — (verification only)
- **action:** `npm run ui`, then walk: **AC-2** — traffic lights inside the toolbar (tune `trafficLightPosition.y` in step 1's file if optically off), toolbar drags the window, every toolbar control clicks, native fullscreen + restore render without breakage (the 84px reserve remains in fullscreen — accepted, no IPC per decision 4). **AC-3** — the full feature checklist from the refined request (storage add/delete both tabs; tree expand; resizer; open text/JSON/markdown/code/HTML/image; edit-save-cancel; create/rename/delete file; delete folder; single download; folder + container ZIP with progress UI; Link-to-Repo, Links panel, Sync confirm; Publish + Reverse Links; add PAT; GitHub Apps + Add GitHub App; all four context menus; theme toggle) with zero console errors. **AC-5** — clear `sn-theme` in DevTools → relaunch matches system appearance and follows a live System-Settings appearance flip; toggle once → survives restart. **AC-6** — tab through a modal (visible focus ring on every control); verify the step-7 contrast pairs with a contrast checker. **AC-1** — capture light + dark screenshots (toolbar, sidebar, content, one sheet, one context menu). **AC-8** — `npm run dist:mac`, launch the packaged app from `release/`, confirm identical rendering (public/ ships verbatim via `extraResources`; confirm no new sibling dirs under `public/` were introduced — icons are inline, so none expected).
- **verify:** checklist above fully passed; screenshots saved for the record (attach paths in the implementer's final report).
- **done:** all manual ACs pass on dev AND packaged builds.

### Step 15 — project-design.md: dated design section

- **depends_on:** 14
- **files:** `docs/design/project-design.md` (modify — append)
- **action:** Append a dated section "2026-07-04 — Plan 014: macOS Tahoe UI redesign" citing the full provenance chain (refined request, research, scan, this plan — absolute paths as in this plan's Context). Record: resolved Q1/Q2/Q3 decisions; the two-option window-chrome change; token architecture + legacy-alias strategy (incl. the `--text-muted`/`--link` gap closure); icon convention (hand-authored inline SVG, emoji-keyed tree map, `<option>` exception); the `:has()` chevron approach; native overlay scrollbars; reduced-transparency/motion/contrast fallbacks; deliberate non-changes (`preload.cjs`, `html-view.js`, `zip-download-ui.js`, unit tests, CDN assets); and the note that plan-013's packaging is unaffected.
- **verify:** `grep -n 'Plan 014' docs/design/project-design.md` shows the section.
- **done:** section appended; no existing content mutated.

### Step 16 — project-functions.md: finalize FR entries

- **depends_on:** 14
- **files:** `docs/design/project-functions.md` (modify)
- **action:** The planner already appended a "Plan 014 — macOS Tahoe UI Redesign" section with FR-UI14-1 … FR-UI14-7 marked "planned". Verify each statement against the implemented behavior (esp. FR-UI14-3's follow-system semantics and FR-UI14-5's script name), correct any drift, and flip the status line from "planned" to "implemented".
- **verify:** `grep -n 'FR-UI14' docs/design/project-functions.md` shows the seven entries; `grep -c 'Status: planned' docs/design/project-functions.md` no longer matches the Plan-014 section.
- **done:** FR section accurate and marked implemented.

### Step 17 — Issues - Pending Items.md sweep

- **depends_on:** 14
- **files:** `Issues - Pending Items.md` (modify)
- **action:** (a) Register as COMPLETED the pre-existing defect "undefined CSS custom properties `--text-muted`/`--link`" (scan §4) — fixed by step 3, with the issue+solution documented per project rule. (b) Add pending/nice-to-have entries deferred by this plan: optional native-vibrancy enhancement (Q1 upgrade path); fullscreen 84px traffic-light padding not collapsed (no IPC by decision — cosmetic); three-state System/Light/Dark toggle upgrade path (Q3); legacy inline-style strings inside app.js innerHTML templates (`app.js:612, 1309, 2209, 2218` — functional via aliases, cosmetic cleanup deferred); the `<option>` emoji exception (`app.js:2321`); the highlight.js/marked npm-vs-CDN version drift (scan Notes — pre-existing, out of scope here). (c) Check whether any existing pending item was incidentally resolved (none expected — token-expiry badge and link-dialog dropdown remain explicitly out of scope per the refined request). Keep pending-first / most-critical-first ordering.
- **verify:** `grep -n 'text-muted' "Issues - Pending Items.md"` shows the completed entry; new pending entries present under the correct ordering.
- **done:** file reflects the redesign's resolved defect and deferred items.

## Implementation Units

Units have pairwise-disjoint file sets. A single implementer executes them in step order; if ever fanned out, units A/B/D are independent of C's files, but note the LOGICAL dependencies: C's steps 8+ depend on B's script existing, and D depends on C's outcome — so parallel fan-out is only useful for A+B alongside C's early CSS steps.

### Unit A — window-chrome
- **steps:** 1
- **files:** `src/electron/main.ts`
- **contract exposed:** hidden-inset chrome; renderer may assume traffic lights occupy the top-left ~84px of the toolbar row.

### Unit B — dom-contract-tooling
- **steps:** 2
- **files:** `test_scripts/check-dom-contract.mjs`
- **contract exposed:** `node test_scripts/check-dom-contract.mjs` exits 0/1; used as the verification command by steps 8–13.

### Unit C — renderer-restyle
- **steps:** 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
- **files:** `src/electron/public/styles.css`, `src/electron/public/index.html`, `src/electron/public/app.js`
- **contract exposed:** all element IDs verbatim; all legacy CSS custom-property names alive as aliases; existing class names preserved (additions only); `html-view.js`/`zip-download-ui.js`/`preload.cjs`/unit tests untouched.

### Unit D — documentation
- **steps:** 15, 16, 17
- **files:** `docs/design/project-design.md`, `docs/design/project-functions.md`, `Issues - Pending Items.md`
- **contract exposed:** provenance chain recorded; FR register finalized; issues ledger updated.

## Risks & Mitigations

- **Scan staleness:** none — `last_scanned_commit` equals HEAD (`008ddae…`) at planning time. If implementation starts after new commits touching `src/electron/**`, re-run the scanner first.
- **`:has()` chevron reliance:** requires Chromium `:has()` (shipped Chromium 105; Electron 41 is far newer) AND the invariant that every glyph write co-toggles `.expanded` — verified at all 20 sites. Mitigation if a stray site surfaces: patch that one site to sync the class (small in-step deviation, documented), not a redesign of the approach.
- **Traffic-light position is optical:** research confidence MEDIUM on exact `{x:20, y:18}`. Mitigation: step 14 explicitly tunes ±2px.
- **Glass legibility/performance:** content pane stays opaque; blur ≤ 30–40px and confined to toolbar/menus/sheets/indicator; `prefers-reduced-transparency` fallback (step 7). Tree scrolling perf is unaffected (no backdrop-filter on rows).
- **Fixed-header under-scroll geometry vs `#resizer`:** the preferred fixed-toolbar layout may complicate the drag-resizer math. Mitigation: step 4 defines an explicit in-flow fallback that sacrifices only the toolbar under-scroll effect.
- **Alias omissions → invisible styling bugs:** mitigated by step 3's automated `var(--…)` cross-check over all four renderer files.
- **Theme persist semantics:** persisting during system-follow mode would freeze the appearance and silently break AC-5. Mitigation: step 11 makes persistence exclusive to the manual-toggle path and step 14 tests a live system-appearance flip.
- **happy-dom unit tests:** they eval `html-view.js`/`zip-download-ui.js` sources and assert on emitted DOM — kept green by not touching those files. Any deviation that does touch them MUST update `tests/unit/html-view.test.ts`/`tests/unit/zip-download-ui.test.ts` in the same step.
- **Fullscreen padding:** traffic lights auto-hide in native fullscreen but the 84px reserve remains (no IPC per decision). Accepted cosmetic asymmetry; logged in step 17.

## Acceptance Criteria Mapping

| Criterion (refined request) | Satisfied by step(s) | Verified in |
|---|---|---|
| AC-1 — Visual language (glass, macOS controls, SF Pro, radii, both themes) | 3, 4, 5, 6, 7, 8, 9, 10 | 14 (screenshots) |
| AC-2 — Window chrome (traffic lights in toolbar, drag, fullscreen) | 1, 4 | 14 |
| AC-3 — Feature smoke checklist, no console errors | 8, 9, 10, 11, 12 (contract preservation) | 14 |
| AC-4 — DOM contract, zero unresolved selectors | 2 (script), 8, 9, 10, 11, 12 (gated runs) | 13 |
| AC-5 — Appearance behavior (system default, persistent override) | 3 (media block), 11 | 14 |
| AC-6 — Accessibility (contrast ≥ 4.5:1, focus visibility) | 3 (focus ring), 7 (contrast + media blocks), 5 | 14 |
| AC-7 — Hygiene (no inline styles, no glyph icon buttons) | 9 (inline styles), 8, 10, 12 (glyphs) | 13 (greps) |
| AC-8 — Packaged app renders identically | 1 (tsc-clean main.ts) | 14 (`npm run dist:mac`) |

Every step serves at least one criterion (steps 15–17 serve the project's process requirements mandated by the refined request's Constraints section).

## Deviation Rules for Executors

1. **Auto-fix bugs and blockers** discovered mid-step (e.g., a selector the scan missed, a broken grep) — fix them within the step and document the deviation in your final report.
2. **Add missing security/correctness essentials** without asking (e.g., an escaping bug surfaced while editing markup) — and document them.
3. **STOP and surface anything architectural** — e.g., discovering the DOM contract cannot be preserved without restructuring app.js, or that CSS-only glass is unworkable and native vibrancy seems needed. Do not improvise architecture; report and wait.
4. **Log nice-to-haves instead of doing them.** When running SOLO, append them directly to `Issues - Pending Items.md`. When running as one of several PARALLEL agents, do NOT edit that shared file — report the entries in your final report and the orchestrator appends them after the phase.
5. **Never edit the phase artifacts** (refined request, scan, research, this plan) during execution; scope changes require re-running the producing subagent.

## Verification

Overall proof the plan landed (decision 11's flow, using the scan's commands):

1. `npm run build` — tsc clean (covers the `main.ts` change; renderer files are not compiled).
2. `node test_scripts/check-dom-contract.mjs` — exit 0, zero unresolved IDs (AC-4).
3. `npm test` — existing Vitest suite fully green (html-view + zip-download-ui suites prove the untouched injected-DOM contract).
4. AC-7 greps: `grep -c 'style="' src/electron/public/index.html` = 0; no `&#…;` glyph buttons; `grep -c '::-webkit-scrollbar\|🔗' src/electron/public/styles.css` = 0.
5. Manual/screenshot smoke via `npm run ui` (AC-1/2/3/5/6) and packaged check via `npm run dist:mac` (AC-8), per step 14.

No lint gate exists (`lint_command: null` per scan — genuinely absent, not skipped).
