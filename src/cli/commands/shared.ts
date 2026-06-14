import * as readline from "readline";
import { CredentialStore } from "../../core/credential-store.js";
import type { DirectStorageEntry, GitHubAppEntry, StorageEntry } from "../../core/types.js";
import type { IStorageBackend } from "../../core/backend/backend.js";
import { makeBackend } from "../../core/backend/factory.js";
import { generateInstallationToken } from "../../core/github-app-auth.js";

/**
 * Prompt the user for a secret value (input is visible — terminal limitation).
 */
export function promptSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt the user for a yes/no confirmation.
 */
export function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export interface StorageOpts {
  storage?: string;
  accountKey?: string;
  sasToken?: string;
  account?: string;
}

/**
 * Resolve a storage entry using the priority chain:
 * 1. Inline credentials (--account-key or --sas-token with --account)
 * 2. Named stored credential (--storage)
 * 3. First stored credential
 * Exits with error if no credential is available.
 */
export async function resolveStorageEntry(opts: StorageOpts): Promise<{ store: CredentialStore; entry: StorageEntry }> {
  const store = new CredentialStore();

  // 1. Inline credentials provided via CLI
  if (opts.accountKey || opts.sasToken) {
    const accountName = opts.account || opts.storage;
    if (!accountName) {
      console.error("--account (or --storage) is required when using inline --account-key or --sas-token.");
      process.exit(1);
    }
    const entry: DirectStorageEntry = {
      kind: 'direct',
      name: 'inline',
      accountName,
      accountKey: opts.accountKey,
      sasToken: opts.sasToken,
      addedAt: new Date().toISOString(),
    };
    return { store, entry };
  }

  // 2. Named stored credential
  if (opts.storage) {
    const entry = store.getStorage(opts.storage);
    if (entry) return { store, entry };
    console.error(`Storage '${opts.storage}' not found.`);
    process.exit(1);
  }

  // 3. First stored credential
  const first = store.getFirstStorage();
  if (first) return { store, entry: first };

  // No credential available — raise error (no interactive fallback)
  console.error("Error: No storage accounts configured.");
  console.error(`\nTo add a storage account, run:`);
  console.error(`  npx tsx src/cli/index.ts add --name <name> --account <account> --account-key <key>`);
  console.error(`\nOr provide credentials inline with --account-key <key> --account <name>`);
  process.exit(1);
}

export interface PatOpts {
  pat?: string;
  tokenName?: string;
}

/**
 * Resolve a PAT token using the priority chain:
 * 1. Inline PAT (--pat)
 * 2. Named stored token (--token-name)
 * 3. First stored token for the provider
 * Exits with error if no token is available.
 */
export async function resolvePatToken(
  store: CredentialStore,
  provider: "github" | "azure-devops",
  opts: PatOpts
): Promise<string> {
  // 1. Inline PAT
  if (opts.pat) return opts.pat;

  // 2. Named stored token
  if (opts.tokenName) {
    const token = store.getToken(opts.tokenName);
    if (token) return token.token;
    console.error(`Token '${opts.tokenName}' not found.`);
    process.exit(1);
  }

  // 3. First stored token for provider
  const token = store.getTokenByProvider(provider);
  if (token) return token.token;

  // No token available — raise error (no interactive fallback)
  console.error(`Error: No ${provider} personal access token configured.`);
  console.error(`\nTo add a token, run:`);
  console.error(`  npx tsx src/cli/index.ts add-token --name <name> --provider ${provider} --token <token>`);
  console.error(`\nOr provide one inline with --pat <token>`);
  process.exit(1);
}

/**
 * GitHub App credential options for CLI commands.
 */
export interface GitHubAppOpts {
  githubAppName?: string;
  githubAppInline?: string;  // JSON string
}

/**
 * Resolve GitHub credential (PAT or GitHub App installation token).
 * Precedence: --github-app-name > --github-app-inline > --pat > --token-name > first stored PAT
 */
export async function resolveGitHubCredential(
  store: CredentialStore,
  provider: "github" | "azure-devops",
  patOpts: PatOpts,
  appOpts: GitHubAppOpts
): Promise<{
  token: string;
  authType: "pat" | "github-app";
  credentialName: string;
}> {
  // 1. GitHub App inline
  if (appOpts.githubAppInline) {
    try {
      const appEntry = JSON.parse(appOpts.githubAppInline) as GitHubAppEntry;
      if (!appEntry.appId || !appEntry.privateKeyPem || !appEntry.installationId) {
        throw new Error("Missing required fields: appId, privateKeyPem, installationId");
      }
      const token = await generateInstallationToken(
        appEntry.appId,
        appEntry.privateKeyPem,
        appEntry.installationId
      );
      return { token, authType: "github-app", credentialName: "(inline)" };
    } catch (err) {
      throw new Error(`Invalid --github-app-inline JSON: ${(err as Error).message}`);
    }
  }
  
  // 2. GitHub App by name
  if (appOpts.githubAppName) {
    const appEntry = store.getGitHubApp(appOpts.githubAppName);
    if (!appEntry) {
      console.error(`GitHub App '${appOpts.githubAppName}' not found.`);
      console.error(`Run 'storage-nav list-github-apps' to see available credentials.`);
      process.exit(3);  // ConfigurationError
    }
    const token = await generateInstallationToken(
      appEntry.appId,
      appEntry.privateKeyPem,
      appEntry.installationId
    );
    return { token, authType: "github-app", credentialName: appOpts.githubAppName };
  }
  
  // 3. PAT resolution (existing chain)
  const pat = await resolvePatToken(store, provider, patOpts);
  const credName = patOpts.tokenName ?? "(first for provider)";
  return { token: pat, authType: "pat", credentialName: credName };
}

/**
 * Resolve a storage backend for CLI commands. Looks up the named entry from
 * the credential store (or falls back to inline --account-key/--sas-token
 * for direct mode), then dispatches via the backend factory.
 *
 * For api-backend kinds, `accountName` is required (becomes the {account}
 * path segment in API URLs).
 */
export async function resolveStorageBackend(
  opts: StorageOpts,
  accountName?: string,
): Promise<{ entry: StorageEntry; backend: IStorageBackend }> {
  const { entry } = await resolveStorageEntry(opts);
  if (entry.kind === 'api') {
    if (!accountName) throw new Error('--account is required when using an api backend');
    return { entry, backend: makeBackend(entry, accountName) };
  }
  return { entry, backend: makeBackend(entry) };
}
