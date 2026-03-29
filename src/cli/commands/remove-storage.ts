import { CredentialStore } from "../../core/credential-store.js";

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
