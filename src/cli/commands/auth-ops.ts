import { CredentialStore } from '../../core/credential-store.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';

export async function login(name: string): Promise<void> {
  const store = new CredentialStore();
  const entry = store.getStorage(name);
  if (!entry || entry.kind !== 'api') {
    console.error(`No api backend named "${name}".`);
    process.exit(1);
  }
  if (!entry.authEnabled || !entry.oidc) {
    console.error(`Api backend "${name}" has authEnabled=false; nothing to log in to.`);
    process.exit(1);
  }
  console.log(`Re-running OIDC device-code login for ${name}...`);
  const tokens = await deviceCodeFlow({
    issuer: entry.oidc.issuer,
    clientId: entry.oidc.clientId,
    audience: entry.oidc.audience,
    scopes: entry.oidc.scopes,
  });
  await new TokenStore().save(name, tokens);
  console.log(`Login successful.`);
}

export async function logout(name: string): Promise<void> {
  await new TokenStore().delete(name);
  console.log(`Tokens for "${name}" cleared.`);
}
