/**
 * Tool adapters for blob storage commands:
 *   containers, ls, view, download, create, rename, delete, delete-folder
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";
import { truncateToolResult } from "./truncate.js";
import { handleToolError } from "./types.js";
import { confirmDestructive } from "./confirm.js";
import { resolveStorageBackend } from "../../cli/commands/shared.js";
import type { StorageOpts } from "../../cli/commands/shared.js";
import { renameBlob, deleteBlob, deleteFolder, createBlob } from "../../cli/commands/blob-ops.js";

const storageSchema = {
  storage: z.string().optional().describe("Storage account name (uses first configured if omitted)"),
  account: z.string().optional().describe("Azure Storage account name (required when using accountKey or sasToken)"),
  accountKey: z.string().optional().describe("Inline account key (overrides stored credential)"),
  sasToken: z.string().optional().describe("Inline SAS token (overrides stored credential)"),
};

function buildStorageOpts(input: { storage?: string; account?: string; accountKey?: string; sasToken?: string }): StorageOpts {
  return {
    storage: input.storage,
    account: input.account,
    accountKey: input.accountKey,
    sasToken: input.sasToken,
  };
}

// ── containers ────────────────────────────────────────────────────────────

export function createListContainersTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const { entry, backend } = await resolveStorageBackend(opts, input.account);
        const page = await backend.listContainers();
        return truncateToolResult(
          { storageName: entry.name, containers: page.items.map((c) => c.name) },
          cfg.perToolBudgetBytes
        );
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_containers",
      description: "List all blob containers in a storage account.",
      schema: z.object(storageSchema),
    }
  );
}

// ── ls ────────────────────────────────────────────────────────────────────

export function createListBlobsTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const { entry, backend } = await resolveStorageBackend(opts, input.account);
        const page = await backend.listBlobs(input.container, { prefix: input.prefix, pageSize: undefined });
        return truncateToolResult(
          {
            storageName: entry.name,
            container: input.container,
            prefix: input.prefix ?? "",
            items: page.items,
          },
          cfg.perToolBudgetBytes
        );
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_blobs",
      description: "List blobs in a container, optionally filtered by prefix (folder path). Returns file and directory entries with name, size, and content type.",
      schema: z.object({
        container: z.string().describe("Container name"),
        prefix: z.string().optional().describe("Blob prefix (folder path) to filter by"),
        ...storageSchema,
      }),
    }
  );
}

// ── view ──────────────────────────────────────────────────────────────────

export function createViewBlobTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const { backend } = await resolveStorageBackend(opts, input.account);
        const handle = await backend.readBlob(input.container, input.blob);
        const chunks: Buffer[] = [];
        for await (const chunk of handle.stream) {
          chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        const ext = input.blob.split(".").pop()?.toLowerCase() ?? "";

        let content: string;
        if (ext === "pdf") {
          content = `[PDF file, ${buffer.length} bytes — use download_blob to save locally]`;
        } else if (ext === "docx" || ext === "doc") {
          content = `[DOCX/DOC file, ${buffer.length} bytes — use download_blob to save locally]`;
        } else {
          content = buffer.toString("utf-8");
          if (ext === "json") {
            try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep as-is */ }
          }
        }

        return truncateToolResult({ blob: input.blob, content }, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "view_blob",
      description: "View the text content of a blob (JSON, markdown, plain text). For binary files (PDF, DOCX), returns a size note. Results are byte-budget capped.",
      schema: z.object({
        container: z.string().describe("Container name"),
        blob: z.string().describe("Blob path (e.g. 'folder/file.json')"),
        ...storageSchema,
      }),
    }
  );
}

// ── download ──────────────────────────────────────────────────────────────

export function createDownloadBlobTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const { backend } = await resolveStorageBackend(opts, input.account);
        const handle = await backend.readBlob(input.container, input.blob);

        const outputPath = input.output;
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(outputPath);
          handle.stream.pipe(out);
          out.on("finish", () => resolve());
          out.on("error", (err) => reject(err));
          (handle.stream as NodeJS.ReadableStream).on("error", (err) => reject(err));
        });
        const stats = fs.statSync(outputPath);
        return JSON.stringify({ success: true, output: outputPath, bytes: stats.size });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "download_blob",
      description: "Download a blob to a local file path.",
      schema: z.object({
        container: z.string().describe("Container name"),
        blob: z.string().describe("Blob path"),
        output: z.string().describe("Local file path to save the blob to"),
        ...storageSchema,
      }),
    }
  );
}

// ── create ────────────────────────────────────────────────────────────────

export function createCreateBlobTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        await createBlob(opts, input.container, input.blob, input.file, input.content);
        return JSON.stringify({ success: true, message: `Blob '${input.blob}' created in '${input.container}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "create_blob",
      description: "[MUTATING] Create or upload a blob to a container. Provide either 'file' (local path) or 'content' (inline text).",
      schema: z.object({
        container: z.string().describe("Container name"),
        blob: z.string().describe("Destination blob path"),
        file: z.string().optional().describe("Local file path to upload"),
        content: z.string().optional().describe("Inline text content"),
        ...storageSchema,
      }),
    }
  );
}

// ── rename ────────────────────────────────────────────────────────────────

export function createRenameBlobTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        await renameBlob(opts, input.container, input.blob, input.newName);
        return JSON.stringify({
          success: true,
          message: `Blob '${input.blob}' renamed to '${input.newName}' in '${input.container}'.`,
          oldPath: input.blob,
          newPath: input.newName,
        });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "rename_blob",
      description: "[MUTATING] Rename a blob (copy to new name, then delete old). Returns both old and new paths so subsequent tools use the correct path.",
      schema: z.object({
        container: z.string().describe("Container name"),
        blob: z.string().describe("Current blob path"),
        newName: z.string().describe("New blob path"),
        ...storageSchema,
      }),
    }
  );
}

// ── delete ────────────────────────────────────────────────────────────────

export function createDeleteBlobTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const result = await confirmDestructive(`Delete blob '${input.blob}' from container '${input.container}' in storage '${input.storage ?? "(default)"}'.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        const { backend } = await resolveStorageBackend(opts, input.account);
        await backend.deleteBlob(input.container, input.blob);
        return JSON.stringify({ success: true, message: `Blob '${input.blob}' deleted from '${input.container}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_blob",
      description: "[MUTATING][DESTRUCTIVE] Delete a blob permanently. Requires user confirmation before proceeding.",
      schema: z.object({
        container: z.string().describe("Container name"),
        blob: z.string().describe("Blob path to delete"),
        ...storageSchema,
      }),
    }
  );
}

// ── delete-folder ─────────────────────────────────────────────────────────

export function createDeleteFolderTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = buildStorageOpts(input);
        const result = await confirmDestructive(`Delete ALL blobs under prefix '${input.prefix}' in container '${input.container}' storage '${input.storage ?? "(default)"}'.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        const { backend } = await resolveStorageBackend(opts, input.account);
        const count = await backend.deleteFolder(input.container, input.prefix);
        return JSON.stringify({ success: true, deleted: count, message: `${count} blob(s) deleted under '${input.prefix}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_folder",
      description: "[MUTATING][DESTRUCTIVE] Delete ALL blobs under a prefix/folder permanently. Requires user confirmation before proceeding.",
      schema: z.object({
        container: z.string().describe("Container name"),
        prefix: z.string().describe("Folder prefix (e.g. 'folder/') — all blobs under this prefix will be deleted"),
        ...storageSchema,
      }),
    }
  );
}
