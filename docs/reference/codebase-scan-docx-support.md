# Codebase Scan: DOCX Support Integration Points

## 1. Project Structure

```
src/
  core/
    types.ts             -- Shared TypeScript interfaces (StorageEntry, BlobItem, BlobContent, etc.)
    blob-client.ts       -- Azure Blob Storage client: list containers, list blobs, get/create/rename/delete blob content
    credential-store.ts  -- Encrypted credential persistence (AES-256-GCM)
  cli/
    index.ts             -- Commander-based CLI entry point
    commands/
      view.ts            -- CLI "view" and "download" commands (renders blob content to terminal)
      blob-ops.ts        -- CLI "rename", "delete", "create" commands
      add-storage.ts     -- CLI "add" command
      list-storages.ts   -- CLI "list" command
      remove-storage.ts  -- CLI "remove" command
  electron/
    main.ts              -- Electron/Express bootstrap
    launch.ts            -- Electron window launcher
    server.ts            -- Express HTTP server (serves static UI + REST API for blob operations)
    public/
      index.html         -- Single-page app shell (loads highlight.js, marked.js via CDN)
      app.js             -- Frontend application logic (tree browser, file viewer, CRUD operations)
      styles.css          -- UI styles (dark/light theme)
      favicon.png
```

## 2. Key Files for DOCX Integration

### `src/core/blob-client.ts`
- **`getBlobContent(container, blobName): Promise<BlobContent>`** (line 115) -- Downloads blob as a raw `Buffer`. This is the single data-fetch function used by both CLI and UI. Returns `{ content: Buffer, contentType, size, name }`.
- No file-type-specific logic here; it returns raw bytes regardless of type.

### `src/core/types.ts`
- **`BlobContent`** interface (line 37) -- `content` is typed as `Buffer | string`. The server sends this directly via `res.send(blob.content)`.

### `src/electron/server.ts`
- **GET `/api/blob/:storage/:container?blob=<path>`** (line 83) -- Fetches blob content and sends it to the browser with the original `Content-Type` header. For PDF, the browser receives the raw binary and renders it in an iframe. For text-based formats, the browser receives text and parses it in JavaScript.
- The server does **no format conversion** -- it passes raw bytes through. For DOCX, this means the server may need a new endpoint or middleware to convert `.docx` binary into HTML before sending to the browser.

### `src/electron/public/app.js`
- **`getFileIcon(name)`** (line 250) -- Maps file extensions to emoji icons. Currently handles: `json`, `md`, `pdf`, `txt`. Falls back to a generic clip icon.
- **`viewFile(container, blobName, size)`** (line 260) -- The main rendering dispatcher. Routes by file extension:
  - `pdf` -> embeds in an `<iframe>` pointing at the blob API URL (line 271)
  - `json` -> fetches as text, parses, syntax-highlights with highlight.js (line 278)
  - `md` -> fetches as text, renders with `marked.parse()`, highlights code blocks (line 287)
  - everything else -> fetches as text, displays in a `<pre>` tag (line 293)
- **`createSave` handler** (line 507) -- Sets `contentType` when creating blobs. Currently maps `json`, `html`, `md`. Would need a `docx` mapping.

### `src/cli/commands/view.ts`
- **`viewBlob(storageName, container, blobName)`** (line 22) -- CLI viewer. Routes by extension:
  - `json` -> pretty-prints parsed JSON (line 36)
  - `md` -> dumps raw text (line 43)
  - `pdf` -> prints a message directing user to download (line 45)
  - everything else -> dumps raw text (line 48)
- Downloads via `client.getBlobContent()`, converts buffer to UTF-8 string (`blob.content.toString("utf-8")`).

## 3. Existing File Type Handling Patterns

| Type | UI (app.js) | CLI (view.ts) | Server (server.ts) |
|------|-------------|---------------|---------------------|
| **JSON** | Fetch as text, `JSON.parse`, highlight.js syntax coloring | `JSON.parse` + `JSON.stringify(null, 2)` | Pass-through (raw bytes) |
| **Markdown** | Fetch as text, `marked.parse()` to HTML, highlight code blocks | Print raw text | Pass-through |
| **PDF** | `<iframe>` with direct blob URL (browser-native PDF viewer) | Print "use download" message | Pass-through (binary) |
| **Text** | Fetch as text, display in `<pre>` | Print raw text | Pass-through |

**Pattern summary**: The server always passes raw blob bytes. Text-based formats are handled client-side in the browser. PDF leverages the browser's native viewer via iframe. The CLI converts buffer to UTF-8 for text formats and punts on binary formats.

## 4. Integration Points for DOCX Support

### 4.1 UI Rendering (app.js)

**`getFileIcon(name)`** -- Add `docx` / `doc` icon mapping (line 250-257):
```javascript
if (ext === "docx" || ext === "doc") return "\uD83D\uDCC4"; // or a Word-specific icon
```

**`viewFile(container, blobName, size)`** -- Add a `docx` branch before the default case (around line 270). Two approaches:
- **Option A (server-side conversion)**: Request a new API endpoint that returns HTML. Render the returned HTML in a `<div class="docx-view">`.
- **Option B (client-side conversion)**: Fetch the raw binary as an ArrayBuffer, convert to HTML using a library like `mammoth.js` in the browser, then inject into `contentBody`.

### 4.2 Server-Side Conversion (server.ts)

If choosing server-side conversion, add a new endpoint or modify the existing GET `/api/blob/...` to detect `.docx` and convert:
- Use a library like `mammoth` (Node.js) to convert the `Buffer` from `getBlobContent()` into HTML.
- Return the HTML with `Content-Type: text/html`.
- Location: after line 93 in `server.ts`, add extension detection and conversion logic.

### 4.3 CLI Viewer (view.ts)

**`viewBlob()`** -- Add a `docx` branch (after line 45):
- Use `mammoth` to extract raw text from the buffer.
- Print the extracted text to the terminal.
- Alternatively, print a "use download" message like PDF does.

### 4.4 Content Type Mapping (app.js createSave)

In the `createSave` click handler (line 519), add:
```javascript
else if (ext === "docx") contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
```

### 4.5 BlobContent Type (types.ts)

No changes required. `BlobContent.content` is already `Buffer | string`, which handles binary docx data.

## 5. Current Dependencies

### Runtime
| Package | Version | Purpose |
|---------|---------|---------|
| `@azure/storage-blob` | ^12.31.0 | Azure Blob Storage SDK |
| `chalk` | ^5.6.2 | CLI colored output |
| `commander` | ^14.0.3 | CLI argument parsing |
| `express` | ^5.2.1 | HTTP server for UI |
| `highlight.js` | ^11.11.1 | Syntax highlighting (loaded via CDN in browser) |
| `marked` | ^17.0.5 | Markdown rendering (loaded via CDN in browser) |

### Dev
| Package | Version | Purpose |
|---------|---------|---------|
| `@types/express` | ^5.0.6 | TypeScript types |
| `@types/node` | ^25.5.0 | TypeScript types |
| `electron` | ^41.1.0 | Desktop shell |
| `electron-builder` | ^26.8.1 | Packaging |
| `esbuild` | ^0.27.4 | Bundler |
| `tsx` | ^4.21.0 | TypeScript execution |
| `typescript` | ^6.0.2 | Compiler |

### New Dependency Required for DOCX
- **`mammoth`** -- Converts `.docx` to HTML (server-side, Node.js). Lightweight, no native dependencies. Alternatively, `mammoth.browser.min.js` can be loaded client-side via CDN for browser-only conversion.

## 6. Recommended Integration Strategy

1. **Install `mammoth`** as a runtime dependency.
2. **Server-side** (`server.ts`): Detect `.docx` extension in the GET blob endpoint. When detected, convert the binary buffer to HTML using `mammoth.convertToHtml()` and return HTML with appropriate content type. This keeps the browser code simple and avoids loading a large JS library client-side.
3. **UI** (`app.js`): Add `docx` to `getFileIcon()`. In `viewFile()`, add a `docx` branch that renders the returned HTML in a styled `<div class="docx-view">` (similar to the markdown rendering pattern).
4. **CLI** (`view.ts`): Add a `docx` branch using `mammoth.extractRawText()` to dump plain text to the terminal.
5. **Styles** (`styles.css`): Add `.docx-view` CSS class for proper document styling (margins, table borders, heading sizes, etc.).
