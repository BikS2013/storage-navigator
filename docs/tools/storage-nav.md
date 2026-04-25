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
    </info>
</storage-nav>
