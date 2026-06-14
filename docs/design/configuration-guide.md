# Storage Navigator — Configuration Guide

## Overview

Storage Navigator uses encrypted local storage for credentials and command-line options for runtime settings. There are no environment variables or config files — all configuration is done through the CLI or UI.

## Configuration Options

### 1. Storage Account Credentials

**Purpose**: Authenticate against Azure Blob Storage accounts to browse containers and view files.

**How to configure**: Via CLI or UI.

```bash
# CLI
storage-nav add --name <display-name> --account <azure-account-name> --account-key <key>
storage-nav add --name <display-name> --account <azure-account-name> --sas-token <token>
```

In the UI, click the **+** button in the header to open the Add Storage modal.

**Authentication types** (choose one per storage account):

| Type | Option | Description | Recommended |
|------|--------|-------------|-------------|
| Account Key | `--account-key` | Full access to all containers and blobs. Does not expire. | Yes |
| SAS Token | `--sas-token` | Scoped access. May be limited to specific containers or operations. Has an expiration date. | For restricted access |

**How to obtain**:
- **Account Key**: Azure Portal > Storage Account > Security + networking > Access keys. Copy Key1 or Key2.
- **SAS Token**: Azure Portal > Storage Account > Shared access signature. Configure permissions, expiry, and generate.
- **Azure CLI**: `az storage account keys list --account-name <name> --query "[0].value" -o tsv`

**Storage location**: `~/.storage-navigator/credentials.json` (encrypted with AES-256-GCM).

**Encryption key**: `~/.storage-navigator/machine.key` (random 32-byte key, generated on first use, owner-only permissions `0600`).

**Recommended approach**: Use **Account Key** for developer/admin use. Use **SAS Token** when you need scoped, time-limited access. The app displays expiration warnings in the storage selector when a SAS token is within 30 days of expiry.

**Expiration handling**: SAS tokens have a built-in expiry date (`se` parameter). The app parses this and shows:
- `[EXPIRED]` badge if the token has expired
- `[Xd left]` badge if expiring within 30 days

> **Recommendation**: When adding a SAS token, note its expiration date. The app will warn you as it approaches, but you must manually replace the token with `storage-nav add --name <same-name> ...` which overwrites the existing entry.

### 2. Server Port

**Purpose**: Set the HTTP port for the Express server (used by both the Electron UI and the web interface).

**How to configure**:

```bash
# Default: 3100
storage-nav ui

# Custom port
storage-nav ui --port 3200
```

**Default value**: `3100`

**When to change**: When running multiple instances simultaneously, or when port 3100 is already in use.

### 3. Storage Account Selection

**Purpose**: Select which storage account to use for CLI commands.

**How to configure**:

```bash
# Explicit selection
storage-nav containers --storage corporateloans
storage-nav ls --container prompts --storage corporateloans

# Implicit: uses first configured account if --storage is omitted
storage-nav containers
```

**Default behavior**: If `--storage` is omitted, the first configured account is used.

### 4. Inline Secrets

**Purpose**: Allow commands to run without pre-configured credentials, useful for scripting, one-off operations, or first-time use.

**How to configure**:

```bash
# Blob commands: inline storage credentials
storage-nav containers --account myaccount --account-key "your-key"
storage-nav ls --container data --account myaccount --sas-token "sv=2021..."

# Repo commands: inline PAT
storage-nav clone-github --repo https://github.com/org/repo --container myrepo --pat "ghp_xxx"
storage-nav sync --container myrepo --pat "ghp_xxx"

# Combine inline storage + inline PAT
storage-nav clone-github --repo https://github.com/org/repo --container myrepo \
  --pat "ghp_xxx" --account myaccount --account-key "key"
```

**Resolution chain** (in priority order):
1. Inline CLI parameter (`--account-key`, `--sas-token`, `--pat`)
2. Named stored credential (`--storage`, `--token-name`)
3. First stored credential for the account/provider
4. Interactive prompt — asks user for the secret and offers to store it

**When to use**: CI/CD pipelines, one-off operations, or when you don't want to persist credentials.

### 5. GitHub App Credentials (reverse-git publication)

**Purpose**: Authenticate reverse-git publication (`publish-github` / `reverse-link-github` / `push`) as a **GitHub App installation** instead of a Personal Access Token (PAT). A GitHub App installed with **“Only select repositories”** keeps storage-nav limited to exactly the repositories it created/manages, which is a tighter security boundary than a broadly-scoped PAT. GitHub App auth is **additive** — the existing PAT flow keeps working unchanged.

**Options** (multiple ways to supply the credential; priority below):

| Option | Flag | Meaning |
|---|---|---|
| Stored GitHub App | `--github-app-name <name>` | Use an encrypted GitHub App entry added via `add-github-app`. |
| Inline GitHub App | `--github-app-inline <json>` | Provide `{ "appId", "privateKeyPem", "installationId" }` inline (scripting/CI). |
| PAT (existing) | `--pat` / `--token-name` | Unchanged Personal Access Token flow. |

**Resolution chain** (in priority order): `--github-app-inline` > `--github-app-name` > PAT chain (`--pat` > `--token-name` > first stored GitHub PAT). Per the project's no-fallback rule, if a named GitHub App is not found the command exits with configuration-error code 3 rather than silently falling back.

**How to configure**:

```bash
# Register the credential once (private key encrypted at rest)
storage-nav add-github-app \
  --name my-publisher \
  --app-id 123456 \
  --installation-id 7654321 \
  --private-key-file ./my-app.private-key.pem \
  --companion-pat-name my-github-pat   # optional; see scope note below

# Publish a container using the GitHub App
storage-nav publish-github --container my-docs --repo myorg/my-docs \
  --create-repo --github-app-name my-publisher

storage-nav list-github-apps     # never prints the private key
storage-nav remove-github-app --name my-publisher
```

**How to obtain each value**:
- **App ID** (`--app-id`): GitHub > Settings > Developer settings > GitHub Apps > *your app* > **About** (numeric “App ID”).
- **Private key** (`--private-key-file` / `privateKeyPem`): same page > **Private keys** > *Generate a private key* — downloads a `.pem` (PKCS#1 `-----BEGIN RSA PRIVATE KEY-----`; PKCS#8 also accepted). Passphrase-protected keys are rejected with guidance.
- **Installation ID** (`--installation-id`): install the app on your account/org, then read it from the installation settings URL `https://github.com/settings/installations/<INSTALLATION_ID>` (or org equivalent). Each account/org the app is installed on has its own installation ID — register one credential entry per installation with a distinct `--name`.
- **Companion PAT** (`--companion-pat-name`, optional): a stored classic PAT **with `repo` scope**. Required only for *automatic* addition of a newly-created repo to a “select repositories” installation (the installation token itself cannot perform that call). Without it, the repo is still created and pushed, and storage-nav prints instructions to add it to the installation via the GitHub UI.

**Required GitHub App permissions**: Administration: Read & write (create repos), Contents: Read & write (push), Metadata: Read-only.

**Recommended approach**: Prefer a **GitHub App** over a long-lived PAT for publication when you want least-privilege, repository-scoped access. Store the App via `add-github-app` so the private key is held in the same AES-256-GCM encrypted store as other secrets; installation access tokens are minted on demand (RS256 JWT → installation token) and **never written to disk**. Use `--github-app-inline` only for ephemeral CI.

**Expiration handling**: GitHub App private keys do not auto-expire but can be rotated/revoked in the app settings. Installation access tokens are short-lived (~1 hour) and regenerated automatically per command, so token expiry is handled transparently. If you rotate the private key, re-run `add-github-app --name <same-name> ...` to overwrite the stored entry. You may record a renewal reminder via the optional `--expires-at` metadata field when set.

**When to use**: Publishing/pushing to GitHub where you want the app constrained to exactly the repositories it created, with the option to extend scope later by installing additional repositories (or adding more installations as separate credential entries).

## Configuration Priority

All secrets follow the resolution chain: inline CLI param → stored credential → interactive prompt. No environment variables or config files are used.

| Setting | Source | Priority |
|---------|--------|----------|
| Storage credentials | `~/.storage-navigator/credentials.json` | Only source |
| Server port | `--port` CLI argument | Only source (default: 3100) |
| Storage selection | `--storage` CLI argument | Explicit > first configured |
| Theme (UI only) | `localStorage` in browser | Persisted per browser |

## Security Considerations

- Credentials are encrypted at rest using AES-256-GCM with a random key
- The encryption key file (`machine.key`) has `0600` permissions (owner read/write only)
- The credential directory (`~/.storage-navigator/`) has `0700` permissions
- Credentials are never logged, exported with secrets, or sent to external services
- The `export` command and API endpoint exclude secrets — only metadata is exported

## Troubleshooting

### "Failed to decrypt credentials"

The encryption key has changed or the credentials file is corrupted. The app will attempt to migrate from old key formats automatically. If migration fails:

1. Check `~/.storage-navigator/machine.key` exists
2. If lost, re-add your storage accounts with `storage-nav add`
3. See `~/ai-coding/claude-workdocs/local-credential-encryption-pitfalls.md` for details on the encryption approach

### Port already in use

```bash
# Use a different port
storage-nav ui --port 3200
```

---

## Agent Subcommand Configuration

The `storage-nav agent` subcommand uses a separate configuration layer in addition to the storage credentials above. Agent configuration lives in `~/.tool-agents/storage-nav/`.

### Precedence policy (Policy B — file-wins)

```
CLI flag > ~/.tool-agents/storage-nav/.env > shell env var > ~/.tool-agents/storage-nav/config.json > throw ConfigurationError (exit 3)
```

The `.env` file in the tool's config folder is the authoritative source for storage-nav agent configuration. Values there override matching shell exports (`dotenv.config({ override: true })`). This way the file you edit is the file that takes effect — generic shell exports of common Azure / OpenAI vars (set for other tools) do not silently shadow your tool-specific preferences. CLI flags still beat both. There is **never** a silent fallback for required settings — missing required value raises a clear error.

### Config folder

Created automatically on first run:

```
~/.tool-agents/storage-nav/
  config.json         Non-secret runtime defaults (mode: standard)
  .env                Secrets and env overrides (mode: 0600)
```

### Global agent env vars

| Variable | Purpose | Required | Default |
|---|---|---|---|
| `STORAGE_NAV_AGENT_PROVIDER` | LLM provider name | Yes | NONE |
| `STORAGE_NAV_AGENT_MODEL` | Model id or deployment name | Yes* | NONE |
| `STORAGE_NAV_AGENT_MAX_STEPS` | Max ReAct iterations | No | 20 |
| `STORAGE_NAV_AGENT_TEMPERATURE` | Sampling temperature | No | 0 |
| `STORAGE_NAV_AGENT_PER_TOOL_BUDGET_BYTES` | Per-tool result byte cap | No | 16384 |
| `STORAGE_NAV_AGENT_ALLOW_MUTATIONS` | Enable mutating tools | No | false |
| `STORAGE_NAV_AGENT_TOOLS` | CSV tool allowlist | No | all read-only |
| `STORAGE_NAV_AGENT_VERBOSE` | Per-step trace to stderr | No | false |
| `STORAGE_NAV_AGENT_SYSTEM_PROMPT` | Inline system prompt | No | built-in default |
| `STORAGE_NAV_AGENT_SYSTEM_PROMPT_FILE` | Path to system prompt file | No | — |

*For `azure-openai`, `AZURE_OPENAI_DEPLOYMENT` is accepted as a fallback when `STORAGE_NAV_AGENT_MODEL` is not set.

### Provider-specific env vars

#### openai

| Variable | Required | How to obtain |
|---|---|---|
| `OPENAI_API_KEY` | Yes | platform.openai.com > API Keys |
| `OPENAI_BASE_URL` | No | Custom proxy endpoint |
| `OPENAI_ORG_ID` | No | platform.openai.com > Settings > Organization |

Recommended storage: shell export or `~/.tool-agents/storage-nav/.env` (mode 0600).

#### anthropic

| Variable | Required | How to obtain |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | console.anthropic.com > API Keys |
| `ANTHROPIC_BASE_URL` | No | Custom proxy endpoint |

Recommended storage: shell export or `.env`.

#### gemini

| Variable | Required | How to obtain |
|---|---|---|
| `GOOGLE_API_KEY` | Yes (or alias) | console.cloud.google.com > APIs & Services > Credentials |
| `GEMINI_API_KEY` | Yes (alias for above) | Same |

#### azure-openai (default)

| Variable | Required | How to obtain |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Yes | Azure Portal > OpenAI resource > Keys and Endpoint |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure Portal > OpenAI resource > Keys and Endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | Azure AI Studio > Deployments tab |
| `AZURE_OPENAI_API_VERSION` | No | Defaults to `2024-10-21` |

Expiration note: Azure OpenAI API keys do not have a built-in expiry but can be rotated. If you rotate keys in Azure Portal, update `AZURE_OPENAI_API_KEY` promptly. Consider adding an `expiresAt` note in `config.json` comments.

#### azure-anthropic (Azure AI Foundry)

| Variable | Required | How to obtain |
|---|---|---|
| `AZURE_AI_INFERENCE_KEY` | Yes | Azure AI Foundry > Project > Keys |
| `AZURE_AI_INFERENCE_ENDPOINT` | Yes | Azure AI Foundry > Project > Endpoints |

Model is set via `STORAGE_NAV_AGENT_MODEL` or `--model` (e.g. `claude-3-5-sonnet`).

#### local-openai (Ollama / LiteLLM / llama.cpp / MLX-LM)

| Variable | Required | How to obtain |
|---|---|---|
| `LOCAL_OPENAI_BASE_URL` | Yes (or alias) | Your local server URL (e.g. `http://localhost:11434/v1`) |
| `OPENAI_BASE_URL` | Alias for above | Same |
| `OLLAMA_HOST` | Alias (appends `/v1`) | Your Ollama host (e.g. `http://localhost:11434`) |
| `OPENAI_API_KEY` | No | Defaults to `not-needed` |

### Quick setup for azure-openai

```bash
# 1. Export required variables in your shell profile (~/.zshrc or ~/.bashrc)
export AZURE_OPENAI_API_KEY="your-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/"
export AZURE_OPENAI_DEPLOYMENT="gpt-4o"

# 2. Run the agent — config folder is created automatically on first run
npx tsx src/cli/index.ts agent "list all containers in my default storage account"
```

### Example .env for azure-openai

`~/.tool-agents/storage-nav/.env` (mode 0600):

```bash
STORAGE_NAV_AGENT_PROVIDER=azure-openai
STORAGE_NAV_AGENT_MODEL=gpt-4o
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

---

## 6. Agent TUI (raw-mode interactive UI)

When you run `storage-nav agent --interactive` from a real terminal, the CLI launches a
raw-mode TUI on top of the LangGraph ReAct agent (token-by-token streaming, multiline
input, ESC-to-abort, slash commands). When stdin is not a TTY (e.g. CI piping prompts in)
the CLI falls back to the existing line-based REPL so scripts keep working.

### Slash commands

All commands are entered at the `You>` prompt. Names are case-sensitive.

| Command | Purpose |
|---|---|
| `/help` | List commands and keybindings. |
| `/quit`, `/exit` | Restore the terminal and exit. |
| `/new` | Start a fresh thread (new MemorySaver state). |
| `/history` | Show the current session's user↔agent turns. |
| `/last` | Re-display the most recent assistant answer. |
| `/copy` | Copy the last assistant answer to the system clipboard (uses `pbcopy` / `xclip` / `xsel` / `clip.exe`). |
| `/memory` | List persistent memory entries. |
| `/memory show <name>` | Show the content of one entry. |
| `/memory add <name> "<content>"` | Add a new entry (use double quotes for multi-word content). |
| `/memory remove <name>` | Remove an entry. |
| `/memory edit <name>` | Open the entry in `$EDITOR`. |
| `/model <name>` | Switch the active model (keeps the current provider). |
| `/provider <name>` | Switch the active provider. Re-loads `~/.tool-agents/storage-nav/.env` (Policy B file-wins). |
| `/tools` | List the active tool catalog with read-only / mutating / destructive tags. |
| `/allow-mutations` | Toggle `cfg.allowMutations` for the current session and rebuild the catalog. Prints a prominent warning when enabling. |

### Persistent memory

Stored at `~/.tool-agents/storage-nav/memory/<name>.md` (folder mode 0700, files mode 0600).
On every turn the TUI rebuilds the system prompt by appending a `## Persistent memory`
section listing each entry's name and content, so the agent sees them automatically.

To override the location for testing:

| Variable | Purpose | Default |
|---|---|---|
| `STORAGE_NAV_AGENT_MEMORY_DIR` | Override the memory folder. | `~/.tool-agents/storage-nav/memory/` |

### TUI logs

The TUI silences stderr (so structured logs don't corrupt the raw-mode UI) and writes the
existing `AgentLogger` output to a per-session file at
`~/.tool-agents/storage-nav/logs/tui-<timestamp>.log` (mode 0600). Override with `--log-file`.

### Confirmation modal for destructive tools

Destructive tools (`delete_blob`, `delete_folder`, `unlink_container`, `remove_storage`,
`delete_storage`, `logout_api_backend`, `remove_token`, `delete_share`, `delete_file`,
`delete_file_folder`) prompt for `y` / `yes` inside the same raw-mode session. The
non-TUI readline confirm is preserved for one-shot mode and non-TTY interactive use.

Note: If `AZURE_OPENAI_API_KEY` is also exported in your shell, the value in this file wins (Policy B — file-wins). To temporarily override, pass `--model` or comment out the line in `.env`.
