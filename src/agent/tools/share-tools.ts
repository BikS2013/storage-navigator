/**
 * Tool adapters for Azure File Share commands:
 *   shares, share-create, share-delete, files, file-view,
 *   file-upload, file-rename, file-delete, file-delete-folder
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";
import { truncateToolResult } from "./truncate.js";
import { handleToolError } from "./types.js";
import { confirmDestructive } from "./confirm.js";
import {
  listShares, createShare, deleteShareCmd,
  listDir, viewFile, uploadFileCmd, renameFileCmd,
  deleteFileCmd, deleteFileFolderCmd,
} from "../../cli/commands/shares-ops.js";
import { resolveStorageBackend } from "../../cli/commands/shared.js";
import type { StorageOpts } from "../../cli/commands/shared.js";

const storageSchema = {
  storage: z.string().optional().describe("Storage account name"),
  account: z.string().optional().describe("Azure Storage account name (required with inline credentials)"),
  accountKey: z.string().optional().describe("Inline account key"),
  sasToken: z.string().optional().describe("Inline SAS token"),
};

// ── shares ────────────────────────────────────────────────────────────────

export function createListSharesTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts & { account?: string } = input;
        const { backend } = await resolveStorageBackend(opts, input.account);
        const r = await backend.listShares();
        return truncateToolResult(r.items, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_shares",
      description: "List Azure File Shares in a storage account.",
      schema: z.object(storageSchema),
    }
  );
}

// ── share-create ──────────────────────────────────────────────────────────

export function createShareCreateTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = { ...input, name: input.shareName };
        await createShare(opts);
        return JSON.stringify({ success: true, message: `Share '${input.shareName}' created.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "create_share",
      description: "[MUTATING] Create a new Azure File Share.",
      schema: z.object({
        shareName: z.string().describe("Share name to create"),
        quota: z.number().int().positive().optional().describe("Quota in GiB"),
        ...storageSchema,
      }),
    }
  );
}

// ── share-delete ──────────────────────────────────────────────────────────

export function createShareDeleteTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Delete file share '${input.shareName}' and all its contents permanently.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        const opts = { ...input, name: input.shareName };
        await deleteShareCmd(opts);
        return JSON.stringify({ success: true, message: `Share '${input.shareName}' deleted.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_share",
      description: "[MUTATING][DESTRUCTIVE] Delete an Azure File Share and all its contents. Requires user confirmation.",
      schema: z.object({
        shareName: z.string().describe("Share name to delete"),
        ...storageSchema,
      }),
    }
  );
}

// ── files ─────────────────────────────────────────────────────────────────

export function createListDirTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const { backend } = await resolveStorageBackend(input, input.account);
        const r = await backend.listDir(input.share, input.dirPath ?? "");
        return truncateToolResult(r.items, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_dir",
      description: "List files and directories in an Azure File Share directory.",
      schema: z.object({
        share: z.string().describe("Share name"),
        dirPath: z.string().optional().describe("Directory path (empty string or omit for root)"),
        ...storageSchema,
      }),
    }
  );
}

// ── file-view ─────────────────────────────────────────────────────────────

export function createFileViewTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const { backend } = await resolveStorageBackend(input, input.account);
        const r = await backend.readFile(input.share, input.file);
        const chunks: Buffer[] = [];
        for await (const chunk of r.stream) {
          chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        }
        const content = Buffer.concat(chunks).toString("utf-8");
        return truncateToolResult({ file: input.file, content }, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "view_file",
      description: "View the text content of a file in an Azure File Share.",
      schema: z.object({
        share: z.string().describe("Share name"),
        file: z.string().describe("File path within the share"),
        ...storageSchema,
      }),
    }
  );
}

// ── file-upload ───────────────────────────────────────────────────────────

export function createFileUploadTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = { ...input, file: input.destFile, source: input.source };
        await uploadFileCmd(opts);
        return JSON.stringify({ success: true, message: `File '${input.destFile}' uploaded to share '${input.share}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "upload_file",
      description: "[MUTATING] Upload a file to an Azure File Share. Provide either 'source' (local path) or 'content' (inline text).",
      schema: z.object({
        share: z.string().describe("Share name"),
        destFile: z.string().describe("Destination file path within the share"),
        source: z.string().optional().describe("Local file path to upload"),
        content: z.string().optional().describe("Inline text content"),
        ...storageSchema,
      }),
    }
  );
}

// ── file-rename ───────────────────────────────────────────────────────────

export function createFileRenameTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts = { ...input, file: input.file, newName: input.newName };
        await renameFileCmd(opts);
        return JSON.stringify({
          success: true,
          message: `File '${input.file}' renamed to '${input.newName}'.`,
          oldPath: input.file,
          newPath: input.newName,
        });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "rename_file",
      description: "[MUTATING] Rename a file in an Azure File Share. Returns old and new paths so subsequent tools use the correct path.",
      schema: z.object({
        share: z.string().describe("Share name"),
        file: z.string().describe("Current file path"),
        newName: z.string().describe("New file path"),
        ...storageSchema,
      }),
    }
  );
}

// ── file-delete ───────────────────────────────────────────────────────────

export function createFileDeleteTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Delete file '${input.file}' from share '${input.share}' permanently.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        await deleteFileCmd({ ...input });
        return JSON.stringify({ success: true, message: `File '${input.file}' deleted.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_file",
      description: "[MUTATING][DESTRUCTIVE] Delete a file from an Azure File Share permanently. Requires user confirmation.",
      schema: z.object({
        share: z.string().describe("Share name"),
        file: z.string().describe("File path to delete"),
        ...storageSchema,
      }),
    }
  );
}

// ── file-delete-folder ────────────────────────────────────────────────────

export function createFileDeleteFolderTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Delete directory '${input.dirPath}' and all contents from share '${input.share}' permanently.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        await deleteFileFolderCmd({ ...input, path: input.dirPath });
        return JSON.stringify({ success: true, message: `Directory '${input.dirPath}' deleted from share '${input.share}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_file_folder",
      description: "[MUTATING][DESTRUCTIVE] Delete a directory and all its contents from an Azure File Share permanently. Requires user confirmation.",
      schema: z.object({
        share: z.string().describe("Share name"),
        dirPath: z.string().describe("Directory path to delete"),
        ...storageSchema,
      }),
    }
  );
}
