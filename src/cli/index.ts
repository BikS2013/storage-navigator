#!/usr/bin/env node
import { Command } from "commander";
import { addStorage } from "./commands/add-storage.js";
import { listStorages } from "./commands/list-storages.js";
import { removeStorage } from "./commands/remove-storage.js";
import { viewBlob, listContainers, listBlobs, downloadBlob } from "./commands/view.js";
import { renameBlob, deleteBlob, createBlob } from "./commands/blob-ops.js";

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

// List containers
program
  .command("containers")
  .description("List containers in a storage account")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await listContainers(opts.storage);
  });

// List blobs
program
  .command("ls")
  .description("List blobs in a container")
  .requiredOption("--container <name>", "Container name")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .option("--prefix <prefix>", "Blob prefix (folder path)")
  .action(async (opts) => {
    await listBlobs(opts.storage, opts.container, opts.prefix);
  });

// View blob
program
  .command("view")
  .description("View a blob's content (renders JSON, markdown, text)")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await viewBlob(opts.storage, opts.container, opts.blob);
  });

// Download blob
program
  .command("download")
  .description("Download a blob to a local file")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path")
  .requiredOption("--output <path>", "Local output file path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await downloadBlob(opts.storage, opts.container, opts.blob, opts.output);
  });

// Rename blob
program
  .command("rename")
  .description("Rename a blob")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Current blob path")
  .requiredOption("--new-name <path>", "New blob path")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await renameBlob(opts.storage, opts.container, opts.blob, opts.newName);
  });

// Delete blob
program
  .command("delete")
  .description("Delete a blob (asks for confirmation)")
  .requiredOption("--container <name>", "Container name")
  .requiredOption("--blob <path>", "Blob path to delete")
  .option("--storage <name>", "Storage account name (uses first if omitted)")
  .action(async (opts) => {
    await deleteBlob(opts.storage, opts.container, opts.blob);
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
  .action(async (opts) => {
    await createBlob(opts.storage, opts.container, opts.blob, opts.file, opts.content);
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
