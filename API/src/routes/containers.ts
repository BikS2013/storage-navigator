import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { BlobService } from '../azure/blob-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';

const CreateBody = z.object({ name: z.string().min(1).max(63) });

export function containersRouter(svc: BlobService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router();

  r.get('/storages/:account/containers', requireRole('Reader'), async (req, res, next) => {
    try {
      const account = req.params.account as string;
      if (!discovery.lookup(account)) {
        throw ApiError.notFound(`Storage account '${account}' not found`);
      }
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listContainers(account, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  r.post('/storages/:account/containers', requireRole('Writer'), async (req, res, next) => {
    try {
      const account = req.params.account as string;
      if (!discovery.lookup(account)) {
        throw ApiError.notFound(`Storage account '${account}' not found`);
      }
      const body = CreateBody.parse(req.body);
      await svc.createContainer(account, body.name);
      res.status(201).json({ name: body.name });
    } catch (err) { next(err); }
  });

  r.delete('/storages/:account/containers/:container', requireRole('Admin'), async (req, res, next) => {
    try {
      const account = req.params.account as string;
      const container = req.params.container as string;
      if (!discovery.lookup(account)) {
        throw ApiError.notFound(`Storage account '${account}' not found`);
      }
      await svc.deleteContainer(account, container);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
