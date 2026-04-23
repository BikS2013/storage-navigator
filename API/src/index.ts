import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';
import { getAzureCredential } from './azure/credential.js';
import { AccountDiscovery, ArmStorageAdapter } from './azure/account-discovery.js';

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
  await discovery.refresh();
  discovery.startBackgroundRefresh();

  const app = buildApp({
    config,
    discovery,
    readinessChecks: {
      arm: async () => discovery.list().length >= 0, // discovery cache populated
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
