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
    const confirmed = await promptYesNo(
      `Delete storage account '${name}' (Azure account: ${entry.accountName})? This only removes the local credential — blobs in Azure are not touched.`
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
