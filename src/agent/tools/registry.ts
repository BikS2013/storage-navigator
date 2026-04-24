/**
 * Tool catalog builder.
 *
 * Read-only tools are always included.
 * Mutating tools (prefixed [MUTATING]) are excluded unless cfg.allowMutations === true.
 * Destructive tools (prefixed [MUTATING][DESTRUCTIVE]) require user confirmation before executing.
 * An optional toolsAllowlist further filters the catalog by tool name.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentConfig } from "../../config/agent-config.js";

// Storage management
import {
  createListStoragesTool,
  createAddStorageTool,
  createRemoveStorageTool,
  createDeleteStorageTool,
  createAddApiTool,
  createLoginTool,
  createLogoutTool,
} from "./storage-tools.js";

// Blob operations
import {
  createListContainersTool,
  createListBlobsTool,
  createViewBlobTool,
  createDownloadBlobTool,
  createCreateBlobTool,
  createRenameBlobTool,
  createDeleteBlobTool,
  createDeleteFolderTool,
} from "./blob-tools.js";

// Token management
import {
  createListTokensTool,
  createAddTokenTool,
  createRemoveTokenTool,
} from "./token-tools.js";

// Repository integration
import {
  createListLinksTool,
  createCloneGitHubTool,
  createCloneDevOpsTool,
  createSyncTool,
  createLinkGitHubTool,
  createLinkDevOpsTool,
  createUnlinkTool,
  createDiffTool,
} from "./repo-tools.js";

// File share operations
import {
  createListSharesTool,
  createShareCreateTool,
  createShareDeleteTool,
  createListDirTool,
  createFileViewTool,
  createFileUploadTool,
  createFileRenameTool,
  createFileDeleteTool,
  createFileDeleteFolderTool,
} from "./share-tools.js";

export function buildToolCatalog(cfg: AgentConfig): StructuredToolInterface[] {
  // Read-only tools — always available
  const readOnly: StructuredToolInterface[] = [
    createListStoragesTool(cfg),
    createListContainersTool(cfg),
    createListBlobsTool(cfg),
    createViewBlobTool(cfg),
    createDownloadBlobTool(cfg),
    createListTokensTool(cfg),
    createListLinksTool(cfg),
    createDiffTool(cfg),
    createListSharesTool(cfg),
    createListDirTool(cfg),
    createFileViewTool(cfg),
  ];

  // Mutating (non-destructive) — only when --allow-mutations is set
  const mutatingNonDestructive: StructuredToolInterface[] = cfg.allowMutations
    ? [
        createAddStorageTool(cfg),
        createAddApiTool(cfg),
        createLoginTool(cfg),
        createCreateBlobTool(cfg),
        createRenameBlobTool(cfg),
        createAddTokenTool(cfg),
        createCloneGitHubTool(cfg),
        createCloneDevOpsTool(cfg),
        createSyncTool(cfg),
        createLinkGitHubTool(cfg),
        createLinkDevOpsTool(cfg),
        createShareCreateTool(cfg),
        createFileUploadTool(cfg),
        createFileRenameTool(cfg),
      ]
    : [];

  // Destructive — only when --allow-mutations is set (additionally require runtime confirmation)
  const destructive: StructuredToolInterface[] = cfg.allowMutations
    ? [
        createRemoveStorageTool(cfg),
        createDeleteStorageTool(cfg),
        createLogoutTool(cfg),
        createDeleteBlobTool(cfg),
        createDeleteFolderTool(cfg),
        createRemoveTokenTool(cfg),
        createUnlinkTool(cfg),
        createShareDeleteTool(cfg),
        createFileDeleteTool(cfg),
        createFileDeleteFolderTool(cfg),
      ]
    : [];

  let all = [...readOnly, ...mutatingNonDestructive, ...destructive];

  // Apply optional tool allowlist
  if (cfg.toolsAllowlist) {
    const allow = new Set(cfg.toolsAllowlist);
    all = all.filter((t) => allow.has(t.name));
  }

  return all;
}
