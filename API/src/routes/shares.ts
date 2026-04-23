import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { FileService } from '../azure/file-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';

const CreateBody = z.object({ name: z.string().min(1).max(63), quotaGiB: z.number().int().positive().optional() });

export function sharesRouter(svc: FileService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router();

  r.get('/storages/:account/shares', requireRole('Reader'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account as string)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listShares(req.params.account as string, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  r.post('/storages/:account/shares', requireRole('Writer'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account as string)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      const body = CreateBody.parse(req.body);
      await svc.createShare(req.params.account as string, body.name, body.quotaGiB);
      res.status(201).json({ name: body.name });
    } catch (err) { next(err); }
  });

  r.delete('/storages/:account/shares/:share', requireRole('Admin'), async (req, res, next) => {
    try {
      if (!discovery.lookup(req.params.account as string)) throw ApiError.notFound(`Storage account '${req.params.account}' not found`);
      await svc.deleteShare(req.params.account as string, req.params.share as string);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
