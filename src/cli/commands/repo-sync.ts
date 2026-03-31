import { BlobClient } from "../../core/blob-client.js";
import { GitHubClient } from "../../core/github-client.js";
import { DevOpsClient } from "../../core/devops-client.js";
import { cloneRepo, syncRepo, readSyncMeta } from "../../core/sync-engine.js";
import type { RepoProvider } from "../../core/sync-engine.js";
import { resolveStorageEntry, resolvePatToken, type StorageOpts, type PatOpts } from "./shared.js";

export async function cloneGitHub(
  repoUrl: string,
  container: string,
  storageOpts: StorageOpts,
  branch?: string,
  patOpts: PatOpts = {}
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

  const result = await cloneRepo(blobClient, container, provider, {
    provider: "github",
    repoUrl,
    branch: targetBranch,
  }, (msg) => console.log(`  ${msg}`));

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
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const pat = await resolvePatToken(store, "azure-devops", patOpts);
  const { org, project, repo } = DevOpsClient.parseRepoUrl(repoUrl);
  const client = new DevOpsClient(pat, org);
  const blobClient = new BlobClient(entry);

  const targetBranch = branch ?? await client.getDefaultBranch(project, repo);
  console.log(`Cloning ${org}/${project}/${repo} (branch: ${targetBranch}) into container '${container}'...\n`);

  const provider: RepoProvider = {
    listFiles: () => client.listFiles(project, repo, targetBranch),
    downloadFile: (path) => client.downloadFile(project, repo, path, targetBranch),
  };

  const result = await cloneRepo(blobClient, container, provider, {
    provider: "azure-devops",
    repoUrl,
    branch: targetBranch,
  }, (msg) => console.log(`  ${msg}`));

  console.log(`\nDone. Uploaded: ${result.uploaded.length}, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error("\nErrors:");
    for (const e of result.errors) console.error(`  ${e}`);
  }
}

export async function syncContainer(
  container: string,
  storageOpts: StorageOpts,
  dryRun: boolean = false,
  patOpts: PatOpts = {}
): Promise<void> {
  const { store, entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  const meta = await readSyncMeta(blobClient, container);
  if (!meta) {
    console.error(`Container '${container}' is not a synced repository.`);
    process.exit(1);
  }

  const pat = await resolvePatToken(store, meta.provider, patOpts);

  let provider: RepoProvider;

  if (meta.provider === "github") {
    const { owner, repo } = GitHubClient.parseRepoUrl(meta.repoUrl);
    const client = new GitHubClient(pat);
    provider = {
      listFiles: () => client.listFiles(owner, repo, meta.branch),
      downloadFile: (path) => client.downloadFile(owner, repo, path, meta.branch),
    };
  } else {
    const { org, project, repo } = DevOpsClient.parseRepoUrl(meta.repoUrl);
    const client = new DevOpsClient(pat, org);
    provider = {
      listFiles: () => client.listFiles(project, repo, meta.branch),
      downloadFile: (path) => client.downloadFile(project, repo, path, meta.branch),
    };
  }

  console.log(`Syncing container '${container}' with ${meta.provider} repo: ${meta.repoUrl} (branch: ${meta.branch})`);
  console.log(`Last sync: ${meta.lastSyncAt}`);
  if (dryRun) console.log("(Dry run — no changes will be made)\n");
  else console.log();

  const result = await syncRepo(blobClient, container, provider, dryRun, (msg) => console.log(`  ${msg}`));

  console.log(`\nUploaded: ${result.uploaded.length}, Deleted: ${result.deleted.length}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.error("\nErrors:");
    for (const e of result.errors) console.error(`  ${e}`);
  }
}
