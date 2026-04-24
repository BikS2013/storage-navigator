import { CredentialStore } from "../../core/credential-store.js";
import { promptYesNo } from "./shared.js";

export function removeStorage(name: string): void {
  const store = new CredentialStore();
  const removed = store.removeStorage(name);
  if (removed) {
    console.log(`Storage '${name}' removed.`);
  } else {
    console.error(`Storage '${name}' not found.`);
    process.exit(1);
  }
}

export async function deleteStorage(name: string, force: boolean = false): Promise<void> {
  const store = new CredentialStore();
  const entry = store.getStorage(name);
  if (!entry) {
    console.error(`Storage '${name}' not found.`);
    process.exit(1);
  }

  if (!force) {
    const target =
      entry.kind === 'direct' ? `Azure account: ${entry.accountName}` : `API backend: ${entry.baseUrl}`;
    const confirmed = await promptYesNo(
      `Delete storage account '${name}' (${target})? This only removes the local credential — remote data is not touched.`
    );
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  const removed = store.removeStorage(name);
  if (removed) {
    console.log(`Storage '${name}' deleted.`);
  } else {
    console.error(`Failed to delete storage '${name}'.`);
    process.exit(1);
  }
}
