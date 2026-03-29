# Storage Navigator

Azure Blob Storage Navigator — browse containers and view files through CLI or desktop UI.

## Tools

<storage-nav>
    <objective>
        Navigate Azure Blob Storage accounts — list containers, browse blobs, view files (JSON, markdown, text, PDF, DOCX), manage encrypted credentials.
    </objective>
    <command>
        npx tsx src/cli/index.ts <command> [options]
    </command>
    <info>
        CLI and Electron desktop app for browsing Azure Blob Storage. Supports multiple storage accounts with encrypted SAS token / account key storage.

        Credentials are stored encrypted (AES-256-GCM) at ~/.storage-navigator/credentials.json using a machine-derived key (hostname + username).

        Source: src/core/ (credential-store.ts, blob-client.ts, types.ts), src/cli/, src/electron/

        Commands:
          add          Add a new storage account
            --name <name>         Display name
            --account <account>   Azure Storage account name
            --account-key <key>   Account key (recommended, full access)
            --sas-token <token>   SAS token (alternative, may have scope limits)

          list         List configured storage accounts
          remove       Remove a storage account (--name <name>)

          containers   List containers (--storage <name>)
          ls           List blobs (--container <name> --storage <name> --prefix <path>)
          view         View a blob (--container <name> --blob <path> --storage <name>)
          download     Download a blob (--container <name> --blob <path> --output <file>)

          rename       Rename a blob (copy + delete)
            --container <name>    Container name
            --blob <path>         Current blob path
            --new-name <path>     New blob path
            --storage <name>      Storage account (optional)

          delete       Delete a blob (asks for confirmation)
            --container <name>    Container name
            --blob <path>         Blob path to delete
            --storage <name>      Storage account (optional)

          create       Create/upload a new blob
            --container <name>    Container name
            --blob <path>         Destination blob path
            --file <path>         Local file to upload (or use --content)
            --content <text>      Inline text content (or use --file)
            --storage <name>      Storage account (optional)

          ui           Launch web/Electron UI (--port <port>, default 3100)

        Examples:

          # Add storage with account key
          npx tsx src/cli/index.ts add --name corporateloans --account corporateloans --account-key "your-key"

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

          # Create a blob from a local file
          npx tsx src/cli/index.ts create --container prompts --blob "config/new.json" --file ./local-file.json

          # Create a blob with inline content
          npx tsx src/cli/index.ts create --container prompts --blob "notes/hello.txt" --content "Hello world"

          # Launch second instance on different port
          npx tsx src/cli/index.ts ui --port 3200
    </info>
</storage-nav>
