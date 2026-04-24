import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { BlobService } from '../azure/blob-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';
import { abortSignalForRequest } from '../util/abort.js';
import { proxyDownload } from '../streaming/proxy.js';

const RenameBody = z.object({ newPath: z.string().min(1) });

const BLOB_PREFIX = '/storages/:account/containers/:container/blobs';

// req.params is typed as ParamsDictionary because requireRole(...) is a
// generic-erased RequestHandler — TS resolves the union of all handlers'
// param types to the loosest one. The runtime values are always strings for
// :account/:container; the wildcard *path is a string array (joined here).
function paramStr(req: Request, key: string): string {
  return req.params[key] as string;
}

export function blobsRouter(svc: BlobService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router({ mergeParams: true });

  const requireAccount = (req: Request): void => {
    const account = paramStr(req, 'account');
    if (!discovery.lookup(account)) {
      throw ApiError.notFound(`Storage account '${account}' not found`);
    }
  };

  // List
  r.get(`${BLOB_PREFIX}`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const out = await svc.listBlobs(paramStr(req, 'account'), paramStr(req, 'container'), {
        prefix: typeof req.query.prefix === 'string' ? req.query.prefix : undefined,
        delimiter: typeof req.query.delimiter === 'string' ? req.query.delimiter : undefined,
        pageSize: page.pageSize,
        continuationToken: page.continuationToken,
      });
      res.json(out);
    } catch (err) { next(err); }
  });

  // Delete-folder (must come before /*path to avoid eating the route)
  r.delete(`${BLOB_PREFIX}`, requireRole('Admin'), async (req, res, next) => {
    try {
      requireAccount(req);
      const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
      const confirm = req.query.confirm === 'true';
      if (!prefix) throw ApiError.badRequest('prefix query parameter required');
      if (!confirm) throw ApiError.badRequest('confirm=true required for delete-folder');
      const n = await svc.deleteFolder(paramStr(req, 'account'), paramStr(req, 'container'), prefix);
      res.json({ deleted: n });
    } catch (err) { next(err); }
  });

  // Rename — POST /blobs/<path>:rename. Must be registered before the wildcard
  // GET/HEAD/PUT/DELETE handlers so the literal ":rename" suffix matches first.
  // The colon is escaped (\:) to keep path-to-regexp from treating it as a param.
  r.post(`${BLOB_PREFIX}/*path\\:rename`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const body = RenameBody.parse(req.body);
      await svc.renameBlob(paramStr(req, 'account'), paramStr(req, 'container'), path, body.newPath);
      res.json({ from: path, to: body.newPath });
    } catch (err) { next(err); }
  });

  // Read (GET path) — wildcard
  r.get(`${BLOB_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const range = parseRangeHeader(req.header('range'));
      const handle = await svc.readBlob(paramStr(req, 'account'), paramStr(req, 'container'), path, range, abortSignalForRequest(req));
      await proxyDownload(res, handle);
    } catch (err) { next(err); }
  });

  // HEAD
  r.head(`${BLOB_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const meta = await svc.headBlob(paramStr(req, 'account'), paramStr(req, 'container'), path);
      if (meta.contentType) res.setHeader('Content-Type', meta.contentType);
      if (meta.contentLength !== undefined) res.setHeader('Content-Length', meta.contentLength);
      if (meta.etag) res.setHeader('ETag', meta.etag);
      if (meta.lastModified) res.setHeader('Last-Modified', meta.lastModified);
      res.end();
    } catch (err) { next(err); }
  });

  // Upload
  r.put(`${BLOB_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const ct = req.header('content-type');
      const r2 = await svc.uploadBlob(
        paramStr(req, 'account'), paramStr(req, 'container'), path,
        req, ct, { blockSizeMb: config.uploads.streamBlockSizeMb },
        abortSignalForRequest(req),
      );
      res.status(201).json({ etag: r2.etag, lastModified: r2.lastModified });
    } catch (err) { next(err); }
  });

  // Delete
  r.delete(`${BLOB_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      await svc.deleteBlob(paramStr(req, 'account'), paramStr(req, 'container'), path);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}

function decodePath(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((s) => decodeURIComponent(String(s))).join('/');
  return decodeURIComponent(String(raw ?? ''));
}

function parseRangeHeader(h?: string): { offset: number; count?: number } | undefined {
  if (!h) return undefined;
  const m = /^bytes=(\d+)-(\d*)$/.exec(h);
  if (!m) return undefined;
  const offset = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined ? { offset, count: end - offset + 1 } : { offset };
}
