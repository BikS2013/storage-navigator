import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { logger } from './observability/logger.js';

function main(): void {
  const config = loadConfig();
  // Apply config-driven log level (logger.ts initialises from LOG_LEVEL env at
  // import time; this lets the validated config override it post-boot).
  logger.level = config.logLevel;

  const app = buildApp({ config });
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'storage-navigator-api listening');
  });
}

try {
  main();
} catch (err) {
  // Boot-time failures (config invalid) — log and exit non-zero
  // eslint-disable-next-line no-console
  console.error('Boot failed:', (err as Error).message);
  process.exit(1);
}
