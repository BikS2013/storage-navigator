import { BlobClient } from "../../core/blob-client.js";
import { GitHubClient } from "../../core/github-client.js";
import { DevOpsClient } from "../../core/devops-client.js";
import { SshGitClient } from "../../core/ssh-git-client.js";
import { createLink, removeLink, resolveLinks, findLinkByPrefix } from "../../core/sync-engine.js";
import type { RepoLink } from "../../core/types.js";
import { resolveStorageEntry, resolvePatToken, promptYesNo, type StorageOpts, type PatOpts } from "./shared.js";

/**
 * Create a metadata-only link from a GitHub repository to a container (no file download).
 */
export async function linkGitHub(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  prefix?: string,
  repoPath?: string,
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "github", patOpts);
  const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
  const client = new GitHubClient(pat);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(owner, repo);

  console.log(`Linking github.com/${owner}/${repo} (branch: ${targetBranch}) to container '${container}'...`);
  if (prefix) console.log(`  Target prefix: ${prefix}`);
  if (repoPath) console.log(`  Repository sub-path: ${repoPath}`);

  const { link, warning } = await createLink(blobClient, container, {
    provider: "github",
    repoUrl,
    branch: targetBranch,
    targetPrefix: prefix,
    repoSubPath: repoPath,
  });

  if (warning) console.error(`\n${warning}\n`);

  console.log(`\nLink created successfully. ID: ${link.id}`);
  console.log("No files were downloaded. Use 'sync' to download files.");
}

/**
 * Create a metadata-only link from an Azure DevOps repository to a container (no file download).
 */
export async function linkDevOps(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  prefix?: string,
  repoPath?: string,
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "azure-devops", patOpts);
  const { org, project, repo } = DevOpsClient.parseRepoUrl(repoUrl);
  const client = new DevOpsClient(pat, org);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(project, repo);

  console.log(`Linking ${org}/${project}/${repo} (branch: ${targetBranch}) to container '${container}'...`);
  if (prefix) console.log(`  Target prefix: ${prefix}`);
  if (repoPath) console.log(`  Repository sub-path: ${repoPath}`);

  const { link, warning } = await createLink(blobClient, container, {
    provider: "azure-devops",
    repoUrl,
    branch: targetBranch,
    targetPrefix: prefix,
    repoSubPath: repoPath,
  });

  if (warning) console.error(`\n${warning}\n`);

  console.log(`\nLink created successfully. ID: ${link.id}`);
  console.log("No files were downloaded. Use 'sync' to download files.");
}

/**
 * Create a metadata-only link from an SSH-accessible repository to a container.
 * Uses the system's SSH agent/keys — no PAT needed.
 */
export async function linkSsh(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  prefix?: string,
  repoPath?: string
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  // Resolve default branch via git ls-remote (uses SSH)
  const sshClient = new SshGitClient();
  const targetBranch = branch ?? await sshClient.getDefaultBranch(repoUrl);

  const { link, warning } = await createLink(blobClient, container, {
    provider: "ssh",
    repoUrl,
    branch: targetBranch,
    targetPrefix: prefix,
    repoSubPath: repoPath,
  });
  if (warning) console.error(`\n${warning}\n`);

  const { repoName } = SshGitClient.parseRepoUrl(repoUrl);
  console.log(`Linked ${repoName} (SSH, branch: ${targetBranch}) to container '${container}'${prefix ? ` at prefix '${prefix}'` : ""}.`);
  console.log(`Link ID: ${link.id}`);
  console.log("\nRun 'sync' to download files from the repository.");
}

/**
 * Remove a link from a container's registry.
 * Finds the link by --link-id, --prefix, or auto-selects if only one link exists.
 */
export async function unlinkContainer(
  container: string,
  storageOpts: StorageOpts,
  linkId?: string,
  prefix?: string
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  const registry = await resolveLinks(blobClient, container);
  if (registry.links.length === 0) {
    console.error(`Container '${container}' has no repository links.`);
    process.exit(1);
  }

  let targetLink: RepoLink;

  if (linkId) {
    const found = registry.links.find((l) => l.id === linkId);
    if (!found) {
      console.error(`Link with ID '${linkId}' not found in container '${container}'.`);
      process.exit(1);
    }
    targetLink = found;
  } else if (prefix !== undefined) {
    targetLink = findLinkByPrefix(registry.links, prefix);
  } else if (registry.links.length === 1) {
    targetLink = registry.links[0];
  } else {
    console.error(`Container '${container}' has ${registry.links.length} links. Specify --link-id or --prefix to identify which link to remove.`);
    console.error("\nExisting links:");
    for (const l of registry.links) {
      console.error(`  ${l.id.slice(0, 8)}  ${l.provider}  ${l.repoUrl}  prefix: ${l.targetPrefix ?? "(root)"}`);
    }
    process.exit(1);
  }

  console.log(`About to unlink: ${targetLink.repoUrl} (branch: ${targetLink.branch})`);
  if (targetLink.targetPrefix) console.log(`  Prefix: ${targetLink.targetPrefix}`);
  console.log("  Synced files will NOT be deleted.");

  const confirmed = await promptYesNo("Proceed?");
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  const removed = await removeLink(blobClient, container, targetLink.id);
  if (removed) {
    console.log("Link removed successfully.");
  } else {
    console.error("Failed to remove link.");
    process.exit(1);
  }
}

/**
 * List all repository links in a container.
 */
export async function listLinks(
  container: string,
  storageOpts: StorageOpts
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  const registry = await resolveLinks(blobClient, container);
  if (registry.links.length === 0) {
    console.log("No repository links found.");
    return;
  }

  // Print header
  const header = [
    "ID".padEnd(10),
    "Provider".padEnd(14),
    "Repository URL".padEnd(50),
    "Branch".padEnd(16),
    "Prefix".padEnd(20),
    "Repo Sub-Path".padEnd(20),
    "Last Sync",
  ].join("  ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const link of registry.links) {
    const row = [
      link.id.slice(0, 8).padEnd(10),
      link.provider.padEnd(14),
      (link.repoUrl.length > 48 ? link.repoUrl.slice(0, 47) + "..." : link.repoUrl).padEnd(50),
      link.branch.padEnd(16),
      (link.targetPrefix ?? "(root)").padEnd(20),
      (link.repoSubPath ?? "(all)").padEnd(20),
      link.lastSyncAt ?? "never",
    ].join("  ");
    console.log(row);
  }
}
