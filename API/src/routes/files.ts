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
// Either `paths` (explicit caller list) or `prefix` (server-side recursive
// enumeration of a directory subtree). At least one must be set; paths wins
// when both are provided.
const DownloadBody = z
  .object({
    paths: z.array(z.string().min(1)).max(10_000).optional(),
    prefix: z.string().min(1).optional(),
    archiveName: z.string().min(1).max(200).optional(),
    basePath: z.string().optional(),
  })
  .refine((v) => (v.paths && v.paths.length > 0) || (typeof v.prefix === 'string' && v.prefix.length > 0), {
    message: 'either `paths` (non-empty) or `prefix` must be provided',
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

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archive}"; filename*=UTF-8''${encodeURIComponent(archive)}`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const entries = body.paths && body.paths.length > 0
        ? iterEntriesFromPaths(svc, account, share, body.paths, body.basePath, signal)
        : iterEntriesFromPrefix(svc, account, share, body.prefix as string, body.basePath, signal);

      const zip = streamZip({ entries });
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

  // Upload. Honors `If-Match` (concurrency check via getProperties → etag
  // compare). Refuses bodies larger than config.uploads.maxBytes (413).
  r.put(`${FILE_PREFIX}/*path`, requireRole('Writer'), async (req, res, next) => {
    try {
      requireAccount(req);
      const path = decodePath(req.params.path);
      const len = Number(req.header('content-length'));
      if (!Number.isFinite(len) || len < 0) throw ApiError.badRequest('Content-Length required');
      const max = config.uploads.maxBytes;
      if (max !== null && len > max) {
        throw ApiError.payloadTooLarge(`Body exceeds upload size cap of ${max} bytes`);
      }
      const ct = req.header('content-type');
      const ifMatch = req.header('if-match');
      const r2 = await svc.uploadFile(paramStr(req, 'account'), paramStr(req, 'share'), path, req, len, ct, abortSignalForRequest(req), ifMatch);
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

async function* iterEntriesFromPaths(
  svc: FileService,
  account: string,
  share: string,
  paths: string[],
  basePath: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<ZipEntry> {
  const seen = new Set<string>();
  for (const p of paths) {
    let arcName: string;
    try { arcName = archiveName(p, basePath); } catch { continue; }
    if (!arcName || seen.has(arcName)) continue;
    seen.add(arcName);
    yield {
      name: arcName,
      body: lazyFileStream(() => svc.readFile(account, share, p, signal)),
    };
  }
}

// Lazily walk every file under `prefix` (which is a directory path inside the
// share) and yield one ZipEntry at a time. Paths inside the zip default to
// being relative to the selected directory.
async function* iterEntriesFromPrefix(
  svc: FileService,
  account: string,
  share: string,
  prefix: string,
  basePath: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<ZipEntry> {
  const normalizedPrefix = prefix.replace(/\/+$/, '');
  const baseToStrip = basePath ?? (normalizedPrefix ? normalizedPrefix + '/' : '');
  const seen = new Set<string>();
  for await (const item of svc.iterateFilesFlat(account, share, normalizedPrefix, signal)) {
    let arcName: string;
    try { arcName = archiveName(item.name, baseToStrip); } catch { continue; }
    if (!arcName || seen.has(arcName)) continue;
    seen.add(arcName);
    yield {
      name: arcName,
      body: lazyFileStream(() => svc.readFile(account, share, item.name, signal)),
    };
  }
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
