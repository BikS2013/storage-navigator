# Storage Navigator

Azure Blob Storage + Azure Files navigator. Two deployables in one repo:

- **Client** (`src/`) — CLI + Electron desktop app. Browse containers, view files, manage credentials, clone/sync GitHub & Azure DevOps repos into containers.
- **API** (`API/`) — HTTP service that brokers Azure Storage access behind OIDC + RBAC (Plan 006). Designed to be the third backend type for the client.

## Backend types

The client supports three backend kinds:

| kind | Auth | Blob | File shares | Repo sync | Notes |
|---|---|---|---|---|---|
| `direct` (account-key) | Account key | ✓ | ✓ | ✓ | Default; encrypted local store |
| `direct` (sas-token) | SAS token | ✓ | ✓ | ✓ | Same store; scoped to SAS perms |
| `api` | OIDC bearer JWT or anonymous, optional perimeter static-header (Plan 008) | ✓ | ✓ | — | Talks to a deployed Storage Navigator API |

All flows route through the `IStorageBackend` interface (`src/core/backend/backend.ts`). The factory `makeBackend(entry, account?)` dispatches by `kind`.

## Quickstart — CLI

```bash
git clone https://github.com/BikS2013/storage-navigator
cd storage-navigator
npm install

# Add a direct backend (existing storage account)
npx tsx src/cli/index.ts add --name myacct --account <azure-account> --account-key <key>

# OR connect to a deployed API
npx tsx src/cli/index.ts add-api --name dev --base-url https://your-api.azurewebsites.net

# If the API has the perimeter static-header gate enabled (Plan 008),
# discovery tells the CLI to prompt for it. Pass --static-secret to skip the prompt:
npx tsx src/cli/index.ts add-api --name dev --base-url https://your-api.azurewebsites.net \
  --static-secret <header-value>

# Browse
npx tsx src/cli/index.ts list
npx tsx src/cli/index.ts containers --storage myacct
npx tsx src/cli/index.ts ls --storage myacct --container <name>
npx tsx src/cli/index.ts view --storage myacct --container <name> --blob <path>

# File shares (works with either backend kind)
npx tsx src/cli/index.ts shares --storage myacct
npx tsx src/cli/index.ts files --storage myacct --share <name> --path <dir>
npx tsx src/cli/index.ts file-view --storage myacct --share <name> --file <path>
```

For api backends, every blob/share command also accepts `--account <azure-account>` to disambiguate which Azure storage account to target.

Full command reference: `CLAUDE.md` → `<storage-nav>` block.

## Quickstart — Desktop UI

```bash
npx tsx src/cli/index.ts ui --port 3100
```

Click ➕ → "Add Storage Account" → choose tab:
- **Direct (Account Key / SAS)** — account name + key/SAS
- **🔗 Connect to Storage Navigator API** — friendly name + API base URL; if the API has auth on, OIDC login flow opens automatically. If discovery reports `staticAuthHeaderRequired`, an extra password row appears asking for the perimeter header value (Plan 008).

After connecting, the dropdown shows one entry per `(backend, Azure account)` combo. Tree expands to **Containers** + **Shares**.

## Quickstart — API (Plan 006)

The API is a separate Node/TS deployable in `API/`. See `API/README.md` for full setup. Auth-disabled smoke run:

```bash
cd API
cp .env.example .env       # AUTH_ENABLED=false, ANON_ROLE=Admin
npm install
npm run dev
curl http://localhost:3000/healthz
```

Production deploy: multi-stage Docker image to ACR + Azure App Service with System-Assigned Managed Identity (Plan 006 §10).

## Repository sync

Direct backends can mirror GitHub or Azure DevOps repos into a container, with incremental sync via SHA comparison. See `npx tsx src/cli/index.ts clone-github --help` and the `link-*` / `sync` / `diff` commands.

## Project layout

```
src/                                Client (CLI + Electron)
├── cli/                            Commander entry + commands
├── core/                           Shared backend/credential logic
│   ├── backend/                    IStorageBackend interface + impls
│   │   ├── api-backend.ts          HTTP client to deployed API
│   │   ├── direct-backend.ts       Wraps BlobClient + FileShareClient
│   │   └── auth/                   OIDC client + token store + discovery
│   ├── blob-client.ts              Azure Blob SDK wrapper (direct)
│   └── file-share-client.ts        Azure Files SDK wrapper (direct)
└── electron/                       Desktop app + embedded server

API/                                Storage Navigator RBAC API (Plan 006)
├── src/                            Express + zod + jose + Azure SDK
└── test/                           vitest unit + integration (Azurite + mock IdP)

docs/design/                        plan-NNN-<topic>.md design specs
                                    + plan-NNN-<topic>-impl.md implementation plans

tests/unit/                         Client unit tests (vitest)
```

## Tests

```bash
# Client
npm test                    # vitest unit suite

# API
cd API && npm test          # vitest unit + integration
cd API && npm run lint:openapi
```

## Documentation

- `CLAUDE.md` — comprehensive command reference (`<storage-nav>` + `<storage-nav-api>` tool blocks)
- `docs/design/project-design.md` — high-level architecture
- `docs/design/project-functions.md` — feature catalogue
- `docs/design/plan-006-rbac-api.md` — RBAC API design (deployed)
- `docs/design/plan-007-storage-nav-client-adapter.md` — api backend client design
- `docs/design/plan-008-static-auth-header.md` — perimeter static-auth header gate (env-var-driven, Key Vault wired)
- `API/README.md` — API setup + Key Vault wiring runbook for the static-header gate
- `Issues - Pending Items.md` — open items / known follow-ups

## License

ISC
