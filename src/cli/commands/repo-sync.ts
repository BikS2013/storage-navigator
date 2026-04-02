import { BlobClient } from "../../core/blob-client.js";
import { GitHubClient } from "../../core/github-client.js";
import { DevOpsClient } from "../../core/devops-client.js";
import { SshGitClient } from "../../core/ssh-git-client.js";
import { cloneRepo, syncRepo, readSyncMeta, resolveLinks, createLink, writeLinks, findLinkByPrefix } from "../../core/sync-engine.js";
import type { RepoProvider } from "../../core/sync-engine.js";
import type { RepoLink } from "../../core/types.js";
import { resolveStorageEntry, resolvePatToken, type StorageOpts, type PatOpts } from "./shared.js";

export async function cloneGitHub(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  patOpts: PatOpts = {},
  prefix?: string,
  repoPath?: string
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "github", patOpts);
  const { owner, repo } = GitHubClient.parseRepoUrl(repoUrl);
  const client = new GitHubClient(pat);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(owner, repo);
  console.log(`Cloning github.com/${owner}/${repo} (branch: ${targetBranch}) into container '${container}'...\n`);

  const provider: RepoProvider = {
    listFiles: () => client.listFiles(owner, repo, targetBranch),
    downloadFile: (path) => client.downloadFile(owner, repo, path, targetBranch),
  };

  if (prefix) console.log(`  Target prefix: ${prefix}`);
  if (repoPath) console.log(`  Repository sub-path: ${repoPath}`);

  // Create a link in the registry for this clone operation
  const { link, warning } = await createLink(blobClient, container, {
    provider: "github",
    repoUrl,
    branch: targetBranch,
    targetPrefix: prefix,
    repoSubPath: repoPath,
  });
  if (warning) console.error(`\n${warning}\n`);

  const result = await cloneRepo(blobClient, container, provider, link, (msg) => console.log(`  ${msg}`));

  // Write updated link (with fileShas and lastSyncAt) back to registry
  const registry = await resolveLinks(blobClient, container);
  const idx = registry.links.findIndex((l) => l.id === link.id);
  if (idx >= 0) registry.links[idx] = link;
  await writeLinks(blobClient, container, registry);

  console.log(`\nDone. Uploaded: ${result.uploaded.length}, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error("\nErrors:");
    for (const e of result.errors) console.error(`  ${e}`);
  }
}

export async function cloneDevOps(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  patOpts: PatOpts = {},
  prefix?: string,
  repoPath?: string
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "azure-devops", patOpts);
  const { org, project, repo } = DevOpsClient.parseRepoUrl(repoUrl);
  const client = new DevOpsClient(pat, org);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(project, repo);
  console.log(`Cloning ${org}/${project}/${repo} (branch: ${targetBranch}) into container '${container}'...\n`);
  if (prefix) console.log(`  Target prefix: ${prefix}`);
  if (repoPath) console.log(`  Repository sub-path: ${repoPath}`);

  const provider: RepoProvider = {
    listFiles: () => client.listFiles(project, repo, targetBranch),
    downloadFile: (path) => client.downloadFile(project, repo, path, targetBranch),
  };

  // Create a link in the registry for this clone operation
  const { link, warning } = await createLink(blobClient, container, {
    provider: "azure-devops",
    repoUrl,
    branch: targetBranch,
    targetPrefix: prefix,
    repoSubPath: repoPath,
  });
  if (warning) console.error(`\n${warning}\n`);

  const result = await cloneRepo(blobClient, container, provider, link, (msg) => console.log(`  ${msg}`));

  // Write updated link (with fileShas and lastSyncAt) back to registry
  const registry = await resolveLinks(blobClient, container);
  const idx = registry.links.findIndex((l) => l.id === link.id);
  if (idx >= 0) registry.links[idx] = link;
  await writeLinks(blobClient, container, registry);

  console.log(`\nDone. Uploaded: ${result.uploaded.length}, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error("\nErrors:");
    for (const e of result.errors) console.error(`  ${e}`);
  }
}

export async function cloneSsh(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  prefix?: string,
  repoPath?: string
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const sshClient = new SshGitClient();
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await sshClient.getDefaultBranch(repoUrl);
  const { repoName } = SshGitClient.parseRepoUrl(repoUrl);
  console.log(`Cloning ${repoName} via SSH (branch: ${targetBranch}) into container '${container}'...\n`);

  await sshClient.clone(repoUrl, targetBranch);

  const provider: RepoProvider = {
    listFiles: () => sshClient.listFiles(),
    downloadFile: (path) => sshClient.downloadFile(path),
  };

  try {
    const { link, warning } = await createLink(blobClient, container, {
      provider: "ssh",
      repoUrl,
      branch: targetBranch,
      targetPrefix: prefix,
      repoSubPath: repoPath,
    });
    if (warning) console.error(`\n${warning}\n`);

    const result = await cloneRepo(blobClient, container, provider, link, (msg) => console.log(`  ${msg}`));

    const registry = await resolveLinks(blobClient, container);
    const idx = registry.links.findIndex((l) => l.id === link.id);
    if (idx >= 0) registry.links[idx] = link;
    await writeLinks(blobClient, container, registry);

    console.log(`\nDone. Uploaded: ${result.uploaded.length}, Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.error("\nErrors:");
      for (const e of result.errors) console.error(`  ${e}`);
    }
  } finally {
    sshClient.cleanup();
  }
}

export async function syncContainer(
  container: string,
  storageOpts: StorageOpts,
  dryRun: boolean = false,
  patOpts: PatOpts = {},
  prefix?: string,
  linkId?: string,
  all: boolean = false
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  // Resolve links (auto-migrates from old .repo-sync-meta.json if needed)
  const registry = await resolveLinks(blobClient, container);
  if (registry.links.length === 0) {
    console.error(`Container '${container}' is not a synced repository. No links found.`);
    process.exit(1);
  }

  // Determine which links to sync
  let linksToSync: RepoLink[];

  if (all) {
    linksToSync = registry.links;
  } else if (linkId) {
    const found = registry.links.find((l) => l.id === linkId);
    if (!found) {
      console.error(`Link with ID '${linkId}' not found in container '${container}'.`);
      process.exit(1);
    }
    linksToSync = [found];
  } else if (prefix !== undefined) {
    linksToSync = [findLinkByPrefix(registry.links, prefix)];
  } else if (registry.links.length === 1) {
    linksToSync = [registry.links[0]];
  } else {
    console.error(`Container '${container}' has ${registry.links.length} links. Specify --prefix, --link-id, or --all.`);
    console.error("\nExisting links:");
    for (const l of registry.links) {
      console.error(`  ${l.id.slice(0, 8)}  ${l.provider}  ${l.repoUrl}  prefix: ${l.targetPrefix ?? "(root)"}`);
    }
    process.exit(1);
  }

  for (const link of linksToSync) {
    let provider: RepoProvider;
    let cleanup: (() => void) | undefined;

    if (link.provider === "ssh") {
      const sshClient = new SshGitClient();
      await sshClient.clone(link.repoUrl, link.branch);
      provider = {
        listFiles: () => sshClient.listFiles(),
        downloadFile: (path) => sshClient.downloadFile(path),
      };
      cleanup = () => sshClient.cleanup();
    } else {
      const pat = await resolvePatToken(store, link.provider as "github" | "azure-devops", patOpts);

      if (link.provider === "github") {
        const { owner, repo } = GitHubClient.parseRepoUrl(link.repoUrl);
        const client = new GitHubClient(pat);
        provider = {
          listFiles: () => client.listFiles(owner, repo, link.branch),
          downloadFile: (path) => client.downloadFile(owner, repo, path, link.branch),
        };
      } else {
        const { org, project, repo } = DevOpsClient.parseRepoUrl(link.repoUrl);
        const client = new DevOpsClient(pat, org);
        provider = {
          listFiles: () => client.listFiles(project, repo, link.branch),
          downloadFile: (path) => client.downloadFile(project, repo, path, link.branch),
        };
      }
    }

    console.log(`Syncing container '${container}' with ${link.provider} repo: ${link.repoUrl} (branch: ${link.branch})`);
    if (link.targetPrefix) console.log(`  Prefix: ${link.targetPrefix}`);
    console.log(`  Last sync: ${link.lastSyncAt ?? "never"}`);
    if (dryRun) console.log("  (Dry run — no changes will be made)\n");
    else console.log();

    try {
      const result = await syncRepo(blobClient, container, provider, link, dryRun, (msg) => console.log(`  ${msg}`));

      // Write updated link back to registry
      if (!dryRun) {
        const idx = registry.links.findIndex((l) => l.id === link.id);
        if (idx >= 0) registry.links[idx] = link;
        await writeLinks(blobClient, container, registry);
      }

      console.log(`\nUploaded: ${result.uploaded.length}, Deleted: ${result.deleted.length}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        console.error("\nErrors:");
        for (const e of result.errors) console.error(`  ${e}`);
      }
    } finally {
      cleanup?.();
    }

    if (linksToSync.length > 1) console.log(); // separator between links
  }
}
