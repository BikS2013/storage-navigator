import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { requireRole } from '../rbac/enforce.js';
import { ApiError } from '../errors/api-error.js';
import type { FileService } from '../azure/file-service.js';
import type { AccountDiscovery } from '../azure/account-discovery.js';
import type { Config } from '../config.js';
import { parsePage } from '../util/pagination.js';
import { abortSignalForRequest } from '../util/abort.js';
import { proxyDownload } from '../streaming/proxy.js';
import { streamZip, archiveName, type ZipEntry } from '../streaming/zip-stream.js';

const RenameBody = z.object({ newPath: z.string().min(1) });
const DownloadBody = z.object({
  paths: z.array(z.string().min(1)).min(1).max(10_000),
  archiveName: z.string().min(1).max(200).optional(),
  basePath: z.string().optional(),
});
const FILE_PREFIX = '/storages/:account/shares/:share/files';

const paramStr = (req: import('express').Request, key: string): string => String(req.params[key] ?? '');

export function filesRouter(svc: FileService, discovery: AccountDiscovery, config: Config): Router {
  const r = Router({ mergeParams: true });

  const requireAccount = (req: import('express').Request): void => {
    if (!discovery.lookup(paramStr(req, 'account'))) {
      throw ApiError.notFound(`Storage account '${paramStr(req, 'account')}' not found`);
    }
  };

  // List dir
  r.get(FILE_PREFIX, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const page = parsePage(req.query as Record<string, string>, config.pagination);
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const out = await svc.listDir(paramStr(req, 'account'), paramStr(req, 'share'), path, page);
      res.json(out);
    } catch (err) { next(err); }
  });

  // Bulk download as ZIP — same shape as the blobs endpoint.
  r.post(`/storages/:account/shares/:share/files\\:download-zip`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const body = DownloadBody.parse(req.body);
      const account = paramStr(req, 'account');
      const share = paramStr(req, 'share');
      const archive = sanitizeAttachmentName(body.archiveName ?? `${share}.zip`);
      const signal = abortSignalForRequest(req);

      const seen = new Set<string>();
      const entries: ZipEntry[] = [];
      for (const p of body.paths) {
        const arcName = archiveName(p, body.basePath);
        if (seen.has(arcName)) continue;
        seen.add(arcName);
        entries.push({
          name: arcName,
          body: lazyFileStream(() => svc.readFile(account, share, p, signal)),
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archive}"; filename*=UTF-8''${encodeURIComponent(archive)}`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const zip = streamZip({ entries: iterEntries(entries) });
      await pipeline(zip, res);
    } catch (err) { next(err); }
  });

  // Delete-folder (must come before the wildcard handler)
  r.delete(FILE_PREFIX, requireRole('Admin'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = typeof req.query.path === 'string' ? req.query.path : undefined;
      const confirm = req.query.confirm === 'true';
      if (!path) throw ApiError.badRequest('path query parameter required');
      if (!confirm) throw ApiError.badRequest('confirm=true required for delete-folder');
      const n = await svc.deleteFolder(paramStr(req, 'account'), paramStr(req, 'share'), path);
      res.json({ deleted: n });
    } catch (err) { next(err); }
  });

  // Rename (literal :rename suffix; colon escaped for path-to-regexp v8)
  r.post(`${FILE_PREFIX}/*path\\:rename`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const body = RenameBody.parse(req.body);
      await svc.renameFile(paramStr(req, 'account'), paramStr(req, 'share'), path, body.newPath);
      res.json({ from: path, to: body.newPath });
    } catch (err) { next(err); }
  });

  // Read. `?download=1` forces a Save As dialog (Content-Disposition).
  r.get(`${FILE_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const handle = await svc.readFile(paramStr(req, 'account'), paramStr(req, 'share'), path, abortSignalForRequest(req));
      if (req.query.download === '1' || req.query.download === 'true') {
        const fname = sanitizeAttachmentName(path.split('/').pop() || 'download');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
      }
      await proxyDownload(res, handle as never);
    } catch (err) { next(err); }
  });

  // HEAD
  r.head(`${FILE_PREFIX}/*path`, requireRole('Reader'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const m = await svc.headFile(paramStr(req, 'account'), paramStr(req, 'share'), path);
      if (m.contentType) res.setHeader('Content-Type', m.contentType);
      if (m.contentLength !== undefined) res.setHeader('Content-Length', m.contentLength);
      if (m.etag) res.setHeader('ETag', m.etag);
      if (m.lastModified) res.setHeader('Last-Modified', m.lastModified);
      res.end();
    } catch (err) { next(err); }
  });

  // Upload
  r.put(`${FILE_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const len = Number(req.header('content-length'));
      if (!Number.isFinite(len) || len < 0) throw ApiError.badRequest('Content-Length required');
      const ct = req.header('content-type');
      const r2 = await svc.uploadFile(paramStr(req, 'account'), paramStr(req, 'share'), path, req, len, ct, abortSignalForRequest(req));
      res.status(201).json(r2);
    } catch (err) { next(err); }
  });

  // Delete
  r.delete(`${FILE_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      await svc.deleteFile(paramStr(req, 'account'), paramStr(req, 'share'), path);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}

function decodePath(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((s) => decodeURIComponent(String(s))).join('/');
  return decodeURIComponent(String(raw ?? ''));
}

async function* iterEntries(entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const e of entries) yield e;
}

function lazyFileStream(open: () => Promise<{ stream: NodeJS.ReadableStream }>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const handle = await open();
      for await (const chunk of handle.stream) {
        yield chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
      }
    },
  };
}

function sanitizeAttachmentName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'download';
}
