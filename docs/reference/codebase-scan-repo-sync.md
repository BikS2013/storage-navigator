# Codebase Scan: Repository Sync Feature

Produced: 2026-03-31
Scope: Structures, patterns, and extension points relevant to adding repo-sync capabilities.

---

## 1. Type System (`src/core/types.ts`)

All domain types live in a single file. Current interfaces:

```ts
interface StorageEntry {
  name: string;          // display name, used as lookup key everywhere
  accountName: string;   // Azure Storage account name
  sasToken?: string;     // SAS token auth (optional)
  accountKey?: string;   // Account key auth (optional, preferred)
  addedAt: string;       // ISO timestamp
}

interface CredentialData {
  storages: StorageEntry[];   // top-level store shape (decrypted)
}

interface EncryptedPayload { iv: string; data: string; tag: string; }

interface BlobItem {
  name: string;
  isPrefix: boolean;     // true = virtual directory
  size?: number;
  lastModified?: string;
  contentType?: string;
}

interface ContainerInfo  { name: string; }
interface BlobContent    { content: Buffer | string; contentType: string; size: number; name: string; }
```

**Extension point for repo sync**: `StorageEntry` needs new optional fields (e.g., `patToken?: string`, `repoUrl?: string`, `syncConfig?`). The `CredentialData.storages` array already supports mixed entry types since fields are optional. A PAT token would follow the same encryption path as `sasToken`/`accountKey`.

---

## 2. Credential Store (`src/core/credential-store.ts`)

### Storage & encryption
- Credentials persist at `~/.storage-navigator/credentials.json`, encrypted with AES-256-GCM.
- Encryption key: random 32-byte key stored in `~/.storage-navigator/machine.key` (generated on first run, `0o600` permissions). Older hostname-based derivation auto-migrates.
- The entire `CredentialData` JSON blob is encrypted/decrypted as one unit (not per-entry).

### Key methods

| Method | Signature | Notes |
|---|---|---|
| `addStorage` | `(entry: Omit<StorageEntry, 'addedAt'>): void` | Upserts by `name`. Appends `addedAt`. Calls `save()`. |
| `getStorage` | `(name: string): StorageEntry \| undefined` | Lookup by display name. |
| `getFirstStorage` | `(): StorageEntry \| undefined` | Convenience for single-account setups. |
| `listStorages` | `(): {...}[]` | Returns metadata + SAS expiry info. No secrets exposed. |
| `removeStorage` | `(name: string): boolean` | Filter by name, save, return success. |
| `parseSasExpiry` | `static (sasToken): string \| null` | Extracts `se=` param from SAS token. |

**Extension point**: `addStorage` accepts `Omit<StorageEntry, 'addedAt'>`, so adding new optional fields to `StorageEntry` requires no signature change. The `listStorages` return type will need extension to surface repo-sync metadata (e.g., repo URL, last sync time). PAT token expiry could reuse the same pattern as SAS expiry detection.

---

## 3. Blob Client (`src/core/blob-client.ts`)

Wraps `@azure/storage-blob` SDK. Constructor takes a `StorageEntry` and builds a `BlobServiceClient` (account-key or SAS auth).

### Methods relevant to repo sync

| Method | Signature | Usage for sync |
|---|---|---|
| `createBlob` | `(container, blobName, content: Buffer\|string, contentType?): Promise<void>` | Upload repo files. Accepts raw Buffer. Sets content-type header. |
| `listBlobs` | `(container, prefix?): Promise<BlobItem[]>` | Hierarchical listing with `/` delimiter. Returns `isPrefix` for virtual dirs. Needed to diff remote state against repo. |
| `deleteBlob` | `(container, blobName): Promise<void>` | Clean up deleted repo files. Checks existence first. |
| `renameBlob` | `(container, old, new): Promise<void>` | Copy + delete pattern. Useful for moved files. |
| `getBlobContent` | `(container, blobName): Promise<BlobContent>` | Download for comparison (returns Buffer). |
| `listContainers` | `(): Promise<ContainerInfo[]>` | List all containers in account. |

**Limitation**: `listBlobs` uses hierarchical listing (delimiter-based), meaning it returns one level at a time. A recursive listing helper will be needed for full repo tree comparison.

---

## 4. CLI Patterns (`src/cli/index.ts` + `src/cli/commands/blob-ops.ts`)

### Command registration
Uses `commander` library. Pattern:

```ts
program
  .command("create")
  .description("...")
  .requiredOption("--container <name>", "...")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await createBlob(opts.storage, opts.container, opts.blob, opts.file, opts.content);
  });
```

### Storage resolution pattern
Every command handler follows the same pattern via `resolveStorage()` in `blob-ops.ts`:

```ts
function resolveStorage(storageName?: string) {
  const store = new CredentialStore();
  if (storageName) {
    const entry = store.getStorage(storageName);
    if (!entry) { console.error(...); process.exit(1); }
    return entry;
  }
  const first = store.getFirstStorage();
  if (!first) { console.error(...); process.exit(1); }
  return first;
}
```

- `--storage` is always optional; defaults to first configured account.
- Each command creates a fresh `CredentialStore` + `BlobClient` per invocation.

### Content-type inference
`createBlob` command infers content-type from file extension (`.json`, `.md`, `.txt`, `.pdf`, `.html`), defaulting to `application/octet-stream`.

**Extension point for repo sync**: New CLI commands (e.g., `sync`, `sync-status`, `sync-config`) would follow the same pattern. The `resolveStorage()` helper should be extracted to a shared utility since it's duplicated in `blob-ops.ts` and `view.ts`.

---

## 5. Server API Patterns (`src/electron/server.ts`)

Express 5.x server created via `createServer(port)`. Pattern:

```
GET    /api/storages                        -> list storages (no secrets)
POST   /api/storages                        -> add storage (body: name, accountName, sasToken|accountKey)
DELETE /api/storages/:name                  -> remove storage
GET    /api/containers/:storage             -> list containers
GET    /api/blobs/:storage/:container       -> list blobs (?prefix=)
GET    /api/blob/:storage/:container        -> get blob content (?blob=path)
POST   /api/blob/:storage/:container        -> create blob (?blob=path, body: {content})
DELETE /api/blob/:storage/:container        -> delete blob (?blob=path)
POST   /api/rename/:storage/:container      -> rename blob (body: {oldName, newName})
GET    /api/export/:name                    -> export storage config (no secrets)
```

Every endpoint:
1. Instantiates `new CredentialStore()` and `new BlobClient(entry)` per request.
2. Follows `try/catch` with `res.status(500).json({ error: msg })`.
3. Blob path passed as `?blob=` query param (not URL path) to avoid Express 5 wildcard issues.

**Extension points for repo sync**:
- New endpoints needed: `POST /api/sync/:storage/:container` (trigger sync), `GET /api/sync-status/:storage/:container` (check progress), `POST /api/sync-config` (save sync pair config).
- DOCX conversion uses `mammoth` library (already a dependency) for `?format=html|text`.

---

## 6. UI Patterns (`src/electron/public/app.js`)

Single IIFE, vanilla JS (no framework). Key architectural elements:

### State
```js
let currentStorage = "";     // selected storage name
let currentContainer = "";   // currently active container
let activeTreeItem = null;   // highlighted tree item DOM element
let contextTarget = null;    // { container, blobName, parentEl, prefix, depth }
```

### Tree construction
- `buildTree()`: Fetches `/api/containers/:storage`, creates top-level nodes with `createTreeNode()`.
- `toggleContainer(node, containerName)`: Lazy-loads blobs on first expand via `loadTreeLevel()`.
- `loadTreeLevel(parentEl, container, prefix, depth)`: Fetches `/api/blobs/:storage/:container?prefix=`, creates folder/file nodes recursively.
- `toggleFolder(node, container, prefix, depth)`: Same lazy-load pattern for subdirectories.

### Node creation
```js
function createTreeNode(name, icon, depth, hasChildren) {
  // Returns wrapper div with .tree-item (toggle + icon + name) and optional .tree-children
  // depth controls indentation via CSS var --depth
}
```

### Context menu
- Right-click on file nodes sets `contextTarget` and shows `#context-menu`.
- Menu items: Rename, Delete.
- After operations, tree refreshes via `loadTreeLevel()` on the parent element.

### File viewer
- `viewFile(container, blobName, size)`: Routes to appropriate renderer by extension.
- Supports: JSON (syntax highlighted), Markdown (via `marked`), PDF (iframe embed), DOCX (via server-side mammoth), plain text.

### Modals
- Add Storage modal: name, account, auth-type toggle (SAS/key), credential textarea.
- Create File modal: container dropdown, path input, content textarea.
- Rename modal: old name display, new name input.
- Delete modal: confirmation dialog.

**Extension points for repo sync**:
- Tree could gain a new node type for "synced containers" with a sync icon/badge.
- Context menu could add "Sync Now" option at container level.
- A new modal needed for sync configuration (repo URL, PAT, branch, path mappings).
- A status indicator (last sync time, sync-in-progress spinner) could live in the toolbar area.

---

## 7. Dependencies (`package.json`)

| Package | Version | Relevance |
|---|---|---|
| `@azure/storage-blob` | ^12.31.0 | Core blob operations |
| `commander` | ^14.0.3 | CLI framework |
| `express` | ^5.2.1 | API server |
| `chalk` | ^5.6.2 | CLI output formatting |
| `mammoth` | ^1.12.0 | DOCX rendering |
| `marked` | ^17.0.5 | Markdown rendering (frontend) |
| `highlight.js` | ^11.11.1 | Syntax highlighting (frontend) |
| `electron` | ^41.1.0 | Desktop shell (devDep) |
| `tsx` | ^4.21.0 | TypeScript execution (devDep) |
| `typescript` | ^6.0.2 | Compiler (devDep) |

**New dependencies likely needed for repo sync**:
- Git operations: `simple-git` or `isomorphic-git` for cloning/pulling repos.
- Azure DevOps / GitHub API: `@azure/dev` or `octokit` if fetching repo content via API rather than git clone.
- File hashing: Node built-in `crypto` (already imported in credential-store) for content diffing.
- Glob/ignore: `fast-glob` + `ignore` for `.gitignore`-aware file walking.

---

## 8. Architecture Summary

```
src/
  core/
    types.ts              <- All interfaces (extend StorageEntry here)
    credential-store.ts   <- Encrypted credential CRUD (extend for PAT tokens)
    blob-client.ts        <- Azure SDK wrapper (add recursive list helper)
  cli/
    index.ts              <- Commander program (add sync commands)
    commands/
      add-storage.ts      <- Storage CRUD
      list-storages.ts
      remove-storage.ts
      view.ts             <- List/view commands (has its own resolveStorage)
      blob-ops.ts         <- Create/delete/rename (has its own resolveStorage)
  electron/
    server.ts             <- Express API (add sync endpoints)
    main.ts               <- Electron bootstrap
    launch.ts             <- Launch helper
    public/
      app.js              <- Frontend (add sync UI elements)
      index.html          <- Single page
      style.css            <- Styles
```

Key pattern: `CredentialStore` and `BlobClient` are instantiated fresh per CLI invocation or per HTTP request. No singleton state. This is safe for sync features but means sync state (progress, last-sync timestamp) needs its own persistence mechanism (separate file or additional fields in credential store).
