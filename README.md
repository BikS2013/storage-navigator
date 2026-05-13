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

---

## Quickstart — Desktop UI

```bash
npx tsx src/cli/index.ts ui --port 3100
```

Click **➕ → Add Storage Account** and choose a tab:

- **Direct (Account Key / SAS)** — account name + key/SAS, stored encrypted locally.
- **🔗 Connect to Storage Navigator API** — friendly name + API base URL. If the API has auth on, the OIDC login flow opens automatically. If discovery reports `staticAuthHeaderRequired`, an extra password row appears for the perimeter header value.

The dropdown shows one entry per `(backend, Azure account)` combo. The tree expands into **Containers** and **Shares**. Selecting a text file enables the **Edit** button — modifications save with an `If-Match` precondition; if the blob changed in storage since you opened it, the editor surfaces *"File changed in storage. Reload to see the latest version."* instead of overwriting.

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

Packaging the Electron app uses `electron-builder`; see `package.json` for the build pipeline.

---

## Documentation index

| File | Purpose |
|---|---|
| `docs/tools/storage-nav.md` | Full CLI + UI command reference |
| `docs/tools/storage-nav-api.md` | API endpoints, RBAC, static-header gate |
| `docs/tools/storage-nav-agent.md` | Agent provider matrix, tool schemas, TUI keys |
| `docs/design/project-design.md` | High-level architecture |
| `docs/design/project-functions.md` | Feature catalogue |
| `docs/design/plan-NNN-*.md` | Per-feature design + implementation plans |
| `API/README.md` | API setup + Key Vault wiring runbook |
| `Issues - Pending Items.md` | Open items / known follow-ups / dependency vetting log |

---

## License

ISC
