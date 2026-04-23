import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';
import { getAzureCredential } from './azure/credential.js';
import { AccountDiscovery, ArmStorageAdapter } from './azure/account-discovery.js';
import { BlobService } from './azure/blob-service.js';
import { FileService } from './azure/file-service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // Apply config-driven log level (logger.ts initialises from LOG_LEVEL env at
  // import time; this lets the validated config override it post-boot).
  logger.level = config.logLevel;

  const credential = getAzureCredential();
  const discovery = new AccountDiscovery({
    adapter: new ArmStorageAdapter(credential, config.azure.subscriptions),
    allowed: config.azure.allowedAccounts,
    refreshMin: config.azure.discoveryRefreshMin,
  });
  // Initial refresh is best-effort: if Azure credentials are unavailable
  // (no MI, no `az login`, missing subscription scope) the API still boots
  // and serves /healthz. The background refresh keeps retrying; /readyz
  // (via discovery.isHealthy()) reports false until the first success.
  try {
    await discovery.refresh();
  } catch (err) {
    logger.warn({ err }, 'initial account discovery refresh failed; will retry in background');
  }
  discovery.startBackgroundRefresh();

  const blobService = new BlobService(
    credential,
    (account) => discovery.lookup(account)?.blobEndpoint ?? `https://${account}.blob.core.windows.net`,
  );

  const fileService = new FileService(
    credential,
    (account) => discovery.lookup(account)?.fileEndpoint ?? `https://${account}.file.core.windows.net`,
  );

  const app = buildApp({
    config,
    discovery,
    blobService,
    fileService,
    readinessChecks: {
      arm: async () => discovery.isHealthy(),
    },
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'storage-navigator-api listening');
  });
  server.on('error', (err) => {
    logger.error({ err, port: config.port }, 'failed to bind port');
    process.exit(1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Boot failed:', (err as Error).message);
  process.exit(1);
});
