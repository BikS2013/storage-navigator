import express from "express";
import type * as http from "node:http";
import * as path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { CredentialStore } from "../core/credential-store.js";
import { generateInstallationToken } from "../core/github-app-auth.js";
import { BlobClient } from "../core/blob-client.js";
import { makeBackend } from "../core/backend/factory.js";
import type { IStorageBackend } from "../core/backend/backend.js";
import { fetchDiscovery } from "../core/backend/auth/discovery.js";
import { readSyncMeta, syncRepo, resolveLinks, writeLinks, createLink, removeLink } from "../core/sync-engine.js";
import type { RepoProvider } from "../core/sync-engine.js";
import type { ApiBackendEntry, DirectStorageEntry, RepoLink, StorageEntry, SyncResult, DiffReport } from "../core/types.js";
import { buildProviderForLink } from "../core/repo-utils.js";
import { diffLink } from "../core/diff-engine.js";
import {
  detectEditability,
  DEFAULT_MAX_EDIT_BYTES,
} from "../util/text-detect.js";
import { registerSiteRoutes } from "./site-routes.js";
import {
  initReverseLink,
  pushReverseLink,
  previewReverseDiff,
  removeReverseLink,
  listReverseLinks,
  resolveReverseLinks,
  type InitReverseLinkOptions,
} from "../core/reverse-sync-engine.js";
import type {
  CommitAuthor,
  PushResult,
  RepoVisibility,
  ReverseLinkScope,
} from "../core/reverse-git-types.js";
import { mapReverseGitErrorToHttp } from "../core/reverse-git-errors.js";

/**
 * Build the appropriate IStorageBackend for a request.
 *
 * For direct storages, the entry already carries its Azure account name.
 * For api-backed storages, the request must specify which Azure storage
 * account to operate against via `?account=`. We fall back to the entry's
 * own name if `?account=` is omitted (UI is expected to pass it explicitly).
 *
 * Throws Error if the named storage is missing — caller should translate to 404.
 */
function backendFor(req: express.Request, store: CredentialStore): IStorageBackend {
  const name = req.params.storage as string;
  const entry = store.getStorage(name);
  if (!entry) throw new Error(`Storage '${name}' not found`);
  if (entry.kind === 'direct') return makeBackend(entry);
  // api kind needs an account name
  const account = (req.query.account as string | undefined) ?? entry.name;
  return makeBackend(entry, account);
}

/**
 * Narrow a StorageEntry to a DirectStorageEntry. The sync/links/diff
 * endpoints still depend on BlobClient + sync-engine, which only know how
 * to talk to direct backends. T21 leaves that surface alone — it will be
 * lifted in a later task once sync-engine itself moves to IStorageBackend.
 */
function requireDirect(entry: StorageEntry, res: express.Response): DirectStorageEntry | null {
  if (entry.kind === 'direct') return entry;
  res.status(400).json({
    error: "This endpoint currently only supports direct storage backends.",
  });
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build the Express app WITHOUT binding a port.
 *
 * Split out from createServer so the caller decides the binding policy — the
 * packaged desktop app needs the bound port back (it may be ephemeral), which
 * a function that returns only the Express instance cannot provide.
 */
export function buildApp(publicDirOverride?: string): express.Express {
  const app = express();
  // Express auto-generates a weak content-hash ETag for res.send() responses.
  // For the editor we rely on the backend's strong ETag (Azure) to detect
  // concurrent writes; an Express content-hash ETag would be returned to the
  // client and re-submitted as If-Match, never matching the backend's real
  // ETag and causing every save to fail with 412.
  app.set("etag", false);
  app.use(express.json());

  // Serve static files from public directory
  const publicDir = publicDirOverride || path.join(__dirname, "public");
  app.use(express.static(publicDir));
  registerSiteRoutes(app);

  // API: List configured storages — includes `kind` so the UI can render
  // the appropriate icon/badge for direct vs api-backed entries.
  app.get("/api/storages", (_req, res) => {
    const store = new CredentialStore();
    const items = store.listStorages().map((s) => {
      const entry = store.getStorage(s.name);
      return { ...s, kind: entry?.kind ?? 'direct' };
    });
    res.json(items);
  });

  // API: Add storage (direct only — api backends use POST /api/storage/api-backend)
  app.post("/api/storages", (req, res) => {
    const { name, accountName, sasToken, accountKey } = req.body;
    if (!name || !accountName || (!sasToken && !accountKey)) {
      res.status(400).json({ error: "name, accountName, and either sasToken or accountKey are required" });
      return;
    }
    const store = new CredentialStore();
    const direct: Omit<DirectStorageEntry, "addedAt"> = { kind: 'direct', name, accountName, sasToken, accountKey };
    store.addStorage(direct);
    res.json({ success: true });
  });

  // API: Register an api-backed storage (called from the UI, T23)
  // API: proxy `/.well-known/storage-nav-config` for the renderer.
  // The browser context can't fetch a deployed Azure URL directly without CORS;
  // this server runs in Node so it has no such restriction.
  // API: list Azure storage accounts a backend exposes.
  // For direct backends this is the single account stored on the entry.
  // For api backends this proxies the upstream GET /storages.
  app.get("/api/accounts/:storage", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) {
        res.status(404).json({ error: { message: `Storage '${req.params.storage}' not found` } });
        return;
      }
      if (entry.kind === "direct") {
        res.json({ items: [{ name: entry.accountName }] });
        return;
      }
      // api kind — proxy upstream GET /storages
      const headers: Record<string, string> = {};
      if (entry.authEnabled && entry.oidc) {
        const { TokenStore } = await import("../core/backend/auth/token-store.js");
        const tokens = await new TokenStore().load(entry.name);
        if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
      if (entry.staticAuthHeader) {
        headers[entry.staticAuthHeader.name] = entry.staticAuthHeader.value;
      }
      const r = await fetch(`${entry.baseUrl.replace(/\/$/, "")}/storages`, { headers });
      if (!r.ok) {
        res.status(r.status).json({ error: { message: `Upstream HTTP ${r.status}` } });
        return;
      }
      res.json(await r.json());
    } catch (err) { next(err); }
  });

  app.get("/api/discovery", async (req, res, next) => {
    try {
      const baseUrl = (req.query.url as string | undefined) ?? "";
      if (!baseUrl) { res.status(400).json({ error: { message: "url query param required" } }); return; }
      const result = await fetchDiscovery(baseUrl);
      res.json(result);
    } catch (err) { next(err); }
  });

  app.post("/api/storage/api-backend", express.json(), (req, res, next) => {
    try {
      const { name, baseUrl, authEnabled, oidc, staticAuthHeader } = req.body as {
        name: string; baseUrl: string; authEnabled: boolean;
        oidc?: { issuer: string; clientId: string; audience: string; scopes: string[] };
        staticAuthHeader?: { name: string; value: string };
      };
      if (!name || !baseUrl || authEnabled === undefined) {
        res.status(400).json({ error: { message: "name, baseUrl, and authEnabled are required" } });
        return;
      }
      const store = new CredentialStore();
      if (store.getStorage(name)) {
        res.status(409).json({ error: { message: `Storage "${name}" already exists` } });
        return;
      }
      const entry: Omit<ApiBackendEntry, 'addedAt'> = {
        kind: 'api', name, baseUrl, authEnabled, oidc, staticAuthHeader,
      };
      store.addStorage(entry);
      res.status(201).json({ name });
    } catch (err) { next(err); }
  });

  // API: Remove storage
  app.delete("/api/storages/:name", (req, res) => {
    const store = new CredentialStore();
    const removed = store.removeStorage(req.params.name);
    res.json({ success: removed });
  });

  // API: Export storage config (no secrets)
  app.get("/api/export/:name", (req, res) => {
    const store = new CredentialStore();
    const exported = store.exportStorage(req.params.name);
    if (!exported) { res.status(404).json({ error: "Storage not found" }); return; }
    res.json(exported);
  });

  // API: List containers
  app.get("/api/containers/:storage", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const r = await backend.listContainers();
      res.json(r.items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: List blobs
  app.get("/api/blobs/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const prefix = (req.query.prefix as string) || undefined;
      // Always pass delimiter:'/' so the response is hierarchical (folders +
      // immediate blobs only). Without it the api backend returns a flat
      // recursive listing, which the UI tree can't expand/collapse.
      const r = await backend.listBlobs(req.params.container, { prefix, delimiter: "/" });
      res.json(r.items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Get blob content — blob path passed as query param to avoid Express 5 wildcard issues
  app.get("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      const handle = await backend.readBlob(req.params.container, blobPath);

      // Collect stream into a Buffer for docx mammoth conversion or for
      // legacy X-Blob-* response semantics. Streaming straight through is
      // an option for the api-only paths but the original UI relies on the
      // header shape, so we keep buffering for now.
      const chunks: Buffer[] = [];
      for await (const chunk of handle.stream) {
        chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      const contentType = handle.contentType ?? "application/octet-stream";

      // Check if this is a docx file and format conversion is requested
      const format = req.query.format as string | undefined;
      if (blobPath.endsWith(".docx") && format) {
        if (format === "html") {
          const result = await mammoth.convertToHtml({ buffer: content });
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.send(result.value);
          return;
        } else if (format === "text") {
          const result = await mammoth.extractRawText({ buffer: content });
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.send(result.value);
          return;
        }
      }

      // T26: expose ETag + text-editability metadata so the renderer can
      // surface an Edit button only for safely-editable files and submit
      // If-Match on save. Detection is layered (allowlist → sniff → size cap)
      // — see src/util/text-detect.ts.
      const totalSize = handle.contentLength ?? content.length;
      const editability = detectEditability(blobPath, totalSize, content);
      if (handle.etag) res.setHeader("ETag", handle.etag);
      res.setHeader("X-Editable", String(editability.editable));
      res.setHeader("X-Editable-Reason", editability.reason);
      res.setHeader("X-Editable-Max-Bytes", String(editability.maxBytes));

      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Blob-Name", encodeURIComponent(blobPath));
      res.setHeader("X-Blob-Size", String(totalSize));
      res.send(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Edit (overwrite) a blob in-place. Companion to GET /api/blob — the
  // renderer captures the ETag from the read response, edits, and submits
  // PUT with If-Match so a concurrent writer doesn't get clobbered.
  //
  // Body: JSON { content: string, ifMatch?: string, contentType?: string }.
  // Returns 412 when ifMatch is supplied and the current ETag differs.
  // Returns 413 when content is larger than the configured edit size cap.
  app.put("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }
      const body = req.body as { content?: unknown; ifMatch?: unknown; contentType?: unknown };
      if (typeof body?.content !== "string") {
        res.status(400).json({ error: "JSON body field 'content' (string) required" });
        return;
      }
      const contentType = typeof body.contentType === "string" ? body.contentType : "text/plain; charset=utf-8";
      const buf = Buffer.from(body.content, "utf-8");
      if (buf.byteLength > DEFAULT_MAX_EDIT_BYTES) {
        res.status(413).json({ error: `Body exceeds edit size cap of ${DEFAULT_MAX_EDIT_BYTES} bytes` });
        return;
      }
      if (typeof body.ifMatch === "string" && body.ifMatch.length > 0) {
        const meta = await backend.headBlob(req.params.container as string, blobPath);
        if (normalizeEtag(meta.etag) !== normalizeEtag(body.ifMatch)) {
          res.status(412).json({ error: "Blob ETag does not match (concurrent modification)" });
          return;
        }
      }
      const r = await backend.uploadBlob(req.params.container as string, blobPath, buf, buf.byteLength, contentType);
      res.json({ success: true, etag: r.etag, lastModified: r.lastModified });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface backend precondition failures as 412 when uploadBlob couldn't
      // tunnel If-Match (e.g. backends that only support app-level checks).
      if (/precondition|If-Match|412/i.test(msg)) {
        res.status(412).json({ error: msg });
        return;
      }
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Download a single blob with Content-Disposition (browser save).
  app.get("/api/download/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }
      const handle = await backend.readBlob(req.params.container as string, blobPath);
      const filename = (blobPath.split("/").pop() || "download").replace(/[\r\n"\\/]+/g, "_");
      res.setHeader("Content-Type", handle.contentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      if (handle.contentLength !== undefined) res.setHeader("Content-Length", String(handle.contentLength));
      const { pipeline } = await import("node:stream/promises");
      await pipeline(handle.stream, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      if (!res.headersSent) res.status(status).json({ error: msg });
    }
  });

  // API: Stream a ZIP archive of multiple blobs.
  // Body: { paths: string[], basePath?: string, archiveName?: string }
  app.post("/api/download-zip/:storage/:container", express.json(), async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths : [];
      const prefix: string | undefined = typeof req.body?.prefix === "string" && req.body.prefix.length > 0
        ? req.body.prefix
        : undefined;
      // Whole-container download: no paths, no prefix, but an explicit flag so
      // we don't confuse "archive everything" with a malformed request.
      const wholeContainer = req.body?.wholeContainer === true;
      if (paths.length === 0 && !prefix && !wholeContainer) { res.status(400).json({ error: "paths or prefix required" }); return; }
      const basePath = typeof req.body?.basePath === "string" ? req.body.basePath : undefined;
      const archive = String(req.body?.archiveName ?? `${req.params.container}.zip`).replace(/[\r\n"\\/]+/g, "_");
      const container = req.params.container as string;

      const { streamZip, archiveName } = await import("../util/zip-stream.js");

      type Entry = { name: string; body: AsyncIterable<Uint8Array> };

      const bodyFor = (blobPath: string): AsyncIterable<Uint8Array> => ({
        async *[Symbol.asyncIterator]() {
          const h = await backend.readBlob(container, blobPath);
          for await (const chunk of h.stream) {
            yield chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
          }
        },
      });

      async function* iterFromPaths(): AsyncGenerator<Entry> {
        const seen = new Set<string>();
        for (const p of paths) {
          let arc: string;
          try { arc = archiveName(p, basePath); } catch { continue; }
          if (!arc || seen.has(arc)) continue;
          seen.add(arc);
          yield { name: arc, body: bodyFor(p) };
        }
      }

      // Lazy descendant walk: each blob name is pulled one at a time from the
      // backend (Azure SDK / API pagination) and immediately fed into the zip
      // writer so the response starts streaming without buffering the full
      // tree.
      async function* iterFromPrefix(): AsyncGenerator<Entry> {
        // Empty string lists every blob in the container (whole-container
        // download); otherwise restrict to the given prefix.
        const normalized = prefix
          ? (prefix.endsWith("/") ? prefix : prefix + "/")
          : "";
        const baseToStrip = basePath ?? normalized;
        const seen = new Set<string>();
        for await (const item of backend.iterateBlobsFlat(container, normalized)) {
          let arc: string;
          try { arc = archiveName(item.name, baseToStrip); } catch { continue; }
          if (!arc || seen.has(arc)) continue;
          seen.add(arc);
          yield { name: arc, body: bodyFor(item.name) };
        }
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition",
        `attachment; filename="${archive}"; filename*=UTF-8''${encodeURIComponent(archive)}`);
      res.setHeader("Cache-Control", "no-store");

      const entries = paths.length > 0 ? iterFromPaths() : iterFromPrefix();
      const zip = streamZip({ entries });
      const { pipeline } = await import("node:stream/promises");
      await pipeline(zip, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: msg });
      else try { res.destroy(); } catch { /* already closed */ }
    }
  });

  // API: Download a single file from a share.
  app.get("/api/download-file/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: "?path= query parameter required" }); return; }
      const handle = await backend.readFile(req.params.share as string, filePath);
      const filename = (filePath.split("/").pop() || "download").replace(/[\r\n"\\/]+/g, "_");
      res.setHeader("Content-Type", handle.contentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      if (handle.contentLength !== undefined) res.setHeader("Content-Length", String(handle.contentLength));
      const { pipeline } = await import("node:stream/promises");
      await pipeline(handle.stream, res);
    } catch (err) { next(err); }
  });

  // API: Stream a ZIP of multiple files from a share.
  app.post("/api/download-file-zip/:storage/:share", express.json(), async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths : [];
      if (paths.length === 0) { res.status(400).json({ error: "paths required" }); return; }
      const basePath = typeof req.body?.basePath === "string" ? req.body.basePath : undefined;
      const archive = String(req.body?.archiveName ?? `${req.params.share}.zip`).replace(/[\r\n"\\/]+/g, "_");
      const share = req.params.share as string;

      const { streamZip, archiveName } = await import("../util/zip-stream.js");

      const seen = new Set<string>();
      type Entry = { name: string; body: AsyncIterable<Uint8Array> };
      const items: Entry[] = [];
      for (const p of paths) {
        let arc: string;
        try { arc = archiveName(p, basePath); } catch { continue; }
        if (seen.has(arc)) continue;
        seen.add(arc);
        items.push({
          name: arc,
          body: {
            async *[Symbol.asyncIterator]() {
              const h = await backend.readFile(share, p);
              for await (const chunk of h.stream) {
                yield chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
              }
            },
          },
        });
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition",
        `attachment; filename="${archive}"; filename*=UTF-8''${encodeURIComponent(archive)}`);
      res.setHeader("Cache-Control", "no-store");

      async function* iter() { for (const e of items) yield e; }
      const zip = streamZip({ entries: iter() });
      const { pipeline } = await import("node:stream/promises");
      await pipeline(zip, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: msg });
      else try { res.destroy(); } catch { /* already closed */ }
    }
  });

  // API: Rename a blob
  app.post("/api/rename/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);

      const { oldName, newName } = req.body;
      if (!oldName || !newName) { res.status(400).json({ error: "oldName and newName are required" }); return; }

      await backend.renameBlob(req.params.container, oldName, newName);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Delete a blob
  app.delete("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      await backend.deleteBlob(req.params.container, blobPath);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Delete a folder (all blobs under a prefix)
  app.delete("/api/folder/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);

      const prefix = req.query.prefix as string;
      if (!prefix) { res.status(400).json({ error: "?prefix= query parameter required" }); return; }

      const count = await backend.deleteFolder(req.params.container, prefix);
      res.json({ success: true, deleted: count });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // API: Create (upload) a blob
  app.post("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      const contentType = (req.query.contentType as string) || "application/octet-stream";
      const content = typeof req.body.content === "string" ? req.body.content : JSON.stringify(req.body.content ?? "");
      const buf = Buffer.from(content, "utf-8");

      await backend.uploadBlob(req.params.container, blobPath, buf, buf.byteLength, contentType);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ============================================================
  // File Share API Endpoints (Azure Files)
  // ============================================================

  // API: List shares
  app.get("/api/shares/:storage", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const r = await backend.listShares();
      res.json(r);
    } catch (err) { next(err); }
  });

  // API: Create a share
  app.post("/api/shares/:storage", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const { name, quotaGiB } = req.body as { name: string; quotaGiB?: number };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      await backend.createShare(name, quotaGiB);
      res.status(201).json({ name });
    } catch (err) { next(err); }
  });

  // API: Delete a share
  app.delete("/api/shares/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      await backend.deleteShare(req.params.share as string);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // API: List directory contents within a share
  app.get("/api/files/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const path = (req.query.path as string | undefined) ?? '';
      const r = await backend.listDir(req.params.share as string, path);
      res.json(r);
    } catch (err) { next(err); }
  });

  // API: Read a file from a share — file path passed as ?path= query param
  // (matches the existing /api/blob convention; avoids Express 5 wildcard
  // ambiguity around encoded slashes). Buffers the body so we can sniff
  // editability and return X-Editable headers in lockstep with /api/blob.
  app.get("/api/file/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: "?path= query parameter required" }); return; }
      const handle = await backend.readFile(req.params.share as string, filePath);
      const chunks: Buffer[] = [];
      for await (const chunk of handle.stream) {
        chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      const totalSize = handle.contentLength ?? content.length;
      const editability = detectEditability(filePath, totalSize, content);
      if (handle.contentType) res.setHeader("Content-Type", handle.contentType);
      res.setHeader("Content-Length", String(totalSize));
      if (handle.etag) res.setHeader("ETag", handle.etag);
      if (handle.lastModified) res.setHeader("Last-Modified", handle.lastModified);
      res.setHeader("X-Editable", String(editability.editable));
      res.setHeader("X-Editable-Reason", editability.reason);
      res.setHeader("X-Editable-Max-Bytes", String(editability.maxBytes));
      res.send(content);
    } catch (err) { next(err); }
  });

  // API: Upload / edit a file in a share. Two modes, switched by Content-Type:
  //   - application/json → edit-in-place flow. Body is JSON
  //     { content: string, ifMatch?: string, contentType?: string }.
  //     Applies an edit size cap (DEFAULT_MAX_EDIT_BYTES) and honors If-Match
  //     via headFile → etag compare. Returns 412 / 413 as appropriate.
  //   - anything else → original raw upload path (PR #3): the request body
  //     is streamed directly into the backend as a generic file upload.
  app.put("/api/file/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: "?path= query parameter required" }); return; }
      const ct = req.header("content-type") ?? "";

      if (ct.toLowerCase().startsWith("application/json")) {
        const body = req.body as { content?: unknown; ifMatch?: unknown; contentType?: unknown };
        if (typeof body?.content !== "string") {
          res.status(400).json({ error: "JSON body field 'content' (string) required" });
          return;
        }
        const outCt = typeof body.contentType === "string" ? body.contentType : "text/plain; charset=utf-8";
        const buf = Buffer.from(body.content, "utf-8");
        if (buf.byteLength > DEFAULT_MAX_EDIT_BYTES) {
          res.status(413).json({ error: `Body exceeds edit size cap of ${DEFAULT_MAX_EDIT_BYTES} bytes` });
          return;
        }
        if (typeof body.ifMatch === "string" && body.ifMatch.length > 0) {
          try {
            const meta = await backend.headFile(req.params.share as string, filePath);
            if (normalizeEtag(meta.etag) !== normalizeEtag(body.ifMatch)) {
              res.status(412).json({ error: "File ETag does not match (concurrent modification)" });
              return;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found")) {
              res.status(412).json({ error: "File no longer exists (concurrent modification)" });
              return;
            }
            throw err;
          }
        }
        const r = await backend.uploadFile(req.params.share as string, filePath, buf, buf.byteLength, outCt);
        res.json({ success: true, etag: r.etag, lastModified: r.lastModified });
        return;
      }

      const len = Number(req.header("content-length") ?? 0);
      const r = await backend.uploadFile(req.params.share as string, filePath, req, len, ct);
      res.status(201).json(r);
    } catch (err) { next(err); }
  });

  // API: Delete a file from a share
  app.delete("/api/file/:storage/:share", async (req, res, next) => {
    try {
      const store = new CredentialStore();
      const backend = backendFor(req, store);
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: "?path= query parameter required" }); return; }
      await backend.deleteFile(req.params.share as string, filePath);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ============================================================
  // Sync / Links / Diff (still direct-only — see requireDirect note)
  // ============================================================

  // API: Get sync metadata for a container (backward compatible)
  // Falls back to .repo-links.json if .repo-sync-meta.json is not found
  app.get("/api/sync-meta/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);

      // Try the legacy .repo-sync-meta.json first
      const meta = await readSyncMeta(client, req.params.container);
      if (meta) { res.json(meta); return; }

      // Fall back to .repo-links.json — convert first link to old format
      const registry = await resolveLinks(client, req.params.container);
      if (registry.links.length > 0) {
        const link = registry.links[0];
        const legacyMeta = {
          provider: link.provider,
          repoUrl: link.repoUrl,
          branch: link.branch,
          lastSyncAt: link.lastSyncAt ?? "",
          lastCommitSha: link.lastCommitSha,
          fileShas: link.fileShas,
        };
        res.json(legacyMeta);
        return;
      }

      res.json(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Trigger sync for a container
  app.post("/api/sync/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
      const direct = requireDirect(entry, res);
      if (!direct) return;
      const blobClient = new BlobClient(direct);

      // Resolve links (auto-migrates from old .repo-sync-meta.json if needed)
      const registry = await resolveLinks(blobClient, req.params.container);
      if (registry.links.length === 0) {
        res.status(400).json({ error: "Container is not a synced repository" });
        return;
      }

      // If multiple links exist, direct caller to per-link or sync-all endpoints
      if (registry.links.length > 1) {
        res.status(400).json({
          error: "Multiple links exist. Use /api/sync-link/:storage/:container/:linkId or /api/sync-all/:storage/:container",
          links: registry.links.map((l) => ({ id: l.id, provider: l.provider, repoUrl: l.repoUrl, targetPrefix: l.targetPrefix })),
        });
        return;
      }
      const link: RepoLink = registry.links[0];

      const built = await buildProviderForLink(store, link);
      if (!built) { res.status(400).json({ error: `No ${link.provider} personal access token configured. Please add a token via Settings or the CLI.`, code: "MISSING_PAT", provider: link.provider }); return; }

      const dryRun = req.query.dryRun === "true";
      let result: SyncResult;
      try {
        result = await syncRepo(blobClient, req.params.container, built.provider, link, dryRun);
      } finally {
        built.cleanup?.();
      }

      // Write updated link back to registry (unless dry run)
      if (!dryRun) {
        const idx = registry.links.findIndex((l) => l.id === link.id);
        if (idx >= 0) registry.links[idx] = link;
        await writeLinks(blobClient, req.params.container, registry);
      }

      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ============================================================
  // Link Registry API Endpoints (Folder-Level Linking)
  // ============================================================

  // API: List all links in a container
  app.get("/api/links/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const registry = await resolveLinks(client, req.params.container);
      res.json(registry);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Create a new link
  app.post("/api/links/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const { provider, repoUrl, branch, targetPrefix, repoSubPath } = req.body;
      if (!provider || !repoUrl || !branch) {
        res.status(400).json({ error: "provider, repoUrl, and branch are required" });
        return;
      }
      if (provider !== "github" && provider !== "azure-devops" && provider !== "ssh") {
        res.status(400).json({ error: "provider must be 'github', 'azure-devops', or 'ssh'" });
        return;
      }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const result = await createLink(client, req.params.container, {
        provider,
        repoUrl,
        branch,
        repoSubPath,
        targetPrefix,
      });

      res.json({ success: true, link: result.link, warning: result.warning });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // createLink throws on exact prefix conflict — return 409
      if (msg.includes("A link already exists for prefix")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // API: Remove a link
  app.delete("/api/links/:storage/:container/:linkId", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const removed = await removeLink(client, req.params.container, req.params.linkId);
      if (!removed) {
        res.status(404).json({ error: "Link not found" });
        return;
      }
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Sync a specific link
  app.post("/api/sync-link/:storage/:container/:linkId", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const blobClient = new BlobClient(direct);
      const registry = await resolveLinks(blobClient, req.params.container);
      const link = registry.links.find((l) => l.id === req.params.linkId);
      if (!link) {
        res.status(404).json({ error: "Link not found" });
        return;
      }

      const built = await buildProviderForLink(store, link);
      if (!built) {
        res.status(400).json({ error: `No ${link.provider} personal access token configured.`, code: "MISSING_PAT", provider: link.provider });
        return;
      }

      const dryRun = req.query.dryRun === "true";
      let result: SyncResult;
      try {
        result = await syncRepo(blobClient, req.params.container, built.provider, link, dryRun);
      } finally {
        built.cleanup?.();
      }

      if (!dryRun) {
        const idx = registry.links.findIndex((l) => l.id === link.id);
        if (idx >= 0) registry.links[idx] = link;
        await writeLinks(blobClient, req.params.container, registry);
      }

      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Sync all links in a container sequentially
  app.post("/api/sync-all/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const blobClient = new BlobClient(direct);
      const registry = await resolveLinks(blobClient, req.params.container);

      if (registry.links.length === 0) {
        res.status(400).json({ error: "No links configured in this container" });
        return;
      }

      const dryRun = req.query.dryRun === "true";
      const results: Array<{ linkId: string; provider: string; repoUrl: string; result: SyncResult }> = [];

      for (const link of registry.links) {
        let built: { provider: RepoProvider; cleanup?: () => void } | null = null;
        try {
          built = await buildProviderForLink(store, link);
          if (!built) {
            results.push({
              linkId: link.id,
              provider: link.provider,
              repoUrl: link.repoUrl,
              result: { uploaded: [], deleted: [], skipped: [], errors: [`No ${link.provider} personal access token configured.`] },
            });
            continue;
          }

          const result = await syncRepo(blobClient, req.params.container, built.provider, link, dryRun);

          if (!dryRun) {
            const idx = registry.links.findIndex((l) => l.id === link.id);
            if (idx >= 0) registry.links[idx] = link;
          }

          results.push({ linkId: link.id, provider: link.provider, repoUrl: link.repoUrl, result });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            linkId: link.id,
            provider: link.provider,
            repoUrl: link.repoUrl,
            result: { uploaded: [], deleted: [], skipped: [], errors: [msg] },
          });
        } finally {
          built?.cleanup?.();
        }
      }

      // Write updated registry once at the end (unless dry run)
      if (!dryRun) {
        await writeLinks(blobClient, req.params.container, registry);
      }

      res.json({ results });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Diff a specific link (read-only comparison of container vs remote repo)
  app.get("/api/diff/:storage/:container/:linkId", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const blobClient = new BlobClient(direct);
      const registry = await resolveLinks(blobClient, req.params.container);
      const link = registry.links.find((l) => l.id === req.params.linkId);
      if (!link) {
        res.status(404).json({ error: "Link not found" });
        return;
      }

      const built = await buildProviderForLink(store, link);
      if (!built) {
        res.status(400).json({ error: `No ${link.provider} personal access token configured.`, code: "MISSING_PAT", provider: link.provider });
        return;
      }

      const includePhysicalCheck = req.query.physicalCheck === "true";
      const showIdentical = req.query.showIdentical === "true";

      let report: DiffReport;
      try {
        report = await diffLink(built.provider, link, blobClient, req.params.container, { includePhysicalCheck, showIdentical });
      } finally {
        built.cleanup?.();
      }

      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Diff all links in a container (read-only comparison)
  app.get("/api/diff-all/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const blobClient = new BlobClient(direct);
      const registry = await resolveLinks(blobClient, req.params.container);

      if (registry.links.length === 0) {
        res.status(400).json({ error: "No links configured in this container" });
        return;
      }

      const includePhysicalCheck = req.query.physicalCheck === "true";
      const showIdentical = req.query.showIdentical === "true";

      const results: Array<{ linkId: string; provider: string; repoUrl: string; report: DiffReport }> = [];

      for (const link of registry.links) {
        let built: { provider: RepoProvider; cleanup?: () => void } | null = null;
        try {
          built = await buildProviderForLink(store, link);
          if (!built) {
            res.status(400).json({ error: `No ${link.provider} personal access token configured for link ${link.id}.`, code: "MISSING_PAT", provider: link.provider, linkId: link.id });
            return;
          }

          const report = await diffLink(built.provider, link, blobClient, req.params.container, { includePhysicalCheck, showIdentical });
          results.push({ linkId: link.id, provider: link.provider, repoUrl: link.repoUrl, report });
        } finally {
          built?.cleanup?.();
        }
      }

      res.json({ results });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: List configured tokens (no secrets)
  app.get("/api/tokens", (_req, res) => {
    const store = new CredentialStore();
    res.json(store.listTokens());
  });

  // API: Add a personal access token
  app.post("/api/tokens", (req, res) => {
    const { name, provider, token } = req.body;
    if (!name || !provider || !token) {
      res.status(400).json({ error: "name, provider, and token are required" });
      return;
    }
    if (provider !== "github" && provider !== "azure-devops") {
      res.status(400).json({ error: 'provider must be "github" or "azure-devops"' });
      return;
    }
    const store = new CredentialStore();
    store.addToken({ name, provider, token });
    res.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // GitHub Apps API (plan-012)
  // -------------------------------------------------------------------------

  // API: List GitHub Apps
  app.get("/api/github-apps", (_req, res) => {
    const store = new CredentialStore();
    res.json(store.listGitHubApps());
  });

  // API: Add a GitHub App credential
  app.post("/api/github-apps", (req, res) => {
    const { name, appId, installationId, privateKeyPem, companionPatTokenName } = req.body;
    if (!name || !appId || !installationId || !privateKeyPem) {
      res.status(400).json({ error: "name, appId, installationId, and privateKeyPem are required" });
      return;
    }
    const store = new CredentialStore();
    store.addGitHubApp({ name, appId, installationId, privateKeyPem, companionPatTokenName });
    res.json({ success: true });
  });

  // API: Remove a GitHub App credential
  app.delete("/api/github-apps/:name", (req, res) => {
    const { name } = req.params;
    const store = new CredentialStore();
    const removed = store.removeGitHubApp(name);
    if (!removed) {
      res.status(404).json({ error: `GitHub App "${name}" not found` });
      return;
    }
    res.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // Reverse-Git Publication API (Phase F)
  //
  // Six endpoints implementing the route table in
  // `docs/design/project-design.md` §"Reverse-Git Publication" §4.2.
  //
  // Routing notes:
  //   * Express 5 (path-to-regexp 8) dropped the `:param?` optional-param
  //     syntax used in the design's compact form `:container?`. Each
  //     endpoint is therefore registered twice — once with `:container`
  //     (container/prefix scope) and once without (account scope).
  //   * Account scope uses the storage entry's own `accountName`.
  //   * Handlers are thin: they validate input, build a BlobClient +
  //     CredentialStore, dispatch to `reverse-sync-engine.ts`, and map
  //     any thrown error via `mapReverseGitErrorToHttp`.
  // -------------------------------------------------------------------------

  /**
   * Build the BlobClient + CredentialStore + accountName context for a
   * reverse-git request. Returns null after sending the appropriate 4xx
   * response when the storage entry is missing or is api-backed (the
   * reverse-git engine talks directly to Azure Blob storage and the
   * `BlobClient` only supports direct backends).
   */
  function reverseGitContext(
    req: express.Request,
    res: express.Response,
  ): { store: CredentialStore; blobClient: BlobClient; account: string } | null {
    const store = new CredentialStore();
    const entry = store.getStorage(req.params.storage as string);
    if (!entry) {
      res.status(404).json({ error: "Storage not found" });
      return null;
    }
    const direct = requireDirect(entry, res);
    if (!direct) return null;
    return {
      store,
      blobClient: new BlobClient(direct),
      account: direct.accountName,
    };
  }

  /**
   * Build a `ReverseLinkScope` from the request URL params + body.
   *
   *   - When `:container` is absent → account scope.
   *   - When `:container` is present and `body.prefix` is set → prefix scope.
   *   - Otherwise → container scope.
   */
  function scopeFromRequest(
    req: express.Request,
    account: string,
  ): ReverseLinkScope {
    const container = req.params.container as string | undefined;
    if (!container) {
      return { kind: "account", account };
    }
    const prefix =
      typeof req.body?.prefix === "string" && req.body.prefix.length > 0
        ? (req.body.prefix as string)
        : undefined;
    if (prefix) {
      return { kind: "prefix", account, container, prefix };
    }
    return { kind: "container", account, container };
  }

  /**
   * Convert any error thrown by the reverse-sync engine into an HTTP
   * response. ReverseGitError subclasses carry their own `httpStatus`;
   * anything else surfaces as a 500.
   */
  function sendReverseGitError(res: express.Response, err: unknown): void {
    const mapped = mapReverseGitErrorToHttp(err);
    res.status(mapped.status).json(mapped.body);
  }

  // GET /api/reverse-links/:storage/:container? — list reverse-links in scope.
  const handleListReverseLinks: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;
      const scope = scopeFromRequest(req, ctx.account);
      const links = await listReverseLinks(scope, {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
      });
      res.json({ links });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.get("/api/reverse-links/:storage/:container", handleListReverseLinks);
  app.get("/api/reverse-links/:storage", handleListReverseLinks);

  // POST /api/reverse-links/:storage/:container? — create + persist a link.
  const handleCreateReverseLink: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;

      const {
        provider,
        repoUrl,
        branch,
        repoSubPath,
        tokenName,
        authType,
        authCredentialName,
        author,
        exclusionPatterns,
        respectGitignore,
        createRepo,
        visibility,
      } = req.body ?? {};

      if (!provider || !repoUrl) {
        res
          .status(400)
          .json({ error: "provider and repoUrl are required" });
        return;
      }
      
      // Validate credential: must have either tokenName (PAT) or authType + authCredentialName (GitHub App)
      const hasPatCred = tokenName;
      const hasAppCred = authType === "github-app" && authCredentialName;
      if (!hasPatCred && !hasAppCred) {
        res
          .status(400)
          .json({ error: "A credential is required: either tokenName (PAT) or authType + authCredentialName (GitHub App)" });
        return;
      }
      if (provider !== "github" && provider !== "azure-devops") {
        res
          .status(400)
          .json({ error: 'provider must be "github" or "azure-devops"' });
        return;
      }
      if (
        visibility !== undefined &&
        visibility !== "public" &&
        visibility !== "private"
      ) {
        res
          .status(400)
          .json({ error: 'visibility must be "public" or "private"' });
        return;
      }
      if (
        exclusionPatterns !== undefined &&
        (!Array.isArray(exclusionPatterns) ||
          !exclusionPatterns.every((p) => typeof p === "string"))
      ) {
        res
          .status(400)
          .json({ error: "exclusionPatterns must be an array of strings" });
        return;
      }

      const scope = scopeFromRequest(req, ctx.account);

      // Conflict check: refuse duplicate scope + repoUrl pair.
      const existing = await listReverseLinks(scope, {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
      });
      if (existing.some((l) => l.repoUrl === repoUrl)) {
        res.status(409).json({
          error: `A reverse-link for repo '${repoUrl}' already exists in this scope`,
        });
        return;
      }

      const initOpts: InitReverseLinkOptions = {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
        scope,
        provider: provider as "github" | "azure-devops",
        repoUrl: repoUrl as string,
        branch: typeof branch === "string" ? branch : undefined,
        repoSubPath:
          typeof repoSubPath === "string" ? repoSubPath : undefined,
        // tokenName is the credential name for backward compat; use authCredentialName for GitHub App, tokenName for PAT
        tokenName: (authType === "github-app" ? authCredentialName : tokenName) as string,
        authType: authType === "github-app" ? "github-app" : "pat",
        authCredentialName: (authType === "github-app" ? authCredentialName : tokenName) as string | undefined,
        author:
          author && typeof author === "object"
            ? (author as CommitAuthor)
            : undefined,
        exclusionPatterns:
          exclusionPatterns as string[] | undefined,
        respectGitignore:
          typeof respectGitignore === "boolean"
            ? respectGitignore
            : undefined,
        createRepo:
          typeof createRepo === "boolean" ? createRepo : undefined,
        visibility:
          visibility === "public" || visibility === "private"
            ? (visibility as RepoVisibility)
            : undefined,
      };

      const link = await initReverseLink(initOpts);
      res.status(201).json({ link });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.post("/api/reverse-links/:storage/:container", handleCreateReverseLink);
  app.post("/api/reverse-links/:storage", handleCreateReverseLink);

  // DELETE /api/reverse-links/:storage/:container?/:linkId — drop a link.
  const handleDeleteReverseLink: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;
      await removeReverseLink(req.params.linkId as string, {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
        containerHint: req.params.container as string | undefined,
      });
      res.json({ removed: true });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.delete(
    "/api/reverse-links/:storage/:container/:linkId",
    handleDeleteReverseLink,
  );
  app.delete(
    "/api/reverse-links/:storage/:linkId",
    handleDeleteReverseLink,
  );

  // POST /api/push/:storage/:container?/:linkId — execute push for one link.
  // Query: dryRun=true|false, force=true|false, allowOverwriteRemote=true|false.
  const handlePushReverseLink: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;
      const result = await pushReverseLink(req.params.linkId as string, {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
        containerHint: req.params.container as string | undefined,
        dryRun: req.query.dryRun === "true",
        force: req.query.force === "true",
        allowOverwriteRemote: req.query.allowOverwriteRemote === "true",
      });
      res.json({ result });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.post("/api/push/:storage/:container/:linkId", handlePushReverseLink);
  app.post("/api/push/:storage/:linkId", handlePushReverseLink);

  // POST /api/push-all/:storage/:container? — push every link in scope.
  // Partial-failure tolerated: per-link errors are preserved in the result list
  // and the overall response surfaces 502 if any link failed (per design §4.2).
  const handlePushAll: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;
      const container = req.params.container as string | undefined;
      const links = await resolveReverseLinks({
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
        scopeHint: container
          ? { container }
          : { account: ctx.account },
      });

      const dryRun = req.query.dryRun === "true";
      const force = req.query.force === "true";
      const allowOverwriteRemote = req.query.allowOverwriteRemote === "true";

      const results: Array<
        | { linkId: string; ok: true; result: PushResult }
        | {
            linkId: string;
            ok: false;
            error: { error: string; code?: string };
          }
      > = [];
      let anyFailed = false;

      for (const link of links) {
        try {
          const result = await pushReverseLink(link.id, {
            blobClient: ctx.blobClient,
            credentialStore: ctx.store,
            dryRun,
            force,
            allowOverwriteRemote,
          });
          results.push({ linkId: link.id, ok: true, result });
        } catch (err: unknown) {
          anyFailed = true;
          const mapped = mapReverseGitErrorToHttp(err);
          results.push({
            linkId: link.id,
            ok: false,
            error: { error: mapped.body.error, code: mapped.body.code },
          });
        }
      }

      if (anyFailed) {
        res.status(502).json({ results });
        return;
      }
      res.json({ results });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.post("/api/push-all/:storage/:container", handlePushAll);
  app.post("/api/push-all/:storage", handlePushAll);

  // GET /api/reverse-diff/:storage/:container?/:linkId — preview diff (no push).
  const handleReverseDiff: express.RequestHandler = async (req, res) => {
    try {
      const ctx = reverseGitContext(req, res);
      if (!ctx) return;
      const diff = await previewReverseDiff(req.params.linkId as string, {
        blobClient: ctx.blobClient,
        credentialStore: ctx.store,
        containerHint: req.params.container as string | undefined,
      });
      res.json({ diff });
    } catch (err: unknown) {
      sendReverseGitError(res, err);
    }
  };
  app.get("/api/reverse-diff/:storage/:container/:linkId", handleReverseDiff);
  app.get("/api/reverse-diff/:storage/:linkId", handleReverseDiff);

  return app;
}

/**
 * Build the app and bind it, the original all-in-one entry point.
 * Retained for callers that do not need the bound port back.
 */
export function createServer(port: number, publicDirOverride?: string): express.Express {
  const app = buildApp(publicDirOverride);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Storage Navigator server running on http://127.0.0.1:${port}`);
  });
  return app;
}

export interface StartedServer {
  app: express.Express;
  server: http.Server;
  /** The port actually bound — differs from the request when `port` was 0. */
  port: number;
}

/**
 * Build the app and bind it to `port`, resolving once the socket is listening.
 *
 * `port: 0` asks the OS for a free port — this is what a Finder/dock launch of
 * the packaged app uses, since no port has been configured there and a
 * hardcoded one makes the app unlaunchable whenever something else holds it.
 *
 * A port the caller DID configure is never silently substituted: if it is busy
 * the returned promise rejects (EADDRINUSE) so the caller can surface the real
 * failure instead of the user getting a blank window.
 */
export function startServer(port: number, publicDirOverride?: string): Promise<StartedServer> {
  const app = buildApp(publicDirOverride);
  return new Promise<StartedServer>((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
    server.once("listening", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      console.log(`Storage Navigator server running on http://127.0.0.1:${boundPort}`);
      resolve({ app, server, port: boundPort });
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${port} is already in use.`, { cause: err })
          : err
      );
    });
  });
}

// Strip optional W/ prefix and surrounding double quotes so we can compare
// ETags from different transports — Azure returns `"0xABC..."` while many
// HTTP layers wrap responses with `W/"..."`.
function normalizeEtag(e: string | undefined): string {
  if (!e) return "";
  return e.replace(/^W\//, "").replace(/^"|"$/g, "");
}
