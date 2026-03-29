# Refined Request: DOCX File Support for Storage Navigator

**Date:** 2026-03-29
**Source:** Raw user request — "I want you to make the navigator to support docx files"

---

## 1. Objective

Add native viewing support for Microsoft Word `.docx` files across both the CLI and the Electron/web UI of Storage Navigator. Users should be able to browse to a `.docx` blob in Azure Blob Storage and view its textual content directly, without needing to download the file and open it in an external application.

---

## 2. Scope

Both the **CLI viewer** and the **UI viewer** must be updated. The change touches the following areas:

| Layer | File(s) | Change |
|---|---|---|
| **CLI view command** | `src/cli/commands/view.ts` | Add a `.docx` branch that extracts and displays plain text from the downloaded buffer |
| **Server API** | `src/electron/server.ts` | Add a new endpoint (or extend the existing blob endpoint) to return docx content converted to HTML |
| **UI frontend** | `src/electron/public/app.js` | Handle `.docx` extension in `viewFile()` and render the converted HTML in the content panel |
| **UI tree icons** | `src/electron/public/app.js` | Add a dedicated icon for `.docx` files in `getFileIcon()` |
| **Dependencies** | `package.json` | Add a TypeScript-compatible docx parsing library (e.g., `mammoth` for docx-to-HTML conversion) |

The **blob-client** (`src/core/blob-client.ts`) requires **no changes** — it already downloads blob content as a raw `Buffer`, and the docx-to-text/HTML conversion will be performed at view time in the CLI command and the server API respectively.

---

## 3. Requirements

### 3.1 UI Viewer

- When the user clicks a `.docx` file in the tree, the content panel must render the document's textual content as **formatted HTML** (headings, paragraphs, bold/italic, lists, tables).
- The rendering approach must mirror how markdown is handled today: the raw blob buffer is fetched, converted server-side to HTML, and injected into a `<div class="docx-view">` element.
- A dedicated server endpoint or query-parameter variant (e.g., `?blob=...&format=html`) must perform the buffer-to-HTML conversion so the frontend receives ready-to-render HTML.
- Images embedded inside the docx are **out of scope** for the initial implementation; a placeholder or omission is acceptable.

### 3.2 CLI Viewer

- When the user runs `storage-nav view` on a `.docx` blob, the CLI must extract the **plain text** content and print it to the terminal (similar to how markdown files are displayed today).
- Structural markers (headings, list items) should be preserved where practical (e.g., prefix headings with `#`, indent list items).
- If the docx cannot be parsed, print a clear error message and suggest using `storage-nav download` instead.

### 3.3 Tree View Icon

- The `getFileIcon()` function in the UI frontend must return a distinct icon for `.docx` files. Recommended: the clipboard/document emoji distinct from existing icons (e.g., the "W" word-processing icon or a page-with-curl emoji).

### 3.4 Library Selection

- Use the `mammoth` npm package (MIT license, TypeScript-compatible, actively maintained) for converting `.docx` buffers to HTML (UI) and plain text (CLI).
- `mammoth` accepts a `Buffer` directly, which aligns with the existing `BlobContent.content` type returned by `blob-client.ts`.
- The library must be added as a production dependency via `npm install mammoth`.

### 3.5 Server-Side Conversion Approach

- The conversion from `.docx` buffer to HTML must happen **server-side** (in the Express server), not in the browser. This avoids shipping a large parsing library to the frontend.
- Two approaches are acceptable:
  - **Option A (preferred):** Add a query parameter `?format=html` to the existing `/api/blob/:storage/:container` endpoint. When `format=html` is present and the blob is a `.docx`, the server converts the buffer to HTML before responding with `Content-Type: text/html`.
  - **Option B:** Create a new endpoint `/api/blob-html/:storage/:container?blob=...` that always returns converted HTML for supported binary formats.

---

## 4. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC-1 | A `.docx` file selected in the UI tree renders as formatted HTML in the content panel (headings, paragraphs, bold, italic, lists visible). | Manual: upload a sample `.docx` to blob storage, click it in the UI, confirm rendered output. |
| AC-2 | The CLI `view` command for a `.docx` blob prints extracted text to the terminal. | Run `npx tsx src/cli/index.ts view --container <c> --blob <file.docx>` and verify text output. |
| AC-3 | The tree view shows a dedicated icon for `.docx` files, distinct from JSON, MD, PDF, and TXT icons. | Visual inspection of the tree after navigating to a container with `.docx` files. |
| AC-4 | If a `.docx` file is corrupted or unparseable, both CLI and UI display a meaningful error message rather than crashing. | Upload a renamed `.txt` file as `.docx` and attempt to view it. |
| AC-5 | Existing file type viewers (JSON, Markdown, PDF, plain text) continue to work unchanged. | Regression: view one file of each existing type after the change. |
| AC-6 | The `mammoth` library is listed in `package.json` under `dependencies`. | Inspect `package.json`. |
| AC-7 | No configuration fallback values are introduced; the feature works without any new configuration parameters. | Code review. |

---

## 5. Constraints

- **Language:** All implementation must be in TypeScript, consistent with the existing codebase.
- **Patterns:** Follow existing viewer patterns — the CLI branch in `view.ts` uses a file-extension switch; the UI `viewFile()` function branches on extension; the server endpoint returns content with appropriate headers.
- **No config fallbacks:** Per project rules, no default/fallback configuration values may be introduced. This feature requires no new configuration parameters.
- **Dependencies:** Only production-grade, MIT-licensed npm packages are acceptable. The `mammoth` package meets these criteria.
- **No breaking changes:** The existing `/api/blob/` endpoint behavior must remain unchanged for all current file types when the `format` query parameter is absent.
