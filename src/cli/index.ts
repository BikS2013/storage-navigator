#!/usr/bin/env node
import { Command } from "commander";
import { addStorage } from "./commands/add-storage.js";
import { addApi } from "./commands/add-api.js";
import { listStorages } from "./commands/list-storages.js";
import { removeStorage, deleteStorage } from "./commands/remove-storage.js";
import { viewBlob, listContainers, listBlobs, downloadBlob } from "./commands/view.js";
import { createContainer, renameBlob, deleteBlob, deleteFolder, createBlob } from "./commands/blob-ops.js";
import { addToken, listTokens, removeToken } from "./commands/token-ops.js";
import { cloneGitHub, cloneDevOps, cloneSsh, syncContainer } from "./commands/repo-sync.js";
import { linkGitHub, linkDevOps, linkSsh, unlinkContainer, listLinks } from "./commands/link-ops.js";
import { diffContainer } from "./commands/diff-ops.js";

const program = new Command();

program
  .name("storage-nav")
  .description("Azure Blob Storage Navigator — browse containers and view files")
  .version("1.0.0");

// Add storage
program
  .command("add")
  .description("Add a new storage account")
  .requiredOption("--name <name>", "Display name for this storage")
  .requiredOption("--account <account>", "Azure Storage account name")
  .option("--sas-token <token>", "SAS token for authentication")
  .option("--account-key <key>", "Account key for full access (recommended)")
  .action((opts) => {
    addStorage(opts.name, opts.account, opts.sasToken, opts.accountKey);
  });

// Register an API backend
program
  .command("add-api")
  .description("Register a Storage Navigator API as a backend")
  .requiredOption("--name <name>", "Display name")
  .requiredOption("--base-url <url>", "API base URL (e.g. https://your-api.azurewebsites.net)")
  .action(async (opts) => {
    await addApi(opts.name, opts.baseUrl);
  });

// List storages
program
  .command("list")
  .description("List configured storage accounts")
  .action(() => {
    listStorages();
  });

// Remove storage
program
  .command("remove")
  .description("Remove a storage account")
  .requiredOption("--name <name>", "Name of the storage to remove")
  .action((opts) => {
    removeStorage(opts.name);
  });

// Delete storage (with confirmation)
program
  .command("delete-storage")
  .description("Delete a storage account from the local credential store (asks for confirmation)")
  .requiredOption("--name <name>", "Name of the storage to delete")
  .option("--force", "Skip the confirmation prompt")
  .action(async (opts) => {
    await deleteStorage(opts.name, opts.force ?? false);
  });

// List containers
program
  .command("containers")
  .description("List containers in a storage account")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline, overrides stored credential)")
  .option("--sas-token <token>", "SAS token (inline, overrides stored credential)")
  .option("--account <account>", "Azure Storage account name (required with inline key/token)")
  .action(async (opts) => {
    await listContainers({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account });
  });

// Create container
program
  .command("create-container")
  .description("Create a new container in a storage account")
  .requiredOption("--name <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline, overrides stored credential)")
  .option("--sas-token <token>", "SAS token (inline, overrides stored credential)")
  .option("--account <account>", "Azure Storage account name (required with inline key/token)")
  .action(async (opts) => {
    await createContainer({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.name);
  });

// List blobs
program
  .command("ls")
  .description("List blobs in a container")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--prefix <prefix>", "Blob prefix (folder path)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await listBlobs({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.prefix);
  });

// View blob
program
  .command("view")
  .description("View a blob's content (renders JSON, markdown, text)")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await viewBlob({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.blob);
  });

// Download blob
program
  .command("download")
  .description("Download a blob to a local file")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path")
  .requiredOption("--output <path>", "Local output file path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await downloadBlob({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.blob, opts.output);
  });

// Rename blob
program
  .command("rename")
  .description("Rename a blob")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Current blob path")
  .requiredOption("--new-name <path>", "New blob path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await renameBlob({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.blob, opts.newName);
  });

// Delete blob
program
  .command("delete")
  .description("Delete a blob (asks for confirmation)")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path to delete")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await deleteBlob({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.blob);
  });

// Delete folder (all blobs under a prefix)
program
  .command("delete-folder")
  .description("Delete all blobs under a prefix/folder (asks for confirmation)")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--prefix <path>", "Folder prefix to delete")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await deleteFolder({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.prefix);
  });

// Create (upload) blob
program
  .command("create")
  .description("Create a new blob from a local file or inline content")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path (destination name)")
  .option("--file <path>", "Local file to upload")
  .option("--content <text>", "Inline text content")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await createBlob({ storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.container, opts.blob, opts.file, opts.content);
  });

// Add token
program
  .command("add-token")
  .description("Add a personal access token (GitHub or Azure DevOps)")
  .requiredOption("--name <name>", "Display name for this token")
  .requiredOption("--provider <provider>", "Token provider (github or azure-devops)")
  .requiredOption("--token <token>", "Personal access token")
  .option("--expires-at <date>", "Token expiration date (ISO 8601)")
  .action((opts) => {
    if (opts.provider !== "github" && opts.provider !== "azure-devops") {
      console.error('Provider must be "github" or "azure-devops".');
      process.exit(1);
    }
    addToken(opts.name, opts.provider, opts.token, opts.expiresAt);
  });

// List tokens
program
  .command("list-tokens")
  .description("List configured personal access tokens")
  .action(() => {
    listTokens();
  });

// Remove token
program
  .command("remove-token")
  .description("Remove a personal access token")
  .requiredOption("--name <name>", "Name of the token to remove")
  .action((opts) => {
    removeToken(opts.name);
  });

// Clone GitHub repo
program
  .command("clone-github")
  .description("Clone a GitHub repository into a blob container")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .requiredOption("--container <name>", "Target container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--branch <branch>", "Branch to clone (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--token-name <name>", "PAT token name (uses first GitHub token if omitted)")
  .option("--pat <token>", "GitHub PAT (inline, overrides stored token)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await cloneGitHub(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, { pat: opts.pat, tokenName: opts.tokenName }, opts.prefix, opts.repoPath);
  });

// Clone Azure DevOps repo
program
  .command("clone-devops")
  .description("Clone an Azure DevOps repository into a blob container")
  .requiredOption("--repo <url>", "Azure DevOps repository URL")
  .requiredOption("--container <name>", "Target container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--branch <branch>", "Branch to clone (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--token-name <name>", "PAT token name (uses first Azure DevOps token if omitted)")
  .option("--pat <token>", "Azure DevOps PAT (inline, overrides stored token)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await cloneDevOps(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, { pat: opts.pat, tokenName: opts.tokenName }, opts.prefix, opts.repoPath);
  });

// Clone via SSH
program
  .command("clone-ssh")
  .description("Clone a repository via SSH into a blob container")
  .requiredOption("--repo <url>", "Repository SSH URL (e.g. git@github.com:owner/repo.git)")
  .requiredOption("--container <name>", "Target container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--branch <branch>", "Branch to clone (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await cloneSsh(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, opts.prefix, opts.repoPath);
  });

// Sync container
program
  .command("sync")
  .description("Sync a previously cloned container with its remote repository")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--dry-run", "Show what would change without making changes")
  .option("--prefix <path>", "Sync only the link at this prefix")
  .option("--link-id <id>", "Sync a specific link by ID")
  .option("--all", "Sync all links in the container")
  .option("--pat <token>", "PAT (inline, overrides stored token)")
  .option("--token-name <name>", "PAT token name")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await syncContainer(opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.dryRun ?? false, { pat: opts.pat, tokenName: opts.tokenName }, opts.prefix, opts.linkId, opts.all ?? false);
  });

// Link GitHub repo (metadata only)
program
  .command("link-github")
  .description("Link a GitHub repository to a container (metadata only, no download)")
  .requiredOption("--repo <url>", "GitHub repository URL")
  .requiredOption("--container <name>", "Target container name")
  .option("--branch <branch>", "Branch (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--token-name <name>", "PAT token name (uses first GitHub token if omitted)")
  .option("--pat <token>", "GitHub PAT (inline, overrides stored token)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await linkGitHub(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, opts.prefix, opts.repoPath, { pat: opts.pat, tokenName: opts.tokenName });
  });

// Link Azure DevOps repo (metadata only)
program
  .command("link-devops")
  .description("Link an Azure DevOps repository to a container (metadata only, no download)")
  .requiredOption("--repo <url>", "Azure DevOps repository URL")
  .requiredOption("--container <name>", "Target container name")
  .option("--branch <branch>", "Branch (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--token-name <name>", "PAT token name (uses first Azure DevOps token if omitted)")
  .option("--pat <token>", "Azure DevOps PAT (inline, overrides stored token)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await linkDevOps(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, opts.prefix, opts.repoPath, { pat: opts.pat, tokenName: opts.tokenName });
  });

// Link via SSH (metadata only)
program
  .command("link-ssh")
  .description("Link an SSH-accessible repository to a container (metadata only, no download)")
  .requiredOption("--repo <url>", "Repository SSH URL (e.g. git@github.com:owner/repo.git)")
  .requiredOption("--container <name>", "Target container name")
  .option("--branch <branch>", "Branch (default: repo default branch)")
  .option("--prefix <path>", "Target folder prefix within container")
  .option("--repo-path <path>", "Sub-path within the repo to sync")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await linkSsh(opts.repo, opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.branch, opts.prefix, opts.repoPath);
  });

// Unlink a repository from a container
program
  .command("unlink")
  .description("Remove a repository link from a container (files are NOT deleted)")
  .requiredOption("--container <name>", "Container name")
  .option("--link-id <id>", "Link ID to remove")
  .option("--prefix <path>", "Folder prefix to unlink")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await unlinkContainer(opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account }, opts.linkId, opts.prefix);
  });

// List links in a container
program
  .command("list-links")
  .description("List all repository links in a container")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Account key (inline)")
  .option("--sas-token <token>", "SAS token (inline)")
  .option("--account <account>", "Azure Storage account name (with inline key/token)")
  .action(async (opts) => {
    await listLinks(opts.container, { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account });
  });

// Diff container against linked remote repository
program
  .command("diff")
  .description("Compare container blobs against the linked remote repository (read-only)")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--account-key <key>", "Inline account key")
  .option("--sas-token <token>", "Inline SAS token")
  .option("--account <account>", "Azure Storage account name (required with inline key/token)")
  .option("--pat <token>", "Inline PAT (overrides stored token)")
  .option("--token-name <name>", "PAT token name to use")
  .option("--prefix <path>", "Diff only the link at this target prefix")
  .option("--link-id <id>", "Diff a specific link by ID")
  .option("--all", "Diff all links in the container")
  .option("--format <fmt>", "Output format: table, json, summary (default: table)", "table")
  .option("--show-identical", "Include identical files in output")
  .option("--physical-check", "Cross-reference with actual container blobs to detect untracked files")
  .option("--output <file>", "Write JSON report to file (only with --format json)")
  .action(async (opts) => {
    await diffContainer(
      opts.container,
      { storage: opts.storage, accountKey: opts.accountKey, sasToken: opts.sasToken, account: opts.account },
      { pat: opts.pat, tokenName: opts.tokenName },
      {
        prefix: opts.prefix,
        linkId: opts.linkId,
        all: opts.all,
        format: opts.format,
        showIdentical: opts.showIdentical,
        physicalCheck: opts.physicalCheck,
        output: opts.output,
      }
    );
  });

// Launch Electron UI
program
  .command("ui")
  .description("Launch the Electron desktop app")
  .option("--port <port>", "Server port", "3100")
  .action(async (opts) => {
    const { launchElectronApp } = await import("../electron/launch.js");
    launchElectronApp(parseInt(opts.port, 10));
  });

program.parse(process.argv);
