# Plan 009 — LangGraph ReAct Agent Subcommand

**Status:** Implemented  
**Date:** 2026-04-24  
**Author:** Claude Sonnet 4.6 (agent build)

---

## 1. Objective

Add a `storage-nav agent` subcommand that runs a LangGraph ReAct agent wrapping all existing CLI commands as LLM tools. The agent supports six LLM providers, read-only mode by default, and optional mutation mode with confirmation prompts for destructive operations.

---

## 2. Command inventory with classification

| CLI command | Agent tool name | Classification |
|---|---|---|
| `list` | `list_storages` | Read-only |
| `containers` | `list_containers` | Read-only |
| `ls` | `list_blobs` | Read-only |
| `view` | `view_blob` | Read-only |
| `download` | `download_blob` | Read-only |
| `list-tokens` | `list_tokens` | Read-only |
| `list-links` | `list_links` | Read-only |
| `diff` | `diff_container` | Read-only |
| `shares` | `list_shares` | Read-only |
| `files` | `list_dir` | Read-only |
| `file-view` | `view_file` | Read-only |
| `add` | `add_storage` | Mutating |
| `add-api` | `add_api_backend` | Mutating |
| `login` | `login_api_backend` | Mutating |
| `create` | `create_blob` | Mutating |
| `rename` | `rename_blob` | Mutating |
| `add-token` | `add_token` | Mutating |
| `clone-github` | `clone_github` | Mutating |
| `clone-devops` | `clone_devops` | Mutating |
| `sync` | `sync_container` | Mutating |
| `link-github` | `link_github` | Mutating |
| `link-devops` | `link_devops` | Mutating |
| `share-create` | `create_share` | Mutating |
| `file-upload` | `upload_file` | Mutating |
| `file-rename` | `rename_file` | Mutating |
| `remove` | `remove_storage` | Mutating + DESTRUCTIVE |
| `delete-storage` | `delete_storage` | Mutating + DESTRUCTIVE |
| `logout` | `logout_api_backend` | Mutating + DESTRUCTIVE |
| `delete` | `delete_blob` | Mutating + DESTRUCTIVE |
| `delete-folder` | `delete_folder` | Mutating + DESTRUCTIVE |
| `remove-token` | `remove_token` | Mutating + DESTRUCTIVE |
| `unlink` | `unlink_container` | Mutating + DESTRUCTIVE |
| `share-delete` | `delete_share` | Mutating + DESTRUCTIVE |
| `file-delete` | `delete_file` | Mutating + DESTRUCTIVE |
| `file-delete-folder` | `delete_file_folder` | Mutating + DESTRUCTIVE |
| `ui` | (skipped — launches UI server) | N/A |

Total: 35 tools (11 read-only, 14 mutating-no-confirm, 10 destructive-with-confirm)

---

## 3. Provider list (standardized set)

| Provider id | Description | SDK class |
|---|---|---|
| `openai` | Direct OpenAI API | `ChatOpenAI` |
| `anthropic` | Direct Anthropic API | `ChatAnthropic` |
| `gemini` | Google Gemini | `ChatGoogleGenerativeAI` |
| `azure-openai` | Azure-hosted OpenAI | `AzureChatOpenAI` |
| `azure-anthropic` | Azure Foundry Anthropic | `ChatAnthropic` + Foundry URL |
| `local-openai` | Local OpenAI-wire-compat | `ChatOpenAI` + custom baseURL |

Default for first deploy: **azure-openai**

---

## 4. Config folder layout

```
~/.tool-agents/storage-nav/
  config.json       (mode: standard, schemaVersion: 1)
  .env              (mode: 0600, commented placeholders only)
  logs/             (agent log files, mode 0600 on create)
```

### Sample config.json

```json
{
  "schemaVersion": 1,
  "provider": "azure-openai",
  "model": "gpt-4o",
  "maxSteps": 20,
  "temperature": 0,
  "perToolBudgetBytes": 16384,
  "allowMutations": false,
  "verbose": false
}
```

---

## 5. Precedence policy

**Policy B — file-wins (default)**

```
CLI flag > ~/.tool-agents/storage-nav/.env > shell env var (STORAGE_NAV_AGENT_*) > ~/.tool-agents/storage-nav/config.json > NONE (throw ConfigurationError, exit 3)
```

Implementation: `dotenv.config({ path: envFilePath, override: true })`

No fallback for required settings. Missing required → `ConfigurationError` with `checkedSources` list.

---

## 6. Module layout

```
src/
  config/
    agent-config.ts          (Unit 2 — config loader)
  util/
    redact.ts                (shared redaction utility)
  agent/
    system-prompt.ts         (Unit 5)
    logging.ts               (Unit 5)
    graph.ts                 (Unit 5)
    run.ts                   (Unit 5)
    providers/
      types.ts               (Unit 3)
      util.ts                (Unit 3)
      openai.ts              (Unit 3)
      anthropic.ts           (Unit 3)
      gemini.ts              (Unit 3)
      azure-openai.ts        (Unit 3)
      azure-anthropic.ts     (Unit 3)
      local-openai.ts        (Unit 3)
      registry.ts            (Unit 3)
    tools/
      types.ts               (Unit 4)
      truncate.ts            (Unit 4)
      confirm.ts             (Unit 4)
      storage-tools.ts       (Unit 4)
      blob-tools.ts          (Unit 4)
      token-tools.ts         (Unit 4)
      repo-tools.ts          (Unit 4)
      share-tools.ts         (Unit 4)
      registry.ts            (Unit 4)
  cli/
    commands/
      agent.ts               (Unit 6)
    index.ts                 (Unit 6 — CLI wiring)

tests/unit/agent/
  agent-config.test.ts
  agent-logging.test.ts
  agent-provider-registry.test.ts
  agent-provider-util.test.ts
  agent-tools-registry.test.ts
  agent-truncate.test.ts

docs/
  reference/
    .env.example
    config.json.example
  design/
    plan-009-agent-subcommand.md (this file)
    configuration-guide.md (updated)
    project-design.md (updated)
    project-functions.md (updated)
```

---

## 7. Implementation decisions (ADRs)

### ADR-001: In-process command invocation
The agent imports and calls command functions directly (`import { listStorages } from '../../cli/commands/list-storages.js'`) rather than spawning child processes. This avoids double startup cost and allows tighter type safety. The trade-off is that `process.exit()` calls inside commands are replaced by error returns in the adapter layer.

### ADR-002: Confirmation via stdin readline for destructive ops
Destructive tools print a summary and read a `y/yes` response from stdin before executing. The tool returns `{ declined: true }` on refusal so the agent can reason about it. This avoids silent data loss.

### ADR-003: diff_container returns link metadata, not full diff
The CLI `diff` command writes formatted table output to console and calls `process.exit`. For agent use, the diff tool returns the link registry metadata (tracked file counts, last sync) which gives the agent enough context to reason without re-implementing the diff engine inline.

### ADR-004: Policy B (file-wins) for dotenv
`dotenv.config({ override: true })` means values in `~/.tool-agents/storage-nav/.env` always replace matching shell exports. Originally Policy A (shell-wins) was chosen but flipped after a real-world incident: a generic `export AZURE_OPENAI_DEPLOYMENT=…` in the user's `~/.zshrc` (set for other Azure tools) silently shadowed the value the user explicitly placed in `.env`. The tool's dedicated config folder is its authoritative source; CLI flags still beat both layers, so one-off overrides remain possible via `--model` etc.

---

## 8. Test coverage

| File | Tests |
|---|---|
| agent-config.test.ts | 22 |
| agent-provider-registry.test.ts | 18 |
| agent-provider-util.test.ts | 8 |
| agent-tools-registry.test.ts | 11 |
| agent-truncate.test.ts | 8 |
| agent-logging.test.ts | 11 |
| **Total new** | **78** |

---

## 9. Documentation checklist

- [x] `docs/design/plan-009-agent-subcommand.md` (this file)
- [x] `docs/reference/.env.example`
- [x] `docs/reference/config.json.example`
- [x] `CLAUDE.md` — `<storage-nav-agent>` tool block
- [x] `docs/design/configuration-guide.md` — agent section
- [x] `docs/design/project-design.md` — Agent Subcommand section
- [x] `docs/design/project-functions.md` — FR-AGT-* section
- [x] `Issues - Pending Items.md` — deferred items registered

---

## 10. Known limitations / deferred items

- `diff_container` tool returns link metadata only, not a full per-file diff. A richer diff adapter is registered in Issues - Pending Items.md.
- `clone-ssh` and `link-ssh` are not exposed as agent tools (SSH key management is interactive and not suitable for agent automation). Registered in Issues.
- No streaming model output (v1 non-goal per spec §2).
- No cross-invocation persistence (in-process `MemorySaver` only).
