<structure-and-conventions>
## Structure & Conventions

### Project Artifacts & Layout

- Test scripts go in the `test_scripts` folder; create the folder if it doesn't exist.
- Plans live under `docs/design/`, one file per plan, named `plan-NNN-<indicative-description>.md`.
- The complete project design is maintained in `docs/design/project-design.md`; update it with each new design or design change.
- All reference material used for the project is collected and kept under `docs/reference/`.
- All functional requirements and feature descriptions are registered in `docs/design/project-functions.md`.
- Every prompt created while working in a project goes in a dedicated `prompts` folder (create it if missing); each prompt file name has a sequential number prefix and is representative of the prompt's use and purpose.
- Maintain `Issues - Pending Items.md` at the project root: register every issue, pending item, inconsistency, or discrepancy you detect, and whenever you fix a defect or issue, check the file for an item to remove. Pending items come first (most critical and important on top), completed items after.
- Every time you are asked to solve an issue, you must resolve it AND thoroughly document both the issue and the solution.

<configuration-guide>
- If the user asks for a configuration guide, create it at `docs/design/configuration-guide.md` and make sure it explains:
  - When multiple configuration options exist (config file, env variables, CLI params, etc.), what the options are and the priority of each one.
  - The purpose and use of each configuration variable.
  - How the user can obtain such a configuration variable.
  - The recommended approach for storing or managing the variable.
  - Which options exist for the variable and what each option means for the project.
  - Any default value the parameter has.
  - For configuration parameters that expire (e.g., PAT keys, tokens), propose adding a parameter that captures the expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

### Tools

- Tools created in the context of a project are always written in TypeScript.
- **Tool creation is MANDATORY via `/tool-conventions scaffold <tool-name>`.** Do NOT scaffold a tool's documentation file or its `~/.tool-agents/<tool-name>/` configuration folder by hand under any circumstances. The slash command dispatches the `tool-doc-config-architect` subagent (`~/.claude/agents/tool-doc-config-architect.md`), which owns the full specification — the documentation file format (the `<toolName>` XML block under `docs/tools/<tool-name>.md`), the configuration folder structure and modes (`~/.tool-agents/<tool-name>/` at `0700`, `.env` at `0600`), the four-tier env-var resolution chain (shell env → `~/.tool-agents/<name>/.env` → local `.env` → CLI flags, lowest to highest priority), the vendor-canonical LLM provider env-var names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_OPENAI_*`, `AZURE_AI_INFERENCE_*`, `OLLAMA_HOST`, `LITELLM_*`), and the required set of eight standard LLM providers every LLM-enabled tool must support out of the box. Read the subagent prompt to inspect the full specification. For existing tools, run `/tool-conventions audit <tool-name>` to verify conformance.
- The project's CLAUDE.md must NOT contain full tool documentation. It must contain a "Tools" section with a concise entry per tool: the tool's name, a one-or-two-sentence description of what it is capable of, and the relative path to its dedicated documentation file (e.g. `docs/tools/<tool-name>.md`) so the full documentation can be retrieved any time it is needed. The slash command produces the recommended entry text after each scaffold.
- Before writing any code script, examine the tools already implemented in the project (via the "Tools" section of the project's CLAUDE.md and the documentation under `docs/tools/`) to detect whether the planned code fits the scope of an existing tool. If so, implement it as an extension of that tool; otherwise build a generic, abstract version of the code as a new tool in the project's toolset. The goal is to progressively grow the tools needed to test, evaluate, generate data, collect information, etc., and reuse them consistently — all referenced in the project's CLAUDE.md.

### General Rules

- When asked to locate code, report the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version-control operation unless explicitly requested.
- Database table naming: table names must be singular (e.g. the table keeping customers' data is `Customer`). Tables expressing references from one entity to another may be plural when the first entity links to many of the second — so with `Customer` and `Transaction` tables, the link table is `CustomerTransactions`.
- NEVER create fallback solutions for configuration settings. Whenever a configuration setting is not provided, raise the appropriate exception — never substitute the missing value with a default or fallback. If the user explicitly asks for an exception to this rule, write the exception in the project's memory file before implementing it.

<dependency-vetting>
- Before adding ANY new runtime dependency to a project (`package.json`, `pyproject.toml`, `go.mod`, etc.), you MUST verify the version you are about to pin is free of known security advisories. Apply this rule especially to:
  - **Browser/embedded-engine packages:** `electron`, `puppeteer`, `playwright`, `chromium`, `webview2` — they ship with full browser engines and accumulate CVEs fast.
  - **Test/build toolchains:** `vitest`, `vite`, `esbuild`, `webpack`, `rollup`, `parcel` — frequent dev-server-RCE advisories with transitive impact.
  - **Network/proxy libraries:** `node-http-proxy`, `http-proxy-3`, `proxy-chain`, `axios`, `node-fetch`, `request`, `got`, `undici`.
  - **Cryptography / auth libraries:** `jsonwebtoken`, `jose`, `bcrypt`, `node-forge`, `crypto-js`.

- Vetting procedure (run BEFORE writing the dependency into the manifest):
  1. Identify the latest stable major version available on the registry (e.g. `npm view <pkg> versions --json | tail -10` or `pnpm info <pkg> versions --json`).
  2. Check the package's security advisory page (GitHub Advisory Database, npmjs.com vulnerability tab, or `npm audit --package <pkg>@<version> --json`) for the candidate version.
  3. If the candidate version has unfixed advisories at HIGH severity or above, bump to the next non-vulnerable major (or, if no such version exists, surface the trade-off to the user via AskUserQuestion before proceeding).
  4. Pin to a caret range against the verified clean version (e.g. `"electron": "^39.8.5"`, not `"electron": "^38"`).
  5. Record the vetted-on date in a one-line comment in `Issues - Pending Items.md` under a "Dependency vetting log" section so future audits can date the decision.

- For ESPECIALLY fast-moving packages (`electron`, `vite`, `vitest`, `esbuild`), ALWAYS pull the latest stable major even when a reference implementation uses an older one. The reference's version is informational, not authoritative — verify it is still on a supported branch before adopting it verbatim.

- After installing, ALWAYS run the project's audit command (`pnpm audit`, `npm audit`, `pip-audit`, `cargo audit`, `go list -m -u -json all | nancy sleuth`, etc.) and confirm the advisory count is zero before marking the scaffolding step complete. Treat any HIGH-or-above advisory as a blocker; surface it before continuing.

- When a transitive dependency carries an advisory that the direct dependency has not yet fixed (e.g. `vitest@1` pulling `vite@5` with a CVE), use the package manager's override mechanism (`pnpm.overrides`, `npm overrides`, `yarn resolutions`, `cargo [patch]`) to force the fixed transitive version, AND document the override in `Issues - Pending Items.md` with its expiry condition (i.e. "remove this override once direct-dep X reaches version Y").
</dependency-vetting>

</structure-and-conventions>

---

# Storage Navigator

Azure Blob Storage Navigator — browse containers and view files through CLI or desktop UI.

## Tools

### storage-nav

CLI and Electron desktop app for browsing Azure Blob Storage and Azure File Shares. Manages encrypted credentials (PATs and GitHub Apps), clones/syncs GitHub and Azure DevOps repos into containers, diffs containers against linked repos, and publishes (pushes) blob containers, prefixes, or whole storage accounts back to GitHub / Azure DevOps repositories via the reverse-git subsystem. Supports GitHub App installation-token authentication for scoped repository access.

Full documentation: [docs/tools/storage-nav.md](docs/tools/storage-nav.md)

<reverseGit>
    <objective>
        Publish (push) Azure Blob containers, prefixes, or whole storage accounts back to GitHub or Azure DevOps repositories. Tracks per-link ETag snapshots so subsequent pushes are incremental (add / modify / delete). Pure REST — no local Git clone, no Git binary, no LFS.
    </objective>
    <command>
        npx tsx src/cli/index.ts publish-github  --repo <owner/repo> [--container <c>] [--prefix <p>] [--branch <b>] [--create-repo] [...]
        npx tsx src/cli/index.ts publish-devops  --org <o> --project <p> --repo <name> [scope flags] [...]
        npx tsx src/cli/index.ts reverse-link-github --repo <owner/repo> [scope flags]   # create link, do NOT push
        npx tsx src/cli/index.ts reverse-link-devops --org <o> --project <p> --repo <r> [scope flags]
        npx tsx src/cli/index.ts push [--container <c>] [--prefix <p>] [--link-id <uuid> | --all] [--dry-run] [--force] [--allow-overwrite-remote]
        npx tsx src/cli/index.ts reverse-unlink --link-id <uuid> [--container <c>] [--yes]
        npx tsx src/cli/index.ts list-reverse-links [--container <c>] [--prefix <p>]
    </command>
    <info>
        Seven subcommands implementing the design's reverse-git surface
        (docs/design/project-design.md §4.1 — CLI subcommand matrix):

          publish-github / publish-devops
            Create a reverse-link AND immediately push the current scope
            contents. First push creates the repo when --create-repo is set
            (GitHub uses `auto_init: true`; ADO inherits visibility from the
            parent project). Subsequent runs push only the diff.

          reverse-link-github / reverse-link-devops
            Create the link record but do NOT push. Useful when the user
            wants to inspect the planned scope, set exclusions, then run
            `push --dry-run` before the first real push.

          push
            Execute a push for one or more existing reverse-links.
            Selection precedence: --link-id (exact) > --all > scope flags.
            --all and --link-id are mutually exclusive.
            --dry-run            Compute the diff but DO NOT push.
            --force              Re-classify every tracked file as modified
                                  (re-pushes everything).
            --allow-overwrite-remote
                                 Force-update the remote ref when the
                                  branch diverged since the last push.
                                  Default OFF — divergence is fatal (exit 2).

          reverse-unlink
            Drop a link record. NEVER touches the remote repository.
            Prompts for confirmation unless --yes is passed.

          list-reverse-links
            Tabular enumeration of every reverse-link rooted at the scope.

        Scope flags (all subcommands):
          --container <name>   Container scope (one repo per container)
          --prefix <p>         Prefix scope (requires --container)
          (none)               Account scope — every container becomes a
                                top-level folder in the repo. USE SPARINGLY:
                                the engine streams every blob in the
                                account through the diff.

        Common chain (matches plan-005 / plan-007):
          --storage <name>     Stored storage entry to use (default: first)
          --account <name>     Inline account name (with --account-key / --sas-token)
          --account-key <k>    Inline account key
          --sas-token <t>      Inline SAS token
          --token-name <name>  Stored PAT name (default: first matching provider)
          --pat <inline>       Inline PAT (overrides stored)

        Target flags (publish-* and reverse-link-*):
          --repo <id>          GitHub: owner/repo or full URL.
                                ADO: bare repo name (with --org/--project)
                                     or full repo URL.
          --org / --project    ADO only — required when --repo is a bare name.
          --branch <name>      Target branch (default: main)
          --commit-message <m> Override the default commit message
          --exclude <pattern>  Repeatable glob exclusion
          --no-respect-gitignore
                               Ignore any .gitignore at the scope root
          --repo-sub-path <p>  Sub-folder inside the target repo
          --visibility <v>     public | private (default: private)
                                Used only when --create-repo creates the repo.
                                Ignored for Azure DevOps.
          --create-repo        Auto-create the remote repo when absent
          --author-name <n>    Commit author name
                                (default: "Storage Navigator")
          --author-email <e>   Commit author email
                                (default: "storage-nav@local")

        Tri-state exit codes (per plan-005 / R10.11):
          0 = success / no-op
          1 = changes pushed (or would be pushed under --dry-run)
          2 = fatal error (auth, divergence, rate-limit, …)
          3 = configuration error (missing required value)

        Examples:
          # First publish of a container — create the repo if missing
          npx tsx src/cli/index.ts publish-github \
              --container my-docs --repo myorg/my-docs --create-repo --visibility private

          # Dry-run a push to see what would change
          npx tsx src/cli/index.ts push --container my-docs --dry-run

          # Force-push when the branch diverged
          npx tsx src/cli/index.ts push --link-id 1234abcd-... --allow-overwrite-remote

          # List every reverse-link recorded for a container
          npx tsx src/cli/index.ts list-reverse-links --container my-docs

          # Remove a link without touching the remote
          npx tsx src/cli/index.ts reverse-unlink --link-id 1234abcd-... --container my-docs --yes
    </info>
</reverseGit>

### storage-nav-api

HTTP API (in `API/`) that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (StorageReader, StorageWriter, StorageAdmin), plus an optional static auth header. Designed as a third backend type for the Storage Navigator client.

Full documentation: [docs/tools/storage-nav-api.md](docs/tools/storage-nav-api.md)

### storage-nav-agent

LangGraph ReAct agent (`agent` subcommand) that wraps storage-nav's CLI commands as LLM tools, with one-shot and interactive TUI modes, six provider backends (OpenAI, Anthropic, Gemini, Azure OpenAI, Azure Anthropic, local OpenAI-wire), persistent memory, and confirmation-gated mutations.

Full documentation: [docs/tools/storage-nav-agent.md](docs/tools/storage-nav-agent.md)

@~/.claude/pre-implementation-pipeline.md
