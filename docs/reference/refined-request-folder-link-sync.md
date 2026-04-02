# Refined Request: Folder-Level Repository Linking and Sync

## Date
2026-04-02

## Origin
User request to extend the existing clone/sync functionality to support linking a **folder inside a container** (not just an entire container) to a GitHub or Azure DevOps repository, and to expose link and sync operations in both CLI and UI.

---

## 1. Problem Statement

The current storage-navigator supports cloning an entire GitHub or Azure DevOps repository into a **whole container** and syncing that container afterwards. The metadata (`.repo-sync-meta.json`) is stored at the container root.

This model has two limitations:

1. **No sub-folder linking** -- Users cannot link a specific folder within a container to a repository. For example, they cannot have a container `my-data` with folder `prompts/` linked to one repo and `templates/` linked to another.
2. **No "link" as a separate step from "clone"** -- Currently, `clone-github` / `clone-devops` both create the association AND download all files in a single operation. There is no way to establish a link first and then pull content later (or re-link to a different branch/repo without re-cloning).
3. **UI cannot initiate linking or cloning** -- The UI only shows a sync badge on already-cloned containers and allows triggering sync. There is no UI workflow for creating a new link or cloning a repo.

---

## 2. Proposed Solution

### 2.1 Concept: "Link" vs "Clone" vs "Sync"

| Operation | Description |
|-----------|-------------|
| **Link**  | Establishes an association between a **target** (container or container/folder) and a **source** (GitHub or Azure DevOps repository, optionally a sub-path within the repo). Writes metadata but does NOT download files. |
| **Clone** | (Existing) Creates a link AND downloads all files in a single operation. Remains available for convenience. |
| **Sync**  | (Existing, extended) Pulls changes from the linked repository into the linked target. Now supports folder-level targets. |
| **Unlink**| Removes the link metadata without deleting the synced files. |

### 2.2 Target Granularity

A link target is identified by:
- **Container name** (required)
- **Folder prefix** (optional) -- a blob prefix path, e.g., `prompts/coa/`. When omitted, the entire container is the target (backward-compatible with current behavior).

### 2.3 Source Specification

A link source is identified by:
- **Provider**: `github` or `azure-devops`
- **Repository URL**
- **Branch** (optional, defaults to repo default branch)
- **Repo sub-path** (optional) -- a path within the repository to sync from, e.g., `src/templates/`. When omitted, the entire repo is synced.

### 2.4 Metadata Storage

#### Current State
- Single file `.repo-sync-meta.json` at container root.
- Contains: `provider`, `repoUrl`, `branch`, `lastSyncAt`, `lastCommitSha`, `fileShas`.

#### Proposed Change
- Introduce a **link registry** blob: `.repo-links.json` at container root.
- This blob holds an **array** of link entries, each representing one link within the container.
- The existing `.repo-sync-meta.json` format is **preserved for backward compatibility**: containers with the old format are treated as having a single container-root link.

**New `RepoLink` type:**
```typescript
interface RepoLink {
  id: string;                    // Unique link identifier (UUID)
  provider: "github" | "azure-devops";
  repoUrl: string;
  branch: string;
  repoSubPath?: string;         // Sub-path within the repo to sync from (e.g., "src/templates/")
  targetPrefix?: string;        // Blob prefix in the container (e.g., "prompts/coa/"). Undefined = container root
  lastSyncAt?: string;          // ISO 8601 timestamp of last sync (null if never synced)
  lastCommitSha?: string;
  fileShas: Record<string, string>;  // path -> SHA mapping for tracked files
  createdAt: string;            // ISO 8601 timestamp
}
```

**New `RepoLinksRegistry` type:**
```typescript
interface RepoLinksRegistry {
  version: 1;
  links: RepoLink[];
}
```

**Migration strategy:**
- When the system reads a container and finds `.repo-sync-meta.json` but no `.repo-links.json`, it auto-migrates: creates a `.repo-links.json` with a single link derived from the old metadata. The old file is retained for safety but ignored once `.repo-links.json` exists.

---

## 3. CLI Specification

### 3.1 New Commands

#### `link-github`
Establish a link between a container/folder and a GitHub repository.

```
npx tsx src/cli/index.ts link-github \
  --repo <url>              # GitHub repository URL (required)
  --container <name>        # Target container (required)
  --prefix <path>           # Target folder prefix within container (optional)
  --repo-path <path>        # Sub-path within the repo to sync (optional)
  --branch <branch>         # Branch (optional, defaults to repo default)
  --storage <name>          # Storage account (optional)
  --token-name <name>       # PAT token name (optional)
  --pat <token>             # Inline GitHub PAT (optional)
  --account-key <key>       # Inline account key (optional)
  --sas-token <token>       # Inline SAS token (optional)
  --account <account>       # Azure Storage account name (optional)
```

**Behavior:** Writes/updates `.repo-links.json` in the container. Does NOT download files. Validates that the repo is accessible and the branch exists. If a link already exists for the same `(container, prefix)`, the command fails with an error suggesting `--force` or `unlink` first.

#### `link-devops`
Same as `link-github` but for Azure DevOps repositories. Accepts the same options, replacing `--repo` with an Azure DevOps URL.

#### `unlink`
Remove a link from a container.

```
npx tsx src/cli/index.ts unlink \
  --container <name>        # Container (required)
  --prefix <path>           # Folder prefix to unlink (optional; omit = container-root link)
  --link-id <id>            # Alternative: unlink by link ID
  --storage <name>          # Storage account (optional)
  --account-key <key>       # Inline account key (optional)
  --sas-token <token>       # Inline SAS token (optional)
  --account <account>       # Azure Storage account name (optional)
```

**Behavior:** Removes the link entry from `.repo-links.json`. Does NOT delete synced files. If `--prefix` matches multiple links (ambiguous), fails with guidance to use `--link-id`.

#### `list-links`
List all repository links in a container.

```
npx tsx src/cli/index.ts list-links \
  --container <name>        # Container (required)
  --storage <name>          # Storage account (optional)
  --account-key <key>       # Inline account key (optional)
  --sas-token <token>       # Inline SAS token (optional)
  --account <account>       # Azure Storage account name (optional)
```

**Output:** Table showing link ID, provider, repo URL, branch, repo sub-path, target prefix, last sync time.

### 3.2 Modified Commands

#### `clone-github` / `clone-devops` (extended)
Add optional parameters:
- `--prefix <path>` -- target folder prefix within the container
- `--repo-path <path>` -- sub-path within the repo

When `--prefix` is provided, the repo content is placed under that prefix in the container. These commands now internally create a link entry in `.repo-links.json` before cloning.

#### `sync` (extended)
Add optional parameter:
- `--prefix <path>` -- sync only the link at this prefix (required when multiple links exist)
- `--link-id <id>` -- alternative: sync a specific link by ID
- `--all` -- sync all links in the container

When the container has a single link, `--prefix` / `--link-id` are optional. When multiple links exist, one of `--prefix`, `--link-id`, or `--all` is required.

---

## 4. UI Specification

### 4.1 Link Management Dialog

#### Trigger Points
1. **Container context menu** -- new "Link to Repository..." option.
2. **Folder context menu** -- new "Link to Repository..." option (pre-fills prefix).
3. **Container header area** -- when viewing a container, show a "Link" button/icon.

#### Dialog Fields
- Provider: dropdown (GitHub / Azure DevOps)
- Repository URL: text input
- Branch: text input (optional, shows placeholder "default branch")
- Repository sub-path: text input (optional, shows placeholder "entire repository")
- Target prefix: text input (pre-filled if triggered from folder context menu; empty = container root)
- Token: dropdown of configured PAT tokens for the selected provider, with option to type inline

#### Dialog Actions
- **Link Only** -- creates the link, does not sync
- **Link & Sync** -- creates the link and immediately syncs (equivalent of clone)
- **Cancel**

### 4.2 Link Indicators (Visual)

| Element | Indicator |
|---------|-----------|
| Container with any links | Existing sync badge enhanced: show count if multiple links (e.g., "2 links") |
| Folder that is a link target | Small link icon next to folder name |
| Linked container/folder tooltip | Shows repo URL, branch, last sync time |

### 4.3 Sync from UI

#### Container-Level Sync
- Clicking the sync badge on a container with a **single** link triggers sync immediately (current behavior preserved).
- Clicking the sync badge on a container with **multiple** links opens a dialog listing all links with individual "Sync" buttons and a "Sync All" button.

#### Folder-Level Sync
- Right-click on a linked folder shows "Sync from Repository" in context menu.
- Triggers sync for that specific link.

### 4.4 Unlink from UI
- Right-click on a linked container or folder shows "Unlink Repository" in context menu.
- Confirmation dialog: "Remove the link to {repoUrl}? Synced files will NOT be deleted."

### 4.5 View Links Panel
- New section in the container detail view (or a modal): "Repository Links" listing all links for the current container.
- Each link shows: provider icon, repo URL (clickable), branch, repo sub-path, target prefix, last sync time.
- Actions per link: Sync, Unlink.

---

## 5. API Endpoints (Server)

The following new/modified REST API endpoints are needed to support the UI:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/links/:storage/:container` | List all links in a container |
| POST   | `/api/links/:storage/:container` | Create a new link (body: provider, repoUrl, branch, repoSubPath, targetPrefix) |
| DELETE | `/api/links/:storage/:container/:linkId` | Remove a link by ID |
| POST   | `/api/sync/:storage/:container/:linkId` | Sync a specific link (query: `?dryRun=true`) |
| POST   | `/api/sync-all/:storage/:container` | Sync all links in a container |

The existing `GET /api/sync-meta/:storage/:container` endpoint should be **preserved** for backward compatibility but internally check `.repo-links.json` first.

The existing `POST /api/sync/:storage/:container` endpoint should be **preserved** for single-link containers. When multiple links exist, it returns an error directing the caller to use the link-specific endpoint.

---

## 6. Core Engine Changes

### 6.1 `sync-engine.ts` Modifications

- `readSyncMeta()` -- extend to read `.repo-links.json` first, fall back to `.repo-sync-meta.json` for backward compatibility.
- New `readLinks(blobClient, container): Promise<RepoLinksRegistry>` -- reads the link registry.
- New `writeLinks(blobClient, container, registry): Promise<void>` -- writes the link registry.
- New `createLink(blobClient, container, link: Omit<RepoLink, "id" | "createdAt" | "fileShas">): Promise<RepoLink>` -- adds a link.
- New `removeLink(blobClient, container, linkId: string): Promise<boolean>` -- removes a link.
- `cloneRepo()` -- extend signature to accept `targetPrefix` and `repoSubPath`. When `targetPrefix` is set, blob paths are prefixed. When `repoSubPath` is set, only files under that path are included and their paths are made relative to it.
- `syncRepo()` -- extend signature to accept a specific `RepoLink` (instead of reading container-level meta). Path prefixing and sub-path filtering apply.
- New `migrateOldMeta(blobClient, container): Promise<RepoLinksRegistry | null>` -- migrates `.repo-sync-meta.json` to `.repo-links.json`.

### 6.2 Path Mapping Logic

When a link has `repoSubPath` and/or `targetPrefix`, the mapping between repo file paths and blob paths is:

```
Repo file:  {repoSubPath}/{relativePath}
Blob:       {targetPrefix}/{relativePath}
```

For example, with `repoSubPath = "src/templates"` and `targetPrefix = "prompts/coa/"`:
- Repo file `src/templates/extract.json` maps to blob `prompts/coa/extract.json`
- Repo file `src/other/file.txt` is excluded (not under repoSubPath)

### 6.3 Provider Filtering

Both `GitHubClient.listFiles()` and `DevOpsClient.listFiles()` currently return all files in the repo. Rather than modifying the provider APIs (which fetch the full tree anyway), filtering by `repoSubPath` should be done **after** the file list is retrieved, in the sync engine.

### 6.4 Conflict Detection

A new link must not overlap with an existing link's `targetPrefix`:
- Two links with the same `targetPrefix` are not allowed.
- A link whose `targetPrefix` is a sub-path of another link's `targetPrefix` (or vice versa) should trigger a warning (not a hard error), since overlapping prefixes could cause file conflicts during sync.

---

## 7. Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Container with existing `.repo-sync-meta.json` only | Auto-migrate to `.repo-links.json` on first read. Old file retained. |
| CLI `sync --container X` on old-format container | Works as before (single link, auto-migrated). |
| UI sync badge on old-format container | Works as before (single link, auto-migrated). |
| New folder-level links alongside old container-level link | Supported: migration creates one entry, new links are appended. |

---

## 8. Implementation Scope

### Files to Create
- None (all changes extend existing files)

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/types.ts` | Add `RepoLink`, `RepoLinksRegistry` interfaces |
| `src/core/sync-engine.ts` | Add link registry CRUD, migration, extend clone/sync for prefix and sub-path |
| `src/core/github-client.ts` | No changes (filtering done in engine) |
| `src/core/devops-client.ts` | No changes (filtering done in engine) |
| `src/cli/index.ts` | Register `link-github`, `link-devops`, `unlink`, `list-links` commands; extend `clone-*` and `sync` |
| `src/cli/commands/repo-sync.ts` | Add `linkGitHub()`, `linkDevOps()`, `unlinkContainer()`, `listLinks()` functions; extend `cloneGitHub()`, `cloneDevOps()`, `syncContainer()` |
| `src/electron/server.ts` | Add link CRUD and folder-sync API endpoints |
| `src/electron/public/app.js` | Link dialog, folder link indicators, multi-link sync UI, context menu entries, unlink flow |
| `src/electron/public/index.html` | Add link dialog HTML, link panel HTML |
| `src/electron/public/style.css` | Styles for link indicators, link dialog, link panel |

### Files to Update (Documentation)
| File | Changes |
|------|---------|
| `CLAUDE.md` | Update `<storage-nav>` tool documentation with new commands |
| `Issues - Pending Items.md` | Track any issues found during implementation |

---

## 9. Testing Strategy

### CLI Tests (test_scripts/)
1. `link-github` -- create a link, verify `.repo-links.json` is written correctly
2. `link-github` with `--prefix` -- folder-level link creation
3. `link-github` with `--repo-path` -- repo sub-path filtering
4. `clone-github` with `--prefix` -- clone into folder
5. `sync` with `--prefix` -- sync specific folder link
6. `sync --all` -- sync all links in a container
7. `list-links` -- verify output format
8. `unlink` -- verify link removal without file deletion
9. Backward compatibility: sync a container that only has `.repo-sync-meta.json`
10. Conflict detection: attempt to create overlapping links

### UI Tests (Manual)
1. Link dialog opens from container context menu
2. Link dialog opens from folder context menu (prefix pre-filled)
3. Link & Sync flow works end-to-end
4. Multi-link container shows correct badge
5. Individual link sync from link panel
6. Folder context menu shows "Sync from Repository" for linked folders
7. Unlink flow preserves files

---

## 10. Out of Scope

- **Push to repo** -- syncing is one-directional (repo to storage only).
- **Automatic/scheduled sync** -- sync is always user-triggered.
- **Partial file sync within a folder** -- all files under the linked path are synced; no per-file exclusion patterns.
- **Multiple branches for a single link** -- each link tracks exactly one branch.
- **Container creation from UI** -- the target container must already exist.
