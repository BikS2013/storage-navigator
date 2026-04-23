import express from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { CredentialStore } from "../core/credential-store.js";
import { BlobClient } from "../core/blob-client.js";
import { readSyncMeta, syncRepo, resolveLinks, writeLinks, createLink, removeLink } from "../core/sync-engine.js";
import type { RepoProvider } from "../core/sync-engine.js";
import type { DirectStorageEntry, RepoLink, StorageEntry, SyncResult, DiffReport } from "../core/types.js";
import { buildProviderForLink } from "../core/repo-utils.js";
import { diffLink } from "../core/diff-engine.js";

/**
 * Narrow a StorageEntry to a DirectStorageEntry. The Electron HTTP server
 * currently only supports direct backends; api-backed entries are routed
 * through the IStorageBackend factory in CLI commands instead. T21 will
 * refactor this server to support both.
 */
function requireDirect(entry: StorageEntry, res: express.Response): DirectStorageEntry | null {
  if (entry.kind === 'direct') return entry;
  res.status(400).json({
    error: "This endpoint currently only supports direct storage backends. Use the CLI for api-backed storages until T21 lands.",
  });
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer(port: number, publicDirOverride?: string): express.Express {
  const app = express();
  app.use(express.json());

  // Serve static files from public directory
  const publicDir = publicDirOverride || path.join(__dirname, "public");
  app.use(express.static(publicDir));

  // API: List configured storages
  app.get("/api/storages", (_req, res) => {
    const store = new CredentialStore();
    res.json(store.listStorages());
  });

  // API: Add storage
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
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const containers = await client.listContainers();
      res.json(containers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: List blobs
  app.get("/api/blobs/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }
      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const prefix = (req.query.prefix as string) || undefined;
      const items = await client.listBlobs(req.params.container, prefix);
      res.json(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Get blob content — blob path passed as query param to avoid Express 5 wildcard issues
  app.get("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const blob = await client.getBlobContent(req.params.container, blobPath);

      // Check if this is a docx file and format conversion is requested
      const format = req.query.format as string | undefined;
      if (blobPath.endsWith(".docx") && format) {
        const buffer = Buffer.isBuffer(blob.content) ? blob.content : Buffer.from(blob.content);
        if (format === "html") {
          const result = await mammoth.convertToHtml({ buffer });
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.send(result.value);
          return;
        } else if (format === "text") {
          const result = await mammoth.extractRawText({ buffer });
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.send(result.value);
          return;
        }
      }

      res.setHeader("Content-Type", blob.contentType);
      res.setHeader("X-Blob-Name", encodeURIComponent(blob.name));
      res.setHeader("X-Blob-Size", String(blob.size));
      res.send(blob.content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Rename a blob
  app.post("/api/rename/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const { oldName, newName } = req.body;
      if (!oldName || !newName) { res.status(400).json({ error: "oldName and newName are required" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      await client.renameBlob(req.params.container, oldName, newName);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Delete a blob
  app.delete("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      await client.deleteBlob(req.params.container, blobPath);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Delete a folder (all blobs under a prefix)
  app.delete("/api/folder/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const prefix = req.query.prefix as string;
      if (!prefix) { res.status(400).json({ error: "?prefix= query parameter required" }); return; }

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      const count = await client.deleteFolder(req.params.container, prefix);
      res.json({ success: true, deleted: count });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // API: Create (upload) a blob
  app.post("/api/blob/:storage/:container", async (req, res) => {
    try {
      const store = new CredentialStore();
      const entry = store.getStorage(req.params.storage);
      if (!entry) { res.status(404).json({ error: "Storage not found" }); return; }

      const blobPath = req.query.blob as string;
      if (!blobPath) { res.status(400).json({ error: "?blob= query parameter required" }); return; }

      const contentType = (req.query.contentType as string) || "application/octet-stream";
      const content = typeof req.body.content === "string" ? req.body.content : JSON.stringify(req.body.content ?? "");

      const direct = requireDirect(entry, res);
      if (!direct) return;
      const client = new BlobClient(direct);
      await client.createBlob(req.params.container, blobPath, content, contentType);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

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

  app.listen(port, "127.0.0.1", () => {
    console.log(`Storage Navigator server running on http://127.0.0.1:${port}`);
  });

  return app;
}
