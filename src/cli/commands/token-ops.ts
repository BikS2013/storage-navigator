import { CredentialStore } from "../../core/credential-store.js";

export function addToken(
  name: string,
  provider: "github" | "azure-devops",
  token: string,
  expiresAt?: string
): void {
  const store = new CredentialStore();
  store.addToken({ name, provider, token, expiresAt });
  console.log(`Token '${name}' (${provider}) added successfully.`);
}

export function listTokens(): void {
  const store = new CredentialStore();
  const tokens = store.listTokens();
  if (tokens.length === 0) {
    console.log("No tokens configured.");
    console.log('Use "storage-nav add-token" to add one.');
    return;
  }
  console.log(`Configured tokens (${tokens.length}):\n`);
  for (const t of tokens) {
    let status = "";
    if (t.expiresAt) {
      if (t.isExpired) status = " [EXPIRED]";
      else {
        const days = Math.ceil((new Date(t.expiresAt).getTime() - Date.now()) / 86400000);
        if (days < 14) status = ` [${days}d left]`;
      }
    }
    console.log(`  ${t.name}${status}`);
    console.log(`    Provider: ${t.provider}`);
    console.log(`    Added:    ${t.addedAt}`);
    if (t.expiresAt) console.log(`    Expires:  ${t.expiresAt}`);
    console.log();
  }
}

export function removeToken(name: string): void {
  const store = new CredentialStore();
  const removed = store.removeToken(name);
  if (removed) {
    console.log(`Token '${name}' removed.`);
  } else {
    console.error(`Token '${name}' not found.`);
    process.exit(1);
  }
}
