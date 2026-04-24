import { CredentialStore } from '../../core/credential-store.js';
import type { ApiBackendEntry } from '../../core/types.js';
import { fetchDiscovery } from '../../core/backend/auth/discovery.js';
import { deviceCodeFlow } from '../../core/backend/auth/oidc-client.js';
import { TokenStore } from '../../core/backend/auth/token-store.js';
import { promptSecret } from './shared.js';

export async function addApi(name: string, baseUrl: string, opts: { staticSecret?: string } = {}): Promise<void> {
  const store = new CredentialStore();
  if (store.getStorage(name)) {
    console.error(`Storage with name "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`Probing ${baseUrl} ...`);
  const discovery = await fetchDiscovery(baseUrl);
  console.log(`  authEnabled = ${discovery.authEnabled}`);
  if (discovery.staticAuthHeaderRequired) {
    console.log(`  staticAuthHeaderRequired = true (header: ${discovery.staticAuthHeaderName})`);
  }

  let staticAuthHeader: { name: string; value: string } | undefined;
  if (discovery.staticAuthHeaderRequired) {
    const headerName = discovery.staticAuthHeaderName!;
    const value = opts.staticSecret ?? await promptSecret(`Enter ${headerName} value: `);
    if (!value) {
      console.error(`A value for ${headerName} is required.`);
      process.exit(1);
    }
    staticAuthHeader = { name: headerName, value };
  }

  const entry: Omit<ApiBackendEntry, 'addedAt'> = {
    kind: 'api',
    name,
    baseUrl,
    authEnabled: discovery.authEnabled,
    oidc: discovery.authEnabled
      ? { issuer: discovery.issuer, clientId: discovery.clientId, audience: discovery.audience, scopes: discovery.scopes }
      : undefined,
    staticAuthHeader,
  };

  if (discovery.authEnabled) {
    console.log(`Starting OIDC device-code login...`);
    const tokens = await deviceCodeFlow({
      issuer: discovery.issuer,
      clientId: discovery.clientId,
      scopes: discovery.scopes,
      audience: discovery.audience,
    });
    await new TokenStore().save(name, tokens);
    console.log(`  login successful (token expires in ${Math.floor((tokens.expiresAt - Date.now()) / 1000)}s)`);
  }

  store.addStorage(entry);
  console.log(`Added api backend "${name}" → ${baseUrl}`);
}
