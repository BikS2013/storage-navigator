# Storage Navigator

A browser, editor, and automation surface for **Azure Blob Storage** and **Azure File Shares**, packaged as a CLI, an Electron desktop app, an HTTP brokering API, and an LLM-driven ReAct agent — all sharing a single backend abstraction.

| Component | Where | What it does |
|---|---|---|
| **CLI** (`storage-nav`) | `src/cli/` | Scriptable browse / view / edit / upload / download / sync from the terminal. |
| **Desktop UI** (`storage-nav ui`) | `src/electron/` | Electron app — tree explorer, in-place text editor, multi-select ZIP download, repo diff viewer. |
| **API** (`storage-nav-api`) | `API/` | HTTP service that brokers Azure Storage behind OIDC + three RBAC roles (Reader / Writer / Admin), with an optional perimeter static-header gate. |
| **Agent** (`storage-nav agent`) | `src/agent/` | LangGraph ReAct agent that exposes every CLI command as an LLM tool, with one-shot + interactive TUI, six provider backends, and confirmation-gated mutations. |

---

## Highlights

- **Three backend kinds, one interface.** Account keys, SAS tokens, and remote API endpoints all flow through `IStorageBackend` (`src/core/backend/backend.ts`), so every command works the same regardless of how credentials are stored.
- **Encrypted local credential store.** Account keys, SAS tokens, OIDC refresh tokens, and PATs are encrypted at rest under a machine-bound key (`src/core/credential-store.ts`). PATs (GitHub / Azure DevOps) are kept separate from storage credentials and tagged for reuse across containers.
- **Safe in-place text editing.** The viewer detects text-editable blobs (allow-list → content sniff → size cap), and `PUT` requests are guarded with an `If-Match` ETag round-trip so concurrent writers can't silently clobber each other.
- **Repo ↔ container sync.** Clone GitHub / Azure DevOps repos (HTTPS + SSH) into a container, then run `sync` for incremental SHA-based updates or `diff` to compare a container against its linked remote without touching either side.
- **Publish back to GitHub (reverse-git).** Push a container / prefix / whole account into a GitHub repo (incremental add/modify/delete), authenticating with a PAT **or** a **GitHub App** installation. A GitHub App installed with “Only select repositories” keeps the tool scoped to exactly the repos it created/manages. See [`docs/design/configuration-guide.md` §5](docs/design/configuration-guide.md).
- **Streaming ZIP downloads.** Single-blob downloads use `Content-Disposition`; multi-blob and folder downloads stream a ZIP archive lazily — pagination is interleaved with archive writing so the response starts before the full tree is walked.
- **DOCX rendering.** `.docx` blobs can be requested as `?format=html` (Mammoth) or `?format=text` for inline preview without leaving the app.
- **Multi-provider agent.** OpenAI, Anthropic, Google Gemini, Azure OpenAI, Azure Anthropic, and any local OpenAI-wire endpoint (Ollama, LiteLLM, MLX, llama.cpp). Provider precedence: CLI flag > env > `~/.tool-agents/storage-nav/.env` > local `.env`.

---

## Install

```bash
git clone https://github.com/BikS2013/storage-navigator
cd storage-navigator
npm install
```

> Requires **Node ≥ 20** for native `fetch` + `Readable.fromWeb`. Electron 41 is pulled in as a dev dependency for the desktop build.

A `storage-nav` binary is exposed via `package.json#bin` once you `npm link` (or install globally). All examples below use the dev runner `npx tsx src/cli/index.ts`; substitute `storage-nav` if you've linked.

---

## Quickstart — CLI

### 1 · Register a backend

```bash
# Direct account-key backend
npx tsx src/cli/index.ts add \
  --name myacct --account <azure-account> --account-key <key>

# Direct SAS-token backend
npx tsx src/cli/index.ts add \
  --name myacct --account <azure-account> --sas-token "<sas>"

# Remote API backend (OIDC discovered from /.well-known/storage-nav-config)
npx tsx src/cli/index.ts add-api \
  --name dev --base-url https://your-api.azurewebsites.net

# If the API has the perimeter static-header gate enabled:
npx tsx src/cli/index.ts add-api \
  --name dev --base-url https://your-api.azurewebsites.net \
  --static-secret <header-value>
```

### 2 · Browse

```bash
npx tsx src/cli/index.ts list                                      # configured backends
npx tsx src/cli/index.ts containers --storage myacct
npx tsx src/cli/index.ts ls         --storage myacct --container <name>
npx tsx src/cli/index.ts view       --storage myacct --container <name> --blob <path>
npx tsx src/cli/index.ts download   --storage myacct --container <name> --blob <path> --out ./file
```

### 3 · File shares

```bash
npx tsx src/cli/index.ts shares     --storage myacct
npx tsx src/cli/index.ts files      --storage myacct --share <name> --path <dir>
npx tsx src/cli/index.ts file-view  --storage myacct --share <name> --file <path>
npx tsx src/cli/index.ts file-upload --storage myacct --share <name> --file <remote-path> --src <local-path>
```

### 4 · Repo sync (direct backends only)

```bash
# Add a token once, reuse across containers
npx tsx src/cli/index.ts add-token --service github --name personal --token <pat>

# Clone into a container
npx tsx src/cli/index.ts clone-github \
  --storage myacct --container repo-mirror \
  --owner BikS2013 --repo storage-navigator --branch main --token personal

# Later: incremental sync + read-only diff
npx tsx src/cli/index.ts sync --storage myacct --container repo-mirror
npx tsx src/cli/index.ts diff --storage myacct --container repo-mirror
```

For `api` backends every blob/share command accepts `--account <azure-account>` to disambiguate which Azure account behind the broker to target.

### 5 · Publish to GitHub — PAT or GitHub App

Publish (push) a container/prefix/account back to a GitHub repo. You can authenticate with a Personal Access Token (PAT) **or** a **GitHub App** installation. A GitHub App installed with “Only select repositories” keeps Storage Navigator limited to exactly the repos it created/manages.

```bash
# --- Option A: PAT ---
npx tsx src/cli/index.ts publish-github --container my-docs --repo myorg/my-docs \
  --create-repo --token-name personal

# --- Option B: GitHub App (scoped, recommended) ---
# 1. Register the app credential once (private key encrypted at rest)
npx tsx src/cli/index.ts add-github-app \
  --name my-publisher --app-id 123456 --installation-id 7654321 \
  --private-key-file ./my-app.private-key.pem \
  --companion-pat-name personal      # optional: auto-adds new repos to the install

# 2. Publish using the app
npx tsx src/cli/index.ts publish-github --container my-docs --repo myorg/my-docs \
  --create-repo --github-app-name my-publisher

# Later incremental pushes (either auth)
npx tsx src/cli/index.ts push --container my-docs
```

Setup of the GitHub App (permissions, App ID, installation ID, private key) and the
companion-PAT boundary behavior are documented in
[`docs/design/configuration-guide.md` §5](docs/design/configuration-guide.md) and the
“GitHub App authentication” section of [`docs/tools/storage-nav.md`](docs/tools/storage-nav.md).
Both the CLI and the Desktop UI support GitHub App credential management and selecting an
app when publishing.

---

## Quickstart — Desktop UI

```bash
npx tsx src/cli/index.ts ui --port 3100
```

Click **➕ → Add Storage Account** and choose a tab:

- **Direct (Account Key / SAS)** — account name + key/SAS, stored encrypted locally.
- **🔗 Connect to Storage Navigator API** — friendly name + API base URL. If the API has auth on, the OIDC login flow opens automatically. If discovery reports `staticAuthHeaderRequired`, an extra password row appears for the perimeter header value.

The dropdown shows one entry per `(backend, Azure account)` combo. The tree expands into **Containers** and **Shares**. Selecting a text file enables the **Edit** button — modifications save with an `If-Match` precondition; if the blob changed in storage since you opened it, the editor surfaces *"File changed in storage. Reload to see the latest version."* instead of overwriting.

### HTML rendering

When you open an `.html` or `.htm` file from a container or file share, the viewer renders it inside a sandboxed iframe instead of showing escaped source. The same content is reachable from any browser at:

```
http://localhost:<port>/api/site/<storage>/<container>/<path>
http://localhost:<port>/api/site-file/<storage>/<share>/<path>
```

Relative references (`./styles.css`, `images/foo.png`, sibling pages) resolve to sibling blobs / files in the same container or share — no rewriting is performed, the browser does it natively.

**Security model.** By default the iframe runs with `sandbox="allow-scripts"` only — scripts execute but cannot reach the host page, navigate the window, submit forms, or call back into the API. The server adds a matching `Content-Security-Policy` with `connect-src 'none'`.

If you need a stored page to behave like a real site (XHR, forms, same-origin storage), click **Trust container** in the viewer's HTML toolbar. The trust flag is per-container (or per-share), persisted in your encrypted credential store, and can be cleared at any time. Trusted mode adds `allow-same-origin allow-forms allow-popups` to the sandbox and relaxes CSP to `connect-src 'self'` + `form-action 'self'` — third-party access remains forbidden.

The **Open in browser** button opens the same URL in your OS default browser. **View source** falls back to the escaped-source viewer with the existing in-place **Edit** button.

---

## Standalone macOS app (`/Applications`)

Package the Desktop UI as a double-clickable `Storage Navigator.app` that installs into `/Applications` (and shows up in Launchpad / Spotlight) — no terminal, no `node_modules`, no `npx`. Built with the bundled `electron-builder` for **Apple Silicon (arm64)**.

```bash
# 1. Build the app + DMG  (tsc → electron-builder --mac --arm64)
npm run dist:mac

# 2. Ad-hoc sign so it runs on Apple Silicon
#    (electron-builder skips signing with identity:null; arm64 won't launch a fully-unsigned bundle)
codesign --force --deep --sign - "release/mac-arm64/Storage Navigator.app"

# 3. Install
cp -R "release/mac-arm64/Storage Navigator.app" /Applications/
```

Outputs land in `release/` (git-ignored):

- `release/mac-arm64/Storage Navigator.app` — the app bundle
- `release/Storage Navigator-<version>-arm64.dmg` — drag-to-Applications installer

Then launch it from Launchpad/Spotlight or `open "/Applications/Storage Navigator.app"`. The app starts its own embedded server and opens the same UI as `storage-nav ui`; it shares the same encrypted credential store (`~/.storage-nav/`), so backends added via the CLI/dev UI are already available.

**Notes & limitations** (personal-use scope — see `Issues - Pending Items.md`):

- **Not notarized.** A locally-built copy launches fine. If you *send* the DMG to someone else, macOS Gatekeeper blocks first launch on their machine — they must right-click → **Open** once, or run `xattr -dr com.apple.quarantine "/Applications/Storage Navigator.app"`. Distributing cleanly would require a Developer ID certificate + Apple notarization.
- **Fixed port 3100.** The packaged app's embedded server uses port 3100; if it's already in use the window won't load.
- **Bundle ~145 MB.** All production dependencies (including the agent's LangChain stack) are bundled.

Design and rationale: [`docs/design/plan-013-macos-standalone-app.md`](docs/design/plan-013-macos-standalone-app.md).

---

## Quickstart — API (RBAC broker)

The API is a separate Node/TypeScript service in `API/`. It brokers Azure Storage behind OIDC + three global roles (`StorageReader`, `StorageWriter`, `StorageAdmin`), with an optional perimeter static-header gate that runs **in front of** OIDC validation.

```bash
cd API
cp .env.example .env       # AUTH_ENABLED=false, ANON_ROLE=Admin for local smoke
npm install
npm run dev
curl http://localhost:3000/healthz
curl http://localhost:3000/.well-known/storage-nav-config | jq
```

Production: multi-stage Docker image → ACR → Azure App Service, with Storage account access via a **System-Assigned Managed Identity** and the static-header secret pulled from Key Vault at boot. See `API/README.md` for the full runbook.

---

## Quickstart — Agent

```bash
# One-shot
npx tsx src/cli/index.ts agent "list containers in myacct and show the first 5 blobs of each"

# Interactive TUI (streaming, slash commands, persistent memory)
npx tsx src/cli/index.ts agent
```

The agent wraps every storage-nav command as an LLM tool. Mutating tools (delete, upload, rename, sync) are confirmation-gated — the agent emits a structured proposal that the TUI surfaces as a y/N prompt before the underlying command runs. Provider, model, and credentials are resolved from a four-tier chain (CLI flag → shell env → `~/.tool-agents/storage-nav/.env` → local `.env`). See `docs/tools/storage-nav-agent.md` for the full provider matrix.

---

## Backend types at a glance

| Kind | Auth | Blob | File shares | Repo sync | Notes |
|---|---|---|---|---|---|
| `direct` (account-key) | Account key | ✓ | ✓ | ✓ | Default; encrypted local store |
| `direct` (sas-token) | SAS token | ✓ | ✓ | ✓ | Same store; scoped to SAS perms |
| `api` | OIDC bearer JWT (or anonymous), optional perimeter static-header | ✓ | ✓ | — | Talks to a deployed Storage Navigator API |

Factory: `makeBackend(entry, account?)` in `src/core/backend/factory.ts`, dispatched by `entry.kind`.

---

## Configuration & secrets

| Where it lives | What it stores |
|---|---|
| `~/.storage-nav/credentials.enc` | Encrypted JSON: backend entries (account keys, SAS, API URLs), OIDC refresh tokens, PATs. Machine-bound key. |
| `~/.tool-agents/storage-nav/.env` (mode 0600, folder 0700) | Agent provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_*`, …) per the project's tool-conventions. |
| Local `.env` | Optional per-project overrides — lower precedence than `~/.tool-agents/storage-nav/.env`. |
| Shell env | Lowest precedence; CLI flags win above all. |

There are **no fallback defaults** for credentials: if a required value is missing the tool fails fast with an actionable error.

---

## Project layout

```
src/                            Client (CLI + Electron + Agent)
├── cli/
│   ├── index.ts                Commander entry — registers all subcommands
│   └── commands/               One file per command group
├── core/
│   ├── backend/
│   │   ├── backend.ts          IStorageBackend interface
│   │   ├── direct-backend.ts   Wraps BlobClient + FileShareClient
│   │   ├── api-backend.ts      HTTP client for the RBAC API
│   │   ├── factory.ts          makeBackend(entry, account?)
│   │   └── auth/               OIDC client + token store + discovery
│   ├── blob-client.ts          Azure Blob SDK wrapper (direct kind)
│   ├── file-share-client.ts    Azure Files SDK wrapper (direct kind)
│   ├── credential-store.ts     Encrypted at-rest credential store
│   └── sync-engine.ts          Repo ↔ container SHA-diff sync
├── electron/
│   ├── main.ts                 Electron bootstrap
│   ├── server.ts               Embedded Express server (renderer ↔ backend)
│   └── public/                 Renderer (HTML/CSS/JS)
├── agent/                      LangGraph ReAct agent
│   ├── graph.ts                State machine
│   ├── providers/              OpenAI / Anthropic / Gemini / Azure / local
│   └── tools/                  storage-nav commands → LLM tool schemas
├── tui/                        TUI for the agent (streaming, slash cmds)
└── util/                       text-detect, zip-stream, path utils

API/                            Storage Navigator RBAC API
├── src/                        Express + zod + jose + Azure SDK
└── test/                       vitest unit + integration (Azurite + mock IdP)

docs/
├── design/                     plan-NNN-<topic>.md + project-design.md
├── tools/                      Per-tool reference (storage-nav, -api, -agent)
└── reference/                  External reference material

tests/unit/                     Client unit tests (vitest)
test_scripts/                   Manual / integration smoke scripts
```

---

## Development

```bash
npm run build      # tsc → dist/
npm test           # vitest unit suite
npm run test:watch # watch mode

# Run from source
npm run cli -- list
npm run ui

# API
cd API && npm test && npm run lint:openapi
```

Type-check only:

```bash
npx tsc --noEmit
```

Packaging the Electron app as a standalone macOS `.app` uses `electron-builder` (`npm run dist:mac`) — see [Standalone macOS app](#standalone-macos-app-applications) above and the `build` block in `package.json`.

---

## Documentation index

| File | Purpose |
|---|---|
| `docs/tools/storage-nav.md` | Full CLI + UI command reference |
| `docs/tools/storage-nav-api.md` | API endpoints, RBAC, static-header gate |
| `docs/tools/storage-nav-agent.md` | Agent provider matrix, tool schemas, TUI keys |
| `docs/design/configuration-guide.md` | Credentials & config: storage backends, PATs, **GitHub App auth (§5)** |
| `docs/design/project-design.md` | High-level architecture |
| `docs/design/project-functions.md` | Feature catalogue |
| `docs/design/plan-NNN-*.md` | Per-feature design + implementation plans |
| `API/README.md` | API setup + Key Vault wiring runbook |
| `Issues - Pending Items.md` | Open items / known follow-ups / dependency vetting log |

---

## License

ISC
