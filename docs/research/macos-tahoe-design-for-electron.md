# macOS Tahoe (26) / Liquid Glass Design for an Electron App with a Plain HTML/CSS/JS Renderer

Research date: 2026-07-04
Target: Storage Navigator (Electron ^41.1.1, macOS arm64, renderer served from `http://localhost:<port>`, vanilla HTML/CSS/JS, current `BrowserWindow` is fully default — see `src/electron/main.ts:192`).

---

## Overview

macOS 26 "Tahoe" (shipped September 2025) introduced **Liquid Glass**, Apple's unified design language: translucent, refractive materials, dramatically rounder corners, floating sidebars, and capsule-shaped controls ([Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/), [Liquid Glass — Wikipedia](https://en.wikipedia.org/wiki/Liquid_Glass)).

**Critical mid-2026 context:** at WWDC 2026 (June 2026) Apple announced **macOS 27 "Golden Gate"** (public beta July 2026, ships fall 2026), which *walks back* several Tahoe extremes ([MacRumors](https://www.macrumors.com/2026/06/09/macos-golden-gate-liquid-glass/)):

- Window corner radius is now **uniform and "not as dramatically rounded"** as Tahoe.
- Sidebars changed from **floating panels back to edge-to-edge**, with less shadowing.
- **Sidebar icons regained color** (Tahoe had made them monochrome).
- A user-facing **transparency slider** was added; the more opaque option improves legibility.
- Toolbars were made **uniform** for legibility of headings and control groups.

Tahoe's original design was widely criticized for legibility/contrast problems ("whiteout" in Light Mode, illegible menu text over busy backgrounds) and a months-long Reduce Transparency regression ([Cloudship analysis](https://cloudship.co.uk/blog/macos-tahoe-liquid-glass/), [fone.tips](https://fone.tips/macos-27-liquid-glass-redesign/)).

**Design north star for Storage Navigator:** aim at the *Golden Gate–corrected* version of Liquid Glass — edge-to-edge translucent sidebar (native vibrancy), opaque content pane, unified 52px toolbar, moderate corner radii, capsule buttons, accent-tinted selection, restrained blur. Do **not** chase Tahoe's floating-sidebar/heavy-refraction look; Apple itself is retreating from it.

A web renderer cannot reproduce real Liquid Glass refraction ("lensing"). What it *can* reproduce convincingly: the material stack (blur + saturation + tint), the metrics (heights, radii, type scale), the semantic color system, and the interaction details (accent selection, focus halos, overlay scrollbars, vibrancy dimming on window blur).

---

## Key Concepts

| Concept | Native reality | Web-renderer strategy |
|---|---|---|
| Liquid Glass material | `NSGlassEffectView` / SwiftUI `.glassEffect()` — refracts desktop behind the window | Electron `vibrancy` (native `NSVisualEffectView`) for surfaces that must show the *desktop*; CSS `backdrop-filter` for surfaces that only need to show *in-app content* behind them (menus, sticky toolbars, modals) |
| Semantic colors | `NSColor.labelColor`, `controlBackgroundColor`, etc. resolve per appearance | CSS custom properties in light/dark token sets + `color-scheme` |
| Accent color | User-selectable system accent | Read from main via `systemPreferences`, inject as `--accent`; fall back to `#007AFF`/`#0A84FF` |
| SF Pro | System font, size-specific optical variants | `system-ui`/`-apple-system` resolves to SF Pro at runtime — no font shipping needed (fully license-safe: the font is never distributed) |
| Window chrome | Unified toolbar, inset traffic lights | `titleBarStyle: 'hiddenInset'` + custom HTML toolbar with `app-region: drag` |

---

## 1. Electron Main-Process Changes (Electron 41, macOS)

All options below are current in Electron 41.x docs ([BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window), [custom title bar tutorial](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [custom window styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)).

### Recommended BrowserWindow configuration

```ts
const win = new BrowserWindow({
  width: 1400,
  height: 900,
  minWidth: 900,
  minHeight: 600,
  title: `Storage Navigator — port ${port}`,
  icon: iconPath,

  // -- macOS chrome --------------------------------------------------------
  titleBarStyle: 'hiddenInset',          // full-bleed content, inset traffic lights
  trafficLightPosition: { x: 20, y: 18 },// center lights in a 52px toolbar (optional)
  vibrancy: 'sidebar',                   // native NSVisualEffectView behind the page
  visualEffectState: 'followWindow',     // material dims when window loses focus (native behavior)
  backgroundColor: '#00000000',          // let vibrancy show through until CSS paints
  // DO NOT set `transparent: true` — unnecessary with vibrancy and it kills the
  // native window shadow and resize behavior on macOS.
  // DO NOT set `backgroundMaterial` — that option is Windows 11 (mica/acrylic) only.

  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    plugins: true,
    preload: preloadPath,
  },
});
```

### Option-by-option notes

**`titleBarStyle: 'hiddenInset'` vs `'hidden'`**
- `'hidden'`: title bar removed, content is full-size, traffic lights sit at the tight default top-left position (~`x:7, y:6`). Pair with `trafficLightPosition` when you want exact placement.
- `'hiddenInset'`: same, but traffic lights get a deeper, more comfortable inset that visually matches modern unified-toolbar apps. **Recommended** for Storage Navigator.
- `trafficLightPosition: { x, y }` works with both and overrides the inset. For a 52px-tall toolbar, `{ x: 20, y: 18 }` vertically centers the 14px-tall buttons (`(52 − 14) / 2 = 19`; 18 reads slightly better optically). (Confidence: HIGH for the API, MEDIUM for the exact default coordinates — tune visually.)
- `'customButtonsOnHover'` exists but is experimental — avoid.

**`vibrancy` (macOS only)** — valid types in Electron 41: `titlebar`, `selection`, `menu`, `popover`, `sidebar`, `header`, `sheet`, `window`, `hud`, `fullscreen-ui`, `tooltip`, `content`, `under-window`, `under-page`. Also settable at runtime: `win.setVibrancy('sidebar', { animationDuration: 300 })`; pass `null` to remove.
- **`'sidebar'`** — matches the material behind Finder/Notes sidebars. Use when the sidebar is the star translucent surface. **Recommended.**
- **`'under-window'`** — subtler whole-window wash; good alternative if `'sidebar'` reads too milky.
- **`'hud'`, `'menu'`, `'popover'`** — darker/lighter special materials; not needed here.
- Vibrancy applies to the **whole window**, behind the web contents. The standard Electron pattern for "vibrancy only under the sidebar": keep `html`/`body`/`.sidebar` backgrounds **transparent** and paint the content pane with an **opaque** background. Whatever you leave transparent shows the native material; whatever you paint opaque hides it.
- Vibrancy is composited natively — essentially free, unlike large-area CSS `backdrop-filter`.

**`visualEffectState`** — `'followWindow'` (default; material desaturates when window is inactive — this is the native look, keep it), `'active'`, `'inactive'`.

**`transparent: true` caveats** (from Electron's custom-window-styles doc) — you do **not** need it for vibrancy. If ever used: no native window shadow on macOS, window not resizable in places, CSS `blur()` cannot affect other apps behind the window, and transparency breaks while DevTools is open. Avoid.

**`roundedCorners`** — only relevant for frameless (`frame: false`) windows; keep the default. With `titleBarStyle: 'hiddenInset'` the window keeps native rounded corners and shadow — never fake the *window* radius in CSS.

### Drag regions for the custom toolbar

With a hidden title bar there is **no draggable area** until you declare one:

```css
.toolbar {
  -webkit-app-region: drag;   /* also plain `app-region: drag` in recent Chromium */
  -webkit-user-select: none;
  user-select: none;
}
.toolbar button,
.toolbar input,
.toolbar select,
.toolbar [role="button"],
.toolbar .clickable {
  -webkit-app-region: no-drag;   /* REQUIRED or clicks are swallowed */
}
```

Rules that matter in practice:
- A `drag` region swallows **all** pointer events (`click`, `dblclick`, `contextmenu`, hover styling still works but JS events don't fire). Every interactive descendant must be `no-drag`.
- **Double-click on a drag region triggers the native macOS titlebar action** (zoom or minimize, per System Settings "Double-click a window's title bar to…"). Electron implements this automatically on drag regions. Consequence: never put your own double-click behavior on the drag surface, and don't mark large content areas as `drag`.
- Reserve space for traffic lights: `padding-left: 84px` on the toolbar (three 14px buttons with 6–8px gaps starting at x≈20 end around x≈76). In **native fullscreen** the traffic lights auto-hide — collapse the padding by listening to `enter-full-screen` / `leave-full-screen` in main and forwarding over IPC to toggle a `.is-fullscreen` class.
- `env(titlebar-area-*)` CSS variables exist but only when using Window Controls Overlay (`titleBarStyle: 'hidden'` + `titleBarOverlay`); for macOS-only apps the fixed-padding approach is simpler and standard.

### Window focus/blur dimming

Native macOS dims toolbar/sidebar text when a window is inactive. The vibrancy layer does this automatically (`visualEffectState: 'followWindow'`), but your HTML text won't. Forward focus state:

```ts
win.on('blur',  () => win.webContents.send('window:focus', false));
win.on('focus', () => win.webContents.send('window:focus', true));
```

```css
body.window-blurred .toolbar,
body.window-blurred .sidebar { opacity: 0.75; }  /* or reduce label colors */
```

### Native accent color and theme sync

```ts
import { systemPreferences, nativeTheme } from 'electron';

// macOS: resolves the user's accent (multiply-checked: on macOS use getColor)
const accent = systemPreferences.getColor('control-accent');    // e.g. '#007AFFFF'
// (systemPreferences.getAccentColor() also works on macOS in current Electron,
//  returning RRGGBBAA — verify on 41 at implementation time. Confidence: MEDIUM.)

// Push to renderer -> document.documentElement.style.setProperty('--accent', ...)

// React to changes:
systemPreferences.subscribeNotification(
  'AppleColorPreferencesChangedNotification',
  () => pushAccentToRenderer(),
);
nativeTheme.on('updated', () => pushThemeToRenderer(nativeTheme.shouldUseDarkColors));
```

**Manual theme toggle must drive `nativeTheme.themeSource`.** If the app's `data-theme` toggle forces dark while the OS is light, the *native vibrancy material stays light* and the window looks broken. Setting `nativeTheme.themeSource = 'dark' | 'light' | 'system'` flips the native window appearance (vibrancy, traffic lights, native menus, dialogs) to match. This is the single most important integration detail for a mixed manual/system theme app.

---

## 2. Layout Metrics (the numbers that make it look native)

| Element | Value | Notes |
|---|---|---|
| Toolbar height | **52px** | Unified toolbar; matches Finder/Notes (Confidence: HIGH) |
| Traffic-light reserve | **84px** left padding | With `trafficLightPosition {x:20,y:18}` |
| Sidebar width | **240px** default, 200–320 resizable | Finder default ≈ 220–240 |
| Sidebar row height | **28px** | 13px text, 16–18px icon, 8px gap |
| Sidebar row radius | **6–8px** (use 8px) | Tahoe rounder than Big Sur's 6; Golden Gate keeps ~8 (MEDIUM) |
| Sidebar section header | 11px / 600, secondary label color, 8px top margin | Not uppercase |
| Sidebar horizontal inset | 10px outer, 10px row padding | Rows inset from sidebar edge |
| Content pane | opaque, separated by 0.5–1px hairline from sidebar | Golden Gate returns to edge-to-edge — no floating gap needed |
| Buttons (regular) | height **24px** (Tahoe "large" 28px), padding 0 14px | |
| Button radius | **capsule** (`border-radius: 999px`) in Tahoe; 6px pre-Tahoe | Tahoe made push buttons capsule-shaped; capsule is the current look (MEDIUM-HIGH) |
| Text field height | 24–28px, radius **6px** | |
| Segmented control | height 24px, outer radius 7px, inner radius 5px, 2px inset | |
| Context menu | radius **12px**, 5px outer padding, items 28px tall radius 6px | Tahoe/GG menus are rounder with padded, rounded items (MEDIUM) |
| Modal/sheet radius | **12–14px** | |
| Hairline separators | `0.5px` (renders correctly on retina) with 8–10% alpha | |
| Window corner radius | leave to macOS | Native frame handles it; Tahoe varied it per-window (controversial), Golden Gate unifies it — never fake it in CSS |

---

## 3. Typography (SF Pro via system stack)

Chromium on macOS resolves `system-ui` / `-apple-system` to the installed SF Pro — the correct, license-safe way to get SF (the font is never distributed with the app; SF's license prohibits embedding/shipping, not runtime use of the OS font — see [Apple Developer Forums on SF licensing](https://developer.apple.com/forums/thread/757407)).

```css
:root {
  --font-ui: system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
}
body {
  font-family: var(--font-ui);
  font-size: 13px;                       /* macOS Body */
  -webkit-font-smoothing: antialiased;   /* matches modern macOS grayscale AA */
}
```

macOS built-in text styles (from Apple HIG [Typography](https://developer.apple.com/design/human-interface-guidelines/typography); pt = px at 1x — use these px values):

| Style | Size / line height | Weight | Use in Storage Navigator |
|---|---|---|---|
| Large Title | 26 / 32 | 400 | rarely (welcome/empty states) |
| Title 1 | 22 / 26 | 400 | — |
| Title 2 | 17 / 22 | 400 | modal titles (large) |
| Title 3 | 15 / 20 | 400 | pane headings |
| Headline | 13 / 16 | **700** | modal/alert titles, window title |
| **Body** | **13 / 16** | 400 | default UI text, sidebar rows, table cells, menus |
| Callout | 12 / 15 | 400 | dense secondary UI |
| Subheadline | 11 / 14 | 400 | sidebar section headers (use 600), toolbar labels |
| Footnote | 10 / 13 | 400 | metadata, badges |
| Caption 1 / 2 | 10 / 13 | 400 / 500 | timestamps, file sizes |

Notes:
- Window/toolbar title: 13px / 600.
- SF Pro Display vs Text switching is automatic via optical sizing in the system font; nothing to do.
- `ui-monospace` may resolve to Menlo rather than SF Mono in Chromium (SF Mono isn't a public system-wide font); the stack above degrades gracefully. Use 12px for code/blob content.

---

## 4. Color System (light + dark tokens)

Semantic values below are the widely documented resolutions of Apple's `NSColor`/UIKit semantic colors (cross-checked against [swiftuicolors.com](https://swiftuicolors.com/) and long-stable AppKit values). Apple can nudge them per release — treat as high-fidelity approximations (Confidence: HIGH for labels/separators/system accents, MEDIUM for window/sidebar tints which are materials, not flat colors).

```css
:root { color-scheme: light dark; }   /* native form controls + scrollbars follow theme */

/* ---------- Light ---------- */
:root, :root[data-theme="light"] {
  color-scheme: light;
  --label:            rgba(0, 0, 0, 0.85);   /* labelColor */
  --label-2:          rgba(0, 0, 0, 0.50);   /* secondaryLabelColor */
  --label-3:          rgba(0, 0, 0, 0.25);   /* tertiaryLabelColor */
  --label-4:          rgba(0, 0, 0, 0.10);   /* quaternaryLabelColor */
  --separator:        rgba(0, 0, 0, 0.10);
  --content-bg:       #ffffff;               /* controlBackgroundColor */
  --window-bg:        #ececec;               /* windowBackgroundColor (fallback when no vibrancy) */
  --sidebar-tint:     rgba(246, 246, 246, 0.72); /* CSS-only sidebar; transparent when vibrancy on */
  --toolbar-tint:     rgba(250, 250, 250, 0.80);
  --menu-bg:          rgba(246, 246, 246, 0.78);
  --control-bg:       #ffffff;
  --control-border:   rgba(0, 0, 0, 0.12);
  --hover-fill:       rgba(0, 0, 0, 0.045);
  --selected-fill:    rgba(0, 0, 0, 0.065);  /* inactive selection */
  --accent:           #007aff;               /* replaced at runtime by system accent */
  --accent-text:      #ffffff;
  --destructive:      #ff3b30;
}

/* ---------- Dark ---------- */
:root[data-theme="dark"] {
  color-scheme: dark;
  --label:            rgba(255, 255, 255, 0.85);
  --label-2:          rgba(255, 255, 255, 0.55);
  --label-3:          rgba(255, 255, 255, 0.26);
  --label-4:          rgba(255, 255, 255, 0.10);
  --separator:        rgba(255, 255, 255, 0.10);
  --content-bg:       #1e1e1e;               /* controlBackgroundColor dark */
  --window-bg:        #282828;               /* window chrome fallback */
  --sidebar-tint:     rgba(40, 40, 40, 0.65);
  --toolbar-tint:     rgba(34, 34, 34, 0.72);
  --menu-bg:          rgba(46, 46, 46, 0.78);
  --control-bg:       rgba(255, 255, 255, 0.10);
  --control-border:   rgba(255, 255, 255, 0.14);
  --hover-fill:       rgba(255, 255, 255, 0.06);
  --selected-fill:    rgba(255, 255, 255, 0.09);
  --accent:           #0a84ff;
  --accent-text:      #ffffff;
  --destructive:      #ff453a;
}

/* System-follows mode when no manual override is set */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* duplicate the dark block, or set data-theme via JS */ }
}
```

**Practical pattern for the manual toggle + system mode:** resolve the theme in JS (`system | light | dark`) and always stamp the *resolved* value on `<html data-theme="...">`, listening to `matchMedia('(prefers-color-scheme: dark)')` while in system mode. This avoids duplicating token blocks in `@media` and keeps CSS single-source. Remember to mirror the choice to `nativeTheme.themeSource` over IPC (Section 1).

**macOS system accent palette** (light / dark resolutions — offer these if you add an in-app accent picker):

| Accent | Light | Dark |
|---|---|---|
| Blue (default) | `#007aff` | `#0a84ff` |
| Purple | `#af52de` | `#bf5af2` |
| Pink | `#ff2d55` | `#ff375f` |
| Red | `#ff3b30` | `#ff453a` |
| Orange | `#ff9500` | `#ff9f0a` |
| Yellow | `#ffcc00` | `#ffd60a` |
| Green | `#28cd41` | `#32d74b` |
| Graphite | `#8e8e93` | `#98989d` |

Selection color = accent at full strength with white text (menus, sidebar selected row when window active); inactive-window selection = `--selected-fill` gray.

---

## 5. CSS Recipes

### 5.1 Sidebar with native vibrancy (preferred)

```css
html, body { background: transparent; height: 100%; margin: 0; }

.app          { display: grid; grid-template-columns: 240px 1fr; height: 100vh; }
.sidebar      { background: transparent; }          /* native material shows through */
.main-pane    { background: var(--content-bg); }    /* opaque — hides vibrancy */
.main-pane    { box-shadow: -0.5px 0 0 var(--separator); } /* hairline divider */
```

With `vibrancy: 'sidebar'` in the BrowserWindow, this alone produces the real desktop-refracting sidebar — no `backdrop-filter` needed, no GPU cost.

### 5.2 Translucent surfaces WITHOUT window vibrancy (CSS-only)

`backdrop-filter` can only blur **in-app content behind the element** — never the desktop behind the window (Electron docs are explicit that CSS blur cannot affect other apps). So CSS-only translucency is only convincing for surfaces that overlay scrolling app content:

```css
/* Sticky toolbar over scrolling content */
.toolbar {
  position: sticky; top: 0; z-index: 10;
  height: 52px;
  background: var(--toolbar-tint);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  backdrop-filter: blur(20px) saturate(1.8);
  box-shadow: inset 0 -0.5px 0 var(--separator);
}

/* Fallback sidebar when vibrancy is off */
.sidebar--css-material {
  background: var(--sidebar-tint);
  -webkit-backdrop-filter: blur(30px) saturate(1.6);
  backdrop-filter: blur(30px) saturate(1.6);
}
```

The `saturate(1.6–1.8)` component is what makes it read as "macOS material" instead of frosted gray — Apple's materials boost background saturation. Keep blur radii ≤ 30px on large surfaces (performance, Section 7).

### 5.3 Buttons

```css
/* Bordered (default) button — Tahoe capsule */
.btn {
  height: 24px; padding: 0 14px;
  border-radius: 999px;                      /* Tahoe capsule; use 6px for pre-Tahoe look */
  font: 400 13px/1 var(--font-ui);
  color: var(--label);
  background: var(--control-bg);
  border: 0.5px solid var(--control-border);
  box-shadow: 0 0.5px 1.5px rgba(0, 0, 0, 0.10);
}
.btn:active { background: color-mix(in srgb, var(--control-bg) 92%, var(--label)); }

/* Primary (default action) — accent filled */
.btn--primary {
  color: var(--accent-text);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 88%, white) 0%,
    var(--accent) 100%);
  border-color: transparent;
}
.btn--primary:active { filter: brightness(0.92); }
```

### 5.4 Segmented control

```css
.segmented {
  display: inline-flex; height: 24px; padding: 2px;
  border-radius: 7px;
  background: var(--label-4);                       /* quaternary fill */
}
.segmented > button {
  border: 0; background: transparent; border-radius: 5px;
  padding: 0 12px; font: 400 12px var(--font-ui); color: var(--label);
}
.segmented > button[aria-pressed="true"] {
  background: var(--content-bg);                    /* light: white; dark: #636366-ish */
  box-shadow: 0 1px 2.5px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
}
:root[data-theme="dark"] .segmented > button[aria-pressed="true"] {
  background: rgba(255, 255, 255, 0.22);
}
```

### 5.5 Text fields and focus rings

```css
.field {
  height: 26px; padding: 0 8px;
  border-radius: 6px;
  font: 400 13px var(--font-ui); color: var(--label);
  background: var(--control-bg);
  border: 0.5px solid var(--control-border);
}
.field:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--accent) 35%, transparent);
}
/* Generic macOS focus halo for any focusable */
:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
  outline-offset: 1px;
}
```

### 5.6 Checkboxes / radios / switches — use `accent-color`

The cheapest high-fidelity option: keep native `<input type="checkbox|radio|range">` and set

```css
input[type="checkbox"], input[type="radio"], input[type="range"], progress {
  accent-color: var(--accent);
}
```

Chromium renders macOS-appropriate controls tinted with your accent, and `color-scheme` makes them theme-correct. Only build a custom switch if you need the NSSwitch look (38×22px track, radius 11px, white 20px knob, accent track when on).

### 5.7 Select / popup button

```css
.popup {
  appearance: none; -webkit-appearance: none;
  height: 24px; padding: 0 26px 0 10px;
  border-radius: 6px;
  font: 400 13px var(--font-ui); color: var(--label);
  background:
    var(--control-bg)
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='12' viewBox='0 0 8 12'><path d='M1 4.5 4 1.5 7 4.5M1 7.5 4 10.5 7 7.5' fill='none' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")
    no-repeat right 5px center / 8px 12px;
  border: 0.5px solid var(--control-border);
}
/* macOS look: the chevrons sit in a small accent-filled rounded square */
.popup { background-color: var(--control-bg); }
.popup-wrap { position: relative; display: inline-block; }
.popup-wrap::after {
  content: ""; position: absolute; right: 4px; top: 50%; translate: 0 -50%;
  width: 16px; height: 16px; border-radius: 5px;
  background: var(--accent); pointer-events: none;
  /* place the white up/down chevron SVG above via mask or background */
}
```

(The stacked up/down chevrons `⌃/⌄` in an accent square are the signature of a macOS popup button.)

### 5.8 Context menu

```css
.context-menu {
  position: fixed; z-index: 1000;
  min-width: 210px; padding: 5px;
  border-radius: 12px;                                     /* Tahoe-era; 8px pre-Tahoe */
  background: var(--menu-bg);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  backdrop-filter: blur(40px) saturate(1.8);
  border: 0.5px solid var(--separator);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.22),
    0 2px 8px rgba(0, 0, 0, 0.10);
}
.context-menu .item {
  display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 9px;
  border-radius: 6px;
  font: 400 13px var(--font-ui); color: var(--label);
}
.context-menu .item:hover:not(.disabled) {
  background: var(--accent); color: var(--accent-text);
}
.context-menu .item:hover:not(.disabled) svg { color: var(--accent-text); }
.context-menu .item.disabled { color: var(--label-3); }
.context-menu .separator {
  height: 1px; margin: 5px 10px; background: var(--separator);
}
.context-menu .item .shortcut { margin-left: auto; color: var(--label-2); }
.context-menu .item:hover .shortcut { color: color-mix(in srgb, var(--accent-text) 75%, transparent); }
```

Key native detail: hover highlight is **full-strength accent with white text** (not a gray wash), and it snaps — no transition on menu-item hover.

### 5.9 Modal / sheet

```css
.overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.25);            /* dark theme: 0.45 */
}
.sheet {
  border-radius: 13px;
  background: var(--content-bg);              /* opaque body text surface */
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35), 0 0 0 0.5px var(--separator);
  animation: sheet-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes sheet-in {
  from { opacity: 0; transform: scale(0.97) translateY(6px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sheet { animation: none; }
}
```

Alert layout convention: 15px/600 title, 11–12px message in `--label-2`, buttons right-aligned (primary rightmost), 13px.

### 5.10 Scrollbars — prefer NOT styling them

**Chromium honors macOS native overlay scrollbars** (they appear only while scrolling when System Settings → "Show scroll bars" is "When scrolling"). **Any `::-webkit-scrollbar` rule permanently opts that scroller out of overlay behavior** and forces classic always-visible bars. The most native-feeling choice is zero scrollbar CSS. If you must style (e.g., to guarantee overlay look regardless of system setting):

```css
.scroller::-webkit-scrollbar { width: 14px; height: 14px; }
.scroller::-webkit-scrollbar-track { background: transparent; }
.scroller::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.32);
  border: 4px solid transparent;      /* inset the pill */
  background-clip: padding-box;
  border-radius: 999px;
  min-height: 32px;
}
:root[data-theme="dark"] .scroller::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.32);
  background-clip: padding-box; border: 4px solid transparent;
}
```

### 5.11 Sidebar rows (file tree)

```css
.sidebar { padding: 8px 10px; font-size: 13px; }
.sidebar .row {
  display: flex; align-items: center; gap: 7px;
  height: 28px; padding: 0 8px;
  border-radius: 8px;
  color: var(--label);
}
.sidebar .row:hover { background: var(--hover-fill); }
.sidebar .row[aria-selected="true"] {
  background: var(--accent); color: #fff;
}
body.window-blurred .sidebar .row[aria-selected="true"] {
  background: var(--selected-fill); color: var(--label);   /* inactive-window selection */
}
.sidebar .section {
  margin: 14px 8px 4px; font: 600 11px var(--font-ui); color: var(--label-2);
}
```

(Note: over a vibrancy sidebar, `--hover-fill`/`--selected-fill` grays should use the label-based rgba values above so they work on the translucent material.)

---

## 6. Iconography (SF-Symbols-like in HTML)

**Licensing:** SF Symbols' agreement restricts the symbols to apps running on Apple platforms and prohibits redistribution/export for other uses; SF fonts likewise cannot be shipped or used on the web ([Apple Developer Forums](https://developer.apple.com/forums/thread/757407), [thread 724523](https://developer.apple.com/forums/thread/724523)). An Electron app *running on macOS* is a gray area, but exporting symbol SVGs into the repo is the risky part — **use an open-source lookalike set instead** (Confidence: HIGH that this is the safe choice).

**Recommended sets** (all MIT/ISC, 24×24 grid, stroke-based, `currentColor`-friendly):
- **Lucide** — closest general-purpose match; default `stroke-width` 2 is too heavy for macOS — **set `stroke-width="1.5"`** for SF-like lightness at 16–18px.
- **Phosphor** — multiple weights (thin/light/regular/fill); "regular" ≈ SF Regular, "fill" variants cover SF's filled states.
- **Tabler Icons** — 5,900+ icons, 2px stroke on 24 grid, also accepts 1.5.

**Usage pattern** (inline SVG, monochrome, inherits text color):

```html
<svg class="icon" width="16" height="16" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="..."/>
</svg>
```

```css
.icon { flex: none; }
.toolbar .icon { width: 16px; height: 16px; color: var(--label-2); }
.sidebar .icon { width: 17px; height: 17px; color: var(--accent); } /* accent-tinted like Finder */
```

- **Sidebar icon color:** Finder tints sidebar icons with the system accent. Tahoe briefly made them monochrome gray; macOS 27 restores color ([MacRumors](https://www.macrumors.com/2026/06/09/macos-golden-gate-liquid-glass/)) — so **accent-tint your sidebar icons**; it is the forward-compatible look.
- **Hierarchical rendering** (SF's two-tone style): primary path `currentColor`, secondary path `currentColor` at `opacity: 0.4`.
- **Finder-like folder color:** macOS folders are a blue gradient; a close approximation is `linear-gradient(180deg, #6fb5f6, #2e9cf4)` on a filled folder path, or flat `#3b9cf4` (sampled approximation — Confidence: LOW-MEDIUM; sample from a screenshot at implementation time if pixel-fidelity matters). Generic file icons: near-white page `#f5f5f7` with `#c7c7cc` border and a gray glyph, per file-type color chips (accent-colored for known types) are acceptable and Finder-like.
- Toolbar icon-buttons: 28×28px hit area, 16px glyph, radius 6px, `--hover-fill` on hover — matches macOS toolbar button behavior.

---

## 7. Pitfalls & Accessibility

1. **Drag region swallows events** — every interactive toolbar element needs `app-region: no-drag` (Section 1). Symptoms otherwise: buttons "dead", no context menu, text fields unfocusable.
2. **Double-click-to-zoom** fires on any `app-region: drag` surface. Keep drag regions to the toolbar strip only; never mark the whole header including tabs/breadcrumbs if they have double-click semantics.
3. **Vibrancy vs manual theme mismatch** — always mirror the in-app toggle to `nativeTheme.themeSource`, or a forced-dark app sits on a light native material (and vice versa). This also keeps native context menus/dialogs/save panels in the right appearance.
4. **`transparent: true` traps** — no native shadow, breaks with DevTools open, resize quirks. Not needed with vibrancy; don't use it.
5. **`backgroundMaterial` is Windows-only** (Mica/Acrylic); a no-op on macOS — don't cargo-cult it from cross-platform examples.
6. **`backdrop-filter` performance** — each backdrop-filtered element forces an offscreen readback+blur per frame. Fine for menus/toolbars/modals; expensive for a full-height always-visible sidebar (use native vibrancy there instead). Never nest backdrop-filters; avoid animating elements underneath large blurred surfaces.
7. **Legibility over glass** — Tahoe's biggest criticism ([Cloudship](https://cloudship.co.uk/blog/macos-tahoe-liquid-glass/)). Keep **body text and the content pane opaque**; restrict translucency to chrome (sidebar, toolbar, menus). Use `--label` at 0.85 alpha, never lower, for primary text on materials.
8. **`prefers-reduced-transparency`** (supported in Chromium ≥118, well within Electron 41) — provide opaque fallbacks:
   ```css
   @media (prefers-reduced-transparency: reduce) {
     .toolbar, .sidebar--css-material, .context-menu {
       backdrop-filter: none; -webkit-backdrop-filter: none;
       background: var(--window-bg);
     }
   }
   ```
   When the user enables Reduce Transparency in macOS, also consider removing window vibrancy (`win.setVibrancy(null)`) — detect via `systemPreferences.getEffectiveAppearance()`/`accessibility` APIs or just honor the media query for in-app surfaces.
9. **`prefers-contrast: more`** — bump `--separator` to 0.25 alpha and border widths to 1px.
10. **`prefers-reduced-motion`** — disable sheet/menu animations (shown in 5.9).
11. **Inactive-window states** — dim chrome text and switch selection from accent to gray on `blur` (Sections 1, 5.11); this is one of the strongest "feels native" signals and is almost always forgotten.
12. **Fullscreen** — traffic lights auto-hide; collapse the 84px toolbar padding via an IPC-driven class.
13. **Hairlines** — use `0.5px` borders (valid on retina) or `box-shadow: inset 0 -0.5px 0` rather than 1px lines everywhere; 1px borders instantly read as "web app".
14. **Don't fake the window radius** — with `titleBarStyle: 'hiddenInset'` (framed window) macOS draws the correct Tahoe/Golden Gate window corners and shadow for you. CSS-rounded window corners are a frameless-window technique only and will clash with the OS.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if wrong |
|---|---|---|
| Electron `^41.1.1` — all cited BrowserWindow options (`titleBarStyle`, `trafficLightPosition`, `vibrancy` incl. type list, `visualEffectState`) verified against current Electron docs | HIGH | — |
| Target is macOS-only (arm64 DMG per package.json); no Windows/Linux titlebar fallback designed | HIGH | Would need Window Controls Overlay (`titleBarOverlay`) branch for Win/Linux |
| "Native vibrancy sidebar + opaque content" is the right architecture (vs whole-window glass) | HIGH | Golden Gate's direction strongly supports it; whole-window glass would need `under-window` vibrancy + more transparent panes |
| Tahoe capsule buttons / 12px menu radius / 8px sidebar-row radius | MEDIUM | Values are from release coverage + observation, not published Apple specs; tune ±2px against a real Finder window |
| Semantic color resolutions (labels, separators, control backgrounds, accent palette) | HIGH (labels/accents) / MEDIUM (window & material tints) | Material tints are dynamic composites; sampled fallbacks may need per-theme tweaks |
| `systemPreferences.getColor('control-accent')` works for accent on macOS in Electron 41 | MEDIUM | Fall back to `getAccentColor()` or hardcoded palette + in-app picker |
| Finder folder gradient hexes | LOW-MEDIUM | Sample from screenshot if pixel-fidelity needed |
| Exact traffic-light default coordinates for `hiddenInset` | MEDIUM | Purely cosmetic; tune `trafficLightPosition` visually |
| Chromium in Electron 41 supports all cited CSS (`color-mix`, `color-scheme`, `accent-color`, `backdrop-filter`, `prefers-reduced-transparency`) | HIGH | All shipped by Chromium 118–125; Electron 41 is far newer |

**Out of scope:** Windows/Linux chrome, real Liquid Glass refraction/lensing shaders, native NSMenu replacement for in-page context menus (the app's DOM menus are styled instead), app icon redesign for Tahoe's icon style.

**Interpretations made:** "Liquid Glass era" interpreted as *the Golden Gate–refined direction* (mid-2026 state of the design language), not Tahoe's initial floating-glass extremes — justified by Apple's own June 2026 corrections. "Native-feeling controls in CSS" interpreted as visual emulation on standard HTML elements, not a component library.

---

## Uncertainties & Gaps

- **No published Apple pixel specs for Tahoe radii/materials** — Apple's HIG gives type/semantic-color guidance but not window-radius or material-blur constants; third-party sources conflict (one blog claims 12px window arcs, others larger, and Tahoe varies radius per window content). All radius values here are best-fit recommendations, not Apple constants.
- **macOS 27 Golden Gate is beta** (public beta July 2026); its "uniform, less rounded" corners and edge-to-edge sidebars could still shift before fall release.
- **SF Symbols in an Electron-on-macOS app** is a licensing gray zone; the recommendation (Lucide/Phosphor at stroke 1.5) sidesteps it entirely.
- Whether Chromium's `AccentColor`/`AccentColorText` CSS system keywords resolve to the *macOS* accent in Electron 41 was not verified — the `systemPreferences` IPC route is the reliable path.

## Clarifying Questions for Follow-up

1. Should the app follow the **system accent color** dynamically (IPC plumbing) or expose only an in-app accent picker (simpler, static palette)?
2. Is a **Windows/Linux build** ever planned? If yes, the titlebar work should use the Window Controls Overlay pattern from day one.
3. Should the existing in-page context menus be kept as DOM menus (styled per 5.8) or replaced with **native `Menu.popup()`** from the main process (perfect fidelity, less styling control)?
4. Does the content viewer need translucency too (e.g., toolbar floating over blob content), or is a fully opaque content pane acceptable (recommended)?
5. Target fidelity for icons: is Lucide at stroke 1.5 acceptable, or is a hand-curated SF-lookalike subset desired?

---

## References

1. Electron BrowserWindow / BaseWindow options — https://www.electronjs.org/docs/latest/api/browser-window (via Context7 `/electron/electron`)
2. Electron custom title bar tutorial — https://www.electronjs.org/docs/latest/tutorial/custom-title-bar (via Context7)
3. Electron custom window styles (transparent-window limitations) — https://www.electronjs.org/docs/latest/tutorial/custom-window-styles (via Context7)
4. Apple Newsroom — Liquid Glass announcement — https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
5. Liquid Glass — Wikipedia — https://en.wikipedia.org/wiki/Liquid_Glass
6. macOS Tahoe — Wikipedia — https://en.wikipedia.org/wiki/MacOS_Tahoe
7. MacRumors — "All the Liquid Glass Changes in macOS Golden Gate" (June 9, 2026) — https://www.macrumors.com/2026/06/09/macos-golden-gate-liquid-glass/
8. Cloudship — "macOS Tahoe's Liquid Glass and the death of consistency" — https://cloudship.co.uk/blog/macos-tahoe-liquid-glass/
9. fone.tips — "macOS 27 Liquid Glass: Every Readability Fix Explained" — https://fone.tips/macos-27-liquid-glass-redesign/
10. Apple HIG — Typography — https://developer.apple.com/design/human-interface-guidelines/typography
11. Apple HIG — Color / Dark Mode (macOS) — https://developer.apple.com/design/human-interface-guidelines/color
12. swiftuicolors.com — Apple system color hex/RGBA reference — https://swiftuicolors.com/
13. Apple Developer Forums — SF Symbols / SF Pro license threads — https://developer.apple.com/forums/thread/757407 , https://developer.apple.com/forums/thread/724523
14. Lucide — https://lucide.dev/ ; Phosphor — https://phosphoricons.com/ ; Tabler Icons — https://tabler.io/icons
15. OS X Daily — "How to Reduce Liquid Glass on macOS Tahoe" (accessibility angle) — https://osxdaily.com/2025/10/07/how-reduce-liquid-glass-macos-tahoe/
