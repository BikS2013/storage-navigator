import express from 'express';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { anonymousPrincipalMiddleware } from '../../src/auth/auth-toggle.js';
import type { AppRole } from '../../src/auth/role-mapper.js';

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
  };
}

export function appWithFixedRole(role: AppRole) {
  const app = express();
  return buildApp({
    config: disabledModeConfig(role),
    authOverride: anonymousPrincipalMiddleware(role),
  });
}
