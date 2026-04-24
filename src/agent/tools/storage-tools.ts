/**
 * Tool adapters for storage account management commands:
 *   list, add, remove, delete-storage, add-api, login, logout
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";
import { truncateToolResult } from "./truncate.js";
import { handleToolError } from "./types.js";
import { confirmDestructive } from "./confirm.js";
import { listStorages } from "../../cli/commands/list-storages.js";
import { addStorage } from "../../cli/commands/add-storage.js";
import { removeStorage, deleteStorage } from "../../cli/commands/remove-storage.js";
import { addApi } from "../../cli/commands/add-api.js";
import { login, logout } from "../../cli/commands/auth-ops.js";
import { CredentialStore } from "../../core/credential-store.js";

// ── list ────────────────────────────────────────────────────────────────────

export function createListStoragesTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async () => {
      try {
        const store = new CredentialStore();
        const storages = store.listStorages();
        return truncateToolResult(storages, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_storages",
      description: "List all configured Azure Storage accounts and API backends. Returns name, kind (direct/api), accountName or baseUrl, and addedAt.",
      schema: z.object({}),
    }
  );
}

// ── add ────────────────────────────────────────────────────────────────────

export function createAddStorageTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        addStorage(input.name, input.account, input.sasToken, input.accountKey);
        return JSON.stringify({ success: true, message: `Storage '${input.name}' added.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "add_storage",
      description: "[MUTATING] Add a new Azure Storage account to the local credential store. Provide either accountKey (recommended, full access) or sasToken.",
      schema: z.object({
        name: z.string().describe("Display name for this storage account"),
        account: z.string().describe("Azure Storage account name"),
        accountKey: z.string().optional().describe("Account key for full access (recommended)"),
        sasToken: z.string().optional().describe("SAS token (alternative to account key)"),
      }),
    }
  );
}

// ── remove ─────────────────────────────────────────────────────────────────

export function createRemoveStorageTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Remove storage '${input.name}' from the credential store. Remote Azure data is NOT deleted.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        removeStorage(input.name);
        return JSON.stringify({ success: true, message: `Storage '${input.name}' removed.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "remove_storage",
      description: "[MUTATING][DESTRUCTIVE] Remove a storage account from the local credential store. Only removes the local credential — Azure data is NOT deleted. Requires user confirmation.",
      schema: z.object({
        name: z.string().describe("Name of the storage account to remove"),
      }),
    }
  );
}

// ── delete-storage ─────────────────────────────────────────────────────────

export function createDeleteStorageTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const store = new CredentialStore();
        const entry = store.getStorage(input.name);
        if (!entry) return JSON.stringify({ error: { code: "NOT_FOUND", message: `Storage '${input.name}' not found.` } });
        const target = entry.kind === "direct" ? `Azure account: ${entry.accountName}` : `API backend: ${entry.baseUrl}`;
        const result = await confirmDestructive(`Delete storage '${input.name}' (${target}) from the credential store. Remote data is NOT deleted.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        await deleteStorage(input.name, true); // force=true since we already confirmed
        return JSON.stringify({ success: true, message: `Storage '${input.name}' deleted.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "delete_storage",
      description: "[MUTATING][DESTRUCTIVE] Delete a storage account from the local credential store (same as remove_storage but with explicit confirmation step). Remote Azure data is NOT deleted.",
      schema: z.object({
        name: z.string().describe("Name of the storage account to delete"),
      }),
    }
  );
}

// ── add-api ────────────────────────────────────────────────────────────────

export function createAddApiTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        await addApi(input.name, input.baseUrl, { staticSecret: input.staticSecret });
        return JSON.stringify({ success: true, message: `API backend '${input.name}' registered.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "add_api_backend",
      description: "[MUTATING] Register a Storage Navigator API backend. Probes the discovery endpoint and runs OIDC login if the API requires authentication.",
      schema: z.object({
        name: z.string().describe("Display name for the API backend"),
        baseUrl: z.string().describe("API base URL (e.g. https://your-api.azurewebsites.net)"),
        staticSecret: z.string().optional().describe("Value for the static auth header (when the API requires it)"),
      }),
    }
  );
}

// ── login ──────────────────────────────────────────────────────────────────

export function createLoginTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        await login(input.name, { staticSecret: input.staticSecret });
        return JSON.stringify({ success: true, message: `Login for '${input.name}' completed.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "login_api_backend",
      description: "[MUTATING] Re-run OIDC login for an existing API backend (e.g. after token expiry or static-header rotation).",
      schema: z.object({
        name: z.string().describe("API backend name"),
        staticSecret: z.string().optional().describe("New static-header value (after rotation)"),
      }),
    }
  );
}

// ── logout ─────────────────────────────────────────────────────────────────

export function createLogoutTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Clear stored OIDC tokens for API backend '${input.name}'.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        await logout(input.name);
        return JSON.stringify({ success: true, message: `Tokens for '${input.name}' cleared.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "logout_api_backend",
      description: "[MUTATING][DESTRUCTIVE] Clear stored OIDC tokens for an API backend. Requires user confirmation.",
      schema: z.object({
        name: z.string().describe("API backend name"),
      }),
    }
  );
}
