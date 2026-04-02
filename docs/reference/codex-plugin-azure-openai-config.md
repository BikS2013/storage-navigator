# Configuring the Codex Claude Code Plugin to Use Azure OpenAI

## Overview

The OpenAI Codex plugin for Claude Code (`codex-plugin-cc`) delegates all work to the local
`@openai/codex` CLI binary. It does not have its own AI client — it inherits whatever
configuration is active for the Codex CLI. This means Azure OpenAI configuration is done
entirely at the Codex CLI level, not inside the plugin itself.

---

## Key Concepts

| Concept | Detail |
|---|---|
| Plugin delegates to | Local `codex` binary installed globally via npm |
| Config file location | `~/.codex/config.toml` (user-level) or `.codex/config.toml` (project-level) |
| Plugin picks up config | Automatically — same config the CLI uses |
| No `codex-companion.mjs` changes needed | The companion script does not handle model routing |

---

## Step-by-Step: Configure Codex CLI for Azure OpenAI

### 1. Create or edit `~/.codex/config.toml`

There are two supported URL patterns depending on your Azure deployment:

**Option A — Using the v1 Responses API (recommended, no `api-version` query param needed)**

```toml
model = "your-deployment-name"    # The deployment name you set in Azure AI Foundry / Azure OpenAI Studio
model_provider = "azure"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
wire_api = "responses"
```

**Option B — Using the preview REST API with `api-version` query parameter**

```toml
model = "your-deployment-name"
model_provider = "azure"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR_PROJECT_NAME.openai.azure.com/openai"
env_key = "AZURE_OPENAI_API_KEY"
query_params = { api-version = "2025-04-01-preview" }
wire_api = "responses"
```

**Option C — Cognitive Services endpoint (use if you get 404 with the standard URL)**

```toml
[model_providers.azure]
base_url = "https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com/openai"
env_key = "AZURE_OPENAI_API_KEY"
query_params = { api-version = "2025-04-01-preview" }
wire_api = "responses"
```

### 2. Set the environment variable

```bash
export AZURE_OPENAI_API_KEY="your-azure-openai-key-here"
```

Add this to `~/.zshrc` or `~/.bash_profile` to persist across sessions.

**Important:** The `env_key` field in `config.toml` is the name of an environment variable,
not the key value itself. The key must be set as an env var.

### 3. Verify the setup

```bash
codex -p azure "hello"
```

Or run inside Claude Code:

```
/codex:setup
```

---

## Project-Level Configuration

To scope the Azure provider to a specific project without changing the global config, create
`.codex/config.toml` at the root of the project directory:

```toml
model = "your-deployment-name"
model_provider = "azure"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
wire_api = "responses"
```

Note: Project-level config is only loaded when the project is marked as **trusted** by Codex.

---

## Using a Proxy / Simple Base URL Override

If you only need to redirect the built-in `openai` provider to a different endpoint (e.g., an
Azure AI proxy that exposes the standard OpenAI API shape), you can skip defining a full
provider block and use `openai_base_url` instead:

```toml
openai_base_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1"
```

This is the lightest-weight option and works if your proxy accepts the standard OpenAI API key
header. The Codex plugin README explicitly mentions this field as the way to redirect the
built-in OpenAI provider to a different endpoint.

---

## How the Claude Code Plugin Picks Up the Config

The `codex-plugin-cc` plugin:

1. Locates the `codex` binary from the system PATH
2. Invokes it for review/rescue/status operations via the Codex app server
3. The Codex binary loads `~/.codex/config.toml` (and optionally `.codex/config.toml` in the
   project root) before making any API calls
4. No additional environment variable injection is needed inside Claude Code itself

The plugin README states: "Because the plugin uses your local Codex CLI, your existing sign-in
method and config still apply."

---

## Environment Variable Summary

| Variable | Required | Purpose |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Yes (when `env_key = "AZURE_OPENAI_API_KEY"`) | API key for Azure OpenAI resource |
| `OPENAI_API_KEY` | Not needed for Azure | Standard OpenAI key — not used for Azure provider |

The variable name in `env_key` is arbitrary — you can name it anything as long as the
`config.toml` `env_key` value and the actual exported environment variable name match.

---

## OpenAI Node SDK (for custom scripts like `codex-companion.mjs`)

If the project uses a custom `codex-companion.mjs` that calls the OpenAI Node SDK directly
(rather than delegating to the `codex` binary), the SDK must be initialized as `AzureOpenAI`,
not `OpenAI`:

```typescript
import { AzureOpenAI } from 'openai';

const client = new AzureOpenAI({
  apiVersion: '2024-10-01-preview',
  endpoint: process.env['AZURE_OPENAI_ENDPOINT'],  // e.g. https://yourresource.openai.azure.com
  apiKey: process.env['AZURE_OPENAI_API_KEY'],
});
```

Relevant environment variables for the SDK path:

| Variable | Purpose |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Full resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | API key |
| `OPENAI_API_VERSION` | API version string, e.g. `2024-10-01-preview` |

Note: `OPENAI_API_BASE` and `OPENAI_API_TYPE` are legacy variables from the older
`openai` Python SDK (v0.x) and are not used by the current Node SDK or Codex CLI.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Pointing to `/chat/completions` endpoint | Use `/openai/v1` (Responses API) or `/openai` with `api-version` query param |
| Setting `env_key = "sk-..."` directly | `env_key` must be the name of an env var, not the key value |
| Not including `/v1` in the base_url for Option A | Required when using `wire_api = "responses"` without `api-version` |
| Launching VS Code/Claude Code from an app launcher | API key env var may not be inherited; launch from the terminal where the var is set |

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| The `codex-companion.mjs` script delegates to the `codex` binary rather than calling OpenAI SDK directly | HIGH | If it calls the SDK directly, the Node SDK `AzureOpenAI` initialization section becomes the primary path |
| The Codex CLI version in use is the current Rust-based release (not the legacy TS version) | HIGH | Legacy TS version had different config file format |
| Azure deployment uses the Responses API (`wire_api = "responses"`) | MEDIUM | Chat Completions endpoint uses a different URL path and does not need `wire_api` |

### Clarifying Questions

1. Does `codex-companion.mjs` in this project call the OpenAI Node SDK directly, or does it
   shell out to the `codex` binary? If the former, the SDK-level configuration section applies
   directly.
2. Is the Azure deployment using the AI Foundry / Azure OpenAI Service endpoint
   (`*.openai.azure.com`) or the Cognitive Services endpoint (`*.cognitiveservices.azure.com`)?
3. Is the target model deployed as a standard deployment or a serverless/provisioned-throughput
   deployment? This affects the URL structure.

---

## References

- [Codex CLI README (legacy TS)](https://github.com/openai/codex/blob/main/codex-cli/README.md) — Custom provider config, `--provider azure` flag
- [Codex Advanced Config](https://developers.openai.com/codex/config-advanced) — `model_providers.azure`, `openai_base_url`, `query_params`
- [codex-plugin-cc GitHub](https://github.com/openai/codex-plugin-cc) — Plugin architecture, config inheritance, `openai_base_url` tip
- [Microsoft Learn: Codex with Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/codex) — Azure-specific setup walkthrough
- [Microsoft DevBlog: Codex Azure Integration](https://devblogs.microsoft.com/all-things-azure/codex-azure-openai-integration-fast-secure-code-development/) — Endpoint format details
- [OpenAI Node SDK — Azure docs](https://github.com/openai/openai-node/blob/master/azure.md) — `AzureOpenAI` client initialization
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference) — Plugin env var injection via `hooks.json` / `.mcp.json`
- [OpenAI Community: Custom base URL issues](https://community.openai.com/t/cant-setup-codex-cli-with-custom-base-url-and-api-key-via-terminal-env-variables-or-command-options/1363678) — Common pitfalls
