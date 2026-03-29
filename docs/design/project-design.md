# Storage Navigator - Project Design

## Architecture Overview

Storage Navigator is a dual-interface tool (CLI + Electron/web UI) for browsing Azure Blob Storage accounts. The architecture has three layers:

1. **Core** (`src/core/`) -- Credential management (AES-256-GCM encrypted) and Azure Blob Storage client. Shared by both CLI and UI.
2. **CLI** (`src/cli/`) -- Commander-based terminal interface. Dispatches commands to core, formats output for the terminal.
3. **Electron/UI** (`src/electron/`) -- Express HTTP server serving a single-page frontend. The server proxies blob operations through REST endpoints; the browser renders content client-side.

**Content rendering pattern:** The server passes raw blob bytes to the browser. Text-based formats (JSON, Markdown) are parsed client-side. PDF uses the browser's native viewer via iframe. Binary formats that require conversion (DOCX) use server-side conversion before delivery.

**Dependency:** `mammoth` (v1.12+, BSD-2-Clause) for DOCX-to-HTML and DOCX-to-text conversion. Pure JavaScript, no native modules. Used server-side only.

---

## Technical Design: DOCX File Viewing Support

**Date:** 2026-03-29
**References:**
- `docs/reference/refined-request-docx-support.md` (requirements)
- `docs/reference/investigation-docx-support.md` (library evaluation)
- `docs/reference/codebase-scan-docx-support.md` (integration points)
- `docs/design/plan-001-docx-support.md` (implementation plan)

### Design Principles

- Server-side conversion: the Express server converts `.docx` binary to HTML before sending to the browser. This keeps the frontend lightweight and follows the existing architecture.
- The `?format=` query parameter is opt-in. Omitting it preserves existing pass-through behavior for all file types (no breaking changes).
- The CLI operates on the raw `Buffer` directly via `mammoth.extractRawText()`, avoiding UTF-8 conversion of binary data.
- All mammoth calls are wrapped in try/catch with actionable error messages.

### Implementation Units

Three parallel units modify disjoint files. Unit B depends on Unit A at runtime (the UI fetches converted HTML from the server endpoint), but they can be coded and reviewed independently.

```
Phase 0: npm install mammoth (package.json)
   |
   +---> Unit A: Server-side conversion (server.ts)
   |
   +---> Unit B: UI viewer (app.js + styles.css)  [runtime dependency on Unit A]
   |
   +---> Unit C: CLI viewer (view.ts)
```

---

## Unit A: Server-Side Conversion

**File:** `src/electron/server.ts`

### A.1 Import Statement

Add at the top of the file, after the existing imports (after line 5):

```typescript
import mammoth from "mammoth";
```

**Exact location:** After `import { BlobClient } from "../core/blob-client.js";` (line 5), add a blank line then the mammoth import.

### A.2 DOCX Conversion Logic in GET Blob Endpoint

**Exact location:** Inside the `app.get("/api/blob/:storage/:container", ...)` handler (line 83). The new code is inserted between the `getBlobContent` call (line 93) and the response headers (line 95). The existing pass-through becomes the `else` branch.

**Current code (lines 93-98):**
```typescript
      const blob = await client.getBlobContent(req.params.container, blobPath);

      res.setHeader("Content-Type", blob.contentType);
      res.setHeader("X-Blob-Name", blob.name);
      res.setHeader("X-Blob-Size", String(blob.size));
      res.send(blob.content);
```

**Replacement code:**
```typescript
      const blob = await client.getBlobContent(req.params.container, blobPath);

      // DOCX conversion: server-side HTML or text extraction
      const format = req.query.format as string | undefined;
      const blobExt = blobPath.split(".").pop()?.toLowerCase();

      if (blobExt === "docx" && (format === "html" || format === "text")) {
        try {
          if (format === "html") {
            const result = await mammoth.convertToHtml({ buffer: blob.content as Buffer });
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(result.value);
          } else {
            const result = await mammoth.extractRawText({ buffer: blob.content as Buffer });
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.send(result.value);
          }
        } catch (convErr: unknown) {
          const msg = convErr instanceof Error ? convErr.message : String(convErr);
          res.status(422).json({ error: `Failed to convert .docx: ${msg}. Use download instead.` });
        }
        return;
      }

      res.setHeader("Content-Type", blob.contentType);
      res.setHeader("X-Blob-Name", blob.name);
      res.setHeader("X-Blob-Size", String(blob.size));
      res.send(blob.content);
```

### A.3 Behavior Matrix

| Request | Behavior |
|---|---|
| `GET /api/blob/:s/:c?blob=file.docx&format=html` | Returns HTML via `mammoth.convertToHtml()`, Content-Type `text/html; charset=utf-8` |
| `GET /api/blob/:s/:c?blob=file.docx&format=text` | Returns plain text via `mammoth.extractRawText()`, Content-Type `text/plain; charset=utf-8` |
| `GET /api/blob/:s/:c?blob=file.docx` (no format) | Pass-through: raw binary with original Content-Type (backward compatible) |
| `GET /api/blob/:s/:c?blob=file.json&format=html` | Pass-through: `format` param ignored for non-docx files |
| `GET /api/blob/:s/:c?blob=corrupt.docx&format=html` | HTTP 422 JSON: `{ "error": "Failed to convert .docx: <message>. Use download instead." }` |

### A.4 Error Handling

- `mammoth.convertToHtml()` and `mammoth.extractRawText()` are wrapped in try/catch.
- On failure: HTTP 422 with JSON body containing an actionable error message.
- The outer try/catch (line 84) still catches any unexpected errors with HTTP 500.

---

## Unit B: UI Viewer

**Files:** `src/electron/public/app.js`, `src/electron/public/styles.css`

### B.1 File Icon -- `getFileIcon()` in app.js

**Exact location:** `app.js`, line 250-257. The function currently handles `json`, `md`, `pdf`, `txt` with a fallback.

**Current code (lines 250-257):**
```javascript
  function getFileIcon(name) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "json") return "\uD83D\uDCCB";
    if (ext === "md") return "\uD83D\uDCDD";
    if (ext === "pdf") return "\uD83D\uDCC4";
    if (ext === "txt") return "\uD83D\uDCC3";
    return "\uD83D\uDCCE";
  }
```

**Replacement code:**
```javascript
  function getFileIcon(name) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "json") return "\uD83D\uDCCB";
    if (ext === "md") return "\uD83D\uDCDD";
    if (ext === "pdf") return "\uD83D\uDCC4";
    if (ext === "txt") return "\uD83D\uDCC3";
    if (ext === "docx" || ext === "doc") return "\uD83D\uDCD6";
    return "\uD83D\uDCCE";
  }
```

**Icon chosen:** `\uD83D\uDCD6` (open book) -- distinct from clipboard (json), memo (md), page (pdf), page-with-curl (txt).

### B.2 DOCX Branch in `viewFile()` -- app.js

**Exact location:** `app.js`, line 269-295. The `viewFile()` function dispatches by extension. The DOCX branch goes after the PDF branch (line 273) and before the JSON branch (line 278).

**Current code (lines 270-278):**
```javascript
      if (ext === "pdf") {
        contentBody.innerHTML = `<iframe class="pdf-embed" src="${url}"></iframe>`;
        return;
      }

      const res = await api(url);
      const text = await res.text();

      if (ext === "json") {
```

**Replacement code:**
```javascript
      if (ext === "pdf") {
        contentBody.innerHTML = `<iframe class="pdf-embed" src="${url}"></iframe>`;
        return;
      }

      if (ext === "docx" || ext === "doc") {
        const docxUrl = `${url}&format=html`;
        const docxRes = await api(docxUrl);
        const html = await docxRes.text();
        contentBody.innerHTML = `<div class="docx-view">${html}</div>`;
        return;
      }

      const res = await api(url);
      const text = await res.text();

      if (ext === "json") {
```

**How it works:**
1. Appends `&format=html` to the existing blob URL (which already has `?blob=...`).
2. The server receives the `format=html` parameter and returns converted HTML.
3. The HTML is injected into a `<div class="docx-view">` for styled rendering.
4. Error handling: the `api()` helper throws on non-OK responses; the existing `catch` block at line 296 displays the error in the content panel.

### B.3 Content Type Mapping in `createSave` -- app.js

**Exact location:** `app.js`, lines 519-523. The `createSave` handler maps extensions to MIME types.

**Current code (lines 519-523):**
```javascript
      const ext = blobPath.split(".").pop()?.toLowerCase();
      let contentType = "text/plain";
      if (ext === "json") contentType = "application/json";
      else if (ext === "html") contentType = "text/html";
      else if (ext === "md") contentType = "text/plain";
```

**Replacement code:**
```javascript
      const ext = blobPath.split(".").pop()?.toLowerCase();
      let contentType = "text/plain";
      if (ext === "json") contentType = "application/json";
      else if (ext === "html") contentType = "text/html";
      else if (ext === "md") contentType = "text/plain";
      else if (ext === "docx") contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
```

### B.4 CSS Styles -- styles.css

**Exact location:** `styles.css`, after the `.markdown-view` block (ends at line 240) and before the `.placeholder` class (line 242). Insert a new `.docx-view` block.

**Current code (lines 240-242):**
```css
.markdown-view th { background: var(--table-header); }

.placeholder { color: var(--text-dim); text-align: center; padding: 40px; font-style: italic; }
```

**Replacement code:**
```css
.markdown-view th { background: var(--table-header); }

/* DOCX */
.docx-view { font-size: 14px; line-height: 1.7; max-width: 800px; }
.docx-view h1, .docx-view h2, .docx-view h3 { color: var(--text-accent); margin-top: 1em; }
.docx-view p { margin: 0.5em 0; }
.docx-view table { border-collapse: collapse; margin: 1em 0; width: 100%; }
.docx-view th, .docx-view td { border: 1px solid var(--table-border); padding: 6px 12px; text-align: left; }
.docx-view th { background: var(--table-header); }
.docx-view ul, .docx-view ol { padding-left: 2em; }
.docx-view li { margin: 0.25em 0; }
.docx-view img { max-width: 100%; height: auto; }
.docx-view strong { font-weight: 600; }
.docx-view em { font-style: italic; }

.placeholder { color: var(--text-dim); text-align: center; padding: 40px; font-style: italic; }
```

**Design rationale:** The `.docx-view` class mirrors `.markdown-view` structurally (same max-width, line-height, heading colors, table borders) but adds specific rules for Word-generated HTML: list indentation, list item spacing, image max-width, and explicit bold/italic styles. mammoth outputs semantic HTML (`<strong>`, `<em>`, `<table>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>`, `<p>`, `<img>`) so these selectors cover the full output surface.

---

## Unit C: CLI Viewer

**File:** `src/cli/commands/view.ts`

### C.1 Import Statement

Add at the top of `view.ts`, after the existing imports (after line 2):

```typescript
import mammoth from "mammoth";
```

**Exact location:** After `import { BlobClient } from "../../core/blob-client.js";` (line 2).

### C.2 Restructured `viewBlob()` Function

**Exact location:** `view.ts`, lines 32-50. The function currently converts the buffer to UTF-8 on line 34 for all formats, then branches. This is incorrect for binary formats (DOCX, PDF). The restructured code moves the UTF-8 conversion inside text-format branches and adds DOCX handling on the raw buffer.

**Current code (lines 32-50):**
```typescript
  const blob = await client.getBlobContent(container, blobName);
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  const text = blob.content.toString("utf-8");

  if (ext === "json") {
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  } else if (ext === "md") {
    // Render markdown as plain text with structure hints
    console.log(text);
  } else if (ext === "pdf") {
    console.log(`[PDF file, ${blob.size} bytes — use "storage-nav download" to save locally]`);
  } else {
    console.log(text);
  }
```

**Replacement code:**
```typescript
  const blob = await client.getBlobContent(container, blobName);
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "docx" || ext === "doc") {
    try {
      const result = await mammoth.extractRawText({ buffer: blob.content as Buffer });
      console.log(result.value);
    } catch (convErr: unknown) {
      const msg = convErr instanceof Error ? convErr.message : String(convErr);
      console.error(`Failed to parse .docx file: ${msg}`);
      console.error('Use "storage-nav download" to save the file locally and open in Word.');
    }
  } else if (ext === "pdf") {
    console.log(`[PDF file, ${blob.size} bytes — use "storage-nav download" to save locally]`);
  } else {
    const text = blob.content.toString("utf-8");
    if (ext === "json") {
      try {
        const parsed = JSON.parse(text);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(text);
      }
    } else if (ext === "md") {
      console.log(text);
    } else {
      console.log(text);
    }
  }
```

### C.3 Key Design Decisions

1. **Binary-safe buffer handling:** The `blob.content.toString("utf-8")` call is moved inside the `else` branch so it only runs for text-based formats. DOCX and PDF branches operate on the raw `Buffer` directly. This prevents mangling binary data.
2. **DOCX branch placement:** Before PDF, so the extension check happens early. Both are binary formats that skip UTF-8 conversion.
3. **Error message:** On failure, prints a clear error and suggests `storage-nav download` as a fallback, matching the pattern used for PDF files.

---

## Unit D: Dependency Installation

**File:** `package.json`

### D.1 Add mammoth Dependency

**Current `dependencies` block (lines 25-31):**
```json
  "dependencies": {
    "@azure/storage-blob": "^12.31.0",
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "express": "^5.2.1",
    "highlight.js": "^11.11.1",
    "marked": "^17.0.5"
  },
```

**Replacement:**
```json
  "dependencies": {
    "@azure/storage-blob": "^12.31.0",
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "express": "^5.2.1",
    "highlight.js": "^11.11.1",
    "mammoth": "^1.12.0",
    "marked": "^17.0.5"
  },
```

**Installation command:** `npm install mammoth`

---

## Complete File Change Summary

| File | Unit | Changes |
|------|------|---------|
| `package.json` | D | Add `"mammoth": "^1.12.0"` to `dependencies` |
| `src/electron/server.ts` | A | Add `import mammoth`; insert DOCX conversion logic with `?format=` parameter detection in GET blob endpoint (between getBlobContent call and response send) |
| `src/electron/public/app.js` | B | Add `docx`/`doc` icon in `getFileIcon()`; add DOCX branch in `viewFile()` that fetches `&format=html` and renders in `<div class="docx-view">`; add DOCX MIME type in `createSave` handler |
| `src/electron/public/styles.css` | B | Add `.docx-view` CSS class block (headings, paragraphs, tables, lists, images, bold, italic) after `.markdown-view` |
| `src/cli/commands/view.ts` | C | Add `import mammoth`; restructure `viewBlob()` to handle DOCX with raw `Buffer` via `extractRawText()`; move `toString("utf-8")` inside text-format branch |

## Files NOT Modified

| File | Reason |
|------|--------|
| `src/core/blob-client.ts` | Already returns raw `Buffer`; no file-type-specific logic needed |
| `src/core/types.ts` | `BlobContent.content` is already `Buffer \| string`; no changes needed |
| `src/electron/public/index.html` | No new CDN scripts needed (mammoth runs server-side) |
| `src/electron/main.ts` | No changes to Electron bootstrap |
| `src/electron/launch.ts` | No changes to window launcher |

---

## Acceptance Criteria Traceability

| AC | Description | Verified By |
|---|---|---|
| AC-1 | `.docx` in UI renders as formatted HTML (headings, paragraphs, bold, italic, lists, tables) | Unit A (server conversion) + Unit B (UI rendering) |
| AC-2 | CLI `view` command prints extracted text for `.docx` | Unit C |
| AC-3 | Tree view shows distinct icon for `.docx` files | Unit B, section B.1 |
| AC-4 | Corrupted/unparseable `.docx` shows meaningful error (not crash) | Unit A (HTTP 422), Unit B (catch block), Unit C (try/catch) |
| AC-5 | Existing file type viewers (JSON, MD, PDF, TXT) unchanged | No modifications to existing branches; `?format=` is opt-in; UTF-8 refactor preserves behavior |
| AC-6 | `mammoth` listed in `package.json` `dependencies` | Unit D |
| AC-7 | No configuration fallback values introduced | No new config parameters; feature works out of the box |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| mammoth fails on complex documents | Medium | try/catch with actionable error message; suggest download as fallback |
| Large `.docx` causes slow conversion | Low | mammoth is pure JS, processes in-memory; acceptable for document viewing |
| Embedded images inflate HTML response | Low | mammoth embeds as inline base64 by default; leave as-is (free functionality) |
| HTML injection from malicious `.docx` | Low | mammoth produces HTML from OOXML structure, not arbitrary user HTML; add DOMPurify later if needed |
| Breaking change to blob endpoint | None | `?format=` parameter is opt-in; omitting preserves all existing behavior |
