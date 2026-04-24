import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import type { AppRole } from '../../src/auth/role-mapper.js';
import { AccountDiscovery } from '../../src/azure/account-discovery.js';
import type { BlobService } from '../../src/azure/blob-service.js';
import type { FileService } from '../../src/azure/file-service.js';

// Stub used for tests that exercise routes mounted before auth (health,
// well-known) or routes that don't touch blob storage (storages list). The
// blobService dep on buildApp is required for production, so tests must
// supply something — the stub is safe because none of these handlers call it.
export const stubBlobService = {} as unknown as BlobService;
// Same rationale as stubBlobService — fileService is required by buildApp,
// but the routes touching it aren't exercised by these test paths.
export const stubFileService = {} as unknown as FileService;

export function disabledModeConfig(anonRole: AppRole = 'Admin'): Config {
  return {
    port: 0,
    logLevel: 'silent',
    authEnabled: false,
    oidc: { mode: 'disabled', anonRole },
    azure: { subscriptions: [], allowedAccounts: [], discoveryRefreshMin: 60 },
    pagination: { defaultPageSize: 200, maxPageSize: 1000 },
    uploads: { maxBytes: null, streamBlockSizeMb: 8 },
    swaggerUiEnabled: false,
    corsOrigins: [],
    staticAuth: { values: [], headerName: 'X-Storage-Nav-Auth' },
  };
}

export async function appWithFixedRole(role: AppRole) {
  const discovery = new AccountDiscovery({
    adapter: { list: async () => [] },
    allowed: [],
    refreshMin: 60,
  });
  await discovery.refresh();
  return buildApp({
    config: disabledModeConfig(role),
    authOverride: anonymousPrincipalMiddleware(role),
    discovery,
    blobService: stubBlobService,
    fileService: stubFileService,
  });
}
