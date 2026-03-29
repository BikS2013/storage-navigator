# Plan 001: DOCX File Viewing Support

**Date:** 2026-03-29
**Status:** Draft
**References:**
- `docs/reference/refined-request-docx-support.md` (requirements, acceptance criteria)
- `docs/reference/investigation-docx-support.md` (library evaluation, architecture decision)
- `docs/reference/codebase-scan-docx-support.md` (integration points, existing patterns)

---

## Overview

Add `.docx` file viewing support to Storage Navigator. The UI renders docx content as formatted HTML (server-side conversion). The CLI extracts and prints plain text. The library chosen is `mammoth` v1.12+ (BSD-2-Clause, pure JS, dual API for HTML and plain text).

---

## Phase Dependencies

```
Phase 1 (mammoth install)
   |
   +---> Phase 2 (server-side conversion) --independent--+
   |                                                       |
   +---> Phase 3 (UI viewer update)       --independent--+--> Phase 5 (documentation)
   |                                                       |
   +---> Phase 4 (CLI viewer update)      --independent--+
```

- Phase 1 must complete before Phases 2, 3, 4.
- Phases 2, 3, 4 are independent of each other and can be developed in parallel.
- Phase 5 runs after all other phases are complete.

---

## Phase 1: Install mammoth Dependency

### Objective
Add the `mammoth` npm package as a production dependency.

### Steps

1. Run `npm install mammoth` in the project root.
2. Verify `mammoth` appears in `package.json` under `dependencies`.
3. Verify TypeScript types are available (mammoth ships built-in types since v1.6+). Confirm by checking that `import mammoth from "mammoth"` compiles without errors.

### Files Modified
| File | Change |
|------|--------|
| `package.json` | New entry under `dependencies`: `"mammoth": "^1.12.0"` |
| `package-lock.json` | Auto-updated by npm |

### Acceptance Criteria
- [ ] `mammoth` is listed in `package.json` `dependencies` (not `devDependencies`).
- [ ] `npm ls mammoth` shows the package installed.
- [ ] A minimal TypeScript import (`import mammoth from "mammoth"`) compiles without type errors.

---

## Phase 2: Server-Side DOCX Conversion (`src/electron/server.ts`)

### Objective
Extend the existing GET blob endpoint to convert `.docx` buffers to HTML or plain text when requested via a `?format=` query parameter.

### Current State
- **File:** `src/electron/server.ts`
- **Endpoint:** `GET /api/blob/:storage/:container?blob=<path>` (line 83)
- The server currently passes raw blob bytes through to the client with the original `Content-Type` header. No format conversion is performed.

### Steps

1. **Add mammoth import** at the top of `server.ts`:
   ```typescript
   import mammoth from "mammoth";
   ```

2. **Detect the `format` query parameter** in the GET blob endpoint (after line 93, where `blob` is fetched):
   ```typescript
   const format = req.query.format as string | undefined;
   const blobExt = blobPath.split(".").pop()?.toLowerCase();
   ```

3. **Add docx conversion logic** before the existing `res.send(blob.content)`:
   - If `blobExt === "docx"` and `format === "html"`:
     - Call `mammoth.convertToHtml({ buffer: blob.content as Buffer })`
     - On success: return the HTML string with `Content-Type: text/html; charset=utf-8`
     - On failure: return HTTP 422 with a JSON error message
   - If `blobExt === "docx"` and `format === "text"`:
     - Call `mammoth.extractRawText({ buffer: blob.content as Buffer })`
     - On success: return the text string with `Content-Type: text/plain; charset=utf-8`
     - On failure: return HTTP 422 with a JSON error message
   - If `format` is not specified (or the file is not `.docx`): fall through to the existing pass-through behavior (no breaking change).

4. **Wrap mammoth calls in try/catch** to handle corrupted or invalid `.docx` files gracefully. Return a structured JSON error with HTTP 422 and a message suggesting the user download the file instead.

### Implementation Detail

The conversion block should be inserted between the `getBlobContent` call (line 93) and the response headers/send (lines 95-98). The existing pass-through behavior becomes the `else` branch:

```typescript
const blob = await client.getBlobContent(req.params.container, blobPath);

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

// Existing pass-through for all other cases
res.setHeader("Content-Type", blob.contentType);
res.setHeader("X-Blob-Name", blob.name);
res.setHeader("X-Blob-Size", String(blob.size));
res.send(blob.content);
```

### Files Modified
| File | Change |
|------|--------|
| `src/electron/server.ts` | Add `mammoth` import; add docx conversion logic in GET blob endpoint |

### Acceptance Criteria
- [ ] `GET /api/blob/:s/:c?blob=file.docx&format=html` returns valid HTML with `Content-Type: text/html`.
- [ ] `GET /api/blob/:s/:c?blob=file.docx&format=text` returns plain text with `Content-Type: text/plain`.
- [ ] `GET /api/blob/:s/:c?blob=file.docx` (no format param) returns raw binary (backward compatible).
- [ ] `GET /api/blob/:s/:c?blob=file.json&format=html` ignores the format param and returns raw JSON (non-docx files unaffected).
- [ ] A corrupted `.docx` returns HTTP 422 with a JSON error message, not a crash.
- [ ] Existing blob endpoint behavior for JSON, MD, PDF, TXT files is unchanged.

---

## Phase 3: UI Viewer Update (`src/electron/public/app.js` + `styles.css`)

### Objective
Display `.docx` files as formatted HTML in the browser UI, with a dedicated file tree icon.

### Current State
- **File:** `src/electron/public/app.js`
- `getFileIcon(name)` (line 250): maps `json`, `md`, `pdf`, `txt` to emoji icons.
- `viewFile(container, blobName, size)` (line 260): dispatches rendering by extension (pdf -> iframe, json -> highlight.js, md -> marked.parse, default -> `<pre>`).
- `createSave` handler (line 519): maps extensions to content types for blob creation.
- **File:** `src/electron/public/styles.css`
- `.markdown-view` class (line 234): styles for rendered markdown content.

### Steps

#### 3.1 Add DOCX Icon in `getFileIcon()` (app.js, line 250)

Insert a new branch before the fallback:
```javascript
if (ext === "docx" || ext === "doc") return "\uD83D\uDCE4"; // inbox tray, or use "\uD83C\uDFA9" etc.
```

Choose an icon distinct from existing ones (`json`=clipboard, `md`=memo, `pdf`=page, `txt`=page-with-curl). Recommended: `\uD83D\uDCDD` is taken (memo/md), so use `\u2709` (envelope) or simply the letter-W emoji. The exact emoji is a design choice; what matters is it is distinct.

#### 3.2 Add DOCX Branch in `viewFile()` (app.js, line 269)

Insert a new `else if` branch after the `pdf` check and before the `json` check:

```javascript
if (ext === "pdf") {
  // existing pdf handling...
} else if (ext === "docx" || ext === "doc") {
  const docxUrl = `${url}&format=html`;
  const res = await api(docxUrl);
  const html = await res.text();
  contentBody.innerHTML = `<div class="docx-view">${html}</div>`;
} else if (ext === "json") {
  // existing json handling...
}
```

**Error handling:** Wrap in try/catch (the outer try/catch at line 269 already covers this). If the server returns a 422, the `api()` helper should throw, and the catch block displays the error.

#### 3.3 Add Content Type Mapping in `createSave` Handler (app.js, line 519)

Add a docx content type branch:
```javascript
else if (ext === "docx") contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
```

#### 3.4 Add `.docx-view` CSS Class (styles.css)

Add after the existing `.markdown-view` styles (line 240). Reuse the same structural styling as markdown with minor adjustments for Word-specific HTML output:

```css
/* DOCX */
.docx-view { font-size: 14px; line-height: 1.7; max-width: 800px; }
.docx-view h1, .docx-view h2, .docx-view h3 { color: var(--text-accent); margin-top: 1em; }
.docx-view p { margin: 0.5em 0; }
.docx-view table { border-collapse: collapse; margin: 1em 0; width: 100%; }
.docx-view th, .docx-view td { border: 1px solid var(--table-border); padding: 6px 12px; text-align: left; }
.docx-view th { background: var(--table-header); }
.docx-view ul, .docx-view ol { padding-left: 2em; }
.docx-view img { max-width: 100%; height: auto; }
```

### Files Modified
| File | Change |
|------|--------|
| `src/electron/public/app.js` | Add docx icon in `getFileIcon()`; add docx branch in `viewFile()`; add docx content type in `createSave` |
| `src/electron/public/styles.css` | Add `.docx-view` CSS class |

### Acceptance Criteria
- [ ] Clicking a `.docx` file in the UI tree renders formatted HTML (headings, paragraphs, bold, italic, lists, tables visible).
- [ ] The file tree shows a distinct icon for `.docx` files, different from JSON, MD, PDF, TXT icons.
- [ ] A corrupted `.docx` shows a user-friendly error message in the content panel.
- [ ] Creating a `.docx` blob via the UI sets the correct MIME content type.
- [ ] Existing file type rendering (JSON, MD, PDF, TXT) is unaffected.

---

## Phase 4: CLI Viewer Update (`src/cli/commands/view.ts`)

### Objective
Display `.docx` file content as plain text in the terminal when using the `view` command.

### Current State
- **File:** `src/cli/commands/view.ts`
- `viewBlob()` (line 22): downloads blob via `client.getBlobContent()`, then branches on extension.
- Currently converts buffer to UTF-8 string on line 34 for all types. For `.docx` (binary), this produces garbage.

### Steps

1. **Add mammoth import** at the top of `view.ts`:
   ```typescript
   import mammoth from "mammoth";
   ```

2. **Add `.docx` branch** in the `viewBlob()` function, after the `pdf` branch (line 46) and before the default `else` (line 48). The docx branch must operate on the raw `Buffer`, not the UTF-8 string:

   ```typescript
   } else if (ext === "docx" || ext === "doc") {
     try {
       const result = await mammoth.extractRawText({ buffer: blob.content as Buffer });
       console.log(result.value);
     } catch (convErr: unknown) {
       const msg = convErr instanceof Error ? convErr.message : String(convErr);
       console.error(`Failed to parse .docx file: ${msg}`);
       console.error('Use "storage-nav download" to save the file locally and open in Word.');
     }
   }
   ```

3. **Move the UTF-8 conversion** (line 34: `const text = blob.content.toString("utf-8")`) to only execute for text-based formats (json, md, default), not for docx/pdf. This prevents unnecessary conversion of binary data. The refactored structure:

   ```typescript
   const blob = await client.getBlobContent(container, blobName);
   const ext = blobName.split(".").pop()?.toLowerCase() ?? "";

   if (ext === "docx" || ext === "doc") {
     // Use raw buffer, not UTF-8 string
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

   This restructuring moves the `toString("utf-8")` call inside the text-format branches, avoiding it for binary formats (docx, pdf). It is a minor refactor that improves correctness without changing behavior for existing formats.

### Files Modified
| File | Change |
|------|--------|
| `src/cli/commands/view.ts` | Add `mammoth` import; add `.docx` branch; restructure to avoid UTF-8 conversion of binary formats |

### Acceptance Criteria
- [ ] `npx tsx src/cli/index.ts view --container <c> --blob <file.docx>` prints readable plain text.
- [ ] A corrupted `.docx` prints a clear error message and suggests using `download`.
- [ ] Existing CLI behavior for JSON, MD, PDF, TXT files is unchanged.
- [ ] No garbled binary output appears for `.docx` files.

---

## Phase 5: Documentation

### Objective
Update project documentation to reflect the new `.docx` viewing capability.

### Steps

1. **Update `CLAUDE.md`** (project root):
   - In the `storage-nav` tool documentation, add `.docx` to the list of supported file types in the `<objective>` section.
   - Add a usage example for viewing a `.docx` file:
     ```
     # View a Word document
     npx tsx src/cli/index.ts view --container docs --blob "reports/quarterly.docx"
     ```

2. **Update `docs/design/project-functions.md`** (create if it does not exist):
   - Add a feature entry for DOCX viewing support, describing CLI and UI capabilities.

3. **Update `docs/design/project-design.md`** (create if it does not exist):
   - Add docx support to the architecture description, noting the mammoth dependency and server-side conversion pattern.

### Files Modified
| File | Change |
|------|--------|
| `CLAUDE.md` | Add docx to supported types; add CLI example |
| `docs/design/project-functions.md` | Add DOCX viewing feature description |
| `docs/design/project-design.md` | Add docx to architecture description |

### Acceptance Criteria
- [ ] `CLAUDE.md` mentions `.docx` viewing support and includes an example command.
- [ ] `docs/design/project-functions.md` has a feature entry for DOCX support.

---

## Summary of All Files Modified

| Phase | File | Type of Change |
|-------|------|----------------|
| 1 | `package.json` | Add `mammoth` dependency |
| 1 | `package-lock.json` | Auto-updated |
| 2 | `src/electron/server.ts` | Add mammoth import + docx conversion in GET blob endpoint |
| 3 | `src/electron/public/app.js` | Add docx icon, viewer branch, content type mapping |
| 3 | `src/electron/public/styles.css` | Add `.docx-view` CSS class |
| 4 | `src/cli/commands/view.ts` | Add mammoth import + docx branch + binary-safe refactor |
| 5 | `CLAUDE.md` | Document docx support |
| 5 | `docs/design/project-functions.md` | Feature entry |
| 5 | `docs/design/project-design.md` | Architecture update |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| mammoth fails silently on complex documents | Wrap all mammoth calls in try/catch; return actionable error messages |
| Large `.docx` files cause slow conversion | mammoth is pure JS and processes in-memory; for the expected use case (document viewing), this is acceptable. No streaming API exists. |
| Embedded images inflate HTML response size | mammoth embeds images as inline base64 by default. Leave as-is for initial implementation; suppress via custom `convertImage` handler if needed later. |
| Breaking change to existing blob endpoint | The `?format=` parameter is opt-in; omitting it preserves existing behavior for all file types |
| HTML injection from malicious `.docx` content | mammoth produces semantic HTML from OOXML structure, not from arbitrary user HTML. Risk is low. If needed, add DOMPurify sanitization in a future iteration. |

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1 | 5 minutes |
| Phase 2 | 30 minutes |
| Phase 3 | 30 minutes |
| Phase 4 | 20 minutes |
| Phase 5 | 15 minutes |
| **Total** | **~1.5 hours** |
