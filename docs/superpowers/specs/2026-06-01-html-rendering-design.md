# HTML Rendering for Stored Pages — Design

**Date:** 2026-06-01
**Status:** Approved (design phase)
**Project:** storage-navigator

## Problem

The Electron viewer already handles PDF, DOCX, JSON, Markdown, and plain text, but `.html` blobs fall through to the plain-text branch (`src/electron/public/app.js:719-721`) and are shown as escaped source. Users storing HTML — single-page reports as well as multi-file static sites — cannot view them as web pages, and external API consumers cannot browse a stored site directly.

## Goals

1. Render HTML blobs as web pages inside the Electron viewer.
2. Expose the same rendering through the HTTP API so external browsers and API consumers can navigate a stored static site directly.
3. Handle both self-contained single-page HTML and multi-file sites (relative `./styles.css`, `images/foo.png`, sibling-page links) without URL rewriting.
4. Apply to both Azure Blob containers and Azure File Shares.
5. Default-safe rendering of untrusted HTML, with an explicit per-container/per-share opt-in for higher fidelity.

## Non-Goals

- No CLI or agent integration (`storage-nav agent`, CLI `cat`/`get` commands unchanged).
- No server-side HTML sanitization or URL rewriting — sandbox + CSP do the work.
- No virtual-host mapping (e.g. `mycontainer.localhost`); flat `/api/site/...` prefix only.
- No changes to the existing API auth subsystem (OIDC / static header reused as-is).
- No edit mode for the *rendered* HTML view. Edit stays under the existing text-source flow with a new "View source" toggle that flips back to the plain-text viewer.

## Architecture

A single server-side route exposes the container/share as a static-site root. The Electron viewer points a sandboxed iframe at the same route. External browsers hit it directly.

```
┌─────────────────────────┐         GET /api/site/:storage/:container/*path
│ Electron viewer         │  ─────► ┌──────────────────────────────────────┐
│  <iframe sandbox=...    │         │ server.ts — new "site" handler        │
│          src="/api/site │         │  • blob backend OR file backend       │
│             /…/x.html"> │         │  • streams bytes through              │
└─────────────────────────┘         │  • Content-Type from blob metadata    │
                                    │  • For .html: adds CSP + sandbox HDRs │
External browser ────────────────►  │  • For other types: pass-through      │
                                    └──────────────────────────────────────┘
                                                    │
                                                    ▼
                                          backend.readBlob / readFile
```

Because all assets are served from the same URL prefix, the browser resolves `./styles.css`, `images/foo.png`, and `other-page.html` to sibling blobs natively. **No URL rewriting is performed.**

## Components

### 1. New API routes — `src/electron/server.ts`

- `GET /api/site/:storage/:container/*path` — Azure Blob backend.
- `GET /api/site-file/:storage/:share/*path` — Azure File Share backend.
- Behavior (both routes):
  - Decode and normalize `*path`; reject paths containing `..` segments with `400`.
  - Resolve to a blob/file via the existing `backendFor(req, store)` factory.
  - Stream bytes to the response (no in-memory buffering).
  - Set `Content-Type` from the storage handle's `contentType`; fall back to extension-based detection using the existing `src/util/text-detect.ts` helpers when missing or `application/octet-stream`.
  - For `text/html` responses only:
    - Set `Content-Security-Policy` based on the container/share trust level (see §3):
      - **Untrusted (default):** `default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'self';`
      - **Trusted:** as above but with `connect-src 'self'` and adds `form-action 'self'`.
    - Set `X-Frame-Options: SAMEORIGIN` and `Referrer-Policy: no-referrer`.
  - 404 if blob/file not found; 403 if backend denies. HTML requests return a minimal HTML error page so the iframe shows a readable message; non-HTML requests return JSON `{ error }`.

### 2. New trust endpoints — `src/electron/server.ts`

- `GET /api/trust/:storage/:container` → `{ trusted: boolean }` for blob containers.
- `PUT /api/trust/:storage/:container` body `{ trusted: boolean }` → persists and returns the new value.
- `GET /api/trust-file/:storage/:share` and `PUT /api/trust-file/:storage/:share` — file-share equivalents.

### 3. Trust persistence — credential store

- Extend the per-storage credential record with:
  - `trustedHtmlContainers: string[]`
  - `trustedHtmlShares: string[]`
- Persisted by the existing `CredentialStore` (encrypted at rest, same mechanism as existing PATs).
- Backward compatible: missing fields default to empty arrays.

### 4. Viewer hook — `src/electron/public/app.js` and new `src/electron/public/html-view.js`

- Extract HTML rendering into a small new module `html-view.js` to avoid bloating the 2k-line `app.js`.
- In `app.js` `showBlob()` (around line 685): if `ext === "html" || ext === "htm"` (or response `Content-Type` starts with `text/html`) AND the user did not request `?view=source`, dispatch to `htmlView.render({storage, container, path, contentBody})`.
- `html-view.js` renders:
  ```html
  <iframe class="html-view"
          sandbox="<computed>"
          src="/api/site/<storage>/<container>/<path>"></iframe>
  ```
  - Untrusted sandbox: `allow-scripts`.
  - Trusted sandbox: `allow-scripts allow-same-origin allow-forms allow-popups`.
- Toolbar additions (only visible while viewing HTML):
  - **Trust container** toggle — calls `PUT /api/trust/...`, reloads iframe with new sandbox.
  - **Open in browser** — Electron `shell.openExternal(/api/site/...)` (wire through `preload.cjs` IPC).
  - **View source** — re-enters `showBlob()` with `?view=source`, restoring the existing text viewer + Edit button flow.

### 5. CLI / agent

No changes.

## Data Flow

### Path A — Electron viewer renders `report.html` from a blob container

1. User clicks `report.html` in the tree.
2. `showBlob()` detects `ext === "html"`, calls `GET /api/trust/:storage/:container` → `{ trusted: false }`.
3. Renderer injects `<iframe sandbox="allow-scripts" src="/api/site/<storage>/<container>/report.html">`.
4. Iframe requests `/api/site/.../report.html`.
5. Server reads blob, streams bytes with `Content-Type: text/html`, restrictive CSP, `X-Frame-Options: SAMEORIGIN`.
6. Page loads. `<link href="theme.css">` triggers `/api/site/.../theme.css` (browser-resolved relatively) → server streams CSS with `text/css`.
7. User clicks **Trust container** → `PUT /api/trust/...` flips the flag → renderer reloads the iframe with relaxed sandbox.

### Path B — External browser hits the API directly

1. Browser navigates to `http://localhost:<port>/api/site/<storage>/<container>/index.html`.
2. Same server route, same CSP applied based on trust flag.
3. Sibling pages, CSS, images, JS all resolve via the same `/api/site/...` prefix — static-site browsing works end-to-end.

### Error paths

- Blob/file not found → `404`. Dual format: minimal HTML error page for HTML requests, JSON for others.
- Backend auth denial → `403`, same dual-format treatment.
- Path traversal attempt (`..` segments after URL decoding) → `400` rejected at the route before touching the backend.
- HTML files of arbitrary size — streamed, no in-memory cap on the route itself.

## Security

- **Defense in depth:** iframe `sandbox` attribute *and* server-side CSP both restrict the page. Bypassing one still leaves the other.
- **Trust scope:** trust is per-container / per-share, never global. Stored encrypted with the rest of the credential record.
- **Trusted mode still constrained:** `allow-same-origin` lets the iframe call back to `/api/...` as the user; CSP `connect-src 'self'` keeps it from reaching third parties. Documented explicitly in the README so users understand the trade-off before flipping the toggle.
- **No write paths added:** the new routes are read-only. Existing `PUT /api/blob` paths are untouched.
- **No new auth subsystem:** routes go through the existing OIDC / static-header middleware unchanged.

## Testing

- **Unit tests** (vitest, under `tests/`):
  - Untrusted vs trusted CSP header content.
  - Blob backend vs file-share backend route symmetry.
  - Path traversal rejection (raw `..`, URL-encoded `..%2F`, mixed-case encodings).
  - Content-Type pass-through and extension-based fallback.
  - Trust GET/PUT round-trip and credential-store persistence.
- **Manual smoke test:**
  - Upload a multi-file static site (`index.html` + `styles.css` + `images/*.png` + linked `page2.html`) to a blob container.
  - Open `index.html` in the viewer; verify CSS, images, and links resolve.
  - Verify untrusted sandbox blocks XHR from page JS; flip Trust toggle and verify XHR works.
  - Repeat on a file share.
  - Visit the same `/api/site/...` URL in Chrome; verify identical rendering.

## Files Touched

- `src/electron/server.ts` — add 4 new routes (`/api/site`, `/api/site-file`, `/api/trust`, `/api/trust-file`).
- `src/electron/public/app.js` — add dispatch branch for HTML in `showBlob()`; add toolbar wiring.
- `src/electron/public/html-view.js` — **new file** holding HTML render + trust toggle logic.
- `src/electron/preload.cjs` — expose `shell.openExternal` IPC channel.
- `src/core/credentials/*` — extend record shape with `trustedHtmlContainers` / `trustedHtmlShares`.
- `src/util/text-detect.ts` — only if extension→content-type map needs an addition (likely already covers `.html`/`.htm`/`.css`/`.js`).
- `tests/` — new test files for the routes and trust persistence.
- `README.md` — short section on HTML rendering and the trust model.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Trusted container's iframe calls `/api/...` as the user. | CSP `connect-src 'self'`; trust is explicit and per-container; documented trade-off. |
| Blob `.html` with stored content-type `application/octet-stream`. | Fall back to extension-based detection via `text-detect.ts`. |
| Path traversal via URL-encoded `..%2F`. | Decode then normalize; reject `..` segments. |
| Bloating the 2k-line `app.js`. | Isolate HTML rendering in new `html-view.js`; `app.js` only dispatches. |
| Sandbox attribute change not picked up on toggle. | Re-create the iframe element rather than mutating `sandbox` in place. |

## Open Questions

None at design time. All resolved during brainstorming:
- Scope: Electron UI + API, both blob and file share, sandboxed iframe with per-container trust toggle.
- Asset resolution: native browser relative resolution via flat `/api/site/...` prefix.
- Auth: reuse existing API auth.
