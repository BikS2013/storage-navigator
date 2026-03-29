# Investigation: DOCX File Viewing Support

**Date:** 2026-03-29
**Context:** Storage Navigator needs to render `.docx` files in both the Electron/web UI (as HTML) and the CLI (as plain text). This document evaluates available Node.js libraries and recommends an approach.

---

## 1. Library Evaluation

### 1.1 mammoth.js

| Criterion | Assessment |
|---|---|
| **npm package** | `mammoth` |
| **Latest version** | 1.12.0 |
| **License** | BSD-2-Clause (compatible with MIT) |
| **Unpacked size** | ~2.17 MB |
| **Weekly downloads** | ~200k+ (most popular in this category, ~882 dependents) |
| **TypeScript support** | Ships with built-in type definitions since v1.6+ |
| **Node.js support** | Full server-side support; also has a browser build |
| **Active maintenance** | Yes, regular releases through 2025-2026 |
| **Dependencies** | `jszip`, `argparse`, `lop`, `sax`, `underscore` (pure JS, no native modules) |

**Capabilities:**
- `convertToHtml({ buffer })` -- converts docx buffer to semantic HTML
- `extractRawText({ buffer })` -- extracts plain text (ideal for CLI)
- Accepts `Buffer` directly, which matches our `BlobContent.content` type
- Supports: headings, paragraphs, bold/italic/underline/strikethrough, tables (including merged cells), ordered/unordered lists, footnotes/endnotes, line breaks, text boxes, images (inline base64 by default), superscript/subscript
- Custom style mapping (e.g., map Word style "WarningHeading" to `h1.warning`)

**Limitations:**
- Semantic conversion, not visual fidelity -- ignores fonts, colors, exact spacing
- Table borders and cell formatting are stripped
- Complex layouts (multi-column, text wrapping around images) are simplified
- Charts and SmartArt are not converted
- Images may fail silently on some documents
- No sanitization of output HTML (security consideration for untrusted input)

**Verdict:** Best overall fit. Mature, lightweight, dual API (HTML + plain text), works server-side with Buffer input, no native dependencies.

---

### 1.2 docx-preview / docx-preview-node

| Criterion | Assessment |
|---|---|
| **npm package** | `docx-preview` (browser) / `docx-preview-node` (Node.js fork) |
| **Latest version** | 0.3.7 / 0.3.6 |
| **License** | Apache-2.0 |
| **TypeScript support** | Yes |
| **Node.js support** | `docx-preview` is browser-only (requires DOM APIs). The `docx-preview-node` fork uses jsdom to polyfill browser globals. |
| **Active maintenance** | Moderate; the Node.js fork has fewer contributors |

**Capabilities:**
- WYSIWYG rendering -- attempts to reproduce the visual appearance of the document
- Higher visual fidelity than mammoth for formatted documents

**Limitations:**
- The main package (`docx-preview`) does not work in Node.js
- The Node.js fork (`docx-preview-node`) adds jsdom as a heavy dependency (~20+ MB)
- No plain text extraction API (would need to strip HTML for CLI use)
- Lower adoption than mammoth (~205 dependents vs ~882)
- WYSIWYG approach produces complex, style-heavy HTML that is harder to render cleanly in a simple viewer

**Verdict:** Not recommended. The jsdom dependency is heavy, the Node fork is a secondary project with lower maintenance, and it lacks a plain text extraction API for the CLI.

---

### 1.3 docx-html-renderer

| Criterion | Assessment |
|---|---|
| **npm package** | `docx-html-renderer` |
| **Latest version** | 0.1.10 |
| **License** | ISC |
| **TypeScript support** | Native TypeScript |
| **Node.js support** | Yes (ESM + UMD) |
| **Active maintenance** | Low; version 0.1.x suggests early stage |

**Capabilities:**
- Aims for visual fidelity with configurable options
- Supports page breaks, headers/footers, footnotes/endnotes, tracked changes, comments

**Limitations:**
- Very early stage (v0.1.10)
- Minimal adoption (no significant dependents listed)
- No plain text extraction API
- Untested at scale

**Verdict:** Not recommended. Too immature for production use and lacks plain text extraction.

---

### 1.4 @omer-go/docx-parser-converter-ts

| Criterion | Assessment |
|---|---|
| **npm package** | `@omer-go/docx-parser-converter-ts` |
| **Latest version** | 0.0.1 |
| **License** | Not clearly documented |
| **TypeScript support** | Native TypeScript |
| **Node.js support** | Primarily browser; Node.js compatibility not guaranteed |

**Capabilities:**
- Converts DOCX to HTML and plain text
- Detailed style hierarchy parsing

**Limitations:**
- Version 0.0.1 -- pre-release quality
- Browser-first, Node.js may produce errors
- Extremely low adoption
- Ported from Python, maturity unclear

**Verdict:** Not recommended. Pre-release, browser-only, no community adoption.

---

### 1.5 libreoffice-convert

| Criterion | Assessment |
|---|---|
| **npm package** | `libreoffice-convert` |
| **Approach** | Shells out to a local LibreOffice installation |

**Capabilities:**
- High-fidelity conversion (uses the full LibreOffice engine)
- Supports virtually all Word features

**Limitations:**
- Requires LibreOffice to be installed on the machine (1+ GB)
- Not suitable for Electron distribution -- cannot bundle LibreOffice
- Slow (spawns a process for each conversion)
- Non-starter for a lightweight desktop/CLI tool

**Verdict:** Not recommended. External dependency on LibreOffice makes it impractical for this project.

---

### 1.6 docx4js / docx2html

| Criterion | Assessment |
|---|---|
| **npm package** | `docx4js` / `docx2html` |
| **Maintenance** | Last updated years ago; effectively abandoned |

**Verdict:** Not recommended. Unmaintained.

---

## 2. Comparison Summary

| Library | Node.js | Plain Text API | HTML Quality | Bundle Weight | Maturity | Recommendation |
|---|---|---|---|---|---|---|
| **mammoth** | Full | `extractRawText()` | Clean semantic HTML | ~2.2 MB (pure JS) | High (v1.12, 882 deps) | **RECOMMENDED** |
| docx-preview-node | Via jsdom | No | WYSIWYG | Heavy (jsdom ~20 MB) | Medium | Not recommended |
| docx-html-renderer | Yes | No | Visual fidelity | Small | Low (v0.1) | Not recommended |
| @omer-go/docx-parser-converter-ts | Partial | Yes | Visual fidelity | Small | Very low (v0.0.1) | Not recommended |
| libreoffice-convert | Yes | Via LibreOffice | Excellent | Requires LibreOffice | High | Not recommended (external dep) |
| docx4js / docx2html | Yes | No | Basic | Medium | Abandoned | Not recommended |

---

## 3. Architecture Decision: Server-Side vs Client-Side Conversion

### Option A: Server-Side Conversion (Recommended)

The Express server in `server.ts` converts the `.docx` buffer to HTML before sending to the browser.

**Advantages:**
- Keeps the frontend lightweight -- no additional JS library loaded in the browser
- Consistent with how the existing architecture works (server fetches blob, processes, serves)
- Single conversion library instance in the Node.js process
- The `mammoth` package is designed for Node.js; its server-side API is the primary use case
- CLI and server share the same dependency

**Implementation:** Add a `?format=html` query parameter to the existing `/api/blob/:storage/:container` endpoint. When `format=html` is specified and the blob is `.docx`, convert using `mammoth.convertToHtml()` and return `Content-Type: text/html`.

### Option B: Client-Side Conversion

Load `mammoth.browser.min.js` via CDN in the frontend and convert in the browser.

**Advantages:**
- No server changes needed
- Offloads CPU work to the client

**Disadvantages:**
- Adds ~800 KB to the browser bundle (mammoth browser build)
- Cannot share the library with the CLI
- Two separate loading paths to maintain
- Inconsistent with the existing pattern where the server handles content delivery

### Decision

**Server-side conversion (Option A)** is the recommended approach. It aligns with the existing architecture, keeps the frontend simple, and allows both CLI and UI to share a single `mammoth` dependency.

---

## 4. Recommended Approach

### Library: mammoth v1.12.0

**Justification:**
1. **Dual API** -- `convertToHtml()` for the UI and `extractRawText()` for the CLI, both accepting a `Buffer` directly
2. **Proven and mature** -- v1.12, 882+ dependents, active maintenance
3. **Lightweight** -- pure JavaScript, no native modules, ~2.2 MB unpacked
4. **License compatible** -- BSD-2-Clause is permissive and compatible with this project's ISC license
5. **Node.js first** -- designed for server-side use, which matches our architecture
6. **Buffer input** -- accepts `Buffer` directly via `{ buffer: blob.content }`, matching the existing `BlobContent.content` type with zero adaptation

### Integration Summary

| Component | Action | mammoth API |
|---|---|---|
| **CLI** (`view.ts`) | Add `.docx` branch; extract and print plain text | `mammoth.extractRawText({ buffer })` |
| **Server** (`server.ts`) | Detect `.docx` + `?format=html`; convert and return HTML | `mammoth.convertToHtml({ buffer })` |
| **UI** (`app.js`) | Add `.docx` branch in `viewFile()`; fetch HTML from server; render in `<div class="docx-view">` | N/A (consumes server HTML) |
| **UI** (`app.js`) | Add `.docx` icon in `getFileIcon()` | N/A |
| **Styles** (`styles.css`) | Add `.docx-view` CSS class for document styling | N/A |
| **Dependencies** (`package.json`) | `npm install mammoth` | N/A |

### Error Handling

- Wrap `mammoth.convertToHtml()` and `mammoth.extractRawText()` in try/catch
- If parsing fails, the UI shows a user-friendly error with a download suggestion
- If parsing fails in CLI, print an error message and suggest using `download` command
- This handles cases where a file has a `.docx` extension but is not a valid OOXML document

### Images

- Per the refined specification, embedded images are out of scope for the initial implementation
- mammoth embeds images as inline base64 by default; this can be left as-is (free functionality) or suppressed via a custom `convertImage` handler that returns empty content
- Recommendation: leave default behavior (inline base64) -- it works without extra effort and provides value at no cost

---

## 5. Technical Research Guidance

**Research needed: No**

The investigation is conclusive. mammoth.js is the clear winner across all evaluation criteria -- maturity, API fit, license, Node.js support, and dual HTML/text extraction. No further deep research is required before proceeding to implementation.

The following topics would only need revisiting if requirements change:

| Topic | When to revisit |
|---|---|
| High-fidelity WYSIWYG rendering | If users demand pixel-perfect reproduction of Word formatting |
| Client-side conversion | If server performance becomes a bottleneck with large documents |
| Image handling customization | If embedded images need to be extracted to separate blob storage |
| HTML sanitization | If the app begins accepting untrusted `.docx` uploads from external users |

---

## Sources

- [mammoth on npm](https://www.npmjs.com/package/mammoth)
- [mammoth.js on GitHub](https://github.com/mwilliamson/mammoth.js/)
- [mammoth on Bundlephobia](https://bundlephobia.com/package/mammoth)
- [docx-preview on npm](https://www.npmjs.com/package/docx-preview)
- [docx-preview-node on npm](https://www.npmjs.com/package/docx-preview-node)
- [docx-html-renderer on Libraries.io](https://libraries.io/npm/docx-html-renderer)
- [@omer-go/docx-parser-converter-ts on npm](https://www.npmjs.com/package/@omer-go/docx-parser-converter-ts)
- [Mammoth Guide (2025)](https://generalistprogrammer.com/tutorials/mammoth-npm-package-guide)
- [npm library comparison](https://npm-compare.com/docx-preview,docxtemplater,jszip,mammoth,officegen)
