import type express from 'express';
import { pipeline } from 'node:stream/promises';
import { CredentialStore } from '../core/credential-store.js';
import { normaliseSitePath } from '../util/site-path.js';
import { makeBackend } from '../core/backend/factory.js';
import type { IStorageBackend } from '../core/backend/backend.js';

type Scope = 'container' | 'share';

// ---------------------------------------------------------------------------
// Content-type helpers
// ---------------------------------------------------------------------------

const EXT_CT: Record<string, string> = {
  html:  'text/html; charset=utf-8',
  htm:   'text/html; charset=utf-8',
  css:   'text/css; charset=utf-8',
  js:    'application/javascript; charset=utf-8',
  mjs:   'application/javascript; charset=utf-8',
  json:  'application/json; charset=utf-8',
  svg:   'image/svg+xml',
  png:   'image/png',
  jpg:   'image/jpeg',
  jpeg:  'image/jpeg',
  gif:   'image/gif',
  webp:  'image/webp',
  ico:   'image/x-icon',
  woff:  'font/woff',
  woff2: 'font/woff2',
  ttf:   'font/ttf',
  txt:   'text/plain; charset=utf-8',
  md:    'text/markdown; charset=utf-8',
  pdf:   'application/pdf',
};

function resolveContentType(handleCt: string | undefined, blobPath: string): string {
  if (handleCt && handleCt !== 'application/octet-stream') return handleCt;
  const ext = (blobPath.split('.').pop() ?? '').toLowerCase();
  return EXT_CT[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// CSP helpers
// ---------------------------------------------------------------------------

function htmlCsp(trusted: boolean): string {
  const directives = [
    "default-src 'none'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    trusted ? "connect-src 'self' https:" : "connect-src 'none'",
    trusted ? "form-action 'self'" : "form-action 'none'",
    // Allow third-party embeds (YouTube, Vimeo, codepen, etc.) over HTTPS only.
    // In untrusted mode we still permit https: frame/media sources because the
    // outer iframe sandbox confines what those embeds can do; without this,
    // a stored page that embeds a YouTube video would render as a black box.
    "frame-src https:",
    "media-src 'self' data: https:",
    "child-src https:",
  ];
  return directives.join('; ');
}

function isHtmlRequest(reqPath: string): boolean {
  const ext = (reqPath.split('.').pop() ?? '').toLowerCase();
  return ext === 'html' || ext === 'htm';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Error sender
// ---------------------------------------------------------------------------

function sendError(res: express.Response, status: number, msg: string, wantsHtml: boolean): void {
  if (wantsHtml) {
    res
      .status(status)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><meta charset="utf-8"><title>${status}</title><body>` +
          `<h1>${status}</h1><p>${escapeHtml(msg)}</p></body>`,
      );
  } else {
    res.status(status).json({ error: msg });
  }
}

// ---------------------------------------------------------------------------
// Core streaming helper
// ---------------------------------------------------------------------------

async function serveFromBackend(opts: {
  res: express.Response;
  backend: IStorageBackend;
  scope: 'container' | 'share';
  parent: string;
  rawPath: string;
  trusted: boolean;
}): Promise<void> {
  const { res, backend, scope, parent, rawPath, trusted } = opts;

  let normalised: string;
  try {
    normalised = normaliseSitePath(rawPath);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : 'invalid path', isHtmlRequest(rawPath));
    return;
  }

  const target = normalised === '' ? 'index.html' : normalised;
  const wantsHtml = isHtmlRequest(target);

  try {
    const handle =
      scope === 'container'
        ? await backend.readBlob(parent, target)
        : await backend.readFile(parent, target);

    const ct = resolveContentType(handle.contentType, target);
    res.setHeader('Content-Type', ct);
    // strict-origin-when-cross-origin (browser default in 2020+) sends just the
    // origin — not the path — to cross-origin destinations like an embedded
    // YouTube iframe. YouTube needs *some* Referer to validate the embed; the
    // previous 'no-referrer' triggered Error 153 ("video player configuration
    // error") on every embedded video. Same-origin requests still get the
    // full URL, so this doesn't leak path info to third parties.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (handle.contentLength !== undefined) {
      res.setHeader('Content-Length', String(handle.contentLength));
    }
    if (ct.startsWith('text/html')) {
      res.setHeader('Content-Security-Policy', htmlCsp(trusted));
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    await pipeline(handle.stream, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(msg)
      ? 404
      : /denied|forbidden|unauthor/i.test(msg)
        ? 403
        : 500;
    sendError(res, status, msg, wantsHtml);
  }
}

function handleTrustGet(scope: Scope) {
  return (req: express.Request, res: express.Response) => {
    const store = new CredentialStore();
    const storageName = req.params.storage as string;
    if (!store.getStorage(storageName)) {
      res.status(404).json({ error: `Storage '${storageName}' not found` });
      return;
    }
    const name = (scope === 'container' ? req.params.container : req.params.share) as string;
    res.json({ trusted: store.isHtmlTrusted(storageName, scope, name) });
  };
}

function handleTrustPut(scope: Scope) {
  return (req: express.Request, res: express.Response) => {
    const body = req.body as { trusted?: unknown };
    if (typeof body?.trusted !== 'boolean') {
      res.status(400).json({ error: "JSON body field 'trusted' (boolean) required" });
      return;
    }
    const store = new CredentialStore();
    const storageName = req.params.storage as string;
    if (!store.getStorage(storageName)) {
      res.status(404).json({ error: `Storage '${storageName}' not found` });
      return;
    }
    const name = (scope === 'container' ? req.params.container : req.params.share) as string;
    store.setHtmlTrust(storageName, scope, name, body.trusted);
    res.json({ trusted: body.trusted });
  };
}

export function registerSiteRoutes(app: express.Express): void {
  // Trust management routes (Task 4)
  app.get('/api/trust/:storage/:container', handleTrustGet('container'));
  app.put('/api/trust/:storage/:container', handleTrustPut('container'));
  app.get('/api/trust-file/:storage/:share', handleTrustGet('share'));
  app.put('/api/trust-file/:storage/:share', handleTrustPut('share'));

  // ---------------------------------------------------------------------------
  // Blob-container site streaming (Task 5)
  // Express 5 named wildcard: *splat → req.params.splat (string | string[])
  // ---------------------------------------------------------------------------
  app.get('/api/site/:storage/:container/*splat', async (req, res) => {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) {
      sendError(res, 404, `Storage '${req.params.storage}' not found`, isHtmlRequest(req.path));
      return;
    }
    const account = entry.kind === 'api' ? ((req.query.account as string) ?? entry.name) : undefined;
    const backend = makeBackend(entry, account);
    const trusted = store.isHtmlTrusted(req.params.storage, 'container', req.params.container);
    const splat = (req.params as Record<string, unknown>).splat;
    const rawPath = Array.isArray(splat) ? splat.join('/') : (splat as string ?? '');
    await serveFromBackend({ res, backend, scope: 'container', parent: req.params.container, rawPath, trusted });
  });

  // ---------------------------------------------------------------------------
  // File-share site streaming (Task 5)
  // ---------------------------------------------------------------------------
  app.get('/api/site-file/:storage/:share/*splat', async (req, res) => {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage);
    if (!entry) {
      sendError(res, 404, `Storage '${req.params.storage}' not found`, isHtmlRequest(req.path));
      return;
    }
    const account = entry.kind === 'api' ? ((req.query.account as string) ?? entry.name) : undefined;
    const backend = makeBackend(entry, account);
    const trusted = store.isHtmlTrusted(req.params.storage, 'share', req.params.share);
    const splat = (req.params as Record<string, unknown>).splat;
    const rawPath = Array.isArray(splat) ? splat.join('/') : (splat as string ?? '');
    await serveFromBackend({ res, backend, scope: 'share', parent: req.params.share, rawPath, trusted });
  });
}
