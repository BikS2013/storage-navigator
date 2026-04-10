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

---

## Technical Design: Repository-to-Container Synchronization

**Date:** 2026-03-31
**Status:** Ready for implementation
**References:**
- `docs/reference/refined-request-repo-sync.md` (requirements)
- `docs/reference/investigation-repo-sync.md` (technical investigation)
- `docs/design/plan-002-repo-sync.md` (implementation plan)

### Feature Overview

Replicate GitHub and Azure DevOps repositories into Azure Blob Storage containers via REST APIs (no `git clone`), and keep them synchronized over time. PATs are stored in the existing encrypted credential store. Containers that mirror a repository carry a `.repo-sync-meta.json` metadata blob enabling on-demand sync from CLI and UI. No new npm dependencies required -- uses Node 18+ built-in `fetch`.

---

### Implementation Unit A: Types + Credential Store Extensions

**Files modified:** `src/core/types.ts`, `src/core/credential-store.ts`
**Dependencies:** None (foundation for all subsequent units)

#### A.1 New Interfaces in `src/core/types.ts`

Add after the existing `BlobContent` interface (after line 42):

```typescript
/** A stored Personal Access Token for repository access */
export interface TokenEntry {
  name: string;                          // user-chosen display name (e.g. "my-github-pat")
  provider: "github" | "azure-devops";   // which service this PAT authenticates against
  token: string;                         // PAT value (encrypted at rest with everything else)
  addedAt: string;                       // ISO timestamp of when the token was stored
  expiresAt?: string;                    // optional ISO timestamp for PAT expiry warning
}

/** Expiry status for a token */
export type TokenExpiryStatus = "valid" | "expiring-soon" | "expired" | "no-expiry";

/** Display-safe token info (no raw token) */
export interface TokenListItem {
  name: string;
  provider: "github" | "azure-devops";
  maskedToken: string;                   // first 4 chars + "****"
  addedAt: string;
  expiresAt?: string;
  expiryStatus: TokenExpiryStatus;
}

/** A single sync history entry */
export interface SyncHistoryEntry {
  syncedAt: string;                      // ISO timestamp
  commitSha: string;                     // commit SHA at time of sync
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  durationMs?: number;
}

/** Metadata blob stored at {prefix}.repo-sync-meta.json in mirrored containers */
export interface RepoSyncMeta {
  provider: "github" | "azure-devops";
  repository: string;                    // "owner/repo" or "org/project/repo"
  branch: string;
  prefix: string;                        // "" or "some/path/" (trailing slash)
  tokenName: string;                     // name of the PAT used for sync
  lastSyncedAt: string;                  // ISO timestamp
  lastSyncCommitSha: string;             // commit SHA of last sync
  lastSyncTreeSha?: string;              // tree SHA for quick "anything changed?" check (GitHub only)
  fileCount: number;
  fileShas: Record<string, string>;      // blob-path -> git-object-SHA map
  syncHistory: SyncHistoryEntry[];       // last 20 entries (FIFO)
}

/** Result object returned by sync operations */
export interface SyncResult {
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  durationMs: number;
  errors: Array<{ path: string; error: string }>;
}

/** File entry from a repository tree listing */
export interface RepoFileEntry {
  path: string;        // relative path from repo root
  sha: string;         // git object SHA (content hash)
  size?: number;       // file size in bytes
}
```

#### A.2 Extend `CredentialData` in `src/core/types.ts`

**Current code (lines 11-13):**
```typescript
export interface CredentialData {
  storages: StorageEntry[];
}
```

**Replacement:**
```typescript
export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];        // optional for backward compat on load
}
```

The `tokens` field is optional so that existing credential files without it still deserialize correctly.

#### A.3 Credential Store Extensions in `src/core/credential-store.ts`

**A.3.1 Update import** (line 5):

**Current:**
```typescript
import type { CredentialData, EncryptedPayload, StorageEntry } from "./types.js";
```

**Replacement:**
```typescript
import type { CredentialData, EncryptedPayload, StorageEntry, TokenEntry, TokenListItem, TokenExpiryStatus } from "./types.js";
```

**A.3.2 Backward compatibility normalization in `load()`**

Add at the end of the `load()` method, inside the `try` block, immediately after `this.data = JSON.parse(decrypted) as CredentialData;` (after line 80):

```typescript
      if (!this.data.tokens) this.data.tokens = [];
```

Also add the same normalization after the migration path. After `this.data = JSON.parse(decrypted) as CredentialData;` inside `tryMigrateFromHostnameKey()` (after line 119):

```typescript
        if (!this.data.tokens) this.data.tokens = [];
```

And after the fallback assignment `this.data = { storages: [] };` (line 88):

```typescript
      this.data = { storages: [], tokens: [] };
```

And at the class property initialization (line 65):

**Current:**
```typescript
  private data: CredentialData = { storages: [] };
```

**Replacement:**
```typescript
  private data: CredentialData = { storages: [], tokens: [] };
```

Also update the initial assignment in `load()` when no store file exists (line 73):

**Current:**
```typescript
      this.data = { storages: [] };
```

**Replacement:**
```typescript
      this.data = { storages: [], tokens: [] };
```

**A.3.3 Add helper function** before the `CredentialStore` class (after line 10, before `const ALGORITHM`):

```typescript
/** Determine token expiry status */
function getExpiryStatus(expiresAt?: string): TokenExpiryStatus {
  if (!expiresAt) return "no-expiry";
  const expiry = new Date(expiresAt);
  const now = new Date();
  if (expiry < now) return "expired";
  const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 14) return "expiring-soon";
  return "valid";
}
```

**A.3.4 Add token methods** to `CredentialStore` class, after `getFirstStorage()` (after line 223, before the closing `}`):

```typescript
  // ==================== Token Management ====================

  /** Add or update a PAT token */
  addToken(entry: Omit<TokenEntry, "addedAt">): void {
    if (!entry.name || !entry.name.trim()) {
      throw new Error("Token name is required.");
    }
    if (!entry.token || !entry.token.trim()) {
      throw new Error("Token value is required.");
    }
    if (entry.provider !== "github" && entry.provider !== "azure-devops") {
      throw new Error(`Invalid provider "${entry.provider}". Must be "github" or "azure-devops".`);
    }
    const tokens = this.data.tokens!;
    const existing = tokens.findIndex((t) => t.name === entry.name);
    const full: TokenEntry = { ...entry, addedAt: new Date().toISOString() };
    if (existing >= 0) {
      tokens[existing] = full;
    } else {
      tokens.push(full);
    }
    this.save();
  }

  /** Get a token by name */
  getToken(name: string): TokenEntry | undefined {
    return this.data.tokens!.find((t) => t.name === name);
  }

  /** Get the first token matching a provider */
  getTokenByProvider(provider: "github" | "azure-devops"): TokenEntry | undefined {
    return this.data.tokens!.find((t) => t.provider === provider);
  }

  /** List all tokens with masked values and expiry status */
  listTokens(): TokenListItem[] {
    return this.data.tokens!.map((t) => ({
      name: t.name,
      provider: t.provider,
      maskedToken: t.token.substring(0, 4) + "****",
      addedAt: t.addedAt,
      expiresAt: t.expiresAt,
      expiryStatus: getExpiryStatus(t.expiresAt),
    }));
  }

  /** Remove a token by name */
  removeToken(name: string): boolean {
    const tokens = this.data.tokens!;
    const before = tokens.length;
    this.data.tokens = tokens.filter((t) => t.name !== name);
    if (this.data.tokens.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Check if any tokens are configured */
  hasTokens(): boolean {
    return this.data.tokens!.length > 0;
  }
```

#### A.4 Validation Rules

- `addToken` throws if `name` is empty, `token` is empty, or `provider` is not `"github"` or `"azure-devops"`. No fallback values.
- `removeToken` returns false if name not found (caller decides behavior).
- All token arrays are non-null at runtime thanks to `load()` normalization.

---

### Implementation Unit B: GitHub Client

**New file:** `src/core/github-client.ts`
**Dependencies:** Unit A (for `RepoFileEntry` type)
**Can run in parallel with:** Unit C

#### B.1 Shared Utilities: `src/core/repo-utils.ts` (NEW FILE)

Create this file first since both Unit B and Unit C depend on it.

```typescript
import type { RepoFileEntry } from "./types.js";

/** Sleep for a given number of milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate-limited fetch with Retry-After handling.
 *
 * 1. Execute fetch.
 * 2. If 429, read Retry-After header, sleep, retry once.
 * 3. After success, check X-RateLimit-Remaining. If < 100, sleep until reset.
 * 4. Return the response.
 */
export async function rateLimitedFetch(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  let res = await fetch(url, { headers });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
    await sleep(retryAfter * 1000);
    res = await fetch(url, { headers });
  }

  const remaining = parseInt(res.headers.get("x-ratelimit-remaining") || "999", 10);
  if (remaining < 100) {
    const resetAt = parseInt(res.headers.get("x-ratelimit-reset") || "0", 10);
    if (resetAt > 0) {
      const waitMs = Math.max(0, resetAt * 1000 - Date.now()) + 1000;
      await sleep(waitMs);
    }
  }

  return res;
}

/**
 * Process items in batches with controlled concurrency.
 * Default batch size: 10.
 */
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(processor));
  }
}

/**
 * Infer content-type from file extension.
 * Covers common programming, web, document, and media file types.
 */
export function inferContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    // Text / source code
    ts: "text/plain", js: "text/plain", jsx: "text/plain", tsx: "text/plain",
    py: "text/plain", go: "text/plain", rs: "text/plain", java: "text/plain",
    c: "text/plain", cpp: "text/plain", h: "text/plain", hpp: "text/plain",
    cs: "text/plain", rb: "text/plain", php: "text/plain", sh: "text/plain",
    bash: "text/plain", zsh: "text/plain", ps1: "text/plain",
    txt: "text/plain", log: "text/plain", csv: "text/plain",
    md: "text/plain", rst: "text/plain",
    // Web
    html: "text/html", htm: "text/html",
    css: "text/css", scss: "text/css", less: "text/css",
    // Data
    json: "application/json",
    xml: "application/xml",
    yaml: "text/yaml", yml: "text/yaml",
    toml: "text/plain",
    // Images
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
    webp: "image/webp",
    // Documents
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // Fonts
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    // Archives
    zip: "application/zip", gz: "application/gzip", tar: "application/x-tar",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}
```

#### B.2 GitHub Client: `src/core/github-client.ts` (NEW FILE)

```typescript
import type { RepoFileEntry } from "./types.js";
import { rateLimitedFetch } from "./repo-utils.js";

/**
 * GitHub REST API client for repository file access.
 * Uses the Git Trees API for listing and Contents API for downloading.
 * All requests use PAT Bearer authentication.
 */
export class GitHubClient {
  private pat: string;
  private baseUrl = "https://api.github.com";

  constructor(pat: string) {
    this.pat = pat;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      Accept: "application/json",
      "User-Agent": "storage-navigator",
    };
  }

  /**
   * Get the default branch name for a repository.
   * GET /repos/{owner}/{repo}
   */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "getDefaultBranch");
    const data = await res.json();
    return data.default_branch;
  }

  /**
   * Get the latest commit SHA for a branch.
   * GET /repos/{owner}/{repo}/git/ref/heads/{branch}
   * Returns the commit SHA (not the tree SHA).
   */
  async getCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/ref/heads/${branch}`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "getCommitSha");
    const data = await res.json();
    return data.object.sha;
  }

  /**
   * Get the tree SHA for a commit.
   * GET /repos/{owner}/{repo}/git/commits/{commitSha}
   */
  async getTreeSha(owner: string, repo: string, commitSha: string): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/commits/${commitSha}`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "getTreeSha");
    const data = await res.json();
    return data.tree.sha;
  }

  /**
   * List all files in a repository branch (recursive tree).
   *
   * Flow:
   * 1. Resolve branch -> commit SHA via Refs API
   * 2. Resolve commit SHA -> tree SHA via Commits API
   * 3. Fetch full recursive tree via Trees API
   * 4. Filter to type === "blob" entries only
   *
   * Returns commitSha and treeSha for metadata tracking.
   */
  async listFiles(owner: string, repo: string, branch: string): Promise<{
    commitSha: string;
    treeSha: string;
    files: RepoFileEntry[];
  }> {
    // Step 1: branch -> commit SHA
    const commitSha = await this.getCommitSha(owner, repo, branch);

    // Step 2: commit SHA -> tree SHA
    const treeSha = await this.getTreeSha(owner, repo, commitSha);

    // Step 3: fetch recursive tree
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "listFiles");
    const data = await res.json();

    // Truncation warning (repos with >100k files)
    if (data.truncated) {
      console.warn(
        "WARNING: GitHub tree response was truncated. Some files may be missing. " +
        "This happens for repositories with >100,000 files."
      );
    }

    // Step 4: filter to blobs only
    const files: RepoFileEntry[] = data.tree
      .filter((entry: any) => entry.type === "blob")
      .map((entry: any) => ({
        path: entry.path,
        sha: entry.sha,
        size: entry.size,
      }));

    return { commitSha, treeSha, files };
  }

  /**
   * Download raw file content by path.
   * GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
   * Accept: application/vnd.github.raw+json
   * Returns raw bytes as a Buffer.
   */
  async downloadFile(owner: string, repo: string, path: string, ref: string): Promise<Buffer> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`;
    const headers = {
      ...this.headers,
      Accept: "application/vnd.github.raw+json",
    };
    const res = await rateLimitedFetch(url, headers);

    // Fallback to Blobs API for files that fail via Contents API (e.g. >100 MB)
    if (!res.ok && res.status === 403) {
      // Cannot use blob SHA fallback without the SHA; caller should handle.
      // For now, throw with actionable message.
      throw new Error(
        `File "${path}" is too large for the Contents API. ` +
        `Use downloadBlobBySha() with the file's SHA from the tree listing.`
      );
    }
    this.handleError(res, `downloadFile(${path})`);

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Download raw file content by blob SHA (fallback for large files).
   * GET /repos/{owner}/{repo}/git/blobs/{sha}
   * Accept: application/vnd.github.raw+json
   */
  async downloadBlobBySha(owner: string, repo: string, sha: string): Promise<Buffer> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/blobs/${sha}`;
    const headers = {
      ...this.headers,
      Accept: "application/vnd.github.raw+json",
    };
    const res = await rateLimitedFetch(url, headers);
    this.handleError(res, `downloadBlobBySha(${sha})`);

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Parse "owner/repo" string into { owner, repo }.
   * Throws if format is invalid.
   */
  static parseRepoUrl(repoStr: string): { owner: string; repo: string } {
    // Handle full URLs: https://github.com/owner/repo or git@github.com:owner/repo.git
    let cleaned = repoStr.replace(/\.git$/, "");
    if (cleaned.includes("github.com")) {
      const match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)/);
      if (match) return { owner: match[1], repo: match[2] };
    }
    // Handle "owner/repo" format
    const parts = cleaned.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid GitHub repository format: "${repoStr}". Expected "owner/repo" or a GitHub URL.`
      );
    }
    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Translate HTTP error codes into actionable error messages.
   */
  private handleError(res: Response, context: string): void {
    if (res.ok) return;
    switch (res.status) {
      case 401:
        throw new Error("GitHub PAT is invalid or expired.");
      case 403:
        throw new Error(
          "GitHub PAT lacks required permissions. " +
          "Classic PATs need the 'repo' scope; fine-grained PATs need 'contents: read'."
        );
      case 404:
        throw new Error("Repository not found, or the PAT has no access to it.");
      default:
        throw new Error(`GitHub API error ${res.status} in ${context}: ${res.statusText}`);
    }
  }
}
```

#### B.3 Key Design Decisions

- **Three-step resolution** (branch -> commit SHA -> tree SHA -> tree) is preferred over the shortcut (`GET /trees/{branch}`) because it returns the commit SHA needed for sync tracking.
- **`parseRepoUrl`** is a static method so it can be called before instantiation (needed for CLI argument validation).
- **`downloadFile` fallback:** If the Contents API returns 403 for a large file, the error message directs the caller to use `downloadBlobBySha()`. The sync engine handles this fallback.

---

### Implementation Unit C: Azure DevOps Client

**New file:** `src/core/devops-client.ts`
**Dependencies:** Unit A (for `RepoFileEntry` type)
**Can run in parallel with:** Unit B

#### C.1 Azure DevOps Client: `src/core/devops-client.ts` (NEW FILE)

```typescript
import type { RepoFileEntry } from "./types.js";
import { rateLimitedFetch, sleep } from "./repo-utils.js";

/**
 * Azure DevOps REST API client for repository file access.
 * Uses Basic auth with PAT (empty username + PAT as password).
 * API version: 7.1
 */
export class DevOpsClient {
  private pat: string;
  private org: string;
  private baseUrl: string;

  constructor(pat: string, org: string) {
    this.pat = pat;
    this.org = org;
    this.baseUrl = `https://dev.azure.com/${org}`;
  }

  private get headers(): Record<string, string> {
    const auth = Buffer.from(`:${this.pat}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    };
  }

  /**
   * Get the default branch for a repository.
   * GET /{project}/_apis/git/repositories/{repo}?api-version=7.1
   * Returns branch name without "refs/heads/" prefix.
   */
  async getDefaultBranch(project: string, repo: string): Promise<string> {
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}?api-version=7.1`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "getDefaultBranch");
    const data = await res.json();
    const defaultBranch = data.defaultBranch as string;
    // Strip "refs/heads/" prefix
    return defaultBranch.replace(/^refs\/heads\//, "");
  }

  /**
   * Get the latest commit SHA for a branch.
   * GET /{project}/_apis/git/repositories/{repo}/commits
   *   ?searchCriteria.itemVersion.version={branch}&$top=1&api-version=7.1
   */
  async getCommitSha(project: string, repo: string, branch: string): Promise<string> {
    const url =
      `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/commits` +
      `?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&$top=1&api-version=7.1`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "getCommitSha");
    const data = await res.json();
    if (!data.value || data.value.length === 0) {
      throw new Error(`No commits found on branch "${branch}".`);
    }
    return data.value[0].commitId;
  }

  /**
   * List all files in a repository branch.
   *
   * Flow:
   * 1. Get latest commit SHA
   * 2. List all items recursively
   * 3. Filter to non-folder entries
   * 4. Map objectId -> sha, strip leading "/" from path
   */
  async listFiles(project: string, repo: string, branch: string): Promise<{
    commitSha: string;
    files: RepoFileEntry[];
  }> {
    const commitSha = await this.getCommitSha(project, repo, branch);

    const url =
      `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/items` +
      `?recursionLevel=Full` +
      `&versionDescriptor.version=${encodeURIComponent(branch)}` +
      `&versionDescriptor.versionType=branch` +
      `&api-version=7.1`;
    const res = await rateLimitedFetch(url, this.headers);
    this.handleError(res, "listFiles");
    const data = await res.json();

    const files: RepoFileEntry[] = data.value
      .filter((item: any) => !item.isFolder)
      .map((item: any) => ({
        path: item.path.replace(/^\//, ""),   // strip leading "/"
        sha: item.objectId,
        size: item.contentMetadata?.fileSize,
      }));

    return { commitSha, files };
  }

  /**
   * Download raw file content.
   * GET /{project}/_apis/git/repositories/{repo}/items
   *   ?path={filePath}&$format=octetStream
   *   &versionDescriptor.version={branch}&versionDescriptor.versionType=branch
   *   &api-version=7.1
   *
   * Includes a 50ms inter-request delay to avoid Azure DevOps throttling (~200 req/min).
   */
  async downloadFile(
    project: string,
    repo: string,
    path: string,
    branch: string
  ): Promise<Buffer> {
    // Small delay to respect Azure DevOps rate limits
    await sleep(50);

    const url =
      `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/items` +
      `?path=${encodeURIComponent(path)}` +
      `&$format=octetStream` +
      `&versionDescriptor.version=${encodeURIComponent(branch)}` +
      `&versionDescriptor.versionType=branch` +
      `&api-version=7.1`;

    const headers = { ...this.headers, Accept: "application/octet-stream" };
    const res = await rateLimitedFetch(url, headers);
    this.handleError(res, `downloadFile(${path})`);

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Parse Azure DevOps repository URL into { org, project, repo }.
   * Accepts:
   *   - "https://dev.azure.com/{org}/{project}/_git/{repo}"
   *   - Or separate --org, --project, --repo CLI args (handled by caller).
   * Throws if URL format is invalid.
   */
  static parseRepoUrl(repoUrl: string): { org: string; project: string; repo: string } {
    const match = repoUrl.match(
      /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/
    );
    if (!match) {
      throw new Error(
        `Invalid Azure DevOps URL: "${repoUrl}". ` +
        `Expected "https://dev.azure.com/{org}/{project}/_git/{repo}" ` +
        `or use --org, --project, --repo separately.`
      );
    }
    return { org: match[1], project: match[2], repo: match[3] };
  }

  /**
   * Translate HTTP error codes into actionable error messages.
   */
  private handleError(res: Response, context: string): void {
    if (res.ok) return;
    switch (res.status) {
      case 401:
        throw new Error("Azure DevOps PAT is invalid or expired.");
      case 403:
        throw new Error("Azure DevOps PAT lacks the required 'Code (Read)' scope.");
      case 404:
        throw new Error(
          "Repository not found. Check that the organization, project, and repository names are correct."
        );
      default:
        throw new Error(`Azure DevOps API error ${res.status} in ${context}: ${res.statusText}`);
    }
  }
}
```

#### C.2 Key Design Decisions

- **50ms inter-request delay** in `downloadFile()` to stay under Azure DevOps' ~200 req/min throttle. Combined with batch-of-10 concurrency, this yields ~200 req/min effective throughput.
- **`parseRepoUrl`** supports full DevOps URLs. The CLI also accepts `--org`, `--project`, `--repo` separately for flexibility.
- **`objectId`** in Azure DevOps is the same Git SHA-1 hash as GitHub, so the same comparison logic works.

---

### Implementation Unit D: Sync Engine

**New file:** `src/core/sync-engine.ts`
**Modified file:** `src/core/blob-client.ts`
**Dependencies:** Units A, B, C

#### D.1 Add `listBlobsFlat()` to `src/core/blob-client.ts`

Add after the existing `listBlobs()` method (after line 68):

```typescript
  /**
   * List all blobs recursively under a prefix (flat listing, no delimiter).
   * Used by the sync engine to detect deleted files.
   */
  async listBlobsFlat(containerName: string, prefix?: string): Promise<BlobItem[]> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const items: BlobItem[] = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      items.push({
        name: blob.name,
        isPrefix: false,
        size: blob.properties.contentLength,
        lastModified: blob.properties.lastModified?.toISOString(),
        contentType: blob.properties.contentType,
      });
    }

    return items;
  }
```

#### D.2 Sync Engine: `src/core/sync-engine.ts` (NEW FILE)

```typescript
import type { BlobClient } from "./blob-client.js";
import type { RepoSyncMeta, SyncResult, SyncHistoryEntry, RepoFileEntry } from "./types.js";
import { processInBatches, inferContentType } from "./repo-utils.js";

const META_FILENAME = ".repo-sync-meta.json";
const MAX_SYNC_HISTORY = 20;
const BATCH_SIZE = 10;

/**
 * Provider-agnostic sync engine.
 *
 * Accepts pre-fetched file lists and a download callback.
 * Does not know about GitHub or Azure DevOps -- only about
 * blob storage and file SHA comparisons.
 */
export class SyncEngine {

  /**
   * Read .repo-sync-meta.json from a container.
   * Returns null if the metadata blob does not exist.
   */
  async readMeta(
    blobClient: BlobClient,
    container: string,
    prefix: string
  ): Promise<RepoSyncMeta | null> {
    const metaPath = prefix ? `${prefix}${META_FILENAME}` : META_FILENAME;
    try {
      const blob = await blobClient.getBlobContent(container, metaPath);
      const text = Buffer.isBuffer(blob.content)
        ? blob.content.toString("utf-8")
        : blob.content;
      return JSON.parse(text) as RepoSyncMeta;
    } catch {
      return null;
    }
  }

  /**
   * Write .repo-sync-meta.json to a container.
   */
  async writeMeta(
    blobClient: BlobClient,
    container: string,
    prefix: string,
    meta: RepoSyncMeta
  ): Promise<void> {
    const metaPath = prefix ? `${prefix}${META_FILENAME}` : META_FILENAME;
    const content = JSON.stringify(meta, null, 2);
    await blobClient.createBlob(container, metaPath, content, "application/json");
  }

  /**
   * Clone (full initial copy) a repository into a blob container.
   *
   * Downloads all files via the provided callback and uploads them.
   * Creates .repo-sync-meta.json with complete metadata.
   */
  async clone(params: {
    blobClient: BlobClient;
    container: string;
    prefix: string;
    provider: "github" | "azure-devops";
    repository: string;
    branch: string;
    tokenName: string;
    repoFiles: { commitSha: string; treeSha?: string; files: RepoFileEntry[] };
    downloadFile: (path: string) => Promise<Buffer>;
    onProgress?: (msg: string) => void;
  }): Promise<SyncResult> {
    const startTime = Date.now();
    const { blobClient, container, prefix, repoFiles, downloadFile, onProgress } = params;
    const log = onProgress ?? (() => {});

    const result: SyncResult = {
      filesAdded: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      filesUnchanged: 0,
      durationMs: 0,
      errors: [],
    };

    const fileShas: Record<string, string> = {};
    const total = repoFiles.files.length;
    let processed = 0;

    log(`Uploading ${total} files...`);

    await processInBatches(repoFiles.files, BATCH_SIZE, async (file) => {
      try {
        const content = await downloadFile(file.path);
        const blobPath = prefix ? `${prefix}${file.path}` : file.path;
        const contentType = inferContentType(file.path);
        await blobClient.createBlob(container, blobPath, content, contentType);

        fileShas[file.path] = file.sha;
        result.filesAdded++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: file.path, error: msg });
      }
      processed++;
      log(`[${processed}/${total}] ${file.path}`);
    });

    // Build metadata
    const syncEntry: SyncHistoryEntry = {
      syncedAt: new Date().toISOString(),
      commitSha: repoFiles.commitSha,
      filesAdded: result.filesAdded,
      filesUpdated: 0,
      filesDeleted: 0,
      durationMs: Date.now() - startTime,
    };

    const meta: RepoSyncMeta = {
      provider: params.provider,
      repository: params.repository,
      branch: params.branch,
      prefix: prefix,
      tokenName: params.tokenName,
      lastSyncedAt: syncEntry.syncedAt,
      lastSyncCommitSha: repoFiles.commitSha,
      lastSyncTreeSha: repoFiles.treeSha,
      fileCount: result.filesAdded,
      fileShas,
      syncHistory: [syncEntry],
    };

    await this.writeMeta(blobClient, container, prefix, meta);

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Incremental sync: compare SHAs, upload changes, delete removals.
   *
   * Quick check: if commit SHA matches and !force, returns early.
   * Dry-run mode: reports diff without modifying blobs.
   */
  async sync(params: {
    blobClient: BlobClient;
    container: string;
    prefix: string;
    meta: RepoSyncMeta;
    repoFiles: { commitSha: string; treeSha?: string; files: RepoFileEntry[] };
    downloadFile: (path: string) => Promise<Buffer>;
    force?: boolean;
    dryRun?: boolean;
    onProgress?: (msg: string) => void;
  }): Promise<SyncResult> {
    const startTime = Date.now();
    const { blobClient, container, prefix, meta, repoFiles, downloadFile, onProgress } = params;
    const force = params.force ?? false;
    const dryRun = params.dryRun ?? false;
    const log = onProgress ?? (() => {});

    const result: SyncResult = {
      filesAdded: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      filesUnchanged: 0,
      durationMs: 0,
      errors: [],
    };

    // Quick check: if commit SHA matches and not forcing, nothing to do
    if (!force && meta.lastSyncCommitSha === repoFiles.commitSha) {
      log("Already up to date.");
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Build new SHA map from current tree
    const newShas: Record<string, string> = {};
    for (const file of repoFiles.files) {
      newShas[file.path] = file.sha;
    }

    // Diff calculation
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];

    if (force) {
      // Force: treat all current files as modified (re-upload everything)
      for (const file of repoFiles.files) {
        modified.push(file.path);
      }
      // Still detect deletions
      for (const oldPath of Object.keys(meta.fileShas)) {
        if (!(oldPath in newShas)) {
          deleted.push(oldPath);
        }
      }
    } else {
      // Incremental: compare SHAs
      for (const [path, sha] of Object.entries(newShas)) {
        if (!(path in meta.fileShas)) {
          added.push(path);
        } else if (meta.fileShas[path] !== sha) {
          modified.push(path);
        } else {
          unchanged.push(path);
        }
      }
      for (const oldPath of Object.keys(meta.fileShas)) {
        if (!(oldPath in newShas)) {
          deleted.push(oldPath);
        }
      }
    }

    result.filesUnchanged = unchanged.length;

    log(
      `${added.length} new, ${modified.length} modified, ` +
      `${deleted.length} deleted, ${unchanged.length} unchanged`
    );

    // Dry-run: report and exit
    if (dryRun) {
      for (const p of added) log(`  + ${p}`);
      for (const p of modified) log(`  ~ ${p}`);
      for (const p of deleted) log(`  - ${p}`);
      log("No changes applied (dry run).");
      result.filesAdded = added.length;
      result.filesUpdated = modified.length;
      result.filesDeleted = deleted.length;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Apply changes: upload added + modified
    const toUpload = [...added.map((p) => ({ path: p, type: "add" as const })),
                      ...modified.map((p) => ({ path: p, type: "update" as const }))];
    const totalOps = toUpload.length + deleted.length;
    let opsProcessed = 0;

    await processInBatches(toUpload, BATCH_SIZE, async (item) => {
      try {
        const content = await downloadFile(item.path);
        const blobPath = prefix ? `${prefix}${item.path}` : item.path;
        const contentType = inferContentType(item.path);
        await blobClient.createBlob(container, blobPath, content, contentType);

        if (item.type === "add") result.filesAdded++;
        else result.filesUpdated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: item.path, error: msg });
      }
      opsProcessed++;
      log(`[${opsProcessed}/${totalOps}] ${item.type === "add" ? "+" : "~"} ${item.path}`);
    });

    // Apply deletions
    await processInBatches(deleted, BATCH_SIZE, async (path) => {
      try {
        const blobPath = prefix ? `${prefix}${path}` : path;
        await blobClient.deleteBlob(container, blobPath);
        result.filesDeleted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path, error: msg });
      }
      opsProcessed++;
      log(`[${opsProcessed}/${totalOps}] - ${path}`);
    });

    // Update metadata
    const updatedFileShas: Record<string, string> = { ...newShas };

    const syncEntry: SyncHistoryEntry = {
      syncedAt: new Date().toISOString(),
      commitSha: repoFiles.commitSha,
      filesAdded: result.filesAdded,
      filesUpdated: result.filesUpdated,
      filesDeleted: result.filesDeleted,
      durationMs: Date.now() - startTime,
    };

    const updatedHistory = [...meta.syncHistory, syncEntry];
    while (updatedHistory.length > MAX_SYNC_HISTORY) {
      updatedHistory.shift();
    }

    const updatedMeta: RepoSyncMeta = {
      ...meta,
      lastSyncedAt: syncEntry.syncedAt,
      lastSyncCommitSha: repoFiles.commitSha,
      lastSyncTreeSha: repoFiles.treeSha,
      fileCount: repoFiles.files.length,
      fileShas: updatedFileShas,
      syncHistory: updatedHistory,
    };

    await this.writeMeta(blobClient, container, prefix, updatedMeta);

    result.durationMs = Date.now() - startTime;
    return result;
  }
}
```

#### D.3 Key Design Decisions

- **Provider-agnostic:** The engine receives file lists and a `downloadFile` callback. It never imports `GitHubClient` or `DevOpsClient`.
- **Non-fatal per-file errors:** If one file fails to download or upload, the error is recorded in `SyncResult.errors` and processing continues.
- **SHA-based diffing:** Uses the `fileShas` map from `.repo-sync-meta.json` to determine changes without downloading existing blobs.
- **Metadata cap:** `syncHistory` is capped at 20 entries (FIFO), per specification.
- **Batch concurrency of 10:** Balances speed against API rate limits and memory.

---

### Implementation Unit E: CLI Token Commands

**New files:** `src/cli/commands/token-ops.ts`, `src/cli/commands/shared.ts`
**Modified files:** `src/cli/index.ts`, `src/cli/commands/blob-ops.ts`, `src/cli/commands/view.ts`
**Dependencies:** Unit A

#### E.1 Shared Helpers: `src/cli/commands/shared.ts` (NEW FILE)

Extract `resolveStorage()` and `confirm()` into a shared module. Currently these are duplicated in `blob-ops.ts` and `view.ts`.

```typescript
import * as readline from "readline";
import { CredentialStore } from "../../core/credential-store.js";
import type { StorageEntry, TokenEntry } from "../../core/types.js";

/**
 * Resolve a storage account by name, or return the first configured storage.
 * Throws if no storages are configured or the named storage is not found.
 */
export function resolveStorage(storageName?: string): StorageEntry {
  const store = new CredentialStore();
  if (storageName) {
    const entry = store.getStorage(storageName);
    if (!entry) throw new Error(`Storage "${storageName}" not found. Use "list" to see configured storages.`);
    return entry;
  }
  const first = store.getFirstStorage();
  if (!first) throw new Error("No storage accounts configured. Use the 'add' command first.");
  return first;
}

/**
 * Ask a yes/no confirmation question.
 */
export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

/**
 * Resolve a PAT token for a given provider.
 *
 * Resolution order:
 * 1. If tokenName is provided, look up by name. Throw if not found.
 * 2. Otherwise, get the first token for the provider.
 * 3. Check expiry and warn if expired or expiring soon.
 * 4. If no token found, throw with actionable message.
 */
export function resolveToken(
  provider: "github" | "azure-devops",
  tokenName?: string
): TokenEntry {
  const store = new CredentialStore();

  let token: TokenEntry | undefined;

  if (tokenName) {
    token = store.getToken(tokenName);
    if (!token) {
      throw new Error(
        `Token "${tokenName}" not found. Use "list-tokens" to see configured tokens.`
      );
    }
    if (token.provider !== provider) {
      throw new Error(
        `Token "${tokenName}" is for provider "${token.provider}", not "${provider}".`
      );
    }
  } else {
    token = store.getTokenByProvider(provider);
  }

  if (!token) {
    throw new Error(
      `No ${provider} PAT found. Use "add-token --name <name> --provider ${provider} --token <pat>" to register one.`
    );
  }

  // Expiry warning
  if (token.expiresAt) {
    const expiry = new Date(token.expiresAt);
    const now = new Date();
    if (expiry < now) {
      console.warn(`WARNING: Token "${token.name}" has EXPIRED (${token.expiresAt}).`);
    } else {
      const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysLeft <= 14) {
        console.warn(
          `WARNING: Token "${token.name}" expires in ${Math.ceil(daysLeft)} days (${token.expiresAt}).`
        );
      }
    }
  }

  return token;
}
```

After creating `shared.ts`, update `blob-ops.ts` and `view.ts` to import `resolveStorage` and `confirm` from `./shared.js` instead of defining them locally. This is a minor refactor that removes duplication.

#### E.2 Token Operations: `src/cli/commands/token-ops.ts` (NEW FILE)

```typescript
import chalk from "chalk";
import { CredentialStore } from "../../core/credential-store.js";
import { confirm } from "./shared.js";

/**
 * Add or update a PAT token in the credential store.
 */
export function addToken(
  name: string,
  provider: string,
  token: string,
  expiresAt?: string
): void {
  if (provider !== "github" && provider !== "azure-devops") {
    throw new Error(`Invalid provider "${provider}". Must be "github" or "azure-devops".`);
  }

  if (expiresAt) {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid --expires-at date: "${expiresAt}". Use ISO format (YYYY-MM-DD).`);
    }
  }

  const store = new CredentialStore();
  store.addToken({
    name,
    provider: provider as "github" | "azure-devops",
    token,
    expiresAt,
  });

  const masked = token.substring(0, 4) + "****";
  console.log(chalk.green(`Token "${name}" saved (${provider}, ${masked}).`));

  // Expiry warning
  if (expiresAt) {
    const expiry = new Date(expiresAt);
    const now = new Date();
    if (expiry < now) {
      console.log(chalk.red(`WARNING: This token is already EXPIRED (${expiresAt}).`));
    } else {
      const daysLeft = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysLeft <= 14) {
        console.log(chalk.yellow(`WARNING: This token expires in ${Math.ceil(daysLeft)} days.`));
      }
    }
  }
}

/**
 * List all stored PAT tokens with masked values and expiry status.
 */
export function listTokens(): void {
  const store = new CredentialStore();
  const tokens = store.listTokens();

  if (tokens.length === 0) {
    console.log("No tokens configured. Use 'add-token' to register a PAT.");
    return;
  }

  console.log(chalk.bold("Stored tokens:\n"));
  for (const t of tokens) {
    const statusColor =
      t.expiryStatus === "valid" ? chalk.green :
      t.expiryStatus === "expiring-soon" ? chalk.yellow :
      t.expiryStatus === "expired" ? chalk.red :
      chalk.gray;

    const statusLabel =
      t.expiryStatus === "no-expiry" ? "no expiry set" : t.expiryStatus;

    console.log(
      `  ${chalk.bold(t.name)}  ${t.provider}  ${t.maskedToken}  ` +
      `added ${t.addedAt.substring(0, 10)}  ` +
      (t.expiresAt ? `expires ${t.expiresAt.substring(0, 10)}  ` : "") +
      statusColor(`[${statusLabel}]`)
    );
  }
}

/**
 * Remove a token by name (with confirmation).
 */
export async function removeToken(name: string): Promise<void> {
  const store = new CredentialStore();
  const token = store.getToken(name);
  if (!token) {
    console.log(chalk.red(`Token "${name}" not found.`));
    return;
  }

  const ok = await confirm(`Remove token "${name}" (${token.provider})?`);
  if (!ok) {
    console.log("Cancelled.");
    return;
  }

  store.removeToken(name);
  console.log(chalk.green(`Token "${name}" removed.`));
}
```

#### E.3 CLI Registration in `src/cli/index.ts`

Add imports and commands. After the existing imports (after line 7):

```typescript
import { addToken, listTokens, removeToken } from "./commands/token-ops.js";
```

Add commands before the `ui` command (before line 124):

```typescript
// Token management
program
  .command("add-token")
  .description("Register a Personal Access Token (GitHub or Azure DevOps)")
  .requiredOption("--name <name>", "Display name for this token")
  .requiredOption("--provider <provider>", "Provider: github or azure-devops")
  .requiredOption("--token <token>", "The PAT value")
  .option("--expires-at <date>", "Expiry date (ISO format, e.g. 2026-12-31)")
  .action((opts) => {
    addToken(opts.name, opts.provider, opts.token, opts.expiresAt);
  });

program
  .command("list-tokens")
  .description("List stored Personal Access Tokens")
  .action(() => {
    listTokens();
  });

program
  .command("remove-token")
  .description("Remove a stored Personal Access Token")
  .requiredOption("--name <name>", "Name of the token to remove")
  .action(async (opts) => {
    await removeToken(opts.name);
  });
```

---

### Implementation Unit F: CLI Sync Commands

**New file:** `src/cli/commands/repo-sync.ts`
**Modified file:** `src/cli/index.ts`
**Dependencies:** Units D, E

#### F.1 Sync Commands: `src/cli/commands/repo-sync.ts` (NEW FILE)

```typescript
import chalk from "chalk";
import { BlobClient } from "../../core/blob-client.js";
import { GitHubClient } from "../../core/github-client.js";
import { DevOpsClient } from "../../core/devops-client.js";
import { SyncEngine } from "../../core/sync-engine.js";
import type { SyncResult } from "../../core/types.js";
import { resolveStorage, resolveToken } from "./shared.js";

/**
 * Print a SyncResult summary to the console.
 */
function printResult(result: SyncResult, verb: string): void {
  const duration = (result.durationMs / 1000).toFixed(1);
  console.log(
    chalk.green(
      `\n${verb} complete: ${result.filesAdded} added, ${result.filesUpdated} updated, ` +
      `${result.filesDeleted} deleted (${duration}s)`
    )
  );
  if (result.errors.length > 0) {
    console.log(chalk.red(`\n${result.errors.length} errors:`));
    for (const e of result.errors) {
      console.log(chalk.red(`  ${e.path}: ${e.error}`));
    }
  }
}

/**
 * Clone a GitHub repository into a blob container.
 */
export async function cloneGithub(
  repoStr: string,
  container: string,
  branch?: string,
  prefix?: string,
  storageName?: string,
  tokenName?: string
): Promise<void> {
  const storage = resolveStorage(storageName);
  const token = resolveToken("github", tokenName);
  const { owner, repo } = GitHubClient.parseRepoUrl(repoStr);
  const client = new GitHubClient(token.token);

  // Resolve branch
  const resolvedBranch = branch ?? await client.getDefaultBranch(owner, repo);
  console.log(`Cloning ${owner}/${repo} (${resolvedBranch}) -> ${container}`);

  // Fetch file tree
  console.log("Fetching file tree...");
  const repoFiles = await client.listFiles(owner, repo, resolvedBranch);
  console.log(`${repoFiles.files.length} files found`);

  // Clone
  const blobClient = new BlobClient(storage);
  const engine = new SyncEngine();
  const normalizedPrefix = prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") : "";

  const result = await engine.clone({
    blobClient,
    container,
    prefix: normalizedPrefix,
    provider: "github",
    repository: `${owner}/${repo}`,
    branch: resolvedBranch,
    tokenName: token.name,
    repoFiles,
    downloadFile: (path) => client.downloadFile(owner, repo, path, resolvedBranch),
    onProgress: (msg) => console.log(msg),
  });

  printResult(result, "Clone");
}

/**
 * Clone an Azure DevOps repository into a blob container.
 */
export async function cloneDevops(
  org: string,
  project: string,
  repo: string,
  container: string,
  branch?: string,
  prefix?: string,
  storageName?: string,
  tokenName?: string
): Promise<void> {
  const storage = resolveStorage(storageName);
  const token = resolveToken("azure-devops", tokenName);
  const client = new DevOpsClient(token.token, org);

  // Resolve branch
  const resolvedBranch = branch ?? await client.getDefaultBranch(project, repo);
  console.log(`Cloning ${org}/${project}/${repo} (${resolvedBranch}) -> ${container}`);

  // Fetch file tree
  console.log("Fetching file tree...");
  const repoFiles = await client.listFiles(project, repo, resolvedBranch);
  console.log(`${repoFiles.files.length} files found`);

  // Clone
  const blobClient = new BlobClient(storage);
  const engine = new SyncEngine();
  const normalizedPrefix = prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") : "";

  const result = await engine.clone({
    blobClient,
    container,
    prefix: normalizedPrefix,
    provider: "azure-devops",
    repository: `${org}/${project}/${repo}`,
    branch: resolvedBranch,
    tokenName: token.name,
    repoFiles,
    downloadFile: (path) => client.downloadFile(project, repo, path, resolvedBranch),
    onProgress: (msg) => console.log(msg),
  });

  printResult(result, "Clone");
}

/**
 * Sync a previously cloned container with its source repository.
 */
export async function syncContainer(
  container: string,
  prefix?: string,
  storageName?: string,
  dryRun?: boolean,
  force?: boolean
): Promise<void> {
  const storage = resolveStorage(storageName);
  const blobClient = new BlobClient(storage);
  const engine = new SyncEngine();
  const normalizedPrefix = prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") : "";

  // Read metadata
  const meta = await engine.readMeta(blobClient, container, normalizedPrefix);
  if (!meta) {
    throw new Error(
      `Container "${container}" is not a repository mirror (no .repo-sync-meta.json found).`
    );
  }

  // Resolve PAT
  const token = resolveToken(meta.provider, meta.tokenName);

  console.log(
    `${dryRun ? "Dry run:" : "Syncing"} ${meta.repository} (${meta.branch}) -> ${container}`
  );

  // Fetch current tree based on provider
  let repoFiles: { commitSha: string; treeSha?: string; files: import("../../core/types.js").RepoFileEntry[] };

  if (meta.provider === "github") {
    const { owner, repo } = GitHubClient.parseRepoUrl(meta.repository);
    const client = new GitHubClient(token.token);
    console.log("Fetching file tree...");
    repoFiles = await client.listFiles(owner, repo, meta.branch);
  } else {
    const parts = meta.repository.split("/");
    if (parts.length !== 3) {
      throw new Error(`Invalid Azure DevOps repository format in metadata: "${meta.repository}".`);
    }
    const [org, project, repo] = parts;
    const client = new DevOpsClient(token.token, org);
    console.log("Fetching file tree...");
    repoFiles = await client.listFiles(project, repo, meta.branch);
  }

  console.log(`${repoFiles.files.length} files found`);

  // Sync
  const result = await engine.sync({
    blobClient,
    container,
    prefix: normalizedPrefix,
    meta,
    repoFiles,
    downloadFile: async (path) => {
      if (meta.provider === "github") {
        const { owner, repo } = GitHubClient.parseRepoUrl(meta.repository);
        const client = new GitHubClient(token.token);
        return client.downloadFile(owner, repo, path, meta.branch);
      } else {
        const parts = meta.repository.split("/");
        const [org, project, repo] = parts;
        const client = new DevOpsClient(token.token, org);
        return client.downloadFile(project, repo, path, meta.branch);
      }
    },
    force,
    dryRun,
    onProgress: (msg) => console.log(msg),
  });

  printResult(result, dryRun ? "Dry run" : "Sync");
}
```

#### F.2 CLI Registration in `src/cli/index.ts`

Add import (after the token-ops import):

```typescript
import { cloneGithub, cloneDevops, syncContainer } from "./commands/repo-sync.js";
```

Add commands (after the token commands, before the `ui` command):

```typescript
// Repository sync
program
  .command("clone-github")
  .description("Clone a GitHub repository into a blob container")
  .requiredOption("--repo <repo>", "GitHub repository (owner/repo or URL)")
  .requiredOption("--container <name>", "Target blob container")
  .option("--branch <branch>", "Branch (defaults to repo default)")
  .option("--prefix <path>", "Blob path prefix for repo files")
  .option("--storage <name>", "Storage account (uses first if omitted)")
  .option("--token-name <name>", "Name of stored GitHub PAT to use")
  .action(async (opts) => {
    await cloneGithub(opts.repo, opts.container, opts.branch, opts.prefix, opts.storage, opts.tokenName);
  });

program
  .command("clone-devops")
  .description("Clone an Azure DevOps repository into a blob container")
  .requiredOption("--org <org>", "Azure DevOps organization")
  .requiredOption("--project <project>", "Azure DevOps project")
  .requiredOption("--repo <repo>", "Repository name")
  .requiredOption("--container <name>", "Target blob container")
  .option("--branch <branch>", "Branch (defaults to repo default)")
  .option("--prefix <path>", "Blob path prefix for repo files")
  .option("--storage <name>", "Storage account (uses first if omitted)")
  .option("--token-name <name>", "Name of stored Azure DevOps PAT to use")
  .action(async (opts) => {
    await cloneDevops(opts.org, opts.project, opts.repo, opts.container, opts.branch, opts.prefix, opts.storage, opts.tokenName);
  });

program
  .command("sync")
  .description("Sync a previously cloned container with its source repository")
  .requiredOption("--container <name>", "Container to sync")
  .option("--prefix <path>", "Blob prefix (if multiple mirrors under different prefixes)")
  .option("--storage <name>", "Storage account (uses first if omitted)")
  .option("--dry-run", "Show changes without applying them")
  .option("--force", "Re-upload all files regardless of changes")
  .action(async (opts) => {
    await syncContainer(opts.container, opts.prefix, opts.storage, opts.dryRun, opts.force);
  });
```

---

### Implementation Unit G: Server API + UI

**Modified files:** `src/electron/server.ts`, `src/electron/public/app.js`, `src/electron/public/index.html`, `src/electron/public/styles.css`
**Dependencies:** Unit D

#### G.1 New API Endpoints in `src/electron/server.ts`

Add imports at the top of the file (after the existing imports):

```typescript
import { SyncEngine } from "../core/sync-engine.js";
import { GitHubClient } from "../core/github-client.js";
import { DevOpsClient } from "../core/devops-client.js";
```

Add the following endpoints before `app.listen(port, ...)` (before line 183):

```typescript
  // API: List tokens (masked, no raw values)
  app.get("/api/tokens", (_req, res) => {
    const store = new CredentialStore();
    res.json(store.listTokens());
  });

  // API: Get repo sync metadata for a container
  app.get("/api/repo-meta/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const blobClient = new BlobClient(entry);
      const engine = new SyncEngine();
      const prefix = (req.query.prefix as string) || "";
      const meta = await engine.readMeta(blobClient, req.params.container, prefix);

      if (!meta) { res.status(404).json({ error: "Not a repository mirror" }); return; }
      res.json(meta);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Trigger sync for a container
  app.post("/api/sync/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const blobClient = new BlobClient(entry);
      const engine = new SyncEngine();
      const prefix = (req.query.prefix as string) || "";
      const dryRun = req.query.dryRun === "true";
      const force = req.query.force === "true";

      // Read metadata
      const meta = await engine.readMeta(blobClient, req.params.container, prefix);
      if (!meta) { res.status(404).json({ error: "Not a repository mirror" }); return; }

      // Resolve PAT
      const token = store.getToken(meta.tokenName);
      if (!token) {
        res.status(400).json({ error: `Token "${meta.tokenName}" not found in credential store.` });
        return;
      }

      // Fetch current tree
      let repoFiles: { commitSha: string; treeSha?: string; files: any[] };

      if (meta.provider === "github") {
        const { owner, repo } = GitHubClient.parseRepoUrl(meta.repository);
        const client = new GitHubClient(token.token);
        repoFiles = await client.listFiles(owner, repo, meta.branch);
      } else {
        const parts = meta.repository.split("/");
        if (parts.length !== 3) {
          res.status(400).json({ error: `Invalid repository format in metadata: "${meta.repository}"` });
          return;
        }
        const [org, project, repo] = parts;
        const client = new DevOpsClient(token.token, org);
        repoFiles = await client.listFiles(project, repo, meta.branch);
      }

      // Build download callback
      const downloadFile = async (path: string): Promise<Buffer> => {
        if (meta.provider === "github") {
          const { owner, repo } = GitHubClient.parseRepoUrl(meta.repository);
          const client = new GitHubClient(token.token);
          return client.downloadFile(owner, repo, path, meta.branch);
        } else {
          const parts = meta.repository.split("/");
          const [org, project, repo] = parts;
          const client = new DevOpsClient(token.token, org);
          return client.downloadFile(project, repo, path, meta.branch);
        }
      };

      // Run sync
      const result = await engine.sync({
        blobClient,
        container: req.params.container,
        prefix,
        meta,
        repoFiles,
        downloadFile,
        force,
        dryRun,
      });

      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
```

#### G.2 UI: Sync Modal in `src/electron/public/index.html`

Add after the Create File Modal closing `</div>` (after line 112, before the Context Menu):

```html
  <!-- Sync Confirmation Modal -->
  <div id="sync-modal" class="modal hidden">
    <div class="modal-content">
      <h2>Sync with Repository</h2>
      <div class="sync-details">
        <p><strong>Provider:</strong> <span id="sync-provider"></span></p>
        <p><strong>Repository:</strong> <span id="sync-repository"></span></p>
        <p><strong>Branch:</strong> <span id="sync-branch"></span></p>
        <p><strong>Last Synced:</strong> <span id="sync-last-time"></span></p>
        <p><strong>Commit:</strong> <span id="sync-last-commit"></span></p>
        <p><strong>Files:</strong> <span id="sync-file-count"></span></p>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:12px;cursor:pointer;">
        <input type="checkbox" id="sync-dry-run"> Dry run (preview changes only)
      </label>
      <div id="sync-progress" style="display:none;margin-top:12px;font-size:13px;color:var(--text-dim);">
        <span class="sync-spinner">&#8635;</span> Syncing...
      </div>
      <div id="sync-result" style="display:none;margin-top:12px;font-size:13px;"></div>
      <div class="modal-actions">
        <button id="sync-cancel-btn">Cancel</button>
        <button id="sync-confirm-btn" class="primary">Sync Now</button>
      </div>
    </div>
  </div>
```

#### G.3 UI: Sync Detection and Button Logic in `src/electron/public/app.js`

Add the following variables after `let contextTarget = null;` (after line 41):

```javascript
  let syncMetaCache = {}; // { "storage/container": RepoSyncMeta }
```

Modify the `loadTreeLevel` function. After the line `if (shortName === ".keep") continue;` (line 185), add detection logic:

```javascript
      // Detect .repo-sync-meta.json at root level for sync indicator
      if (shortName === ".repo-sync-meta.json" && depth === 1) {
        // Mark the container as a repo mirror
        const containerNode = parentEl.parentElement;
        if (containerNode && !containerNode.querySelector(".sync-badge")) {
          const badge = document.createElement("span");
          badge.className = "sync-badge";
          badge.textContent = "\u21BB";
          badge.title = "Repository mirror (click to sync)";
          containerNode.querySelector(".tree-item").appendChild(badge);

          // Fetch and cache metadata
          const cacheKey = `${currentStorage}/${item.name.replace(".repo-sync-meta.json", "")}`;
          fetchSyncMeta(currentStorage, container, "").then((meta) => {
            if (meta) syncMetaCache[`${currentStorage}/${container}`] = meta;
          });

          // Add click handler for sync badge
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            openSyncModal(container);
          });
        }
        continue; // hide .repo-sync-meta.json from the tree
      }
```

Add the following functions before `// --- Init ---` (before line 565):

```javascript
  // --- Sync ---
  async function fetchSyncMeta(storage, container, prefix) {
    try {
      let url = `/api/repo-meta/${storage}/${container}`;
      if (prefix) url += `?prefix=${encodeURIComponent(prefix)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function openSyncModal(container) {
    const meta = syncMetaCache[`${currentStorage}/${container}`];
    if (!meta) { alert("Sync metadata not loaded yet. Try expanding the container first."); return; }

    document.getElementById("sync-provider").textContent = meta.provider;
    document.getElementById("sync-repository").textContent = meta.repository;
    document.getElementById("sync-branch").textContent = meta.branch;
    document.getElementById("sync-last-time").textContent = meta.lastSyncedAt
      ? new Date(meta.lastSyncedAt).toLocaleString()
      : "Never";
    document.getElementById("sync-last-commit").textContent =
      meta.lastSyncCommitSha ? meta.lastSyncCommitSha.substring(0, 12) + "..." : "N/A";
    document.getElementById("sync-file-count").textContent = String(meta.fileCount || 0);
    document.getElementById("sync-dry-run").checked = false;
    document.getElementById("sync-progress").style.display = "none";
    document.getElementById("sync-result").style.display = "none";
    document.getElementById("sync-confirm-btn").disabled = false;
    document.getElementById("sync-confirm-btn").textContent = "Sync Now";
    document.getElementById("sync-modal").classList.remove("hidden");

    // Store container for the confirm handler
    document.getElementById("sync-confirm-btn").dataset.container = container;
  }

  document.getElementById("sync-cancel-btn").addEventListener("click", () => {
    document.getElementById("sync-modal").classList.add("hidden");
  });

  document.getElementById("sync-confirm-btn").addEventListener("click", async () => {
    const btn = document.getElementById("sync-confirm-btn");
    const container = btn.dataset.container;
    const dryRun = document.getElementById("sync-dry-run").checked;

    btn.disabled = true;
    btn.textContent = "Syncing...";
    document.getElementById("sync-progress").style.display = "block";
    document.getElementById("sync-result").style.display = "none";

    try {
      let url = `/api/sync/${currentStorage}/${container}`;
      const params = [];
      if (dryRun) params.push("dryRun=true");
      if (params.length) url += "?" + params.join("&");

      const res = await fetch(url, { method: "POST" });
      const result = await res.json();

      document.getElementById("sync-progress").style.display = "none";

      if (result.error) {
        document.getElementById("sync-result").style.display = "block";
        document.getElementById("sync-result").innerHTML =
          `<span style="color:var(--expiry-expired)">${escapeHtml(result.error)}</span>`;
      } else {
        const duration = (result.durationMs / 1000).toFixed(1);
        document.getElementById("sync-result").style.display = "block";
        document.getElementById("sync-result").innerHTML =
          `<span style="color:var(--expiry-ok)">` +
          `${dryRun ? "Dry run" : "Sync"} complete: ` +
          `${result.filesAdded} added, ${result.filesUpdated} updated, ` +
          `${result.filesDeleted} deleted` +
          (result.filesUnchanged ? `, ${result.filesUnchanged} unchanged` : "") +
          ` (${duration}s)</span>` +
          (result.errors?.length ? `<br><span style="color:var(--expiry-expired)">${result.errors.length} errors</span>` : "");

        // Refresh the tree if not a dry run
        if (!dryRun) {
          // Invalidate cache
          delete syncMetaCache[`${currentStorage}/${container}`];
          await buildTree();
        }
      }
    } catch (e) {
      document.getElementById("sync-progress").style.display = "none";
      document.getElementById("sync-result").style.display = "block";
      document.getElementById("sync-result").innerHTML =
        `<span style="color:var(--expiry-expired)">Sync failed: ${escapeHtml(e.message)}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync Now";
    }
  });
```

#### G.4 CSS Additions in `src/electron/public/styles.css`

Add after the `.context-menu-item.ctx-danger:hover` rule (after line 324), before the danger button section:

```css
/* ===== Sync ===== */
.sync-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 12px;
  color: var(--text-accent);
  background: transparent;
  border-radius: 3px;
  margin-left: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.sync-badge:hover {
  background: var(--btn-primary);
  color: white;
}

.sync-details p {
  margin: 4px 0;
  font-size: 13px;
}
.sync-details strong {
  color: var(--text-dim);
  display: inline-block;
  min-width: 100px;
}

.sync-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

### Implementation Unit Dependency Graph

```
Unit A: Types + Credential Store
    |
    +---> Unit B: GitHub Client  ----\
    |                                 |---> Unit D: Sync Engine ---> Unit F: CLI Sync Commands
    +---> Unit C: DevOps Client ----/                          \
    |                                                           +---> Unit G: Server API + UI
    +---> Unit E: CLI Token Commands
```

| Unit | Depends on | Can run in parallel with |
|---|---|---|
| Unit A | None | -- |
| Unit B | Unit A | Unit C, Unit E |
| Unit C | Unit A | Unit B, Unit E |
| Unit D | Units A, B, C | -- |
| Unit E | Unit A | Units B, C |
| Unit F | Units D, E | -- |
| Unit G | Unit D | Unit F |

**Critical path:** A -> B/C -> D -> F (and G)

---

### New Files Summary

| File | Unit | Purpose |
|------|------|---------|
| `src/core/repo-utils.ts` | B | Shared utilities: rate-limited fetch, batch processing, content-type inference |
| `src/core/github-client.ts` | B | GitHub REST API client (Trees + Contents APIs) |
| `src/core/devops-client.ts` | C | Azure DevOps REST API client (Items API) |
| `src/core/sync-engine.ts` | D | Provider-agnostic clone and incremental sync engine |
| `src/cli/commands/shared.ts` | E | Shared CLI helpers: resolveStorage, confirm, resolveToken |
| `src/cli/commands/token-ops.ts` | E | CLI commands: add-token, list-tokens, remove-token |
| `src/cli/commands/repo-sync.ts` | F | CLI commands: clone-github, clone-devops, sync |

### Modified Files Summary

| File | Unit | Changes |
|------|------|---------|
| `src/core/types.ts` | A | Add 8 new interfaces/types (TokenEntry, TokenListItem, TokenExpiryStatus, SyncHistoryEntry, RepoSyncMeta, SyncResult, RepoFileEntry); extend CredentialData with `tokens?` |
| `src/core/credential-store.ts` | A | Import new types; add getExpiryStatus helper; normalize `tokens` on load; add 6 token CRUD methods |
| `src/core/blob-client.ts` | D | Add `listBlobsFlat()` method for recursive flat listing |
| `src/cli/index.ts` | E, F | Import and register 6 new commands (add-token, list-tokens, remove-token, clone-github, clone-devops, sync) |
| `src/cli/commands/blob-ops.ts` | E | Import resolveStorage and confirm from shared.ts (remove local definitions) |
| `src/cli/commands/view.ts` | E | Import resolveStorage from shared.ts (remove local definition) |
| `src/electron/server.ts` | G | Import SyncEngine, GitHubClient, DevOpsClient; add 3 endpoints (GET /api/tokens, GET /api/repo-meta, POST /api/sync) |
| `src/electron/public/app.js` | G | Add syncMetaCache, sync detection in loadTreeLevel, sync modal logic, fetchSyncMeta, openSyncModal |
| `src/electron/public/index.html` | G | Add sync confirmation modal HTML |
| `src/electron/public/styles.css` | G | Add sync badge, sync details, and spinner animation styles |

---

### Known Limitations (v1)

1. **GitHub tree truncation:** Repos with >100,000 files may return truncated trees. A warning is logged but recursive traversal is not implemented.
2. **Git LFS files:** LFS-tracked files store pointer files in the Git tree, not actual content. LFS files will be synced as pointer files.
3. **Large file handling:** Files over 100 MB use the Git Blobs API fallback on GitHub. Files exceeding API size limits will fail with an error in `SyncResult.errors`.
4. **Sync is synchronous:** The server API endpoint blocks until sync completes. For repos with 5,000+ files this could take 30-60 seconds. SSE/WebSocket streaming is deferred.
5. **No automatic scheduling:** Sync is on-demand only. Scheduled sync is out of scope for v1.
6. **Single-prefix per sync:** The `sync` command operates on one prefix at a time.
7. **No new npm dependencies.** Uses Node 18+ built-in `fetch` for all HTTP calls.

---

### Risk Assessment (Repo Sync)

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub API rate limit hit during large clone | Sync stalls or fails mid-operation | `rateLimitedFetch` checks `X-RateLimit-Remaining` and sleeps before reset; batch concurrency of 10; partial progress saved in SyncResult.errors |
| Azure DevOps throttling (~200 req/min) | Slow clone for large repos | 50ms inter-request delay in `downloadFile`; `Retry-After` handling in `rateLimitedFetch` |
| PAT expires mid-sync | Sync fails partway | Expiry check before starting sync; warning if within 14 days; partial state recoverable via re-sync |
| Credential store format change breaks existing users | Users lose storage configs | `tokens` field is optional; `load()` normalizes missing field to empty array |
| Large `.repo-sync-meta.json` for repos with 5,000+ files | Slow metadata read/write | ~200 KB for 5,000 files is acceptable; single API call to read/write |
| Concurrent syncs on same container | Race condition on metadata | Not addressed in v1; UI disables sync button during operation; CLI is single-invocation |

---

## Technical Design: Folder-Level Repository Linking and Sync

**Date:** 2026-04-02
**Status:** Ready for implementation
**References:**
- `docs/reference/refined-request-folder-link-sync.md` (requirements)
- `docs/reference/investigation-folder-link-sync.md` (technical investigation)
- `docs/reference/codebase-scan-folder-link-sync.md` (codebase scan)
- `docs/design/plan-004-folder-link-sync.md` (implementation plan)

### Feature Overview

Extend the existing container-level clone/sync to support:
1. **Linking** a container or sub-folder to a repository (metadata only, no file download)
2. **Cloning** into a specific folder prefix within a container
3. **Syncing** individual folder-level links or all links in a container
4. **Unlinking** to remove the association without deleting files
5. **UI** support for link management, visual indicators, and per-link sync

A new `.repo-links.json` metadata blob per container replaces the single-link `.repo-sync-meta.json` pattern, with automatic backward-compatible migration.

---

### 1. New and Modified TypeScript Types

#### 1.1 New Types in `src/core/types.ts`

Add after the existing `RepoFileEntry` interface (line 34):

```typescript
/** A single repository link within a container */
export interface RepoLink {
  /** Unique link identifier (UUID v4 via crypto.randomUUID()) */
  id: string;
  /** Repository provider */
  provider: "github" | "azure-devops";
  /** Full repository URL (e.g., "https://github.com/owner/repo") */
  repoUrl: string;
  /** Branch name (never undefined after creation -- resolved to default branch if not specified) */
  branch: string;
  /** Sub-path within the repository to sync from (e.g., "src/templates"). Undefined = entire repo */
  repoSubPath?: string;
  /** Blob prefix in the container (e.g., "prompts/coa"). Undefined = container root */
  targetPrefix?: string;
  /** ISO 8601 timestamp of last successful sync. Undefined if never synced */
  lastSyncAt?: string;
  /** Commit SHA of last successful sync */
  lastCommitSha?: string;
  /** Map of blobPath -> git SHA for all tracked files. Keys are blob paths (not repo paths) */
  fileShas: Record<string, string>;
  /** ISO 8601 timestamp of when the link was created */
  createdAt: string;
}

/** Container-level registry of all repository links */
export interface RepoLinksRegistry {
  /** Schema version for forward compatibility */
  version: 1;
  /** Array of link entries */
  links: RepoLink[];
}
```

#### 1.2 Internal Type in `src/core/sync-engine.ts` (Not Exported)

Add near the top of `sync-engine.ts`, after the `RepoProvider` interface:

```typescript
/** Maps a repo file to its target blob location. Internal to sync-engine. */
interface MappedFileEntry {
  /** Original path in the repository (used for provider.downloadFile) */
  repoPath: string;
  /** Target path in the container (used for blobClient.createBlob and fileShas keys) */
  blobPath: string;
  /** Git object SHA (content hash) */
  sha: string;
}
```

#### 1.3 Existing Types -- No Changes

The following existing types remain unchanged:
- `RepoSyncMeta` -- retained for backward compatibility (read-only during migration)
- `RepoFileEntry` -- unchanged; provider clients return these
- `SyncResult` -- unchanged; clone/sync functions return these
- `RepoProvider` -- unchanged; provider interface stays the same
- `StorageOpts`, `PatOpts` -- unchanged; CLI shared helpers stay the same

---

### 2. Link Registry Functions in `src/core/sync-engine.ts`

#### 2.1 Constants

```typescript
const LINKS_BLOB = ".repo-links.json";
// Existing: const META_BLOB = ".repo-sync-meta.json";
```

#### 2.2 `normalizePath`

```typescript
/**
 * Normalize a path by trimming leading and trailing slashes.
 * Returns empty string for undefined/null/empty input.
 */
export function normalizePath(path: string | undefined): string {
  if (!path) return "";
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}
```

**Behavior:**
- `normalizePath("prompts/coa/")` -> `"prompts/coa"`
- `normalizePath("/src/templates")` -> `"src/templates"`
- `normalizePath(undefined)` -> `""`
- `normalizePath("")` -> `""`

#### 2.3 `readLinks`

```typescript
/**
 * Read the link registry from a container.
 * Returns null if .repo-links.json does not exist.
 */
export async function readLinks(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry | null> {
  try {
    const blob = await blobClient.getBlobContent(container, LINKS_BLOB);
    const text = typeof blob.content === "string" ? blob.content : blob.content.toString("utf-8");
    return JSON.parse(text) as RepoLinksRegistry;
  } catch {
    return null;
  }
}
```

#### 2.4 `writeLinks`

```typescript
/**
 * Write the link registry to a container.
 */
export async function writeLinks(
  blobClient: BlobClient,
  container: string,
  registry: RepoLinksRegistry
): Promise<void> {
  const content = JSON.stringify(registry, null, 2);
  await blobClient.createBlob(container, LINKS_BLOB, content, "application/json");
}
```

#### 2.5 `migrateOldMeta`

```typescript
/**
 * Migrate .repo-sync-meta.json to .repo-links.json.
 * Returns the new registry if migration occurred, null if no old metadata exists.
 * Does NOT delete the old .repo-sync-meta.json (retained for safety).
 */
export async function migrateOldMeta(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry | null> {
  const oldMeta = await readSyncMeta(blobClient, container);
  if (!oldMeta) return null;

  const link: RepoLink = {
    id: crypto.randomUUID(),
    provider: oldMeta.provider,
    repoUrl: oldMeta.repoUrl,
    branch: oldMeta.branch,
    repoSubPath: undefined,
    targetPrefix: undefined,
    lastSyncAt: oldMeta.lastSyncAt,
    lastCommitSha: oldMeta.lastCommitSha,
    fileShas: { ...oldMeta.fileShas },
    createdAt: oldMeta.lastSyncAt, // best available timestamp
  };

  const registry: RepoLinksRegistry = { version: 1, links: [link] };
  await writeLinks(blobClient, container, registry);
  return registry;
}
```

**Key decisions:**
- Uses `crypto.randomUUID()` (Node.js built-in).
- `createdAt` is set to `lastSyncAt` from the old metadata as the best available timestamp.
- `fileShas` are copied as-is. Since the old format has no `targetPrefix` or `repoSubPath`, blob paths equal repo paths -- no transformation needed.

#### 2.6 `resolveLinks`

```typescript
/**
 * Read .repo-links.json, or auto-migrate from old format, or return empty registry.
 * This is the primary entry point for all callers needing link data.
 */
export async function resolveLinks(
  blobClient: BlobClient,
  container: string
): Promise<RepoLinksRegistry> {
  // 1. Try reading .repo-links.json
  const existing = await readLinks(blobClient, container);
  if (existing) return existing;

  // 2. Try auto-migrating from .repo-sync-meta.json
  const migrated = await migrateOldMeta(blobClient, container);
  if (migrated) return migrated;

  // 3. No metadata at all -- return empty registry
  return { version: 1, links: [] };
}
```

#### 2.7 `detectExactConflict`

```typescript
/**
 * Check if an exact prefix match already exists in the link list.
 * Returns true if a link with the same normalized targetPrefix exists.
 */
export function detectExactConflict(
  existingLinks: RepoLink[],
  newPrefix: string | undefined
): boolean {
  const norm = normalizePath(newPrefix);
  return existingLinks.some(
    (link) => normalizePath(link.targetPrefix) === norm
  );
}
```

#### 2.8 `detectOverlap`

```typescript
/**
 * Check for nested prefix overlap (one prefix is a sub-path of another).
 * Returns a warning message if overlap is detected, null otherwise.
 * Does NOT check for exact match (that is detectExactConflict).
 */
export function detectOverlap(
  existingLinks: RepoLink[],
  newPrefix: string | undefined
): string | null {
  const norm = normalizePath(newPrefix);
  for (const link of existingLinks) {
    const existing = normalizePath(link.targetPrefix);
    // Skip exact match (handled by detectExactConflict)
    if (norm === existing) continue;
    if (norm.startsWith(existing + "/") || existing.startsWith(norm + "/")) {
      return `Warning: prefix "${newPrefix ?? "(container root)"}" overlaps with existing link to ${link.repoUrl} at prefix "${link.targetPrefix ?? "(container root)"}"`;
    }
    // Special case: one is empty (container root) and the other is not
    if ((norm === "" && existing !== "") || (norm !== "" && existing === "")) {
      return `Warning: prefix "${newPrefix ?? "(container root)"}" overlaps with existing link to ${link.repoUrl} at prefix "${link.targetPrefix ?? "(container root)"}" (one covers the entire container)`;
    }
  }
  return null;
}
```

#### 2.9 `createLink`

```typescript
/**
 * Add a new link to the container's link registry.
 * Throws on exact prefix conflict. Returns warning on nested overlap.
 *
 * @param linkData - All fields except id, createdAt, fileShas (auto-generated)
 * @returns The created RepoLink and an optional warning string
 */
export async function createLink(
  blobClient: BlobClient,
  container: string,
  linkData: {
    provider: "github" | "azure-devops";
    repoUrl: string;
    branch: string;
    repoSubPath?: string;
    targetPrefix?: string;
  }
): Promise<{ link: RepoLink; warning?: string }> {
  const registry = await resolveLinks(blobClient, container);

  // Check for exact prefix conflict
  if (detectExactConflict(registry.links, linkData.targetPrefix)) {
    const norm = normalizePath(linkData.targetPrefix);
    throw new Error(
      `A link already exists for prefix "${norm || "(container root)"}". Use "unlink" first or specify a different prefix.`
    );
  }

  // Check for nested overlap (warning, not error)
  const warning = detectOverlap(registry.links, linkData.targetPrefix);

  const link: RepoLink = {
    id: crypto.randomUUID(),
    provider: linkData.provider,
    repoUrl: linkData.repoUrl,
    branch: linkData.branch,
    repoSubPath: linkData.repoSubPath ? normalizePath(linkData.repoSubPath) : undefined,
    targetPrefix: linkData.targetPrefix ? normalizePath(linkData.targetPrefix) : undefined,
    lastSyncAt: undefined,
    lastCommitSha: undefined,
    fileShas: {},
    createdAt: new Date().toISOString(),
  };

  registry.links.push(link);
  await writeLinks(blobClient, container, registry);

  return { link, warning: warning ?? undefined };
}
```

#### 2.10 `removeLink`

```typescript
/**
 * Remove a link by ID from the container's link registry.
 * Returns true if the link was found and removed, false otherwise.
 */
export async function removeLink(
  blobClient: BlobClient,
  container: string,
  linkId: string
): Promise<boolean> {
  const registry = await resolveLinks(blobClient, container);
  const before = registry.links.length;
  registry.links = registry.links.filter((l) => l.id !== linkId);

  if (registry.links.length === before) return false;

  await writeLinks(blobClient, container, registry);
  return true;
}
```

#### 2.11 `findLinkByPrefix`

```typescript
/**
 * Find a link by its normalized target prefix.
 * Returns the link if exactly one match is found.
 * Throws if ambiguous (multiple matches) or not found.
 */
export function findLinkByPrefix(
  links: RepoLink[],
  prefix: string | undefined
): RepoLink {
  const norm = normalizePath(prefix);
  const matches = links.filter((l) => normalizePath(l.targetPrefix) === norm);

  if (matches.length === 0) {
    throw new Error(`No link found for prefix "${norm || "(container root)"}".`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple links found for prefix "${norm || "(container root)"}". Use --link-id to specify.`
    );
  }
  return matches[0];
}
```

---

### 3. Path Mapping Logic in `src/core/sync-engine.ts`

#### 3.1 `filterByRepoSubPath`

```typescript
/**
 * Filter a list of repo file entries to include only files under the given sub-path.
 * If repoSubPath is undefined/empty, returns all files.
 */
export function filterByRepoSubPath(
  files: RepoFileEntry[],
  repoSubPath?: string
): RepoFileEntry[] {
  const norm = normalizePath(repoSubPath);
  if (!norm) return files;
  const prefix = norm + "/";
  return files.filter((f) => f.path === norm || f.path.startsWith(prefix));
}
```

#### 3.2 `mapToTargetPaths`

```typescript
/**
 * Map filtered repo files to their target blob paths.
 * Strips repoSubPath prefix and prepends targetPrefix.
 *
 * Identity transform when both repoSubPath and targetPrefix are undefined.
 */
export function mapToTargetPaths(
  files: RepoFileEntry[],
  repoSubPath?: string,
  targetPrefix?: string
): MappedFileEntry[] {
  const normRepo = normalizePath(repoSubPath);
  const normTarget = normalizePath(targetPrefix);
  const stripPrefix = normRepo ? normRepo + "/" : "";

  return files.map((file) => {
    // Compute relative path by stripping the repo sub-path prefix
    const relativePath = stripPrefix && file.path.startsWith(stripPrefix)
      ? file.path.slice(stripPrefix.length)
      : file.path;

    // Compute blob path by prepending the target prefix
    const blobPath = normTarget
      ? normTarget + "/" + relativePath
      : relativePath;

    return {
      repoPath: file.path,
      blobPath,
      sha: file.sha,
    };
  });
}
```

**Path mapping examples:**

| `repoSubPath` | `targetPrefix` | Repo file path | Blob path |
|---|---|---|---|
| `undefined` | `undefined` | `src/templates/extract.json` | `src/templates/extract.json` |
| `"src/templates"` | `undefined` | `src/templates/extract.json` | `extract.json` |
| `undefined` | `"prompts/coa"` | `src/templates/extract.json` | `prompts/coa/src/templates/extract.json` |
| `"src/templates"` | `"prompts/coa"` | `src/templates/extract.json` | `prompts/coa/extract.json` |
| `"src/templates"` | `"prompts/coa"` | `README.md` | Excluded by filterByRepoSubPath |

---

### 4. Refactored `cloneRepo` and `syncRepo` Signatures

#### 4.1 `cloneRepo` -- New Signature

**Current signature (line 33 of sync-engine.ts):**
```typescript
export async function cloneRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  meta: Omit<RepoSyncMeta, "lastSyncAt" | "fileShas">,
  onProgress?: (msg: string) => void
): Promise<SyncResult>
```

**New signature:**
```typescript
/**
 * Clone a repository (or sub-path) into a container (or container prefix).
 * The caller is responsible for writing the updated link back to the registry.
 *
 * @param link - The RepoLink describing what to clone and where. Updated in-place
 *               with lastSyncAt, lastCommitSha, and fileShas on success.
 * @returns SyncResult with upload/error counts
 */
export async function cloneRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  onProgress?: (msg: string) => void
): Promise<SyncResult>
```

**Internal changes:**
1. After `provider.listFiles()`, apply `filterByRepoSubPath(remoteFiles, link.repoSubPath)`.
2. Apply `mapToTargetPaths(filteredFiles, link.repoSubPath, link.targetPrefix)`.
3. In the `processInBatches` callback:
   - Use `mappedFile.repoPath` for `provider.downloadFile(mappedFile.repoPath)`.
   - Use `mappedFile.blobPath` for `blobClient.createBlob(container, mappedFile.blobPath, ...)`.
   - Store `fileShas[mappedFile.blobPath] = mappedFile.sha`.
4. After completion, update `link` in-place:
   - `link.lastSyncAt = new Date().toISOString()`
   - `link.fileShas = fileShas`
5. Do NOT write `.repo-sync-meta.json`. Do NOT write `.repo-links.json` (caller does this).
6. Return `SyncResult` as before.

**Full implementation:**

```typescript
export async function cloneRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} files in repository.`);

  // Apply path filtering and mapping
  const filtered = filterByRepoSubPath(remoteFiles, link.repoSubPath);
  const mapped = mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix);
  onProgress?.(`${mapped.length} files match after filtering.`);

  const fileShas: Record<string, string> = {};

  await processInBatches(mapped, BATCH_CONCURRENCY, async (entry) => {
    try {
      const content = await provider.downloadFile(entry.repoPath);
      const contentType = inferContentType(entry.blobPath);
      await blobClient.createBlob(container, entry.blobPath, content, contentType);
      fileShas[entry.blobPath] = entry.sha;
      result.uploaded.push(entry.blobPath);
      onProgress?.(`Uploaded: ${entry.blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entry.blobPath}: ${msg}`);
      onProgress?.(`Error: ${entry.blobPath} -- ${msg}`);
    }
  });

  // Update the link in-place (caller writes it to the registry)
  link.lastSyncAt = new Date().toISOString();
  link.fileShas = fileShas;

  return result;
}
```

#### 4.2 `syncRepo` -- New Signature

**Current signature (line 77 of sync-engine.ts):**
```typescript
export async function syncRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  dryRun: boolean = false,
  onProgress?: (msg: string) => void
): Promise<SyncResult>
```

**New signature:**
```typescript
/**
 * Sync a previously cloned link with its remote repository.
 * The caller provides the RepoLink (instead of this function reading meta internally).
 * The link is updated in-place with new lastSyncAt, lastCommitSha, and fileShas.
 * The caller is responsible for writing the updated link back to the registry.
 *
 * @param link - The RepoLink to sync. Updated in-place on success.
 * @returns SyncResult with upload/delete/skip/error counts
 */
export async function syncRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  dryRun: boolean = false,
  onProgress?: (msg: string) => void
): Promise<SyncResult>
```

**Internal changes:**
1. Remove the internal `readSyncMeta()` call. Use `link.fileShas` as `oldShas`.
2. After `provider.listFiles()`, apply `filterByRepoSubPath()` and `mapToTargetPaths()`.
3. Compare `mappedFile.blobPath` keys against `link.fileShas` for change detection.
4. Use `mappedFile.repoPath` for `provider.downloadFile()`.
5. Use `mappedFile.blobPath` for `blobClient.createBlob()` and `blobClient.deleteBlob()`.
6. After completion, update `link` in-place:
   - `link.lastSyncAt = new Date().toISOString()`
   - `link.fileShas = newShas`
7. Do NOT write any metadata blobs (caller does this).

**Full implementation:**

```typescript
export async function syncRepo(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  dryRun: boolean = false,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], deleted: [], skipped: [], errors: [] };

  onProgress?.("Listing remote files...");
  const remoteFiles = await provider.listFiles();
  onProgress?.(`Found ${remoteFiles.length} files in repository.`);

  // Apply path filtering and mapping
  const filtered = filterByRepoSubPath(remoteFiles, link.repoSubPath);
  const mapped = mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix);
  onProgress?.(`${mapped.length} files match after filtering.`);

  const oldShas = link.fileShas;
  const newShas: Record<string, string> = {};

  // Determine what changed
  const toUpload: MappedFileEntry[] = [];
  const remoteBlobPathSet = new Set<string>();

  for (const entry of mapped) {
    remoteBlobPathSet.add(entry.blobPath);
    if (oldShas[entry.blobPath] !== entry.sha) {
      toUpload.push(entry);
    } else {
      result.skipped.push(entry.blobPath);
      newShas[entry.blobPath] = entry.sha;
    }
  }

  // Files that were in the old sync but are no longer in the remote set
  const toDelete: string[] = [];
  for (const oldBlobPath of Object.keys(oldShas)) {
    if (!remoteBlobPathSet.has(oldBlobPath)) {
      toDelete.push(oldBlobPath);
    }
  }

  onProgress?.(`Changes: ${toUpload.length} to upload, ${toDelete.length} to delete, ${result.skipped.length} unchanged.`);

  if (dryRun) {
    result.uploaded = toUpload.map((e) => e.blobPath);
    result.deleted = toDelete;
    return result;
  }

  // Upload changed/new files
  await processInBatches(toUpload, BATCH_CONCURRENCY, async (entry) => {
    try {
      const content = await provider.downloadFile(entry.repoPath);
      const contentType = inferContentType(entry.blobPath);
      await blobClient.createBlob(container, entry.blobPath, content, contentType);
      newShas[entry.blobPath] = entry.sha;
      result.uploaded.push(entry.blobPath);
      onProgress?.(`Uploaded: ${entry.blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entry.blobPath}: ${msg}`);
    }
  });

  // Delete removed files
  for (const blobPath of toDelete) {
    try {
      await blobClient.deleteBlob(container, blobPath);
      result.deleted.push(blobPath);
      onProgress?.(`Deleted: ${blobPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`delete ${blobPath}: ${msg}`);
    }
  }

  // Update link in-place (caller writes registry)
  link.lastSyncAt = new Date().toISOString();
  link.fileShas = newShas;

  return result;
}
```

#### 4.3 Backward Compatibility Guarantee

When `link.targetPrefix` is `undefined` and `link.repoSubPath` is `undefined`:
- `filterByRepoSubPath()` returns all files (identity).
- `mapToTargetPaths()` maps `blobPath = repoPath` for every file (identity).
- All existing behavior is preserved exactly.

---

### 5. New CLI Commands in `src/cli/commands/repo-sync.ts`

#### 5.1 New Imports

Add to the existing import block:

```typescript
import {
  cloneRepo, syncRepo, readSyncMeta,
  resolveLinks, writeLinks, createLink, removeLink, findLinkByPrefix,
  normalizePath
} from "../../core/sync-engine.js";
import type { RepoLink, RepoLinksRegistry } from "../../core/types.js";
```

#### 5.2 `linkGitHub`

```typescript
export async function linkGitHub(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  opts: {
    prefix?: string;
    repoPath?: string;
    branch?: string;
  },
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "github", patOpts);
  const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
  const client = new GitHubClient(pat);
  const blobClient = new BlobClient(entry);

  // Validate repo access and resolve branch
  const targetBranch = opts.branch ?? await client.getDefaultBranch(owner, repo);
  console.log(`Validating access to github.com/${owner}/${repo} (branch: ${targetBranch})...`);

  // Validate by listing files (also confirms branch exists)
  await client.listFiles(owner, repo, targetBranch);
  console.log("Repository validated.");

  // Create the link
  const { link, warning } = await createLink(blobClient, container, {
    provider: "github",
    repoUrl,
    branch: targetBranch,
    repoSubPath: opts.repoPath,
    targetPrefix: opts.prefix,
  });

  if (warning) console.error(`\n${warning}\n`);

  console.log(`Link created successfully.`);
  console.log(`  Link ID:        ${link.id}`);
  console.log(`  Repository:     ${repoUrl}`);
  console.log(`  Branch:         ${targetBranch}`);
  console.log(`  Repo sub-path:  ${link.repoSubPath ?? "(entire repo)"}`);
  console.log(`  Target prefix:  ${link.targetPrefix ?? "(container root)"}`);
  console.log(`\nUse "sync --container ${container} --link-id ${link.id}" to download files.`);
}
```

#### 5.3 `linkDevOps`

```typescript
export async function linkDevOps(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  opts: {
    prefix?: string;
    repoPath?: string;
    branch?: string;
  },
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "azure-devops", patOpts);
  const { org, project, repo } = DevOpsClient.parseRepoUrl(repoUrl);
  const client = new DevOpsClient(pat, org);
  const blobClient = new BlobClient(entry);

  const targetBranch = opts.branch ?? await client.getDefaultBranch(project, repo);
  console.log(`Validating access to ${org}/${project}/${repo} (branch: ${targetBranch})...`);

  await client.listFiles(project, repo, targetBranch);
  console.log("Repository validated.");

  const { link, warning } = await createLink(blobClient, container, {
    provider: "azure-devops",
    repoUrl,
    branch: targetBranch,
    repoSubPath: opts.repoPath,
    targetPrefix: opts.prefix,
  });

  if (warning) console.error(`\n${warning}\n`);

  console.log(`Link created successfully.`);
  console.log(`  Link ID:        ${link.id}`);
  console.log(`  Repository:     ${repoUrl}`);
  console.log(`  Branch:         ${targetBranch}`);
  console.log(`  Repo sub-path:  ${link.repoSubPath ?? "(entire repo)"}`);
  console.log(`  Target prefix:  ${link.targetPrefix ?? "(container root)"}`);
  console.log(`\nUse "sync --container ${container} --link-id ${link.id}" to download files.`);
}
```

#### 5.4 `unlinkContainer`

```typescript
export async function unlinkContainer(
  container: string,
  storageOpts: StorageOpts,
  opts: {
    prefix?: string;
    linkId?: string;
  }
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);
  const registry = await resolveLinks(blobClient, container);

  if (registry.links.length === 0) {
    console.error(`Container '${container}' has no repository links.`);
    process.exit(1);
  }

  let targetLink: RepoLink;

  if (opts.linkId) {
    // Find by ID
    const found = registry.links.find((l) => l.id === opts.linkId);
    if (!found) {
      console.error(`Link ID '${opts.linkId}' not found in container '${container}'.`);
      process.exit(1);
    }
    targetLink = found;
  } else if (opts.prefix !== undefined) {
    // Find by prefix
    targetLink = findLinkByPrefix(registry.links, opts.prefix);
  } else if (registry.links.length === 1) {
    // Single link, no qualifier needed
    targetLink = registry.links[0];
  } else {
    // Multiple links, no qualifier -- error with guidance
    console.error(`Container '${container}' has ${registry.links.length} links. Specify --prefix or --link-id:`);
    for (const l of registry.links) {
      console.error(`  ${l.id}  ${l.targetPrefix ?? "(root)"}  ${l.repoUrl}`);
    }
    process.exit(1);
  }

  const removed = await removeLink(blobClient, container, targetLink.id);
  if (removed) {
    console.log(`Link removed: ${targetLink.repoUrl} at prefix "${targetLink.targetPrefix ?? "(container root)"}"`);
    console.log("Synced files were NOT deleted.");
  } else {
    console.error("Failed to remove link.");
    process.exit(1);
  }
}
```

#### 5.5 `listLinks`

```typescript
export async function listLinks(
  container: string,
  storageOpts: StorageOpts
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);
  const registry = await resolveLinks(blobClient, container);

  if (registry.links.length === 0) {
    console.log("No repository links found.");
    return;
  }

  console.log(`Repository links for container '${container}':\n`);
  console.log(
    "ID".padEnd(38) +
    "Provider".padEnd(14) +
    "Repository".padEnd(50) +
    "Branch".padEnd(16) +
    "Repo Sub-Path".padEnd(24) +
    "Target Prefix".padEnd(24) +
    "Last Sync"
  );
  console.log("-".repeat(180));

  for (const l of registry.links) {
    console.log(
      l.id.padEnd(38) +
      l.provider.padEnd(14) +
      l.repoUrl.substring(0, 48).padEnd(50) +
      l.branch.padEnd(16) +
      (l.repoSubPath ?? "(all)").padEnd(24) +
      (l.targetPrefix ?? "(root)").padEnd(24) +
      (l.lastSyncAt ? new Date(l.lastSyncAt).toLocaleString() : "never")
    );
  }
}
```

#### 5.6 Modified `cloneGitHub` -- New Signature

```typescript
export async function cloneGitHub(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  patOpts: PatOpts = {},
  opts: { prefix?: string; repoPath?: string } = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "github", patOpts);
  const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
  const client = new GitHubClient(pat);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(owner, repo);
  const prefixLabel = opts.prefix ? ` into prefix "${opts.prefix}"` : "";
  console.log(`Cloning github.com/${owner}/${repo} (branch: ${targetBranch})${prefixLabel} into container '${container}'...\n`);

  const provider: RepoProvider = {
    listFiles: () => client.listFiles(owner, repo, targetBranch),
    downloadFile: (path) => client.downloadFile(owner, repo, path, targetBranch),
  };

  // Create a link entry first
  const { link, warning } = await createLink(blobClient, container, {
    provider: "github",
    repoUrl,
    branch: targetBranch,
    repoSubPath: opts.repoPath,
    targetPrefix: opts.prefix,
  });

  if (warning) console.error(`${warning}\n`);

  // Clone using the link
  const result = await cloneRepo(blobClient, container, provider, link, (msg) => console.log(`  ${msg}`));

  // Write updated link back to registry
  const registry = await resolveLinks(blobClient, container);
  const idx = registry.links.findIndex((l) => l.id === link.id);
  if (idx >= 0) registry.links[idx] = link;
  await writeLinks(blobClient, container, registry);

  console.log(`\nDone. Uploaded: ${result.uploaded.length}, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error("\nErrors:");
    for (const e of result.errors) console.error(`  ${e}`);
  }
}
```

#### 5.7 Modified `cloneDevOps` -- New Signature

Same pattern as `cloneGitHub` but using `DevOpsClient`. The signature adds the same `opts: { prefix?: string; repoPath?: string } = {}` parameter.

#### 5.8 Modified `syncContainer` -- New Signature

```typescript
export async function syncContainer(
  container: string,
  storageOpts: StorageOpts,
  dryRun: boolean = false,
  patOpts: PatOpts = {},
  opts: { prefix?: string; linkId?: string; all?: boolean } = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);
  const registry = await resolveLinks(blobClient, container);

  if (registry.links.length === 0) {
    console.error(`Container '${container}' has no repository links.`);
    process.exit(1);
  }

  // Determine which links to sync
  let linksToSync: RepoLink[];

  if (opts.all) {
    linksToSync = registry.links;
  } else if (opts.linkId) {
    const found = registry.links.find((l) => l.id === opts.linkId);
    if (!found) {
      console.error(`Link ID '${opts.linkId}' not found.`);
      process.exit(1);
    }
    linksToSync = [found];
  } else if (opts.prefix !== undefined) {
    linksToSync = [findLinkByPrefix(registry.links, opts.prefix)];
  } else if (registry.links.length === 1) {
    linksToSync = [registry.links[0]];
  } else {
    console.error(`Container '${container}' has ${registry.links.length} links. Specify --prefix, --link-id, or --all:`);
    for (const l of registry.links) {
      console.error(`  ${l.id}  ${l.targetPrefix ?? "(root)"}  ${l.repoUrl}`);
    }
    process.exit(1);
  }

  // Sync each link sequentially
  for (const link of linksToSync) {
    const pat = await resolvePatToken(store, link.provider, patOpts);

    let provider: RepoProvider;
    if (link.provider === "github") {
      const { owner, repo } = GitHubClient.parseRepoUrl(link.repoUrl);
      const client = new GitHubClient(pat);
      provider = {
        listFiles: () => client.listFiles(owner, repo, link.branch),
        downloadFile: (path) => client.downloadFile(owner, repo, path, link.branch),
      };
    } else {
      const { org, project, repo } = DevOpsClient.parseRepoUrl(link.repoUrl);
      const client = new DevOpsClient(pat, org);
      provider = {
        listFiles: () => client.listFiles(project, repo, link.branch),
        downloadFile: (path) => client.downloadFile(project, repo, path, link.branch),
      };
    }

    console.log(`\nSyncing link: ${link.repoUrl} (branch: ${link.branch}) -> prefix "${link.targetPrefix ?? "(root)"}"`);
    if (link.lastSyncAt) console.log(`  Last sync: ${link.lastSyncAt}`);
    if (dryRun) console.log("  (Dry run -- no changes will be made)");

    const result = await syncRepo(blobClient, container, provider, link, dryRun, (msg) => console.log(`  ${msg}`));

    // Write updated link back to registry after each sync
    if (!dryRun) {
      const idx = registry.links.findIndex((l) => l.id === link.id);
      if (idx >= 0) registry.links[idx] = link;
      await writeLinks(blobClient, container, registry);
    }

    console.log(`  Uploaded: ${result.uploaded.length}, Deleted: ${result.deleted.length}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.error("  Errors:");
      for (const e of result.errors) console.error(`    ${e}`);
    }
  }
}
```

---

### 6. CLI Command Registration in `src/cli/index.ts`

#### 6.1 Updated Import

```typescript
import {
  cloneGitHub, cloneDevOps, syncContainer,
  linkGitHub, linkDevOps, unlinkContainer, listLinks
} from "./commands/repo-sync.js";
```

#### 6.2 New Commands

Add after the existing `sync` command registration (after line 242):

```typescript
// Link GitHub repo
program
  .command("link-github")
  .description("Link a container/folder to a GitHub repository (metadata only, no download)")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .requiredOption("--container <name>", "Target container")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--branch <branch>", "Branch (default: repo default branch)")
  .option("--storage <name>", "Storage account name")
  .option("--token-name <name>", "PAT token name")
  .option("--pat <token>", "GitHub PAT (inline)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name")
  .action(async (opts) => {
    await linkGitHub(
      opts.repo, opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      { prefix: opts.prefix, repoPath: opts.repoPath, branch: opts.branch },
      { pat: opts.pat, tokenName: opts.tokenName }
    );
  });

// Link Azure DevOps repo
program
  .command("link-devops")
  .description("Link a container/folder to an Azure DevOps repository (metadata only, no download)")
  .requiredOption("--repo <url>", "Azure DevOps repository URL")
  .requiredOption("--container <name>", "Target container")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--branch <branch>", "Branch (default: repo default branch)")
  .option("--storage <name>", "Storage account name")
  .option("--token-name <name>", "PAT token name")
  .option("--pat <token>", "Azure DevOps PAT (inline)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name")
  .action(async (opts) => {
    await linkDevOps(
      opts.repo, opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      { prefix: opts.prefix, repoPath: opts.repoPath, branch: opts.branch },
      { pat: opts.pat, tokenName: opts.tokenName }
    );
  });

// Unlink repository
program
  .command("unlink")
  .description("Remove a repository link from a container (files are NOT deleted)")
  .requiredOption("--container <name>", "Container name")
  .option("--prefix <path>", "Folder prefix to unlink")
  .option("--link-id <id>", "Link ID to unlink")
  .option("--storage <name>", "Storage account name")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name")
  .action(async (opts) => {
    await unlinkContainer(
      opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      { prefix: opts.prefix, linkId: opts.linkId }
    );
  });

// List repository links
program
  .command("list-links")
  .description("List all repository links in a container")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name")
  .action(async (opts) => {
    await listLinks(
      opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }
    );
  });
```

#### 6.3 Modified Existing Commands

**`clone-github`** -- add two options before `.action()`:
```typescript
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
```

Update `.action()`:
```typescript
  .action(async (opts) => {
    await cloneGitHub(
      opts.repo, opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      opts.branch,
      { pat: opts.pat, tokenName: opts.tokenName },
      { prefix: opts.prefix, repoPath: opts.repoPath }
    );
  });
```

**`clone-devops`** -- same additions.

**`sync`** -- add three options before `.action()`:
```typescript
  .option("--prefix <path>", "Sync only the link at this prefix")
  .option("--link-id <id>", "Sync a specific link by ID")
  .option("--all", "Sync all links in the container")
```

Update `.action()`:
```typescript
  .action(async (opts) => {
    await syncContainer(
      opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      opts.dryRun ?? false,
      { pat: opts.pat, tokenName: opts.tokenName },
      { prefix: opts.prefix, linkId: opts.linkId, all: opts.all }
    );
  });
```

---

### 7. API Endpoint Contracts in `src/electron/server.ts`

#### 7.1 New Import

Add to the import from `sync-engine.js`:

```typescript
import {
  readSyncMeta, syncRepo,
  resolveLinks, writeLinks, createLink, removeLink, findLinkByPrefix
} from "../core/sync-engine.js";
import type { RepoProvider } from "../core/sync-engine.js";
import type { RepoLink } from "../core/types.js";
```

#### 7.2 Helper: `buildProviderForLink`

```typescript
/**
 * Construct a RepoProvider for a given link using stored PAT tokens.
 * Throws if no PAT is configured for the link's provider.
 */
function buildProviderForLink(
  store: CredentialStore,
  link: RepoLink
): RepoProvider {
  const pat = store.getTokenByProvider(link.provider);
  if (!pat) {
    throw new Error(`No ${link.provider} token configured. Add one via CLI: add-token --provider ${link.provider} --token <token> --name <name>`);
  }

  if (link.provider === "github") {
    const { owner, repo } = GitHubClient.parseRepoUrl(link.repoUrl);
    const client = new GitHubClient(pat.token);
    return {
      listFiles: () => client.listFiles(owner, repo, link.branch),
      downloadFile: (path) => client.downloadFile(owner, repo, path, link.branch),
    };
  } else {
    const { org, project, repo } = DevOpsClient.parseRepoUrl(link.repoUrl);
    const client = new DevOpsClient(pat.token, org);
    return {
      listFiles: () => client.listFiles(project, repo, link.branch),
      downloadFile: (path) => client.downloadFile(project, repo, path, link.branch),
    };
  }
}
```

#### 7.3 `GET /api/links/:storage/:container`

**Purpose:** List all repository links in a container.

**Response:** `RepoLink[]` (the `links` array from the registry)

```typescript
app.get("/api/links/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);
    const registry = await resolveLinks(blobClient, req.params.container);
    res.json(registry.links);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.4 `POST /api/links/:storage/:container`

**Purpose:** Create a new repository link.

**Request body:**
```json
{
  "provider": "github" | "azure-devops",
  "repoUrl": "string",
  "branch": "string (optional -- will be resolved to default if omitted)",
  "repoSubPath": "string (optional)",
  "targetPrefix": "string (optional)"
}
```

**Response (201):**
```json
{
  "link": { /* RepoLink object */ },
  "warning": "string or undefined"
}
```

**Response (400):** `{ "error": "A link already exists for prefix ..." }`

```typescript
app.post("/api/links/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

    const { provider, repoUrl, branch, repoSubPath, targetPrefix } = req.body;
    if (!provider || !repoUrl) {
      res.status(400).json({ error: "provider and repoUrl are required" });
      return;
    }

    // Resolve branch if not provided
    let resolvedBranch = branch;
    if (!resolvedBranch) {
      const pat = store.getTokenByProvider(provider);
      if (!pat) { res.status(400).json({ error: `No ${provider} token configured` }); return; }
      if (provider === "github") {
        const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
        const client = new GitHubClient(pat.token);
        resolvedBranch = await client.getDefaultBranch(owner, repo);
      } else {
        const { org, project, repo } = DevOpsClient.parseRepoUrl(repoUrl);
        const client = new DevOpsClient(pat.token, org);
        resolvedBranch = await client.getDefaultBranch(project, repo);
      }
    }

    const blobClient = new BlobClient(entry);
    const result = await createLink(blobClient, req.params.container, {
      provider,
      repoUrl,
      branch: resolvedBranch,
      repoSubPath,
      targetPrefix,
    });

    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already exists") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});
```

#### 7.5 `DELETE /api/links/:storage/:container/:linkId`

**Purpose:** Remove a link by ID.

**Response (200):** `{ "success": true }`
**Response (404):** `{ "error": "Link not found" }`

```typescript
app.delete("/api/links/:storage/:container/:linkId", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);
    const removed = await removeLink(blobClient, req.params.container, req.params.linkId);
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Link not found" });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.6 `POST /api/sync/:storage/:container/:linkId`

**Purpose:** Sync a specific link.

**Query params:** `?dryRun=true` (optional)

**Response (200):** `SyncResult` object

```typescript
app.post("/api/sync/:storage/:container/:linkId", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);

    const registry = await resolveLinks(blobClient, req.params.container);
    const link = registry.links.find((l) => l.id === req.params.linkId);
    if (!link) { res.status(404).json({ error: "Link not found" }); return; }

    const provider = buildProviderForLink(store, link);
    const dryRun = req.query.dryRun === "true";

    const result = await syncRepo(blobClient, req.params.container, provider, link, dryRun);

    // Write updated link back to registry
    if (!dryRun) {
      const idx = registry.links.findIndex((l) => l.id === link.id);
      if (idx >= 0) registry.links[idx] = link;
      await writeLinks(blobClient, req.params.container, registry);
    }

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.7 `POST /api/sync-all/:storage/:container`

**Purpose:** Sync all links in a container sequentially.

**Response (200):**
```json
{
  "results": [
    { "linkId": "uuid", "targetPrefix": "...", "result": { /* SyncResult */ } },
    { "linkId": "uuid", "targetPrefix": "...", "error": "..." }
  ]
}
```

```typescript
app.post("/api/sync-all/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);

    const registry = await resolveLinks(blobClient, req.params.container);
    if (registry.links.length === 0) {
      res.status(400).json({ error: "No repository links found" });
      return;
    }

    const results: Array<{ linkId: string; targetPrefix?: string; result?: SyncResult; error?: string }> = [];

    for (const link of registry.links) {
      try {
        const provider = buildProviderForLink(store, link);
        const result = await syncRepo(blobClient, req.params.container, provider, link);

        // Write updated link after each sync
        const idx = registry.links.findIndex((l) => l.id === link.id);
        if (idx >= 0) registry.links[idx] = link;
        await writeLinks(blobClient, req.params.container, registry);

        results.push({ linkId: link.id, targetPrefix: link.targetPrefix, result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ linkId: link.id, targetPrefix: link.targetPrefix, error: msg });
      }
    }

    res.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.8 Modified `GET /api/sync-meta/:storage/:container` (Backward Compatibility)

**Change:** Call `resolveLinks()` first. If links exist, return the first link formatted as old `RepoSyncMeta` shape. Otherwise fall back to the current behavior.

```typescript
app.get("/api/sync-meta/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);

    const registry = await resolveLinks(blobClient, req.params.container);
    if (registry.links.length > 0) {
      // Return first link formatted as old RepoSyncMeta shape
      const link = registry.links[0];
      res.json({
        provider: link.provider,
        repoUrl: link.repoUrl,
        branch: link.branch,
        lastSyncAt: link.lastSyncAt ?? "",
        lastCommitSha: link.lastCommitSha,
        fileShas: link.fileShas,
        // Additional fields for enhanced UI
        linkCount: registry.links.length,
      });
    } else {
      res.json(null);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.9 Modified `POST /api/sync/:storage/:container` (Backward Compatibility)

**Change:** For single-link containers, sync the link. For multi-link containers, return HTTP 400 with guidance.

```typescript
app.post("/api/sync/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
    const blobClient = new BlobClient(entry);

    const registry = await resolveLinks(blobClient, req.params.container);
    if (registry.links.length === 0) {
      res.status(400).json({ error: "Container is not a synced repository" });
      return;
    }

    if (registry.links.length > 1) {
      res.status(400).json({
        error: "Multiple links exist. Use /api/sync/:storage/:container/:linkId or /api/sync-all/:storage/:container",
        links: registry.links.map((l) => ({ id: l.id, targetPrefix: l.targetPrefix, repoUrl: l.repoUrl })),
      });
      return;
    }

    const link = registry.links[0];
    const provider = buildProviderForLink(store, link);
    const dryRun = req.query.dryRun === "true";

    const result = await syncRepo(blobClient, req.params.container, provider, link, dryRun);

    if (!dryRun) {
      registry.links[0] = link;
      await writeLinks(blobClient, req.params.container, registry);
    }

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

---

### 8. UI Components

#### 8.1 New HTML in `src/electron/public/index.html`

Add after the existing `<!-- Sync Confirmation Modal -->` (after line 137, before `<!-- Context Menu (files) -->`):

```html
<!-- Link to Repository Dialog -->
<div id="link-dialog" class="modal hidden">
  <div class="modal-content" style="max-width:500px">
    <h2>Link to Repository</h2>
    <label>Provider
      <select id="link-provider" style="display:block;width:100%;margin-top:4px;padding:8px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        <option value="github">GitHub</option>
        <option value="azure-devops">Azure DevOps</option>
      </select>
    </label>
    <label>Repository URL<input type="text" id="link-repo-url" placeholder="https://github.com/owner/repo"></label>
    <label>Branch<input type="text" id="link-branch" placeholder="(default branch)"></label>
    <label>Repository sub-path<input type="text" id="link-repo-path" placeholder="(entire repository)"></label>
    <label>Target prefix<input type="text" id="link-target-prefix" placeholder="(container root)"></label>
    <label>Token
      <select id="link-token" style="display:block;width:100%;margin-top:4px;padding:8px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        <option value="">Loading tokens...</option>
      </select>
    </label>
    <div id="link-warning" style="color:var(--expiry-warning);font-size:12px;margin:8px 0;display:none;"></div>
    <div class="modal-actions">
      <button id="link-cancel">Cancel</button>
      <button id="link-only" class="primary">Link Only</button>
      <button id="link-and-sync" class="primary">Link & Sync</button>
    </div>
  </div>
</div>

<!-- Multi-Link Sync Dialog -->
<div id="multi-link-sync-dialog" class="modal hidden">
  <div class="modal-content" style="max-width:600px">
    <h2>Sync Repository Links</h2>
    <div id="multi-link-list" style="max-height:300px;overflow-y:auto;margin-bottom:16px;"></div>
    <div class="modal-actions">
      <button id="multi-link-close">Close</button>
      <button id="multi-link-sync-all" class="primary">Sync All</button>
    </div>
  </div>
</div>

<!-- Unlink Confirmation Dialog -->
<div id="unlink-confirm-dialog" class="modal hidden">
  <div class="modal-content">
    <h2>Unlink Repository</h2>
    <p id="unlink-message" style="font-size:13px;color:var(--text);margin-bottom:12px;"></p>
    <p style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">Synced files will NOT be deleted.</p>
    <div class="modal-actions">
      <button id="unlink-cancel">Cancel</button>
      <button id="unlink-confirm" class="primary danger">Unlink</button>
    </div>
  </div>
</div>

<!-- Links Panel (shown as modal) -->
<div id="links-panel" class="modal hidden">
  <div class="modal-content" style="max-width:700px">
    <h2>Repository Links</h2>
    <div id="links-panel-list" style="max-height:400px;overflow-y:auto;margin-bottom:16px;"></div>
    <div class="modal-actions">
      <button id="links-panel-close">Close</button>
    </div>
  </div>
</div>
```

**Context menu additions.** Add to `<!-- Context Menu (containers) -->`:
```html
<div id="container-context-menu" class="context-menu hidden">
  <div class="context-menu-item" id="ctx-refresh-container">Refresh</div>
  <div class="context-menu-item" id="ctx-link-container">Link to Repository...</div>
  <div class="context-menu-item" id="ctx-view-links">View Links</div>
</div>
```

Add to `<!-- Context Menu (folders) -->`:
```html
<div id="folder-context-menu" class="context-menu hidden">
  <div class="context-menu-item" id="ctx-refresh-folder">Refresh</div>
  <div class="context-menu-item" id="ctx-link-folder">Link to Repository...</div>
  <div class="context-menu-item" id="ctx-sync-folder">Sync from Repository</div>
  <div class="context-menu-item" id="ctx-unlink-folder">Unlink Repository</div>
  <div class="context-menu-item ctx-danger" id="ctx-delete-folder">Delete Folder</div>
</div>
```

Note: `ctx-sync-folder` and `ctx-unlink-folder` are shown/hidden dynamically in JavaScript based on whether the folder is a link target.

#### 8.2 CSS Additions in `src/electron/public/styles.css`

```css
/* Link indicators */
.link-indicator {
  font-size: 10px;
  margin-left: 4px;
  opacity: 0.7;
  cursor: help;
}
.link-badge {
  font-size: 10px;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg);
  cursor: pointer;
  font-weight: 600;
}
.link-list-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.link-list-item:last-child { border-bottom: none; }
.link-list-item .link-repo { font-weight: 500; }
.link-list-item .link-meta { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
.link-list-item .link-actions { margin-top: 6px; }
.link-list-item .link-actions button { font-size: 11px; padding: 2px 8px; margin-right: 4px; }
.link-warning { color: var(--expiry-warning); font-size: 12px; }
```

#### 8.3 JavaScript in `src/electron/public/app.js`

Add a new section `// === Repository Link Management ===` after the existing `// --- Sync ---` section (after line 737, before `// --- Resizer ---`).

**New state variables:**
```javascript
let linkTarget = null;    // { container, prefix }
let containerLinks = {};  // Map<containerName, RepoLink[]>
let unlinkTarget = null;  // { container, linkId, repoUrl }
```

**New DOM references** (add near top):
```javascript
const linkDialog = document.getElementById("link-dialog");
const linkProvider = document.getElementById("link-provider");
const linkRepoUrl = document.getElementById("link-repo-url");
const linkBranch = document.getElementById("link-branch");
const linkRepoPath = document.getElementById("link-repo-path");
const linkTargetPrefix = document.getElementById("link-target-prefix");
const linkToken = document.getElementById("link-token");
const linkWarning = document.getElementById("link-warning");
const linkCancel = document.getElementById("link-cancel");
const linkOnly = document.getElementById("link-only");
const linkAndSync = document.getElementById("link-and-sync");
const multiLinkDialog = document.getElementById("multi-link-sync-dialog");
const multiLinkList = document.getElementById("multi-link-list");
const multiLinkClose = document.getElementById("multi-link-close");
const multiLinkSyncAll = document.getElementById("multi-link-sync-all");
const unlinkDialog = document.getElementById("unlink-confirm-dialog");
const unlinkMessage = document.getElementById("unlink-message");
const unlinkCancel = document.getElementById("unlink-cancel");
const unlinkConfirm = document.getElementById("unlink-confirm");
const linksPanel = document.getElementById("links-panel");
const linksPanelList = document.getElementById("links-panel-list");
const linksPanelClose = document.getElementById("links-panel-close");
const ctxLinkContainer = document.getElementById("ctx-link-container");
const ctxViewLinks = document.getElementById("ctx-view-links");
const ctxLinkFolder = document.getElementById("ctx-link-folder");
const ctxSyncFolder = document.getElementById("ctx-sync-folder");
const ctxUnlinkFolder = document.getElementById("ctx-unlink-folder");
```

**Key functions (signatures and behavior descriptions):**

```javascript
async function fetchContainerLinks(storage, container) {
  // GET /api/links/:storage/:container
  // Cache result in containerLinks[container]
  // Returns RepoLink[]
}

function showLinkDialog(container, prefix) {
  // Set linkTarget = { container, prefix }
  // Pre-fill linkTargetPrefix with prefix if provided
  // Populate token dropdown from /api/tokens filtered by selected provider
  // Show linkDialog
}

async function submitLink(syncAfter) {
  // POST /api/links/:storage/:container with form data
  // If response has warning, show in linkWarning div
  // If syncAfter, POST /api/sync/:storage/:container/:linkId
  // Refresh tree and link cache
}

function showMultiLinkSyncDialog(container, links) {
  // Render links list in multiLinkList with per-link Sync buttons
  // Each link shows: provider icon, repoUrl, branch, prefix, lastSyncAt
  // Show multiLinkDialog
}

async function syncSingleLink(storage, container, linkId) {
  // POST /api/sync/:storage/:container/:linkId
  // Show result in alert
  // Refresh tree
}

async function syncAllLinks(storage, container) {
  // POST /api/sync-all/:storage/:container
  // Show aggregate result in alert
  // Refresh tree
}

function showUnlinkConfirm(container, linkId, repoUrl) {
  // Set unlinkTarget = { container, linkId, repoUrl }
  // Set unlinkMessage text
  // Show unlinkDialog
}

async function confirmUnlink() {
  // DELETE /api/links/:storage/:container/:linkId
  // Refresh tree and link cache
}

function renderLinkIndicators(containerName) {
  // After folder tree loads, iterate containerLinks[containerName]
  // For each link with targetPrefix, find matching folder tree node
  // Append <span class="link-indicator" title="...">&#128279;</span>
}

function showLinksPanel(container) {
  // Render all links for container in linksPanelList
  // Each link has Sync and Unlink buttons
  // Show linksPanel
}
```

**Modified `toggleContainer`:** Replace the `fetch('/api/sync-meta/...')` block with:
```javascript
// After loadTreeLevel completes:
try {
  const links = await fetchContainerLinks(currentStorage, containerName);
  if (links.length > 0) {
    const badge = document.createElement("span");
    badge.className = links.length > 1 ? "link-badge" : "sync-badge";
    badge.textContent = links.length > 1 ? `${links.length} links` : "\u21BB";
    badge.title = links.length > 1
      ? `${links.length} repository links`
      : `Synced from ${links[0].provider}: ${links[0].repoUrl} (${links[0].branch})`;

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      if (links.length === 1) {
        // Single link: show sync modal (existing behavior)
        syncTarget = { container: containerName, meta: links[0] };
        syncInfo.innerHTML = `
          <p><strong>Repository:</strong> ${links[0].repoUrl}</p>
          <p><strong>Branch:</strong> ${links[0].branch}</p>
          <p><strong>Provider:</strong> ${links[0].provider}</p>
          <p><strong>Last synced:</strong> ${links[0].lastSyncAt ? new Date(links[0].lastSyncAt).toLocaleString() : "never"}</p>
          <p><strong>Files:</strong> ${Object.keys(links[0].fileShas).length}</p>
        `;
        syncModal.classList.remove("hidden");
      } else {
        // Multiple links: show multi-link sync dialog
        showMultiLinkSyncDialog(containerName, links);
      }
    });

    const containerItem = node.querySelector(".tree-item");
    if (containerItem && !containerItem.querySelector(".sync-badge") && !containerItem.querySelector(".link-badge")) {
      containerItem.appendChild(badge);
    }
  }
  renderLinkIndicators(containerName);
} catch { /* not a linked container */ }
```

**Modified folder context menu handler:** Before showing the folder context menu, check if the folder is a link target:
```javascript
// In the folder contextmenu handler, after setting folderContextTarget:
const links = containerLinks[folderContextTarget.container] || [];
const folderLink = links.find(l => normalizePath(l.targetPrefix) === normalizePath(folderContextTarget.folderPrefix));
ctxSyncFolder.style.display = folderLink ? "" : "none";
ctxUnlinkFolder.style.display = folderLink ? "" : "none";
```

**Context menu event handlers:**
```javascript
ctxLinkContainer.addEventListener("click", () => {
  containerCtxMenu.classList.add("hidden");
  if (containerContextTarget) showLinkDialog(containerContextTarget.containerName);
});

ctxViewLinks.addEventListener("click", () => {
  containerCtxMenu.classList.add("hidden");
  if (containerContextTarget) showLinksPanel(containerContextTarget.containerName);
});

ctxLinkFolder.addEventListener("click", () => {
  folderCtxMenu.classList.add("hidden");
  if (folderContextTarget) showLinkDialog(folderContextTarget.container, folderContextTarget.folderPrefix);
});

ctxSyncFolder.addEventListener("click", async () => {
  folderCtxMenu.classList.add("hidden");
  if (!folderContextTarget) return;
  const links = containerLinks[folderContextTarget.container] || [];
  const folderLink = links.find(l => normalizePath(l.targetPrefix) === normalizePath(folderContextTarget.folderPrefix));
  if (folderLink) await syncSingleLink(currentStorage, folderContextTarget.container, folderLink.id);
});

ctxUnlinkFolder.addEventListener("click", () => {
  folderCtxMenu.classList.add("hidden");
  if (!folderContextTarget) return;
  const links = containerLinks[folderContextTarget.container] || [];
  const folderLink = links.find(l => normalizePath(l.targetPrefix) === normalizePath(folderContextTarget.folderPrefix));
  if (folderLink) showUnlinkConfirm(folderContextTarget.container, folderLink.id, folderLink.repoUrl);
});
```

---

### 9. Backward Compatibility: Auto-Migration Flow

```
Container accessed (any operation: sync, list-links, UI badge, etc.)
    |
    v
resolveLinks(blobClient, container)
    |
    +-- .repo-links.json exists?
    |       |
    |       YES --> Parse and return RepoLinksRegistry
    |       |
    |       NO
    |       |
    |       +-- .repo-sync-meta.json exists?
    |               |
    |               YES --> migrateOldMeta()
    |               |         |
    |               |         +-- Create RepoLink from old metadata
    |               |         +-- Write .repo-links.json
    |               |         +-- Return new RepoLinksRegistry
    |               |         +-- (Old .repo-sync-meta.json retained, not deleted)
    |               |
    |               NO --> Return empty registry { version: 1, links: [] }
```

**Migration is transparent and idempotent:**
- If `.repo-links.json` already exists, `.repo-sync-meta.json` is never read.
- If migration writes `.repo-links.json` successfully, subsequent calls skip migration.
- If migration fails (e.g., write error), the next call retries because `.repo-links.json` does not yet exist.

---

### 10. Parallel Implementation Units and Interface Contracts

The feature decomposes into **five implementation units** with the following dependency graph:

```
Unit 1: Core Types + Link Registry (sync-engine.ts, types.ts)
    |
    v
Unit 2: Refactored Clone/Sync Engine (sync-engine.ts)
    |
    +------------------+------------------+
    |                  |                  |
    v                  v                  |
Unit 3: CLI         Unit 4: Server API   |
(repo-sync.ts,      (server.ts)          |
 index.ts)                               |
    |                  |                  |
    +------------------+                  |
             |                            |
             v                            |
         Unit 5: UI                       |
   (app.js, index.html,                  |
    styles.css)                           |
```

**Units 3 and 4 can be built in parallel** after Units 1 and 2 are complete.

#### Unit 1: Core Types + Link Registry

**Files:** `src/core/types.ts`, `src/core/sync-engine.ts`
**Produces (exports):**
- Types: `RepoLink`, `RepoLinksRegistry`
- Functions: `normalizePath`, `readLinks`, `writeLinks`, `resolveLinks`, `migrateOldMeta`, `createLink`, `removeLink`, `findLinkByPrefix`, `detectExactConflict`, `detectOverlap`
- Constants: `LINKS_BLOB`

**Interface contract for downstream units:**
```typescript
// All downstream units import these from "../../core/sync-engine.js" or "../../core/types.js"
export function normalizePath(path: string | undefined): string;
export function readLinks(blobClient: BlobClient, container: string): Promise<RepoLinksRegistry | null>;
export function writeLinks(blobClient: BlobClient, container: string, registry: RepoLinksRegistry): Promise<void>;
export function resolveLinks(blobClient: BlobClient, container: string): Promise<RepoLinksRegistry>;
export function migrateOldMeta(blobClient: BlobClient, container: string): Promise<RepoLinksRegistry | null>;
export function createLink(blobClient: BlobClient, container: string, linkData: {
  provider: "github" | "azure-devops"; repoUrl: string; branch: string;
  repoSubPath?: string; targetPrefix?: string;
}): Promise<{ link: RepoLink; warning?: string }>;
export function removeLink(blobClient: BlobClient, container: string, linkId: string): Promise<boolean>;
export function findLinkByPrefix(links: RepoLink[], prefix: string | undefined): RepoLink;
export function detectExactConflict(existingLinks: RepoLink[], newPrefix: string | undefined): boolean;
export function detectOverlap(existingLinks: RepoLink[], newPrefix: string | undefined): string | null;
```

#### Unit 2: Refactored Clone/Sync Engine

**Files:** `src/core/sync-engine.ts` (continued)
**Produces (exports):**
- Functions: `filterByRepoSubPath`, `mapToTargetPaths` (utility), refactored `cloneRepo`, refactored `syncRepo`
- Internal type: `MappedFileEntry` (not exported)

**Interface contract for downstream units:**
```typescript
export function filterByRepoSubPath(files: RepoFileEntry[], repoSubPath?: string): RepoFileEntry[];
export function mapToTargetPaths(files: RepoFileEntry[], repoSubPath?: string, targetPrefix?: string): MappedFileEntry[];
export function cloneRepo(blobClient: BlobClient, container: string, provider: RepoProvider, link: RepoLink, onProgress?: (msg: string) => void): Promise<SyncResult>;
export function syncRepo(blobClient: BlobClient, container: string, provider: RepoProvider, link: RepoLink, dryRun?: boolean, onProgress?: (msg: string) => void): Promise<SyncResult>;
```

**Critical contract:** After `cloneRepo` or `syncRepo` returns, the `link` parameter has been mutated in-place with updated `lastSyncAt`, `fileShas`, and (for sync) `lastCommitSha`. The caller must write the updated link back to the registry via `writeLinks()`.

#### Unit 3: CLI Commands

**Files:** `src/cli/commands/repo-sync.ts`, `src/cli/index.ts`
**Depends on:** Units 1 and 2 (imports from sync-engine and types)
**Produces (exports):** `linkGitHub`, `linkDevOps`, `unlinkContainer`, `listLinks` (new); modified `cloneGitHub`, `cloneDevOps`, `syncContainer`

**Interface contract with CLI index:**
```typescript
export async function linkGitHub(repoUrl: string, container: string, storageOpts: StorageOpts, opts: { prefix?: string; repoPath?: string; branch?: string }, patOpts?: PatOpts): Promise<void>;
export async function linkDevOps(repoUrl: string, container: string, storageOpts: StorageOpts, opts: { prefix?: string; repoPath?: string; branch?: string }, patOpts?: PatOpts): Promise<void>;
export async function unlinkContainer(container: string, storageOpts: StorageOpts, opts: { prefix?: string; linkId?: string }): Promise<void>;
export async function listLinks(container: string, storageOpts: StorageOpts): Promise<void>;
export async function cloneGitHub(repoUrl: string, container: string, storageOpts: StorageOpts, branch?: string, patOpts?: PatOpts, opts?: { prefix?: string; repoPath?: string }): Promise<void>;
export async function cloneDevOps(repoUrl: string, container: string, storageOpts: StorageOpts, branch?: string, patOpts?: PatOpts, opts?: { prefix?: string; repoPath?: string }): Promise<void>;
export async function syncContainer(container: string, storageOpts: StorageOpts, dryRun?: boolean, patOpts?: PatOpts, opts?: { prefix?: string; linkId?: string; all?: boolean }): Promise<void>;
```

#### Unit 4: Server API Endpoints

**Files:** `src/electron/server.ts`
**Depends on:** Units 1 and 2 (imports from sync-engine and types)
**Produces:** REST API endpoints

**Interface contract with UI (HTTP):**

| Method | Path | Request Body | Response | Status Codes |
|---|---|---|---|---|
| GET | `/api/links/:storage/:container` | -- | `RepoLink[]` | 200, 404, 500 |
| POST | `/api/links/:storage/:container` | `{ provider, repoUrl, branch?, repoSubPath?, targetPrefix? }` | `{ link: RepoLink, warning?: string }` | 201, 400, 500 |
| DELETE | `/api/links/:storage/:container/:linkId` | -- | `{ success: true }` | 200, 404, 500 |
| POST | `/api/sync/:storage/:container/:linkId` | -- (query: `?dryRun=true`) | `SyncResult` | 200, 404, 500 |
| POST | `/api/sync-all/:storage/:container` | -- | `{ results: [{ linkId, targetPrefix?, result?, error? }] }` | 200, 400, 500 |
| GET | `/api/sync-meta/:storage/:container` | -- | `RepoSyncMeta-shaped \| null` (+ `linkCount`) | 200, 404, 500 |
| POST | `/api/sync/:storage/:container` | -- | `SyncResult` (single-link) or `{ error, links }` (multi-link) | 200, 400, 500 |

#### Unit 5: UI Integration

**Files:** `src/electron/public/app.js`, `src/electron/public/index.html`, `src/electron/public/styles.css`
**Depends on:** Unit 4 (consumes API endpoints)
**No downstream consumers.**

---

### 11. Complete File Change Summary

| File | Unit(s) | Changes |
|------|---------|---------|
| `src/core/types.ts` | 1 | Add `RepoLink`, `RepoLinksRegistry` interfaces |
| `src/core/sync-engine.ts` | 1, 2 | Add `LINKS_BLOB` constant, `MappedFileEntry` type, `normalizePath`, `readLinks`, `writeLinks`, `migrateOldMeta`, `resolveLinks`, `createLink`, `removeLink`, `findLinkByPrefix`, `detectExactConflict`, `detectOverlap`, `filterByRepoSubPath`, `mapToTargetPaths`; refactor `cloneRepo` and `syncRepo` signatures and internals |
| `src/cli/commands/repo-sync.ts` | 3 | Add `linkGitHub`, `linkDevOps`, `unlinkContainer`, `listLinks`; modify `cloneGitHub`, `cloneDevOps`, `syncContainer` for new parameters |
| `src/cli/index.ts` | 3 | Register `link-github`, `link-devops`, `unlink`, `list-links` commands; add `--prefix`, `--repo-path` to clone commands; add `--prefix`, `--link-id`, `--all` to sync |
| `src/electron/server.ts` | 4 | Add `buildProviderForLink` helper; add 5 new endpoints; modify 2 existing endpoints for backward compatibility |
| `src/electron/public/index.html` | 5 | Add 4 new modals (link-dialog, multi-link-sync-dialog, unlink-confirm-dialog, links-panel); extend container and folder context menus |
| `src/electron/public/app.js` | 5 | Add link management section with ~250-300 lines: state variables, DOM refs, `fetchContainerLinks`, `showLinkDialog`, `submitLink`, `showMultiLinkSyncDialog`, `syncSingleLink`, `syncAllLinks`, `showUnlinkConfirm`, `confirmUnlink`, `renderLinkIndicators`, `showLinksPanel`; modify `toggleContainer`; modify folder context menu handler |
| `src/electron/public/styles.css` | 5 | Add `.link-indicator`, `.link-badge`, `.link-list-item`, `.link-warning` styles |

### Files NOT Modified

| File | Reason |
|------|--------|
| `src/core/github-client.ts` | No changes; filtering done in sync engine |
| `src/core/devops-client.ts` | No changes; filtering done in sync engine |
| `src/core/blob-client.ts` | All needed blob operations already available |
| `src/core/repo-utils.ts` | Generic utilities used as-is |
| `src/core/credential-store.ts` | Token management already complete |
| `src/cli/commands/shared.ts` | Reusable helpers used as-is |
| `src/electron/main.ts` | No changes to Electron bootstrap |
| `src/electron/launch.ts` | No changes to launch logic |

---

### 12. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing clone/sync during Phase 2 refactor | High | When `targetPrefix` and `repoSubPath` are undefined, path mapping is identity; test existing flow after refactor |
| Path normalization bugs (trailing slashes, empty strings) | Medium | Centralized `normalizePath()` with explicit handling; always normalize before comparison |
| Concurrent registry writes (two sync operations on same container) | Medium | Sync-all is sequential; UI sync buttons disabled during operation; no parallel sync at API level |
| Migration creates duplicate link if retried | Low | Random UUID acceptable; second migration is no-op if `.repo-links.json` already exists |
| `app.js` growing large (currently 749 lines, adding ~250-300) | Low | New code in clearly-demarcated section; splitting into modules deferred |
| Rate limiting with many links synced via `--all` | Low | Sequential sync; existing `rateLimitedFetch` handles 429 responses |

---

## Technical Design: Container vs. Repository Diff Feature

**Date:** 2026-04-08
**References:**
- `docs/reference/refined-request-container-diff.md` — full requirement specification
- `docs/design/plan-005-container-diff.md` — phased implementation plan
- `docs/reference/investigation-container-diff.md` — architecture decision record
- `docs/reference/codebase-scan-container-diff.md` — codebase analysis and integration points

---

### 1. Overview

The diff feature adds a read-only comparison capability to Storage Navigator. It compares the files currently stored in an Azure Blob Storage container (tracked via `RepoLink.fileShas`) against the current state of the remote repository linked to that container, and classifies every file into one of five categories: **identical**, **modified**, **repo-only**, **container-only**, or **untracked** (the last only with `--physical-check`).

The feature is entirely non-destructive: `diffLink()` makes zero write operations to the container, the credential store, or the link registry.

The feature spans all four layers of the codebase:

| Layer | Primary component |
|-------|-------------------|
| Core engine | `src/core/diff-engine.ts` (new) |
| Shared types | `src/core/types.ts` (extended) |
| Provider factory | `src/core/repo-utils.ts` (extracted from `server.ts`) |
| CLI command | `src/cli/commands/diff-ops.ts` (new) |
| REST API | `src/electron/server.ts` (two new GET endpoints) |
| UI | `src/electron/public/app.js` + `index.html` (diff panel added) |

---

### 2. New Types — `src/core/types.ts`

Add the following three exports **at the end of the file**, after the existing `BlobContent` interface.

#### 2.1 `DiffCategory`

```typescript
/**
 * Classification of a file's diff status between container and remote repository.
 * "untracked" is only populated when includePhysicalCheck=true.
 */
export type DiffCategory =
  | "identical"       // Same SHA on both sides
  | "modified"        // File exists on both sides but SHAs differ
  | "repo-only"       // In repo but not in link.fileShas (never downloaded or new since last sync)
  | "container-only"  // In link.fileShas but removed from or never in remote repo
  | "untracked";      // Physically exists in container but not tracked in link.fileShas at all
```

#### 2.2 `DiffEntry`

```typescript
/**
 * A single file entry in a diff report.
 * blobPath is the canonical key used throughout — it is the path as it appears (or would appear)
 * in the Azure Blob Storage container. repoPath is the original path in the repository before
 * any prefix mapping.
 */
export interface DiffEntry {
  blobPath: string;          // Path as it appears/would appear in the container
  repoPath: string;          // Original path in the repository (pre-prefix mapping)
  remoteSha: string | null;  // Git object SHA from the repo; null for container-only entries
  storedSha: string | null;  // SHA recorded in link.fileShas; null for repo-only entries
  physicallyExists?: boolean; // Set only when includePhysicalCheck=true; true if blob is physically present
}
```

**Design notes:**
- `physicallyExists` is `undefined` (not set) when `includePhysicalCheck=false`. Consumers must check for `=== true`, not just truthiness.
- For `"untracked"` entries, `remoteSha` is `null` and `storedSha` is `null`. Only `blobPath` is meaningful; `repoPath` is set to the same value as `blobPath` since there is no repo-side counterpart.
- SHAs are full 40-character git SHAs internally. Truncation to 8 characters is a display concern handled in `diff-ops.ts`, not in the engine or types.

#### 2.3 `DiffReport`

```typescript
/**
 * Full diff report for a single RepoLink.
 * generatedAt records when diffLink() was called; it is always set regardless of link state.
 * note is set when the link has never been synced (fileShas is empty and lastSyncAt is undefined).
 *
 * The summary counts always reflect the complete diff, even when showIdentical=false is applied
 * at the API or CLI layer (which zeroes out the identical array but preserves identicalCount).
 */
export interface DiffReport {
  linkId: string;
  provider: "github" | "azure-devops" | "ssh";
  repoUrl: string;
  branch: string;
  targetPrefix: string | undefined;
  repoSubPath: string | undefined;
  lastSyncAt: string | undefined;   // ISO 8601; undefined if link has never been synced
  generatedAt: string;              // ISO 8601 timestamp when diffLink() completed

  /** Set when the link has never been synced; explains why all files appear as repo-only */
  note?: string;

  identical:     DiffEntry[];
  modified:      DiffEntry[];
  repoOnly:      DiffEntry[];
  containerOnly: DiffEntry[];
  untracked:     DiffEntry[];  // Only populated when includePhysicalCheck=true; otherwise always []

  summary: {
    total:              number;  // Sum of all four primary counts (excluding untracked)
    identicalCount:     number;
    modifiedCount:      number;
    repoOnlyCount:      number;
    containerOnlyCount: number;
    untrackedCount:     number;
    /** true iff modifiedCount + repoOnlyCount + containerOnlyCount === 0 */
    isInSync: boolean;
  };
}
```

**Key invariant:** `summary.total === identicalCount + modifiedCount + repoOnlyCount + containerOnlyCount`. The `untrackedCount` is deliberately excluded from `total` because untracked blobs are outside the link's tracked universe.

**`showIdentical` application:** The `showIdentical=false` filter is applied **after** `diffLink()` returns, by the API endpoint or CLI formatter. The engine always populates `identical[]` fully. The filter sets `report.identical = []` before serialising, but `summary.identicalCount` is always preserved. This ensures the summary line is always accurate regardless of the display filter.

---

### 3. Diff Engine — `src/core/diff-engine.ts`

This is a new file. It imports the path-mapping helpers from `sync-engine.ts` and the types from `types.ts`. It has zero writes to any external system.

#### 3.1 Imports and Dependencies

```typescript
import type { BlobClient } from "./blob-client.js";
import type { RepoLink, DiffEntry, DiffReport } from "./types.js";
import type { RepoProvider, MappedFileEntry } from "./sync-engine.js";
import { filterByRepoSubPath, mapToTargetPaths } from "./sync-engine.js";
```

`MappedFileEntry` must be exported from `sync-engine.ts` before this import works (one-line change: `export interface MappedFileEntry`).

`RepoProvider` is a non-exported interface in `sync-engine.ts` — it must be exported as well (change `interface RepoProvider` to `export interface RepoProvider`). The existing `server.ts` already imports it with `import type { RepoProvider } from "../core/sync-engine.js"`, confirming this export exists.

#### 3.2 `DiffOptions` interface

```typescript
interface DiffOptions {
  /** When true, calls blobClient.listBlobsFlat() to detect untracked blobs. Default: false */
  includePhysicalCheck?: boolean;
  /** Optional progress callback for long-running operations (SSH clone) */
  onProgress?: (msg: string) => void;
}
```

#### 3.3 `diffLink()` function signature

```typescript
/**
 * Compare the files currently tracked in a RepoLink against the current remote repository state.
 *
 * This function is purely read-only:
 * - Calls provider.listFiles() exactly once
 * - Never calls provider.downloadFile()
 * - Makes zero writes to the container, credential store, or link registry
 * - Does not mutate the link object
 *
 * Errors from provider.listFiles() propagate upward — no silent fallback.
 *
 * @param blobClient  Authenticated blob client (only used when includePhysicalCheck=true)
 * @param container   Container name
 * @param provider    Repo provider instance (GitHub, DevOps, or SSH)
 * @param link        The RepoLink to diff
 * @param options     Optional behaviour flags
 */
export async function diffLink(
  blobClient: BlobClient,
  container: string,
  provider: RepoProvider,
  link: RepoLink,
  options?: DiffOptions
): Promise<DiffReport>
```

#### 3.4 Algorithm — Phase 1 (SHA comparison, always runs)

```
1. Call provider.listFiles() → RepoFileEntry[]
   - If this throws, let the exception propagate. Do NOT catch and return partial results.

2. Apply filterByRepoSubPath(remoteFiles, link.repoSubPath)
   - Returns only files under link.repoSubPath (or all files if repoSubPath is undefined)

3. Apply mapToTargetPaths(filtered, link.repoSubPath, link.targetPrefix)
   - Returns MappedFileEntry[] where each entry has:
     - repoPath:  original path in the repo
     - blobPath:  the container path (repoSubPath stripped, targetPrefix prepended)
     - sha:       the git object SHA

4. Build remoteMap: Map<string, string> = new Map(mapped.map(e => [e.blobPath, e.sha]))
   - Key: blobPath, Value: remoteSha

5. Build storedMap: Map<string, string> = new Map(Object.entries(link.fileShas))
   - Key: blobPath, Value: storedSha (exactly as recorded at last sync)

6. Build repoPathMap: Map<string, string> = new Map(mapped.map(e => [e.blobPath, e.repoPath]))
   - Needed to populate DiffEntry.repoPath for all non-container-only entries

7. Classify entries:

   identical: []
   modified: []
   repoOnly: []
   containerOnly: []

   FOR EACH [blobPath, remoteSha] IN remoteMap:
     repoPath = repoPathMap.get(blobPath) ?? blobPath
     storedSha = storedMap.get(blobPath) ?? null

     IF storedSha === null:
       repoOnly.push({ blobPath, repoPath, remoteSha, storedSha: null })
     ELSE IF storedSha === remoteSha:
       identical.push({ blobPath, repoPath, remoteSha, storedSha })
     ELSE:
       modified.push({ blobPath, repoPath, remoteSha, storedSha })

   FOR EACH [blobPath, storedSha] IN storedMap:
     IF NOT remoteMap.has(blobPath):
       containerOnly.push({ blobPath, repoPath: blobPath, remoteSha: null, storedSha })

8. Detect never-synced link:
   IF Object.keys(link.fileShas).length === 0 AND link.lastSyncAt === undefined:
     note = "Link has never been synced; all repo files appear as repo-only"

9. Build summary:
   summary = {
     total: identical.length + modified.length + repoOnly.length + containerOnly.length,
     identicalCount: identical.length,
     modifiedCount: modified.length,
     repoOnlyCount: repoOnly.length,
     containerOnlyCount: containerOnly.length,
     untrackedCount: 0,
     isInSync: modified.length === 0 && repoOnly.length === 0 && containerOnly.length === 0
   }
```

#### 3.5 Algorithm — Phase 2 (physical check, only when `includePhysicalCheck=true`)

```
1. Call blobClient.listBlobsFlat(container, link.targetPrefix)
   - Returns BlobItem[] filtered to the target prefix
   - Filter out isPrefix=true entries (virtual directories)

2. Build physicalSet: Set<string> = new Set(physicalBlobs.map(b => b.name))

3. For each entry in repoOnly[]:
   entry.physicallyExists = physicalSet.has(entry.blobPath)

4. For each physicalBlobPath in physicalSet:
   IF NOT storedMap.has(physicalBlobPath):
     untracked.push({
       blobPath: physicalBlobPath,
       repoPath: physicalBlobPath,  // no repo counterpart
       remoteSha: null,
       storedSha: null,
       physicallyExists: true
     })

5. Update summary.untrackedCount = untracked.length
```

**Important:** `physicallyExists` is set on `repoOnly` entries even if the physical check discovers them. This allows the UI to distinguish between "this file is in the repo but was never downloaded" (physicallyExists=false) and "this file is in the repo and was uploaded manually outside of sync" (physicallyExists=true).

#### 3.6 Return structure construction

```typescript
const report: DiffReport = {
  linkId: link.id,
  provider: link.provider as "github" | "azure-devops" | "ssh",
  repoUrl: link.repoUrl,
  branch: link.branch,
  targetPrefix: link.targetPrefix,
  repoSubPath: link.repoSubPath,
  lastSyncAt: link.lastSyncAt,
  generatedAt: new Date().toISOString(),
  note,
  identical,
  modified,
  repoOnly,
  containerOnly,
  untracked,
  summary
};
return report;
```

#### 3.7 Error propagation contract

```
provider.listFiles() throws  →  diffLink() re-throws (do not catch)
blobClient.listBlobsFlat() throws  →  diffLink() re-throws (Phase 2 error also propagates)
link.fileShas is empty  →  valid input; all remote files become repoOnly (see Phase 1 step 8)
link.fileShas has unknown blobPaths  →  those entries become containerOnly (correct behaviour)
```

---

### 4. Provider Factory Extraction — `src/core/repo-utils.ts`

#### 4.1 Motivation

`buildProviderForLink()` in `server.ts` is currently a private module-level function. The CLI diff command (`diff-ops.ts`) needs identical provider-construction logic but cannot import from `server.ts` (server-side module). Extracting to `repo-utils.ts` gives both layers a single, shared implementation.

#### 4.2 New function signature in `src/core/repo-utils.ts`

```typescript
import { CredentialStore } from "./credential-store.js";
import { GitHubClient } from "./github-client.js";
import { DevOpsClient } from "./devops-client.js";
import { SshGitClient } from "./ssh-git-client.js";
import type { RepoLink } from "./types.js";
import type { RepoProvider } from "./sync-engine.js";

/**
 * Construct a RepoProvider for the given RepoLink.
 *
 * For SSH links: clones the repository; the returned cleanup() MUST be called
 * in a finally block to remove the temporary directory.
 *
 * For GitHub / Azure DevOps links: looks up the PAT from the credential store.
 * Returns null if no PAT is configured (callers must respond with MISSING_PAT error).
 *
 * @param store      Credential store instance
 * @param link       The RepoLink to build a provider for
 * @param inlinePat  Optional PAT override (CLI --pat flag); takes priority over stored tokens.
 *                   If provided, it is used directly without consulting the credential store.
 */
export async function buildProviderForLink(
  store: CredentialStore,
  link: RepoLink,
  inlinePat?: string
): Promise<{ provider: RepoProvider; cleanup?: () => void } | null>
```

#### 4.3 `inlinePat` precedence logic

```typescript
// Inside buildProviderForLink, for GitHub and Azure DevOps providers:
let token: string;
if (inlinePat) {
  token = inlinePat;
} else {
  const pat = store.getTokenByProvider(link.provider as "github" | "azure-devops");
  if (!pat) return null;
  token = pat.token;
}
```

For SSH links, `inlinePat` is irrelevant and can be ignored — SSH uses system keys, not PATs.

#### 4.4 Function body

The body is moved verbatim from `server.ts` lines 23–61, with the `inlinePat` precedence inserted as shown in 4.3. No other logic changes.

#### 4.5 `server.ts` changes after extraction

1. Remove the `buildProviderForLink` function body (lines 23–61).
2. Remove imports that are now only used by `buildProviderForLink`: `GitHubClient`, `DevOpsClient`, `SshGitClient` (verify no other usages before removing).
3. Add import: `import { buildProviderForLink } from "../core/repo-utils.js";`
4. All existing call sites in `server.ts` pass no `inlinePat` — the optional third parameter defaults to `undefined`. Existing behaviour is unchanged.

#### 4.6 How CLI uses it

```typescript
// In diff-ops.ts:
import { buildProviderForLink } from "../../core/repo-utils.js";
import { CredentialStore } from "../../core/credential-store.js";

const store = new CredentialStore();
const result = await buildProviderForLink(store, link, patOpts.pat);
if (!result) {
  console.error(`No PAT configured for provider "${link.provider}". Add one with: add-token`);
  process.exit(2);
}
const { provider, cleanup } = result;
try {
  const report = await diffLink(blobClient, container, provider, link, diffOptions);
  // ... format and output report
} finally {
  cleanup?.();
}
```

---

### 5. CLI Command — `src/cli/commands/diff-ops.ts`

#### 5.1 File structure

```typescript
// Imports
import * as fs from "fs";
import chalk from "chalk";
import { CredentialStore } from "../../core/credential-store.js";
import { BlobClient } from "../../core/blob-client.js";
import { resolveLinks, findLinkByPrefix } from "../../core/sync-engine.js";
import { diffLink } from "../../core/diff-engine.js";
import { buildProviderForLink } from "../../core/repo-utils.js";
import { resolveStorageEntry, resolvePatToken } from "./shared.js";
import type { StorageOpts, PatOpts } from "./shared.js";
import type { DiffReport, RepoLink } from "../../core/types.js";

// Exit code constants (documented for developer reference)
// EXIT_INSYNC  = 0  — all diffed links are in sync
// EXIT_DIFF    = 1  — one or more links have differences (not an error; expected for diff)
// EXIT_ERROR   = 2  — fatal/operational error (no links, auth failure, ambiguous selection)
const EXIT_INSYNC = 0;
const EXIT_DIFF   = 1;
const EXIT_ERROR  = 2;

// Main exported function
export async function diffContainer(
  container: string,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  opts: DiffContainerOpts
): Promise<void>

// Private formatting helpers
function formatTable(reports: DiffReport[], showIdentical: boolean): void
function formatSummary(reports: DiffReport[]): void
function formatJson(reports: DiffReport[], outputFile?: string): void
function printReport(report: DiffReport, showIdentical: boolean): void
function truncateSha(sha: string | null): string  // Returns first 8 chars or "--------"
function statusLine(isInSync: boolean): string    // Returns coloured "IN SYNC" or "OUT OF SYNC"
```

#### 5.2 `DiffContainerOpts` interface

```typescript
interface DiffContainerOpts {
  prefix?: string;
  linkId?: string;
  all?: boolean;
  format: "table" | "summary" | "json";  // Defaults to "table" from Commander
  showIdentical?: boolean;
  physicalCheck?: boolean;
  output?: string;
}
```

#### 5.3 Link selection logic

Mirrors `syncContainer()` in `repo-sync.ts` exactly, with exit code 2 for all operational errors:

```
Step 1: Load registry = await resolveLinks(blobClient, container)
        IF registry.links.length === 0:
          console.error("No repository links found in container <name>.")
          console.error("Use link-github or link-devops to create a link first.")
          process.exit(EXIT_ERROR)

Step 2: Determine links to diff:
        IF opts.all:
          linksToProcess = registry.links
        ELSE IF opts.linkId:
          link = registry.links.find(l => l.id === opts.linkId)
          IF !link:
            console.error(`No link found with ID "${opts.linkId}".`)
            process.exit(EXIT_ERROR)
          linksToProcess = [link]
        ELSE IF opts.prefix:
          link = findLinkByPrefix(registry.links, opts.prefix)
          IF !link:
            console.error(`No link found at prefix "${opts.prefix}".`)
            process.exit(EXIT_ERROR)
          linksToProcess = [link]
        ELSE IF registry.links.length === 1:
          linksToProcess = registry.links  // auto-select single link
        ELSE:
          console.error(`Container "${container}" has ${n} links. Specify one with:`)
          registry.links.forEach(l => console.error(`  --link-id ${l.id}  (${l.provider}: ${l.repoUrl})`))
          console.error("Or use --all to diff all links.")
          process.exit(EXIT_ERROR)
```

#### 5.4 Per-link diff loop

```typescript
const reports: DiffReport[] = [];
let anyDiff = false;

for (const link of linksToProcess) {
  // SSH performance warning
  if (link.provider === "ssh") {
    console.warn("Warning: this link uses SSH. Diff requires cloning the repository which may take a while...");
  }

  const result = await buildProviderForLink(store, link, patOpts.pat);
  if (!result) {
    console.error(`No PAT configured for provider "${link.provider}" (link: ${link.id}).`);
    process.exit(EXIT_ERROR);
  }

  const { provider, cleanup } = result;
  try {
    const report = await diffLink(blobClient, container, provider, link, {
      includePhysicalCheck: opts.physicalCheck,
      onProgress: (msg) => console.log(msg),
    });
    reports.push(report);
    if (!report.summary.isInSync) anyDiff = true;
  } finally {
    cleanup?.();
  }
}
```

#### 5.5 Output formatting — `table` format

```
Diff Report — container: <container>
Link: <provider> / <repoUrl> (branch: <branch>)
Target prefix: <targetPrefix ?? "(root)">   Repo sub-path: <repoSubPath ?? "(all)">
Last sync: <lastSyncAt ?? "never">
Generated at: <generatedAt>
[NOTE: <note> — only printed when report.note is set]
────────────────────────────────────────────────────────────────────────

[MODIFIED (<n>) — only printed if modified.length > 0]
  <blobPath>    stored: <storedSha[0..7]>  remote: <remoteSha[0..7]>

[REPO-ONLY (<n>)  [in repo, not yet in container] — only if repoOnly.length > 0]
  <blobPath>    remote: <remoteSha[0..7]>

[CONTAINER-ONLY (<n>)  [in container, removed from repo] — only if containerOnly.length > 0]
  <blobPath>    stored: <storedSha[0..7]>

[IDENTICAL (<n>) — only printed when --show-identical is passed AND identical.length > 0]
  <blobPath>    sha: <remoteSha[0..7]>

[UNTRACKED (<n>)  [in container, not tracked by this link] — only if untracked.length > 0]
  <blobPath>

────────────────────────────────────────────────────────────────────────
Summary: <n> modified, <n> repo-only, <n> container-only, <n> identical[, <n> untracked]
Status: <IN SYNC | OUT OF SYNC>
```

**Colour rules:**
- MODIFIED header: `chalk.yellow`
- REPO-ONLY header: `chalk.blue`
- CONTAINER-ONLY header: `chalk.red`
- IDENTICAL header: `chalk.gray`
- UNTRACKED header: `chalk.magenta`
- IN SYNC: `chalk.green.bold`
- OUT OF SYNC: `chalk.red.bold`
- NOTE text: `chalk.yellow.italic` or plain yellow
- Colours are suppressed when `process.stdout.isTTY !== true` (chalk handles this automatically via its TTY detection)

**Multi-link table output:** Print one report block per link. Separate consecutive blocks with a blank line plus `=== Link <n> of <total> ===` header.

#### 5.6 Output formatting — `summary` format

One line per link, always to stdout:

```
<container> / <provider> / <repoUrl> (<branch>) — <n> modified, <n> repo-only, <n> container-only, <n> identical — <STATUS>
```

No per-file details. Useful for CI pipeline checks.

#### 5.7 Output formatting — `json` format

```typescript
const json = JSON.stringify(reports, null, 2);
if (opts.output) {
  fs.writeFileSync(opts.output, json, "utf-8");
  // Do NOT print to stdout when writing to file
} else {
  process.stdout.write(json + "\n");
}
```

`--output` is silently ignored when `--format` is `table` or `summary` (document in help text).

#### 5.8 Exit code logic

```typescript
if (opts.format === "json" && opts.output) {
  // File written silently; exit 0 if in sync, 1 if diffs
}

if (anyDiff) {
  process.exit(EXIT_DIFF);   // exit 1: differences found (not an error)
} else {
  process.exit(EXIT_INSYNC); // exit 0: all in sync
}
// EXIT_ERROR (2) is called inline at error sites via process.exit(EXIT_ERROR)
```

---

### 6. Commander Registration — `src/cli/index.ts`

Add the following block after the existing `sync` command registration. Follow the exact pattern of existing commands:

```typescript
import { diffContainer } from "./commands/diff-ops.js";

program
  .command("diff")
  .description("Compare container blobs against the linked remote repository (read-only)")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name")
  .option("--account-key <key>", "Inline account key")
  .option("--sas-token <token>", "Inline SAS token")
  .option("--account <account>", "Azure Storage account name (required with inline key/token)")
  .option("--pat <token>", "Inline PAT (overrides stored token)")
  .option("--token-name <name>", "PAT token name to use")
  .option("--prefix <path>", "Diff only the link at this target prefix")
  .option("--link-id <id>", "Diff a specific link by ID")
  .option("--all", "Diff all links in the container")
  .option("--format <fmt>", "Output format: table, json, summary", "table")
  .option("--show-identical", "Include identical files in output (hidden by default)")
  .option("--physical-check", "Cross-reference with actual container blobs to detect untracked files")
  .option("--output <file>", "Write JSON report to file (only effective with --format json)")
  .action(async (opts) => {
    await diffContainer(
      opts.container,
      {
        storage: opts.storage,
        accountKey: opts.accountKey,
        sasToken: opts.sasToken,
        account: opts.account,
      },
      { pat: opts.pat, tokenName: opts.tokenName },
      {
        prefix: opts.prefix,
        linkId: opts.linkId,
        all: opts.all,
        format: opts.format as "table" | "summary" | "json",
        showIdentical: opts.showIdentical,
        physicalCheck: opts.physicalCheck,
        output: opts.output,
      }
    );
  });
```

---

### 7. API Endpoints — `src/electron/server.ts`

Two new GET endpoints are added inside `createServer()`, after the existing sync-link endpoints.

#### 7.1 Endpoint 1: `GET /api/diff/:storage/:container/:linkId`

**Purpose:** Diff a single link by its ID.

**Query parameters:**
- `physicalCheck=true` — enables Phase 2 of `diffLink()` (default: false)
- `showIdentical=true` — include `identical[]` in response (default: false; summary counts always present)

**Response:** `DiffReport` JSON object on `200`.

**Implementation skeleton:**

```typescript
app.get("/api/diff/:storage/:container/:linkId", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) {
      res.status(404).json({ error: `Storage "${req.params.storage}" not found` });
      return;
    }

    const blobClient = new BlobClient(entry);
    const registry = await resolveLinks(blobClient, req.params.container);
    if (!registry || registry.links.length === 0) {
      res.status(404).json({ error: `Container "${req.params.container}" has no repository links` });
      return;
    }

    const link = registry.links.find(l => l.id === req.params.linkId);
    if (!link) {
      res.status(404).json({ error: `Link "${req.params.linkId}" not found` });
      return;
    }

    const providerResult = await buildProviderForLink(store, link);
    if (!providerResult) {
      res.status(400).json({ error: `No PAT configured for provider "${link.provider}"`, code: "MISSING_PAT" });
      return;
    }

    const { provider, cleanup } = providerResult;
    try {
      const includePhysicalCheck = req.query.physicalCheck === "true";
      const showIdentical = req.query.showIdentical === "true";

      const report = await diffLink(blobClient, req.params.container, provider, link, {
        includePhysicalCheck,
      });

      // Apply showIdentical filter: preserve counts, zero out array
      if (!showIdentical) {
        report.identical = [];
      }

      res.json(report);
    } finally {
      cleanup?.();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.2 Endpoint 2: `GET /api/diff-all/:storage/:container`

**Purpose:** Diff all links in a container in one call.

**Query parameters:** Same as Endpoint 1.

**Response:** `{ reports: DiffReport[] }` on `200`.

**Implementation skeleton:**

```typescript
app.get("/api/diff-all/:storage/:container", async (req, res) => {
  try {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) {
      res.status(404).json({ error: `Storage "${req.params.storage}" not found` });
      return;
    }

    const blobClient = new BlobClient(entry);
    const registry = await resolveLinks(blobClient, req.params.container);
    if (!registry || registry.links.length === 0) {
      res.status(404).json({ error: `Container "${req.params.container}" has no repository links` });
      return;
    }

    const includePhysicalCheck = req.query.physicalCheck === "true";
    const showIdentical = req.query.showIdentical === "true";
    const reports: DiffReport[] = [];

    // Process links sequentially — matches existing sync-all behaviour
    for (const link of registry.links) {
      const providerResult = await buildProviderForLink(store, link);
      if (!providerResult) {
        res.status(400).json({ error: `No PAT for provider "${link.provider}" (link: ${link.id})`, code: "MISSING_PAT" });
        return;
      }

      const { provider, cleanup } = providerResult;
      try {
        const report = await diffLink(blobClient, req.params.container, provider, link, {
          includePhysicalCheck,
        });
        if (!showIdentical) report.identical = [];
        reports.push(report);
      } finally {
        cleanup?.();
      }
    }

    res.json({ reports });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

#### 7.3 Required new imports in `server.ts`

```typescript
import { diffLink } from "../core/diff-engine.js";
import type { DiffReport } from "../core/types.js";
// buildProviderForLink is imported from repo-utils.js after extraction (Phase 2)
import { buildProviderForLink } from "../core/repo-utils.js";
// resolveLinks is already imported from sync-engine.js
```

#### 7.4 HTTP status code summary

| Condition | Endpoint 1 | Endpoint 2 |
|-----------|------------|------------|
| Storage not found | 404 | 404 |
| Container has no links | 404 | 404 |
| Link ID not found | 404 | N/A |
| PAT missing | 400 + `code: "MISSING_PAT"` | 400 + `code: "MISSING_PAT"` |
| `provider.listFiles()` fails | 500 | 500 |
| Success | 200 with `DiffReport` | 200 with `{ reports: DiffReport[] }` |

---

### 8. UI Design — `src/electron/public/app.js` and `index.html`

#### 8.1 Button placement

**In `renderLinksPanel()` in `app.js`:**

The links table action column currently renders `[Sync] [Unlink]` per row. Change to `[Diff] [Sync] [Unlink]`:

```javascript
// Inside the link row HTML template string:
`<button class="btn-diff-link" data-link-id="${link.id}" title="Compare container against repo">Diff</button>
 <button class="btn-sync-link" data-link-id="${link.id}">Sync</button>
 <button class="btn-unlink" data-link-id="${link.id}">Unlink</button>`
```

**In the Links Panel modal header:**

The header currently has `[Sync All] [Close]`. Change to `[Diff All] [Sync All] [Close]`:

```javascript
`<button id="btn-diff-all">Diff All</button>
 <button id="btn-sync-all">Sync All</button>
 <button id="btn-close-links-panel">✕</button>`
```

#### 8.2 Diff result panel HTML structure

Add a persistent `div` inside the Links Panel modal, immediately below the links table. Hidden by default:

```html
<!-- In index.html, inside the links-panel-modal div, after the links table -->
<div id="diff-result-panel" style="display:none; max-height:60vh; overflow-y:auto; border-top:1px solid #ddd; padding-top:12px; margin-top:12px;">
</div>
```

This is the only required change to `index.html`. All content within the panel is rendered by `app.js` via `innerHTML`.

#### 8.3 Diff result panel content structure

When a diff completes, `renderDiffResult(report, storage, container)` populates `#diff-result-panel`:

```html
<!-- Header -->
<div class="diff-header">
  <span class="diff-provider-icon"><!-- GitHub/DevOps/SSH icon --></span>
  <strong><a href="${repoUrl}" target="_blank">${truncateUrl(repoUrl, 60)}</a></strong>
  (${branch})
  &nbsp;·&nbsp; prefix: ${targetPrefix ?? "(root)"}
  &nbsp;·&nbsp; sub-path: ${repoSubPath ?? "(all)"}
</div>
<div class="diff-timestamps">
  Last sync: ${lastSyncAt ?? "never"} &nbsp;·&nbsp; Generated: ${generatedAt}
</div>

<!-- Note (only if present) -->
${report.note ? `<div class="diff-note">ℹ ${escapeHtml(report.note)}</div>` : ""}

<!-- Summary bar -->
<div class="diff-summary-bar">
  <span class="diff-count-modified">${modifiedCount} modified</span> |
  <span class="diff-count-repo-only">${repoOnlyCount} repo-only</span> |
  <span class="diff-count-container-only">${containerOnlyCount} container-only</span> |
  <span class="diff-count-identical">${identicalCount} identical</span>
  ${untrackedCount > 0 ? `| <span class="diff-count-untracked">${untrackedCount} untracked</span>` : ""}
</div>

<!-- Status badge -->
<div class="diff-status ${isInSync ? 'diff-status-sync' : 'diff-status-diff'}">
  ${isInSync ? "✓ IN SYNC" : "✗ OUT OF SYNC"}
</div>

<!-- Per-category sections using <details>/<summary> for collapsibility -->

<!-- MODIFIED (always open by default if non-empty) -->
${modified.length > 0 ? `
<details open>
  <summary class="diff-category-header diff-modified">MODIFIED (${modified.length})</summary>
  <table class="diff-file-table">
    ${modified.map(e => `
    <tr>
      <td class="diff-filepath">${escapeHtml(e.blobPath)}</td>
      <td class="diff-sha">stored: ${e.storedSha?.slice(0,8) ?? "--------"}</td>
      <td class="diff-sha">remote: ${e.remoteSha?.slice(0,8) ?? "--------"}</td>
    </tr>`).join("")}
  </table>
</details>` : ""}

<!-- REPO-ONLY (always open by default if non-empty) -->
${repoOnly.length > 0 ? `
<details open>
  <summary class="diff-category-header diff-repo-only">REPO-ONLY (${repoOnly.length}) — in repo, not yet in container</summary>
  <table class="diff-file-table">
    ${repoOnly.map(e => `
    <tr>
      <td class="diff-filepath">${escapeHtml(e.blobPath)}</td>
      <td class="diff-sha">remote: ${e.remoteSha?.slice(0,8) ?? "--------"}</td>
      ${e.physicallyExists !== undefined ? `<td class="diff-physical">${e.physicallyExists ? "⚠ physically present" : ""}</td>` : ""}
    </tr>`).join("")}
  </table>
</details>` : ""}

<!-- CONTAINER-ONLY (always open by default if non-empty) -->
${containerOnly.length > 0 ? `
<details open>
  <summary class="diff-category-header diff-container-only">CONTAINER-ONLY (${containerOnly.length}) — in container, removed from repo</summary>
  <table class="diff-file-table">
    ${containerOnly.map(e => `
    <tr>
      <td class="diff-filepath">${escapeHtml(e.blobPath)}</td>
      <td class="diff-sha">stored: ${e.storedSha?.slice(0,8) ?? "--------"}</td>
    </tr>`).join("")}
  </table>
</details>` : ""}

<!-- IDENTICAL (collapsed by default) -->
${identical.length > 0 ? `
<details>
  <summary class="diff-category-header diff-identical">IDENTICAL (${identical.length}) — click to expand</summary>
  <table class="diff-file-table">
    ${identical.map(e => `
    <tr>
      <td class="diff-filepath">${escapeHtml(e.blobPath)}</td>
      <td class="diff-sha">sha: ${e.remoteSha?.slice(0,8) ?? "--------"}</td>
    </tr>`).join("")}
  </table>
</details>` : ""}

<!-- UNTRACKED (collapsed by default, only when non-empty) -->
${untracked.length > 0 ? `
<details>
  <summary class="diff-category-header diff-untracked">UNTRACKED (${untracked.length}) — in container but not tracked by this link</summary>
  <table class="diff-file-table">
    ${untracked.map(e => `
    <tr>
      <td class="diff-filepath">${escapeHtml(e.blobPath)}</td>
    </tr>`).join("")}
  </table>
</details>` : ""}

<!-- Sync Now button -->
<div class="diff-actions">
  <button id="diff-sync-now-btn" data-link-id="${report.linkId}">Sync Now</button>
</div>
```

#### 8.4 Event handler patterns

**Single link Diff button click:**

```javascript
// Attached after renderLinksPanel() renders buttons
document.querySelectorAll(".btn-diff-link").forEach(btn => {
  btn.addEventListener("click", async () => {
    const linkId = btn.dataset.linkId;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Diffing...";
    const panel = document.getElementById("diff-result-panel");
    panel.style.display = "";
    panel.innerHTML = `<div class="diff-loading">Loading diff...</div>`;
    try {
      const report = await apiJson(`/api/diff/${currentStorage}/${currentContainer}/${linkId}`);
      renderDiffResult(report, currentStorage, currentContainer);
    } catch (e) {
      renderDiffError(e);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
});
```

**Diff All button click:**

```javascript
document.getElementById("btn-diff-all").addEventListener("click", async () => {
  const btn = document.getElementById("btn-diff-all");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Diffing...";
  const panel = document.getElementById("diff-result-panel");
  panel.style.display = "";
  panel.innerHTML = `<div class="diff-loading">Loading diffs for all links...</div>`;
  try {
    const result = await apiJson(`/api/diff-all/${currentStorage}/${currentContainer}`);
    renderDiffAllResults(result.reports, currentStorage, currentContainer);
  } catch (e) {
    renderDiffError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});
```

**Sync Now button click (wired after renderDiffResult renders it):**

```javascript
const syncBtn = document.getElementById("diff-sync-now-btn");
if (syncBtn) {
  syncBtn.addEventListener("click", async () => {
    const linkId = syncBtn.dataset.linkId;
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing...";
    try {
      await apiJson(`/api/sync-link/${currentStorage}/${currentContainer}/${linkId}`, { method: "POST" });
      // Refresh links panel
      document.getElementById("diff-result-panel").style.display = "none";
      loadLinksPanel(currentStorage, currentContainer);
    } catch (e) {
      renderDiffError(e);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync Now";
    }
  });
}
```

**Error rendering (no alert()):**

```javascript
function renderDiffError(e) {
  const panel = document.getElementById("diff-result-panel");
  panel.style.display = "";
  panel.innerHTML = `<div class="diff-error">✗ ${escapeHtml(e.message || String(e))}</div>`;
}
```

#### 8.5 `renderDiffAllResults()` — multi-link display

When `Diff All` returns multiple reports, display them as a sequence of collapsible sections, one per link. Each section contains the same structure as a single-link result. Wrap each in:

```html
<details open>
  <summary>Link ${i+1} / ${total}: ${provider} — ${repoUrl} (${branch}) — ${status}</summary>
  <!-- single-link diff panel content here -->
</details>
```

The outer `<details>` for each link is `open` by default so the user sees all results immediately.

#### 8.6 CSS additions (in `styles.css`)

```css
/* Diff result panel layout */
#diff-result-panel { font-size: 0.9em; }
.diff-header { font-weight: bold; margin-bottom: 4px; }
.diff-timestamps { color: #666; font-size: 0.85em; margin-bottom: 8px; }
.diff-note { background: #fffbe6; border-left: 3px solid #f0a500; padding: 6px 10px; margin-bottom: 10px; }
.diff-summary-bar { display: flex; gap: 10px; margin-bottom: 8px; font-weight: 500; }
.diff-count-modified { color: #c0392b; }
.diff-count-repo-only { color: #2980b9; }
.diff-count-container-only { color: #8e44ad; }
.diff-count-identical { color: #27ae60; }
.diff-count-untracked { color: #e67e22; }
.diff-status { display: inline-block; padding: 2px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 12px; }
.diff-status-sync { background: #d4edda; color: #155724; }
.diff-status-diff { background: #f8d7da; color: #721c24; }
.diff-category-header { cursor: pointer; font-weight: bold; padding: 4px 0; }
.diff-modified { color: #c0392b; }
.diff-repo-only { color: #2980b9; }
.diff-container-only { color: #8e44ad; }
.diff-identical { color: #27ae60; }
.diff-untracked { color: #e67e22; }
.diff-file-table { width: 100%; border-collapse: collapse; font-family: monospace; font-size: 0.88em; }
.diff-file-table tr:hover { background: #f5f5f5; }
.diff-filepath { padding: 2px 8px 2px 16px; word-break: break-all; }
.diff-sha { padding: 2px 8px; color: #666; white-space: nowrap; }
.diff-physical { padding: 2px 8px; color: #e67e22; font-style: italic; }
.diff-actions { margin-top: 12px; }
.diff-loading { color: #666; font-style: italic; }
.diff-error { color: #c0392b; background: #fdecea; padding: 8px 12px; border-radius: 4px; }
```

---

### 9. Complete File Inventory

#### 9.1 New files to create

| File | Phase | Estimated LOC | Purpose |
|------|-------|---------------|---------|
| `src/core/diff-engine.ts` | 3 | 90–110 | Core `diffLink()` — read-only diff logic |
| `src/cli/commands/diff-ops.ts` | 4 | 160–190 | CLI diff command and all output formatters |
| `test_scripts/test-diff-engine.ts` | 3 | 100–130 | Unit tests for `diffLink()` covering all AC-CORE scenarios |

#### 9.2 Files to modify

| File | Phase | Change summary |
|------|-------|----------------|
| `src/core/types.ts` | 1 | Add `DiffCategory`, `DiffEntry`, `DiffReport` (~45 LOC) |
| `src/core/sync-engine.ts` | 1 | Export `MappedFileEntry` and `RepoProvider` interfaces (2 lines) |
| `src/core/repo-utils.ts` | 2 | Add extracted `buildProviderForLink()` with `inlinePat` param (~55 LOC added) |
| `src/electron/server.ts` | 2 + 5 | Remove `buildProviderForLink` body; add import; add 2 GET endpoints; add diff imports (~+70 net LOC) |
| `src/cli/index.ts` | 4 | Import `diffContainer`; register `diff` command (~30 LOC) |
| `src/electron/public/app.js` | 6 | Diff/Diff All buttons; result panel render; event handlers (~180–220 LOC) |
| `src/electron/public/index.html` | 6 | Add `<div id="diff-result-panel">` inside links-panel-modal (~3 lines) |
| `src/electron/public/styles.css` | 6 | Diff panel CSS (~30 lines) |
| `CLAUDE.md` | 7 | Document `diff` command in storage-nav tool block |

#### 9.3 Files NOT modified

| File | Reason |
|------|--------|
| `src/core/blob-client.ts` | All required methods (`listBlobsFlat`) already exist |
| `src/core/github-client.ts` | No changes; `listFiles()` already returns `RepoFileEntry[]` with SHAs |
| `src/core/devops-client.ts` | Same as above |
| `src/core/ssh-git-client.ts` | Same as above |
| `src/core/credential-store.ts` | No changes needed |
| `src/cli/commands/shared.ts` | `resolveStorageEntry()` and `resolvePatToken()` are reused as-is |
| `src/electron/main.ts` | No changes to Electron bootstrap |
| `src/electron/launch.ts` | No changes to launch logic |

---

### 10. Dependency Graph

```
Phase 1 (Foundation)
├── 1A: Add DiffCategory, DiffEntry, DiffReport to types.ts
└── 1B: Export MappedFileEntry, RepoProvider from sync-engine.ts
     (1A and 1B are independent; both must complete before Phase 2/3)

Phase 2 (Provider Factory Extraction)
└── 2A: Move buildProviderForLink() from server.ts to repo-utils.ts
     (Depends on Phase 1 type stability)
     (VERIFICATION: npx tsc --noEmit + manual sync --dry-run before Phase 3)

Phase 3 (Core Diff Engine)
└── 3A: Implement diffLink() in diff-engine.ts
     (Depends on 1A, 1B, 2A)
     (VERIFICATION: npx tsx test_scripts/test-diff-engine.ts — all AC-CORE pass)

Phase 4 (CLI Command)         Phase 5 (Server Endpoints)
└── 4A: diff-ops.ts           └── 5A: diff endpoints in server.ts
     (Depends on 3A)               (Depends on 2A, 3A)
└── 4B: Register in index.ts  (Phases 4 and 5 can be implemented in parallel)

Phase 6 (UI)
└── 6A: app.js + index.html + styles.css
     (Depends on Phase 5)

Phase 7 (Documentation)
└── 7A: CLAUDE.md diff command entry
     (Can be written in parallel with Phase 6; requires Phase 4 to be stable)
```

---

### 11. Inter-Developer Parallelisation

The dependency graph enables two developers to work in parallel from Phase 3 onward:

| Developer A | Developer B |
|-------------|-------------|
| Phases 1, 2, 3 (sequential; foundational) | Waits for Phase 3 completion |
| Phase 4: `diff-ops.ts` CLI command | Phase 5: server.ts diff endpoints |
| Phase 7: CLAUDE.md documentation | Phase 6: UI diff panel |

Coordination checkpoints:
1. **After Phase 2:** Developer A signals that `buildProviderForLink` is in `repo-utils.ts` and `npx tsc --noEmit` passes. Developer B confirms sync endpoints still work.
2. **After Phase 3:** Developer A signals that `diffLink()` is exported and test script passes. Both developers begin their parallel tracks.
3. **After Phases 4+5:** Integration test — run CLI diff against a linked container, then verify the UI calls the same endpoint and renders matching data.

---

### 12. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `buildProviderForLink()` extraction breaks sync (Phase 2) | Low | High | Implement Phase 2 in isolation; run `sync --dry-run` before proceeding to Phase 3 |
| SSH clone latency confuses CLI users | Medium | Medium | Mandatory warning line before SSH diff; `cleanup?.()` in `finally` |
| Never-synced link (`fileShas: {}`) produces alarming output | Low | Medium | `DiffReport.note` field; prominently displayed in both CLI table and UI |
| Large repo with `--show-identical` causes huge output | Low | Low | `showIdentical` defaults to `false`; `--output` flag for file-based output |
| UI diff panel overflows modal on small screens | Low | Low | `max-height` + `overflow-y: auto` CSS on `#diff-result-panel` |
| Exit code 1 vs 2 confusion with existing CLI scripts | Low | Low | Document in `diff-ops.ts` source and in `CLAUDE.md`; convention scoped to `diff` command only |

