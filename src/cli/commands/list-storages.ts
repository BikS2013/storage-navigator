import { CredentialStore } from "../../core/credential-store.js";

export function listStorages(): void {
  const store = new CredentialStore();
  const storages = store.listStorages();

  if (storages.length === 0) {
    console.log("No storage accounts configured.");
    console.log('Use "storage-nav add" to add one.');
    return;
  }

  console.log(`Configured storage accounts (${storages.length}):\n`);
  for (const s of storages) {
    const full = store.getStorage(s.name);
    const kind = full?.kind ?? 'direct';
    console.log(`  [${kind}] ${s.name}`);
    if (full && full.kind === 'api') {
      console.log(`    Base URL: ${full.baseUrl}`);
    } else {
      console.log(`    Account: ${s.accountName}`);
    }
    console.log(`    Added:   ${s.addedAt}`);
    console.log();
  }
}
