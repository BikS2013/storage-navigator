import { Router } from 'express';
import { requireRole } from '../rbac/enforce.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';

export function storagesRouter(discovery: AccountDiscovery): Router {
  const r = Router();
  r.get('/storages', requireRole('Reader'), (_req, res) => {
    res.json({
      items: discovery.list().map(({ name, blobEndpoint, fileEndpoint }) => ({
        name, blobEndpoint, fileEndpoint,
      })),
      continuationToken: null,
    });
  });
  return r;
}
