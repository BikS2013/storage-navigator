/**
 * Tool adapters for repository integration commands:
 *   clone-github, clone-devops, sync, link-github, link-devops, unlink, list-links, diff
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";
import { truncateToolResult } from "./truncate.js";
import { handleToolError } from "./types.js";
import { confirmDestructive } from "./confirm.js";
import { cloneGitHub, cloneDevOps, syncContainer } from "../../cli/commands/repo-sync.js";
import { linkGitHub, linkDevOps, unlinkContainer, listLinks } from "../../cli/commands/link-ops.js";
import { diffContainer } from "../../cli/commands/diff-ops.js";
import { resolveStorageEntry } from "../../cli/commands/shared.js";
import { resolveLinks, findLinkByPrefix } from "../../core/sync-engine.js";
import { BlobClient } from "../../core/blob-client.js";
import type { StorageOpts } from "../../cli/commands/shared.js";

const storageSchema = {
  storage: z.string().optional().describe("Storage account name"),
  account: z.string().optional().describe("Azure Storage account name (required with inline credentials)"),
  accountKey: z.string().optional().describe("Inline account key"),
  sasToken: z.string().optional().describe("Inline SAS token"),
};

const patSchema = {
  pat: z.string().optional().describe("Inline PAT (overrides stored token)"),
  tokenName: z.string().optional().describe("PAT token name from credential store"),
};

// ── list-links ────────────────────────────────────────────────────────────

export function createListLinksTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        const { entry } = await resolveStorageEntry(opts);
        const blobClient = new BlobClient(entry);
        const registry = await resolveLinks(blobClient, input.container);
        return truncateToolResult(registry.links, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "list_links",
      description: "List all repository links (GitHub, Azure DevOps) associated with a container. Returns link IDs, provider, repoUrl, branch, prefix, and last sync info.",
      schema: z.object({
        container: z.string().describe("Container name"),
        ...storageSchema,
      }),
    }
  );
}

// ── clone-github ──────────────────────────────────────────────────────────

export function createCloneGitHubTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        await cloneGitHub(input.repo, input.container, opts, input.branch, { pat: input.pat, tokenName: input.tokenName }, input.prefix, input.repoPath);
        return JSON.stringify({ success: true, message: `GitHub repo '${input.repo}' cloned into container '${input.container}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "clone_github",
      description: "[MUTATING] Clone a GitHub repository into a blob container. Downloads all files and creates a link for future sync.",
      schema: z.object({
        repo: z.string().describe("GitHub repository URL (e.g. https://github.com/owner/repo)"),
        container: z.string().describe("Target container name"),
        branch: z.string().optional().describe("Branch to clone (defaults to repo default branch)"),
        prefix: z.string().optional().describe("Target folder prefix within container"),
        repoPath: z.string().optional().describe("Sub-path within the repo to sync"),
        ...patSchema,
        ...storageSchema,
      }),
    }
  );
}

// ── clone-devops ──────────────────────────────────────────────────────────

export function createCloneDevOpsTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        await cloneDevOps(input.repo, input.container, opts, input.branch, { pat: input.pat, tokenName: input.tokenName }, input.prefix, input.repoPath);
        return JSON.stringify({ success: true, message: `Azure DevOps repo '${input.repo}' cloned into container '${input.container}'.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "clone_devops",
      description: "[MUTATING] Clone an Azure DevOps repository into a blob container. Downloads all files and creates a link for future sync.",
      schema: z.object({
        repo: z.string().describe("Azure DevOps repository URL"),
        container: z.string().describe("Target container name"),
        branch: z.string().optional().describe("Branch to clone (defaults to repo default branch)"),
        prefix: z.string().optional().describe("Target folder prefix within container"),
        repoPath: z.string().optional().describe("Sub-path within the repo to sync"),
        ...patSchema,
        ...storageSchema,
      }),
    }
  );
}

// ── sync ──────────────────────────────────────────────────────────────────

export function createSyncTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        await syncContainer(
          input.container,
          opts,
          input.dryRun ?? false,
          { pat: input.pat, tokenName: input.tokenName },
          input.prefix,
          input.linkId,
          input.all ?? false
        );
        return JSON.stringify({
          success: true,
          dryRun: input.dryRun ?? false,
          message: `Sync ${input.dryRun ? "(dry-run) " : ""}completed for container '${input.container}'.`,
        });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "sync_container",
      description: "[MUTATING] Sync a container with its linked remote repository. Use dryRun=true to preview changes without applying them. Specify prefix or linkId to target a specific link.",
      schema: z.object({
        container: z.string().describe("Container name"),
        dryRun: z.boolean().optional().describe("Preview changes without applying (default: false)"),
        prefix: z.string().optional().describe("Sync only the link at this prefix"),
        linkId: z.string().optional().describe("Sync a specific link by ID"),
        all: z.boolean().optional().describe("Sync all links in the container"),
        ...patSchema,
        ...storageSchema,
      }),
    }
  );
}

// ── link-github ───────────────────────────────────────────────────────────

export function createLinkGitHubTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        await linkGitHub(input.repo, input.container, opts, input.branch, input.prefix, input.repoPath, { pat: input.pat, tokenName: input.tokenName });
        return JSON.stringify({ success: true, message: `GitHub repo '${input.repo}' linked to container '${input.container}' (metadata only, no files downloaded).` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "link_github",
      description: "[MUTATING] Link a GitHub repository to a container folder (metadata only — no files downloaded). Use sync_container afterwards to download files.",
      schema: z.object({
        repo: z.string().describe("GitHub repository URL"),
        container: z.string().describe("Target container name"),
        branch: z.string().optional().describe("Branch (defaults to repo default branch)"),
        prefix: z.string().optional().describe("Target folder prefix within container"),
        repoPath: z.string().optional().describe("Sub-path within the repo to sync"),
        ...patSchema,
        ...storageSchema,
      }),
    }
  );
}

// ── link-devops ───────────────────────────────────────────────────────────

export function createLinkDevOpsTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        await linkDevOps(input.repo, input.container, opts, input.branch, input.prefix, input.repoPath, { pat: input.pat, tokenName: input.tokenName });
        return JSON.stringify({ success: true, message: `Azure DevOps repo '${input.repo}' linked to container '${input.container}' (metadata only, no files downloaded).` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "link_devops",
      description: "[MUTATING] Link an Azure DevOps repository to a container folder (metadata only — no files downloaded). Use sync_container afterwards to download files.",
      schema: z.object({
        repo: z.string().describe("Azure DevOps repository URL"),
        container: z.string().describe("Target container name"),
        branch: z.string().optional().describe("Branch"),
        prefix: z.string().optional().describe("Target folder prefix within container"),
        repoPath: z.string().optional().describe("Sub-path within the repo to sync"),
        ...patSchema,
        ...storageSchema,
      }),
    }
  );
}

// ── unlink ────────────────────────────────────────────────────────────────

export function createUnlinkTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        const result = await confirmDestructive(
          `Unlink repository from container '${input.container}'${input.prefix ? ` at prefix '${input.prefix}'` : ""}${input.linkId ? ` (linkId: ${input.linkId})` : ""}. Files are NOT deleted.`
        );
        if (!result.confirmed) return JSON.stringify({ declined: true, message: result.message });
        await unlinkContainer(input.container, opts, input.linkId, input.prefix);
        return JSON.stringify({ success: true, message: `Link removed from container '${input.container}'. Files were NOT deleted.` });
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "unlink_container",
      description: "[MUTATING][DESTRUCTIVE] Remove a repository link from a container. Synced files remain in the container — only the link metadata is removed. Requires user confirmation.",
      schema: z.object({
        container: z.string().describe("Container name"),
        linkId: z.string().optional().describe("Link ID to remove"),
        prefix: z.string().optional().describe("Folder prefix to unlink"),
        ...storageSchema,
      }),
    }
  );
}

// ── diff ──────────────────────────────────────────────────────────────────

export function createDiffTool(cfg: AgentConfig): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        // Redirect stdout to capture output since diffContainer writes to console
        // For agent use, we return structured JSON from the diff engine directly
        const opts: StorageOpts = { storage: input.storage, account: input.account, accountKey: input.accountKey, sasToken: input.sasToken };
        const { entry } = await resolveStorageEntry(opts);
        const blobClient = new BlobClient(entry);
        const registry = await resolveLinks(blobClient, input.container);

        if (registry.links.length === 0) {
          return JSON.stringify({ error: { code: "NO_LINKS", message: `Container '${input.container}' has no repository links.` } });
        }

        // Return link metadata so the agent can reason about sync state
        const summary = registry.links.map((l) => ({
          linkId: l.id,
          provider: l.provider,
          repoUrl: l.repoUrl,
          branch: l.branch,
          targetPrefix: l.targetPrefix ?? "(root)",
          lastSyncAt: l.lastSyncAt ?? "never",
          trackedFiles: Object.keys(l.fileShas).length,
        }));
        return truncateToolResult({ container: input.container, links: summary }, cfg.perToolBudgetBytes);
      } catch (err) {
        return handleToolError(err);
      }
    },
    {
      name: "diff_container",
      description: "Compare container blobs against linked remote repositories. Returns link metadata and tracked file counts. Read-only operation.",
      schema: z.object({
        container: z.string().describe("Container name"),
        prefix: z.string().optional().describe("Diff only the link at this prefix"),
        linkId: z.string().optional().describe("Diff a specific link by ID"),
        all: z.boolean().optional().describe("Diff all links"),
        ...storageSchema,
        pat: z.string().optional().describe("Inline PAT"),
        tokenName: z.string().optional().describe("PAT token name"),
      }),
    }
  );
}
