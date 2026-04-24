/**
 * Tool adapters for personal access token management:
 *   list-tokens, add-token, remove-token
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";
import { truncateToolResult } from "./truncate.js";
import { handleToolError } from "./types.js";
import { confirmDestructive } from "./confirm.js";
import { CredentialStore } from "../../core/credential-store.js";
import { addToken, removeToken } from "../../cli/commands/token-ops.js";

// ── list-tokens ────────────────────────────────────────────────────────────

export function createListTokensTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async () => {
      try {
        const store = new CredentialStore();
        const tokens = store.listTokens();
        // Never return the actual token values — return metadata only
        const safeTokens = tokens.map((t) => ({
          name: t.name,
          provider: t.provider,
          addedAt: t.addedAt,
          expiresAt: t.expiresAt,
          isExpired: t.isExpired,
        }));
        return truncateToolResult(safeTokens, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_tokens",
      description: "List configured personal access tokens (GitHub, Azure DevOps). Returns metadata only — token values are never exposed.",
      schema: z.object({}),
    }
  );
}

// ── add-token ──────────────────────────────────────────────────────────────

export function createAddTokenTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        addToken(input.name, input.provider, input.token, input.expiresAt);
        return JSON.stringify({ success: true, message: `Token '${input.name}' (${input.provider}) added.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "add_token",
      description: "[MUTATING] Add a personal access token (GitHub or Azure DevOps) to the credential store.",
      schema: z.object({
        name: z.string().describe("Display name for this token"),
        provider: z.enum(["github", "azure-devops"]).describe("Token provider"),
        token: z.string().describe("Personal access token value"),
        expiresAt: z.string().optional().describe("Token expiration date in ISO 8601 format (e.g. 2026-12-31)"),
      }),
    }
  );
}

// ── remove-token ───────────────────────────────────────────────────────────

export function createRemoveTokenTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const result = await confirmDestructive(`Remove PAT token '${input.name}' from the credential store.`);
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        removeToken(input.name);
        return JSON.stringify({ success: true, message: `Token '${input.name}' removed.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "remove_token",
      description: "[MUTATING][DESTRUCTIVE] Remove a personal access token from the credential store. Requires user confirmation.",
      schema: z.object({
        name: z.string().describe("Name of the token to remove"),
      }),
    }
  );
}
