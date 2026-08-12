<structure-and-conventions>
## Structure & Conventions — Documentation Map

<!-- Maintained automatically. The master copy lives at
     ~/.claude/structure-and-conventions.md (claude-workdocs repo) and the SessionStart
     hook ~/.claude/scripts/sync-claude-md.sh keeps this copy of the block up to date —
     edit the master, never this block. The block is committed with the repository on
     purpose: it tells anyone (human or agent) working with this repo where the
     project's documentation lives and how to read and maintain it. -->

### Where the documentation lives

- `docs/plans/` — every plan, one file per plan, named `plan-NNN-<indicative-description>.md`.
- `docs/design/` — all other planning and design documents:
  - `project-design.md` — the complete, always-current project design; update it with every new design or design change.
  - `project-functions.md` — the registry of all functional requirements and feature descriptions.
  - `configuration-guide.md` — the project's configuration guide, when one exists (structure below).
- `docs/reference/` — all reference material collected for the project.
- `docs/refined_requests/` — every refined request specification (create the folder if missing), one file per request named `refined-request-NNN-<slug>.md`. `NNN` is a zero-padded three-digit sequential number: the next number is the highest `NNN` already present in the folder plus one, starting at `001`. `<slug>` is the request slug reused by all downstream artifacts of the same request.
- `docs/prompts/` — every prompt created while working on the project (create the folder if missing), one file per prompt named `NNN-<indicative-description>.md`. `NNN` is a zero-padded three-digit sequential number: the next number is the highest `NNN` already present in the folder plus one, starting at `001`. The description states the prompt's use and purpose.
- `docs/tools/<tool-name>.md` — one dedicated documentation file per project tool.
- `test_scripts/` — every test script goes here; create the folder if it doesn't exist.
- `Issues - Pending Items.md` (project root) — the register of every issue, pending item, inconsistency, or discrepancy detected while working on the project. Pending items come first (most critical and important on top), completed items after. Whenever a defect or issue is fixed, check this file for an item to remove.

### How to use the documentation

- Every time an issue is solved, it must be resolved AND both the issue and the solution must be thoroughly documented.
- This file's "Tools" section (when present) lists each project tool with a one-or-two-sentence description of what it is capable of and the relative path to its dedicated documentation file under `docs/tools/` — retrieve the full documentation from there whenever it is needed. Full tool documentation must never be inlined into this file.
- Before writing any code script, consult the "Tools" section and the documentation under `docs/tools/` to check whether the planned code fits the scope of an existing tool. If so, implement it as an extension of that tool; otherwise build a generic, abstract version of the code as a new tool in the project's toolset, document it under `docs/tools/`, and reference it in the "Tools" section. The goal is to progressively grow the tools needed to test, evaluate, generate data, collect information, etc., and reuse them consistently.

<configuration-guide>
- A configuration guide, when requested, is created at `docs/design/configuration-guide.md` and explains:
  - When multiple configuration options exist (config file, env variables, CLI params, etc.), what the options are and the priority of each one.
  - The purpose and use of each configuration variable.
  - How the user can obtain such a configuration variable.
  - The recommended approach for storing or managing the variable.
  - Which options exist for the variable and what each option means for the project.
  - Any default value the parameter has.
  - For configuration parameters that expire (e.g., PAT keys, tokens), propose adding a parameter that captures the expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

</structure-and-conventions>

---

# Storage Navigator

Azure Blob Storage Navigator — browse containers and view files through CLI or desktop UI.

## Tools

### storage-nav

CLI and Electron desktop app for browsing Azure Blob Storage and Azure File Shares. Manages encrypted credentials (PATs and GitHub Apps), clones/syncs GitHub and Azure DevOps repos into containers, diffs containers against linked repos, and publishes (pushes) blob containers, prefixes, or whole storage accounts back to GitHub / Azure DevOps repositories via the reverse-git subsystem. Supports GitHub App installation-token authentication for scoped repository access. Browsing and forward repo sync (link / clone / sync / diff) work against both `direct` and `api` storage backends; reverse-git publication is direct-only.

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
