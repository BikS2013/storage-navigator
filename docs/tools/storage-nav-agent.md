<storage-nav-agent>
    <objective>
        Run a LangGraph ReAct agent over storage-nav. The agent wraps all existing CLI commands as LLM tools and supports natural language queries against Azure Blob Storage and Azure File Shares. Supports one-shot prompts and an interactive REPL. Six LLM providers are supported.
    </objective>
    <command>
        npx tsx src/cli/index.ts agent [prompt] [options]
    </command>
    <info>
        The agent subcommand wires a LangGraph ReAct loop over storage-nav's existing command modules. Tool results are byte-budget capped (default 16 KiB). Destructive operations require explicit runtime confirmation.

        Config folder (created on first run, never in the repo):
          ~/.tool-agents/storage-nav/
            config.json     Non-secret runtime defaults (schemaVersion: 1)
            .env            Secrets (mode 0600; values here win over shell exports)

        Precedence (Policy B — file-wins):
          CLI flag > ~/.tool-agents/storage-nav/.env > shell env var (STORAGE_NAV_AGENT_*) > ~/.tool-agents/storage-nav/config.json > throw ConfigurationError (exit 3)

        Providers:
          openai          Direct OpenAI API (OPENAI_API_KEY required)
          anthropic       Direct Anthropic API (ANTHROPIC_API_KEY required)
          gemini          Google Gemini (GOOGLE_API_KEY or GEMINI_API_KEY required)
          azure-openai    Azure-hosted OpenAI (AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT required)
          azure-anthropic Azure Foundry Anthropic (AZURE_AI_INFERENCE_KEY, AZURE_AI_INFERENCE_ENDPOINT required)
          local-openai    Local OpenAI-wire-compat (LOCAL_OPENAI_BASE_URL or OLLAMA_HOST required)

        Options:
          [prompt]                   One-shot prompt (required unless --interactive)
          -i, --interactive          Interactive mode. When stdin is a TTY, launches the
                                     raw-mode TUI (token streaming, multiline input, ESC
                                     aborts a turn, slash commands /help /quit /exit /new
                                     /history /last /copy /memory /model /provider /tools
                                     /allow-mutations). When stdin is NOT a TTY (CI / piped
                                     input), falls back to the legacy line-based REPL with
                                     /exit and /reset.
          -p, --provider <name>      LLM provider (see list above)
          -m, --model <id>           Model id or deployment name
          --base-url <url>           Override provider base URL (useful for local-openai)
          --max-steps <n>            ReAct iteration cap (default: 20)
          --temperature <t>          Sampling temperature (default: 0)
          --system <text>            Inline system prompt override
          --system-file <path>       Path to system prompt file
          --tools <csv>              Comma-separated tool name allowlist
          --per-tool-budget <bytes>  Per-tool result byte cap (default: 16384)
          --allow-mutations          Enable state-changing tools (off by default)
          --config <path>            Override config.json path
          --env-file <path>          Override .env path
          --log-file <path>          Write redacted log to file (mode 0600)
          --quiet                    Suppress stderr (still writes log file)
          --verbose                  Emit per-step trace to stderr

        Tool catalog (read-only, always available):
          list_storages, list_containers, list_blobs, view_blob, download_blob,
          list_tokens, list_links, diff_container, list_shares, list_dir, view_file

        Mutation tools (only with --allow-mutations):
          Non-destructive: add_storage, add_api_backend, login_api_backend, create_blob,
            rename_blob, add_token, clone_github, clone_devops, sync_container,
            link_github, link_devops, create_share, upload_file, rename_file
          Destructive (require y/yes confirmation):
            remove_storage, delete_storage, logout_api_backend, delete_blob,
            delete_folder, remove_token, unlink_container, delete_share,
            delete_file, delete_file_folder

        Exit codes (inherits project taxonomy):
          0   Success
          1   Unexpected error
          2   Usage error (bad flag, missing prompt)
          3   Configuration error (missing required env var)
          130 SIGINT during interactive mode

        Examples:

          # One-shot with default azure-openai provider (set env vars first)
          export AZURE_OPENAI_API_KEY="..." AZURE_OPENAI_ENDPOINT="..." AZURE_OPENAI_DEPLOYMENT="gpt-4o"
          npx tsx src/cli/index.ts agent "list all containers in my default storage account"

          # Interactive TUI with azure-openai (token-by-token streaming, ESC to abort)
          npx tsx src/cli/index.ts agent --interactive --provider azure-openai --model gpt-4o
          # Force legacy line-based REPL (e.g. for CI smoke tests)
          npx tsx src/cli/index.ts agent --interactive < script-of-prompts.txt

          # Interactive with Ollama (local)
          OLLAMA_HOST=http://localhost:11434 npx tsx src/cli/index.ts agent \
            --provider local-openai --model llama3.1 --interactive

          # One-shot with mutations enabled and verbose output
          npx tsx src/cli/index.ts agent --allow-mutations --verbose \
            "rename blob 'old-config.json' to 'config.json' in container prompts"

          # Restrict to specific tools
          npx tsx src/cli/index.ts agent --tools list_blobs,view_blob \
            "show me the content of the coa-extraction prompt file"

        TUI persistence and logs:
          ~/.tool-agents/storage-nav/memory/<name>.md   Persistent memory entries (mode 0600)
                                                         Injected into the system prompt as a
                                                         "## Persistent memory" section on every
                                                         turn. Manage via /memory list / show /
                                                         add / remove / edit (uses $EDITOR).
          ~/.tool-agents/storage-nav/logs/tui-<ts>.log  Per-session structured log (mode 0600).
                                                         The TUI silences stderr to keep the
                                                         raw-mode UI clean; --log-file overrides
                                                         this default location.
          STORAGE_NAV_AGENT_MEMORY_DIR                  Override the memory folder location
                                                         (used by tests; rarely needed in
                                                         production).

        TUI keybindings (also shown by /help inside the TUI):
          Enter                    Submit input.
          Shift+Enter / Ctrl+J     Insert newline. Shift+Enter is unreliable across
                                   terminals (Apple Terminal/iTerm2 default settings send
                                   plain CR); Ctrl+J is the universal fallback.
          ESC during execution     Abort the in-flight model turn (stays in TUI).
          Ctrl+C during input      Cancel current input (does not exit).
          Ctrl+C twice / Ctrl+D    Exit the TUI.
          ←/→ Home/End Ctrl+A/E    Cursor motion within the active line.
          Option+←/→ Ctrl+←/→      Word motion.
          ↑/↓                      Line nav within input; at edges, browse history.
          Ctrl+W Ctrl+U Ctrl+K     Edit (word back / line start / line end).

        TUI safety:
          Destructive tool calls (delete_blob, delete_folder, unlink_container, …) are
          gated by an in-TUI confirmation modal that runs against the same raw-mode stdin
          (no second readline interface). Outside the TUI the existing readline confirm
          path is unchanged.
    </info>
</storage-nav-agent>
