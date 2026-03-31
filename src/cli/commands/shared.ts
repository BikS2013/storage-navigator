import * as readline from "readline";
import { CredentialStore } from "../../core/credential-store.js";
import type { StorageEntry } from "../../core/types.js";

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
 * 4. Prompt the user interactively and offer to store
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
    const entry: StorageEntry = {
      name: accountName,
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

  // 4. Prompt the user
  console.log("No storage accounts configured.");
  const accountName = await promptSecret("Azure Storage account name: ");
  const authChoice = await promptSecret("Auth type (key/sas): ");
  let accountKey: string | undefined;
  let sasToken: string | undefined;

  if (authChoice === "sas") {
    sasToken = await promptSecret("SAS token: ");
  } else {
    accountKey = await promptSecret("Account key: ");
  }

  const entry: StorageEntry = { name: accountName, accountName, accountKey, sasToken, addedAt: new Date().toISOString() };

  const save = await promptYesNo("Store this credential for future use?");
  if (save) {
    store.addStorage({ name: accountName, accountName, accountKey, sasToken });
    console.log(`Storage '${accountName}' saved.`);
  }

  return { store, entry };
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
 * 4. Prompt the user interactively and offer to store
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

  // 4. Prompt the user
  console.log(`No ${provider} token configured.`);
  const pat = await promptSecret(`${provider} personal access token: `);

  const save = await promptYesNo("Store this token for future use?");
  if (save) {
    const name = await promptSecret("Token display name: ");
    store.addToken({ name, provider, token: pat });
    console.log(`Token '${name}' saved.`);
  }

  return pat;
}
