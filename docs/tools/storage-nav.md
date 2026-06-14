<storage-nav>
    <objective>
        Navigate Azure Blob Storage accounts — list containers, browse blobs, view files (JSON, markdown, text, PDF, DOCX), manage encrypted credentials, clone and sync GitHub/Azure DevOps repositories into containers.
    </objective>
    <command>
        npx tsx src/cli/index.ts <command> [options]
    </command>
    <info>
        CLI and Electron desktop app for browsing Azure Blob Storage. Supports multiple storage accounts with encrypted SAS token / account key storage.

        Credentials are stored encrypted (AES-256-GCM) at ~/.storage-navigator/credentials.json using a persisted random key.

        Secret Resolution Chain (all commands):
          1. Inline CLI parameter (--account-key, --sas-token, --pat) — used if provided
          2. Stored credential from encrypted credential store (--storage, --token-name)
          3. Interactive prompt — asks user, offers to store for future use

        Source: src/core/ (credential-store.ts, blob-client.ts, types.ts), src/cli/ (commands/shared.ts), src/electron/

        Commands:
          add          Add a new storage account
            --name <name>         Display name
            --account <account>   Azure Storage account name
            --account-key <key>   Account key (recommended, full access)
            --sas-token <token>   SAS token (alternative, may have scope limits)

          list         List configured storage accounts
          remove       Remove a storage account (--name <name>) — silent, no confirmation

          delete-storage  Delete a storage account from the local credential store (asks for confirmation)
            --name <name>         Name of the storage to delete
            --force               Skip the confirmation prompt
            Note: only the locally stored credential is removed. The Azure
            storage account and its blobs are NOT touched.

          containers   List containers (--storage <name>)
          ls           List blobs (--container <name> --storage <name> --prefix <path>)
          view         View a blob (--container <name> --blob <path> --storage <name>)
          download     Download a blob (--container <name> --blob <path> --output <file>)

          All blob commands (containers, ls, view, download, rename, delete, delete-folder, create) accept:
            --account-key <key>   Inline account key (overrides stored credential)
            --sas-token <token>   Inline SAS token (overrides stored credential)
            --account <account>   Azure Storage account name (required with inline key/token)

          rename       Rename a blob (copy + delete)
            --container <name>    Container name
            --blob <path>         Current blob path
            --new-name <path>     New blob path
            --storage <name>      Storage account (optional)

          delete       Delete a blob (asks for confirmation)
            --container <name>    Container name
            --blob <path>         Blob path to delete
            --storage <name>      Storage account (optional)

          delete-folder  Delete all blobs under a prefix/folder (asks for confirmation)
            --container <name>    Container name
            --prefix <path>       Folder prefix to delete
            --storage <name>      Storage account (optional)

          create       Create/upload a new blob
            --container <name>    Container name
            --blob <path>         Destination blob path
            --file <path>         Local file to upload (or use --content)
            --content <text>      Inline text content (or use --file)
            --storage <name>      Storage account (optional)

          add-token    Add a personal access token (GitHub or Azure DevOps)
            --name <name>         Display name for the token
            --provider <provider> Token provider (github or azure-devops)
            --token <token>       Personal access token value
            --expires-at <date>   Token expiration date (ISO 8601, optional)

          list-tokens  List configured personal access tokens
          remove-token Remove a personal access token (--name <name>)

          add-github-app  Add a GitHub App credential for installation-token authentication
            --name <name>           Display name for the GitHub App
            --app-id <id>           GitHub App ID (numeric, from app settings)
            --installation-id <id>  Installation ID for the target account/org
            --private-key-file <path>  Path to private key PEM file
            --client-id <id>        OAuth client ID (optional, reserved for future)
            --client-secret <secret>  OAuth client secret (optional, reserved for future)
            --companion-pat-name <name>  Stored PAT name for repository scope addition (optional)
            --expires-at <date>     Private key expiration date (ISO 8601, optional)

          list-github-apps  List configured GitHub App credentials
          remove-github-app  Remove a GitHub App credential (--name <name>)

          clone-github Clone a GitHub repository into a blob container
            --repo <url>          GitHub repository URL
            --container <name>    Target container name
            --branch <branch>     Branch to clone (optional, defaults to repo default)
            --prefix <path>       Target folder prefix within container (optional)
            --repo-path <path>    Sub-path within the repo to sync (optional)
            --storage <name>      Storage account (optional)
            --token-name <name>   PAT token name (optional, uses first GitHub token)
            --pat <token>         Inline GitHub PAT (overrides stored token)

          clone-devops Clone an Azure DevOps repository into a blob container
            --repo <url>          Azure DevOps repository URL
            --container <name>    Target container name
            --branch <branch>     Branch to clone (optional, defaults to repo default)
            --prefix <path>       Target folder prefix within container (optional)
            --repo-path <path>    Sub-path within the repo to sync (optional)
            --storage <name>      Storage account (optional)
            --token-name <name>   PAT token name (optional, uses first Azure DevOps token)
            --pat <token>         Inline Azure DevOps PAT (overrides stored token)

          sync         Sync a previously cloned container with its remote repository
            --container <name>    Container name
            --storage <name>      Storage account (optional)
            --dry-run             Show what would change without making changes
            --prefix <path>       Sync only the link at this prefix (for multi-link containers)
            --link-id <id>        Sync a specific link by ID
            --all                 Sync all links in the container
            --pat <token>         Inline PAT (overrides stored token)
            --token-name <name>   PAT token name

          link-github  Link a GitHub repository to a container folder (metadata only, no download)
            --repo <url>          GitHub repository URL
            --container <name>    Target container name
            --branch <branch>     Branch (optional, defaults to repo default)
            --prefix <path>       Target folder prefix within container (optional)
            --repo-path <path>    Sub-path within the repo to sync (optional)
            --storage <name>      Storage account (optional)
            --token-name <name>   PAT token name (optional)
            --pat <token>         Inline GitHub PAT (optional)

          link-devops  Link an Azure DevOps repository to a container folder (metadata only, no download)
            --repo <url>          Azure DevOps repository URL
            --container <name>    Target container name
            --branch <branch>     Branch (optional, defaults to repo default)
            --prefix <path>       Target folder prefix within container (optional)
            --repo-path <path>    Sub-path within the repo to sync (optional)
            --storage <name>      Storage account (optional)
            --token-name <name>   PAT token name (optional)
            --pat <token>         Inline Azure DevOps PAT (optional)

          unlink       Remove a repository link from a container (files are NOT deleted)
            --container <name>    Container name
            --link-id <id>        Link ID to remove (optional)
            --prefix <path>       Folder prefix to unlink (optional)
            --storage <name>      Storage account (optional)

          list-links   List all repository links in a container
            --container <name>    Container name
            --storage <name>      Storage account (optional)

          All repo commands (clone-github, clone-devops, sync, link-github, link-devops, unlink, list-links) also accept:
            --account-key, --sas-token, --account for inline storage credentials

          diff         Compare container blobs against linked remote repository (read-only)
            --container <name>    Container name (required)
            --storage <name>      Storage account (optional)
            --account-key <key>   Inline account key
            --sas-token <token>   Inline SAS token
            --account <account>   Azure Storage account name (required with inline key/token)
            --pat <token>         Inline PAT (overrides stored token)
            --token-name <name>   PAT token name
            --prefix <path>       Diff only the link at this target prefix
            --link-id <id>        Diff a specific link by ID
            --all                 Diff all links in the container
            --format <fmt>        Output format: table (default), json, summary
            --show-identical      Include identical files in output
            --physical-check      Cross-reference with actual container blobs to detect untracked files
            --output <file>       Write JSON report to file (only with --format json)

            Exit codes: 0=in sync, 1=differences found, 2=fatal error

          ui           Launch web/Electron UI (--port <port>, default 3100)

          add-api      Register a Storage Navigator API as a backend
            --name <name>         Display name
            --base-url <url>      API base URL
            --static-secret <value>  Value for the static auth header (when API requires it).
                                      CLI prompts hidden if omitted and discovery says it's required.

          login        Re-run OIDC login for an existing api backend
            --name <name>         API backend name
            --static-secret <value>  New static header value (e.g. after rotation).
                                      CLI prompts hidden if omitted and discovery says it's required.

          logout       Clear stored OIDC tokens for an api backend
            --name <name>         API backend name

          shares       List file shares (works with direct + api backends)
          share-create Create a file share
            --name <name>         Share name
            --quota <gib>         Quota in GiB (optional)
          share-delete Delete a file share
            --name <name>         Share name

          files        List directory contents in a file share
            --share <name>        Share name
            --path <dir>          Directory path (default: root)

          file-view    View a file (UTF-8 text)
            --share <name>        Share name
            --file <path>         File path

          file-upload  Upload a file
            --share <name>        Share name
            --file <path>         Destination path
            --source <path>       Local file to upload (or use --content)
            --content <text>      Inline text content

          file-rename  Rename a file
            --share <name>        Share name
            --file <path>         Current path
            --new-name <path>     New path

          file-delete  Delete a file
            --share <name>        Share name
            --file <path>         File path

          file-delete-folder  Delete a directory recursively
            --share <name>        Share name
            --path <dir>          Directory path

          All blob commands (containers, ls, view, etc.) accept api backends
          via `--storage <api-backend-name> --account <azure-account>`.

        Examples:

          # Add storage with account key
          npx tsx src/cli/index.ts add --name corporateloans --account corporateloans --account-key "your-key"

          # Delete a storage account from the local credential store (asks for confirmation)
          npx tsx src/cli/index.ts delete-storage --name corporateloans

          # Delete without confirmation prompt
          npx tsx src/cli/index.ts delete-storage --name corporateloans --force

          # List all containers
          npx tsx src/cli/index.ts containers

          # Browse blobs in a container
          npx tsx src/cli/index.ts ls --container prompts --prefix "coa_extraction/"

          # View a JSON file
          npx tsx src/cli/index.ts view --container prompts --blob "configuration_files/config.json"

          # Launch UI
          npx tsx src/cli/index.ts ui --port 3100

          # Rename a blob
          npx tsx src/cli/index.ts rename --container prompts --blob "old-name.json" --new-name "new-name.json"

          # Delete a blob (will ask for confirmation)
          npx tsx src/cli/index.ts delete --container prompts --blob "obsolete-file.json"

          # Delete a folder and all its contents (will ask for confirmation)
          npx tsx src/cli/index.ts delete-folder --container prompts --prefix "old-folder/"

          # Create a blob from a local file
          npx tsx src/cli/index.ts create --container prompts --blob "config/new.json" --file ./local-file.json

          # Create a blob with inline content
          npx tsx src/cli/index.ts create --container prompts --blob "notes/hello.txt" --content "Hello world"

          # Add a GitHub PAT
          npx tsx src/cli/index.ts add-token --name my-github --provider github --token "ghp_xxx"

          # Clone a GitHub repo into a container
          npx tsx src/cli/index.ts clone-github --repo "https://github.com/owner/repo" --container my-container

          # Clone an Azure DevOps repo into a container
          npx tsx src/cli/index.ts clone-devops --repo "https://dev.azure.com/org/project/_git/repo" --container my-container

          # Sync a previously cloned container
          npx tsx src/cli/index.ts sync --container my-container

          # Dry-run sync (show changes without applying)
          npx tsx src/cli/index.ts sync --container my-container --dry-run

          # Use inline account key (no stored credential needed)
          npx tsx src/cli/index.ts containers --account myaccount --account-key "your-key"

          # Clone with inline PAT and inline storage key
          npx tsx src/cli/index.ts clone-github --repo "https://github.com/owner/repo" --container my-repo --pat "ghp_xxx" --account myaccount --account-key "key"

          # Clone a repo into a specific folder prefix
          npx tsx src/cli/index.ts clone-github --repo "https://github.com/owner/repo" --container my-container --prefix "docs/" --repo-path "src/docs"

          # Link a GitHub repo to a folder (metadata only, no download)
          npx tsx src/cli/index.ts link-github --repo "https://github.com/owner/repo" --container my-container --prefix "templates/" --branch main

          # Link an Azure DevOps repo
          npx tsx src/cli/index.ts link-devops --repo "https://dev.azure.com/org/project/_git/repo" --container my-container --prefix "config/"

          # List all links in a container
          npx tsx src/cli/index.ts list-links --container my-container

          # Sync a specific link by prefix
          npx tsx src/cli/index.ts sync --container my-container --prefix "templates/"

          # Sync a specific link by ID
          npx tsx src/cli/index.ts sync --container my-container --link-id "abcd1234-..."

          # Sync all links in a container
          npx tsx src/cli/index.ts sync --container my-container --all

          # Unlink a folder link
          npx tsx src/cli/index.ts unlink --container my-container --prefix "templates/"

          # Unlink by link ID
          npx tsx src/cli/index.ts unlink --container my-container --link-id "abcd1234-..."

          # Launch second instance on different port
          npx tsx src/cli/index.ts ui --port 3200

          # Single-link diff, default table output
          npx tsx src/cli/index.ts diff --container my-container

          # Multi-link container: diff all links
          npx tsx src/cli/index.ts diff --container my-container --all

          # Diff specific link by prefix
          npx tsx src/cli/index.ts diff --container my-container --prefix "docs/"

          # JSON output to file for CI pipeline
          npx tsx src/cli/index.ts diff --container my-container --format json --output /tmp/diff-report.json

          # Show identical files in table output
          npx tsx src/cli/index.ts diff --container my-container --show-identical

          # Detect untracked blobs (physical check)
          npx tsx src/cli/index.ts diff --container my-container --physical-check

        ─────────────────────────────────────────────────────────────────────────
        Reverse Git
        ─────────────────────────────────────────────────────────────────────────

        Publish (push) Azure Blob contents back to GitHub or Azure DevOps
        repositories. Implemented as seven CLI subcommands plus six HTTP
        endpoints (Phase F). See docs/design/plan-011-reverse-git.md and
        docs/design/project-design.md §"Reverse-Git Publication" for the
        full design.

        Architecture:
          - Pure REST. No local git clone, no git binary, no LFS support.
          - Diff is ETag-based (Azure ETag — opaque per blob) — distinct
            from the forward diff which uses Git SHA-1 blob hashes.
          - Metadata persistence is hybrid:
              container / prefix scope → .reverse-git-links.json blob
                                          at the container root
              account scope            → CredentialData.reverseLinks
                                          inside the encrypted store
          - One commit per push (batched). GitHub uses the Git Data API
            (700-entry chunks); ADO uses POST /git/pushes (5 GB cap,
            chunked at 500 changes when exceeded).

        Subcommands:

          publish-github
            Initialise a reverse-link to GitHub AND push the current scope
            contents in a single command.
            --repo <owner/repo>       Required. GitHub repository.
            --container <name>        Scope: container.
            --prefix <path>           Scope: prefix (requires --container).
            (no scope flags)          Scope: storage-account.
            --branch <name>           Default: main.
            --commit-message <msg>    Override default commit message.
            --exclude <pattern>       Repeatable glob exclusion.
            --no-respect-gitignore    Ignore the scope-root .gitignore.
            --repo-sub-path <p>       Sub-folder inside the repo.
            --visibility <v>          public | private (default: private).
                                       Only used with --create-repo.
            --create-repo             Auto-create the repo if it does not
                                       exist (GitHub: auto_init=true).
            --author-name <n>         Default: "Storage Navigator".
            --author-email <e>        Default: "storage-nav@local".
            Common credential / PAT flags: --storage, --account,
            --account-key, --sas-token, --token-name, --pat.
            GitHub App authentication (alternative to PAT):
            --github-app-name <name>  Use stored GitHub App credential.
            --github-app-inline <json>  Inline GitHub App credentials (JSON).
            Precedence: --github-app-inline > --github-app-name > PAT chain.

          publish-devops
            Same as publish-github but targets Azure DevOps. Additional
            flags:
            --org <name>              ADO organisation (required when
                                       --repo is a bare name).
            --project <name>          ADO project (required when --repo
                                       is a bare name).
            --visibility              Accepted but ignored (ADO inherits
                                       from the project).

          reverse-link-github
            Create the reverse-link record but do NOT push. Useful when
            you want to inspect or tune exclusions before the first push.
            Same target/scope flags as publish-github.

          reverse-link-devops
            Same as reverse-link-github but targets Azure DevOps.

          push
            Execute a push for one or more existing reverse-links.
            Selection precedence: --link-id > --all > scope flags.
            --link-id <uuid>          Push a specific link by ID.
            --all                     Push every link in the resolved scope.
            --container <name>        Scope: container.
            --prefix <path>           Scope: prefix.
            --dry-run                 Compute the diff but do NOT push.
            --force                   Re-classify every tracked file as
                                       modified — re-pushes everything.
                                       Independent of --allow-overwrite-remote.
            --allow-overwrite-remote  Force-update the remote ref when the
                                       branch diverged. Default OFF.

          reverse-unlink
            Remove a reverse-link record. NEVER touches the remote.
            --link-id <uuid>          Required. ID to remove.
            --container / --prefix    Scope flags for lookup.
            --yes                     Skip the confirmation prompt.

          list-reverse-links
            Tabular enumeration of every reverse-link rooted at the scope.
            --container / --prefix    Scope flags. With no scope flags,
                                       lists account-scope links for the
                                       resolved storage entry.

        Tri-state exit codes (per plan-005 / R10.11):
          0   success / no-op
          1   changes pushed (or would be pushed under --dry-run)
          2   fatal error
          3   configuration error (missing required value)

        Error → exit-code mapping (per plan-011 §"Error type taxonomy"):
          RepoNotFoundError        2 (HTTP 404)
          RemoteDivergedError      2 (HTTP 409)
          GitHubApiError           2 (HTTP 502)
          GitHubEmptyRepoError     2 (HTTP 502)
          GitHubBlobTooLargeError  per-file, NOT fatal (accumulated)
          DevOpsApiError           2 (HTTP 502)
          AuthenticationError /
            InvalidPATError        2 (HTTP 401)
          InsufficientScopesError  2 (HTTP 403)
          RateLimitExceededError   2 (HTTP 503)
          PayloadTooLargeError     2 (HTTP 413)
          PathCollisionError       2 (HTTP 422)
          ConfigurationError       3 (HTTP 400)

        Path mapping (blob path → repo path):
          container scope    foo/bar.txt           → <repoSubPath>/foo/bar.txt
          prefix=docs/       docs/foo/bar.txt      → <repoSubPath>/foo/bar.txt  (prefix stripped)
          account scope      cust-data/foo/bar.txt → <repoSubPath>/cust-data/foo/bar.txt
        Path collisions (case-only or after prefix strip) abort the push
        (PathCollisionError, exit 2) per R5.5 default policy.

        Security stance:
          PATs are stored encrypted in the credential store (AES-256-GCM).
          --pat is accepted for one-shot use; --token-name retrieves a
          named stored token; the engine falls back to the first matching
          provider token. No fallback for required configuration — every
          missing setting raises ConfigurationError (exit 3).

        Account-scope: USE SPARINGLY
          The engine streams every blob across every container in the
          account through the diff for each push. For accounts with many
          containers / large blob counts this can be slow. Prefer
          container or prefix scope when possible.

        Examples:

          # Initial publish of a container to a new GitHub repo
          npx tsx src/cli/index.ts publish-github \
              --container my-docs --repo myorg/my-docs \
              --create-repo --visibility private

          # Initial publish of a prefix to ADO
          npx tsx src/cli/index.ts publish-devops \
              --container engineering --prefix specs/ \
              --org myorg --project Platform --repo specs

          # Create link only (no push), then dry-run before the first push
          npx tsx src/cli/index.ts reverse-link-github \
              --container my-docs --repo myorg/my-docs
          npx tsx src/cli/index.ts push --container my-docs --dry-run

          # Push every link in a container in one shot
          npx tsx src/cli/index.ts push --container my-docs --all

          # Recover from divergence with a force push
          npx tsx src/cli/index.ts push --link-id 1234abcd-... \
              --allow-overwrite-remote

          # Re-push every tracked file (no diff)
          npx tsx src/cli/index.ts push --container my-docs --force

          # List every reverse-link in a container
          npx tsx src/cli/index.ts list-reverse-links --container my-docs

          # Remove a link without touching the remote
          npx tsx src/cli/index.ts reverse-unlink \
              --link-id 1234abcd-... --container my-docs --yes

        GitHub App authentication (alternative to PAT):
          storage-nav can authenticate GitHub publication/push as a
          GitHub App INSTALLATION instead of a Personal Access Token.
          A GitHub App installed with "Only select repositories" keeps
          storage-nav limited to exactly the repositories it created or
          manages — a tighter boundary than a broadly-scoped PAT. The
          feature is ADDITIVE: the PAT flow is unchanged, and configs
          without GitHub Apps load as before.

          Model:
            - You register/own the GitHub App and provide App ID,
              installation ID, and a private key (PEM). The private key
              is stored encrypted (AES-256-GCM) in the same credential
              store as PATs; it is never printed by list-github-apps.
            - At operation time storage-nav signs a short-lived RS256
              JWT (App ID as issuer) and exchanges it for an
              installation access token (~1h, cached in memory for the
              command/UI action, never written to disk).
            - The installation token CREATES the repo (org installs:
              POST /orgs/{org}/repos with Administration:write; user
              installs: POST /user/repos) and PUSHES contents
              (Contents:write). Required app permissions:
              Administration R/W, Contents R/W, Metadata R/O.

          Boundary + scope extension:
            - Adding a newly-created repo to a "select repositories"
              installation cannot be done by the installation token
              itself — GitHub only allows it via a classic PAT with
              'repo' scope. Configure an OPTIONAL companion PAT
              (--companion-pat-name) to have storage-nav self-add the
              repo automatically. Without it, the repo is still created
              and pushed, and storage-nav prints instructions to add it
              via the GitHub UI (graceful degradation; no retry in v1).
            - Extend scope later by installing additional repositories
              on the app, or by registering additional installations as
              separate GitHub App credential entries (distinct --name).

          Credential management commands:
            storage-nav add-github-app --name <n> --app-id <id> \
                --installation-id <id> --private-key-file <pem> \
                [--companion-pat-name <pat>] [--expires-at <iso>] \
                [--client-id <id>]   # client-id reserved for future use
            storage-nav list-github-apps      # never prints the key
            storage-nav remove-github-app --name <n>

          Use on publish/push (precedence:
          --github-app-inline > --github-app-name > PAT chain):
            storage-nav publish-github --container my-docs \
                --repo myorg/my-docs --create-repo \
                --github-app-name my-publisher

          Both the CLI and the Electron desktop UI support GitHub App
          credential management AND selecting a GitHub App when
          publishing/pushing (the publish dialog credential selector
          lists PATs and GitHub Apps; the reverse-links panel shows the
          auth type per link). See docs/design/configuration-guide.md
          §5 for how to obtain each value and the recommended storage
          approach.

        Known limitations (v1):
          - GitHub App auth: automatic repo→installation scope addition
            requires a companion PAT ('repo' scope); otherwise it is a
            manual GitHub-UI step. User-account (non-org) repo creation
            via an installation token is provider-dependent and should
            be smoke-tested against your app (org installs are the
            primary verified path).
          - No Git LFS support — large binaries trigger
            GitHubBlobTooLargeError per file.
          - No conflict resolution — divergence requires manual
            reconciliation (or --allow-overwrite-remote).
          - No event-driven monitoring — push is on-demand only (CLI or
            UI button).
          - Account-scope iteration is "use sparingly" (see above).
    </info>
</storage-nav>
