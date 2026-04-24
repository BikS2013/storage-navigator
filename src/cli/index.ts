#!/usr/bin/env node
import { Command } from "commander";
import { addStorage } from "./commands/add-storage.js";
import { addApi } from "./commands/add-api.js";
import { login, logout } from "./commands/auth-ops.js";
import { listStorages } from "./commands/list-storages.js";
import { removeStorage, deleteStorage } from "./commands/remove-storage.js";
import { viewBlob, listContainers, listBlobs, downloadBlob } from "./commands/view.js";
import { createContainer, renameBlob, deleteBlob, deleteFolder, createBlob } from "./commands/blob-ops.js";
import { addToken, listTokens, removeToken } from "./commands/token-ops.js";
import { cloneGitHub, cloneDevOps, cloneSsh, syncContainer } from "./commands/repo-sync.js";
import { linkGitHub, linkDevOps, linkSsh, unlinkContainer, listLinks } from "./commands/link-ops.js";
import { diffContainer } from "./commands/diff-ops.js";
import {
  listShares, createShare, deleteShareCmd,
  listDir, viewFile, uploadFileCmd, renameFileCmd, deleteFileCmd, deleteFileFolderCmd,
} from "./commands/shares-ops.js";

const program = new Command();

const commonStorageOpts = (cmd: import('commander').Command) =>
  cmd.option('--storage <name>', 'Storage backend name')
     .option('--account <account>', 'Azure storage account name (required for api backends)')
     .option('--account-key <key>', 'Inline account key (direct only)')
     .option('--sas-token <token>', 'Inline SAS token (direct only)');

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
  .option("--static-secret <value>", "Value for the static auth header (use when API requires it; CLI prompts otherwise)")
  .action(async (opts) => {
    await addApi(opts.name, opts.baseUrl, { staticSecret: opts.staticSecret });
  });

// Re-run OIDC login for an api backend
program
  .command("login")
  .description("Re-run OIDC login + reconcile static-header for an existing api backend")
  .requiredOption("--name <name>", "API backend name")
  .option("--static-secret <value>", "New static-header value (e.g. after rotation)")
  .action(async (opts) => {
    await login(opts.name, { staticSecret: opts.staticSecret });
  });

// Clear stored OIDC tokens for an api backend
program
  .command("logout")
  .description("Delete stored OIDC tokens for an api backend")
  .requiredOption("--name <name>", "API backend name")
  .action(async (opts) => {
    await logout(opts.name);
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

// File share commands
commonStorageOpts(program.command('shares').description('List file shares'))
  .action(async (opts) => { await listShares(opts); });

commonStorageOpts(program.command('share-create').description('Create a file share')
  .requiredOption('--name <name>', 'Share name')
  .option('--quota <gib>', 'Quota in GiB', (v) => parseInt(v, 10)))
  .action(async (opts) => { await createShare(opts); });

commonStorageOpts(program.command('share-delete').description('Delete a file share')
  .requiredOption('--name <name>', 'Share name'))
  .action(async (opts) => { await deleteShareCmd(opts); });

commonStorageOpts(program.command('files').description('List directory contents in a file share')
  .requiredOption('--share <name>', 'Share name')
  .option('--path <dir>', 'Directory path (default: root)'))
  .action(async (opts) => { await listDir(opts); });

commonStorageOpts(program.command('file-view').description('View a file (UTF-8 text)')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'File path'))
  .action(async (opts) => { await viewFile(opts); });

commonStorageOpts(program.command('file-upload').description('Upload a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'Destination path')
  .option('--source <path>', 'Local file to upload')
  .option('--content <text>', 'Inline text content'))
  .action(async (opts) => { await uploadFileCmd(opts); });

commonStorageOpts(program.command('file-rename').description('Rename a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'Current path')
  .requiredOption('--new-name <path>', 'New path'))
  .action(async (opts) => { await renameFileCmd(opts); });

commonStorageOpts(program.command('file-delete').description('Delete a file')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--file <path>', 'File path'))
  .action(async (opts) => { await deleteFileCmd(opts); });

commonStorageOpts(program.command('file-delete-folder').description('Delete a directory recursively')
  .requiredOption('--share <name>', 'Share name')
  .requiredOption('--path <dir>', 'Directory path'))
  .action(async (opts) => { await deleteFileFolderCmd(opts); });

// Launch Electron UI
program
  .command("ui")
  .description("Launch the Electron desktop app")
  .option("--port <port>", "Server port", "3100")
  .action(async (opts) => {
    const { launchElectronApp } = await import("../electron/launch.js");
    launchElectronApp(parseInt(opts.port, 10));
  });

// LangGraph ReAct agent
program
  .command("agent [prompt]")
  .description(
    "Run the LangGraph ReAct agent over storage-nav. " +
    "Prompt required unless --interactive.\n" +
    "Config folder: ~/.tool-agents/storage-nav/"
  )
  .option("-i, --interactive", "Start an interactive REPL session", false)
  .option("-p, --provider <name>", "LLM provider: openai|anthropic|gemini|azure-openai|azure-anthropic|local-openai")
  .option("-m, --model <id>", "Model id or deployment name")
  .option("--base-url <url>", "Override provider base URL (useful for local-openai)")
  .option("--max-steps <n>", "ReAct iteration cap (default: 20)", (v: string) => parseInt(v, 10))
  .option("--temperature <t>", "Sampling temperature (default: 0)", (v: string) => parseFloat(v))
  .option("--system <text>", "Inline system prompt")
  .option("--system-file <path>", "Path to a system prompt file")
  .option("--tools <csv>", "Comma-separated allowlist of tool names to enable")
  .option("--per-tool-budget <bytes>", "Per-tool result byte cap (default: 16384)", (v: string) => parseInt(v, 10))
  .option("--allow-mutations", "Enable state-changing tools (off by default)", false)
  .option("--config <path>", "Override ~/.tool-agents/storage-nav/config.json path")
  .option("--env-file <path>", "Override ~/.tool-agents/storage-nav/.env path")
  .option("--log-file <path>", "Write redacted agent log to this file (mode 0600)")
  .option("--quiet", "Suppress stderr output (still writes log file if --log-file is set)", false)
  .option("--verbose", "Emit per-step trace to stderr", false)
  .action(async (prompt: string | undefined, opts: Record<string, unknown>) => {
    const { run } = await import("./commands/agent.js");
    const { ConfigurationError } = await import("../config/agent-config.js");
    try {
      const result = await run(prompt ?? null, {
        interactive: (opts["interactive"] as boolean) ?? false,
        provider: opts["provider"] as string | undefined,
        model: opts["model"] as string | undefined,
        baseUrl: opts["baseUrl"] as string | undefined,
        maxSteps: opts["maxSteps"] as number | undefined,
        temperature: opts["temperature"] as number | undefined,
        systemPrompt: opts["system"] as string | undefined,
        systemPromptFile: opts["systemFile"] as string | undefined,
        tools: opts["tools"] as string | undefined,
        perToolBudgetBytes: opts["perToolBudget"] as number | undefined,
        allowMutations: (opts["allowMutations"] as boolean) ?? false,
        configFile: opts["config"] as string | undefined,
        envFile: opts["envFile"] as string | undefined,
        logFile: opts["logFile"] as string | undefined,
        quiet: (opts["quiet"] as boolean) ?? false,
        verbose: (opts["verbose"] as boolean) ?? false,
      });

      if (result) {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      if ((err as { name?: string }).name === "ConfigurationError") {
        console.error(`[config error] ${(err as Error).message}`);
        process.exit(3);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("unknown provider") || msg.toLowerCase().includes("usage")) {
        console.error(`[usage error] ${msg}`);
        process.exit(2);
      }
      console.error(`[error] ${msg}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
