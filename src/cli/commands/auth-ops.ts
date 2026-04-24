import { CredentialStore } from '../../core/credential-store.js';
import type { ApiBackendEntry } from '../../core/types.js';
import { fetchDiscovery } from '../../core/backend/auth/discovery.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';
import { promptSecret } from './shared.js';

export async function login(name: string, opts: { staticSecret?: string } = {}): Promise<void> {
  const store = new CredentialStore();
  const entry = store.getStorage(name);
  if (!entry || entry.kind !== 'api') {
    console.error(`No api backend named "${name}".`);
    process.exit(1);
  }

  // Re-probe discovery so we reconcile any operator-side changes (gate added/removed).
  const discovery = await fetchDiscovery(entry.baseUrl);

  // Static-header reconciliation
  let staticAuthHeader = entry.staticAuthHeader;
  if (discovery.staticAuthHeaderRequired) {
    const headerName = discovery.staticAuthHeaderName!;
    if (opts.staticSecret) {
      // Operator passed a new value (rotation case)
      staticAuthHeader = { name: headerName, value: opts.staticSecret };
    } else if (!staticAuthHeader) {
      // Gate was added after registration — prompt
      const value = await promptSecret(`Enter ${headerName} value: `);
      if (!value) {
        console.error(`A value for ${headerName} is required.`);
        process.exit(1);
      }
      staticAuthHeader = { name: headerName, value };
    } else if (staticAuthHeader.name !== headerName) {
      // Header NAME changed; preserve value but update name
      staticAuthHeader = { name: headerName, value: staticAuthHeader.value };
    }
  } else if (entry.staticAuthHeader) {
    console.log(`Note: API no longer requires a static header. The stored value is harmless but unused; remove + re-add to clear it.`);
  }

  // Persist any change to staticAuthHeader before OIDC step
  if (staticAuthHeader !== entry.staticAuthHeader) {
    const updated: Omit<ApiBackendEntry, 'addedAt'> = {
      kind: 'api',
      name: entry.name,
      baseUrl: entry.baseUrl,
      authEnabled: entry.authEnabled,
      oidc: entry.oidc,
      staticAuthHeader,
    };
    store.removeStorage(name);
    store.addStorage(updated);
  }

  if (!discovery.authEnabled) {
    console.log(`API "${name}" is auth-off; nothing to log in to. Static header (if any) preserved.`);
    return;
  }
  if (!entry.oidc) {
    console.error(`Api backend "${name}" lacks oidc config but discovery says authEnabled=true. Re-register.`);
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
