import { CredentialStore } from "../../core/credential-store.js";
import type { DirectStorageEntry } from "../../core/types.js";

export function addStorage(name: string, account: string, sasToken?: string, accountKey?: string): void {
  if (!sasToken && !accountKey) {
    console.error("Error: Either --sas-token or --account-key must be provided.");
    process.exit(1);
  }
  const store = new CredentialStore();
  const entry: Omit<DirectStorageEntry, "addedAt"> = {
    kind: 'direct',
    name,
    accountName: account,
    sasToken,
    accountKey,
  };
  store.addStorage(entry);
  const authType = accountKey ? "account key" : "SAS token";
  console.log(`Storage '${name}' added successfully (account: ${account}, auth: ${authType}).`);
}
