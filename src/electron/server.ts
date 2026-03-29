import express from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { CredentialStore } from "../core/credential-store.js";
import { BlobClient } from "../core/blob-client.js";

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
    store.addStorage({ name, accountName, sasToken, accountKey });
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
      const client = new BlobClient(entry);
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
      const client = new BlobClient(entry);
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

      const client = new BlobClient(entry);
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
      res.setHeader("X-Blob-Name", blob.name);
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

      const client = new BlobClient(entry);
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

      const client = new BlobClient(entry);
      await client.deleteBlob(req.params.container, blobPath);
      res.json({ success: true });
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

      const client = new BlobClient(entry);
      await client.createBlob(req.params.container, blobPath, content, contentType);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.listen(port, () => {
    console.log(`Storage Navigator server running on http://localhost:${port}`);
  });

  return app;
}
