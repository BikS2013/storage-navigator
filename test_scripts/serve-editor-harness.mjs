#!/usr/bin/env node
/**
 * Renderer harness for the in-place text editor (find bar + match highlighting).
 *
 * Serves src/electron/public over HTTP and answers the handful of /api routes
 * the tree + file viewer need with fixed in-memory fixtures, so the real
 * index.html / app.js / styles.css can be driven end-to-end — Edit mode, Cmd+F,
 * highlight alignment, match navigation — with no Azure account and no
 * credential store.
 *
 * Usage:  node test_scripts/serve-editor-harness.mjs [port]
 *         open http://127.0.0.1:<port>/
 *
 * The fixture file deliberately mixes short lines, a very long wrapping line,
 * tabs, HTML-special characters and a trailing newline: the four things that
 * can throw the highlight mirror out of alignment with the textarea.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "src", "electron", "public");
const PORT = Number(process.argv[2] || 8791);

const STORAGE = "harness";
const CONTAINER = "demo";
const BLOB = "sample.txt";

const FIXTURE = [
  "alpha beta gamma alpha",
  "The quick brown fox jumps over the lazy dog. The FOX is quick.",
  "\tindented\twith\ttabs — alpha & <beta> \"gamma\"",
  "",
  "A deliberately long line that must wrap inside the editor so the highlight mirror is forced to break it at exactly the same place the textarea does: alpha appears here, then alpha again much further along the same logical line, and one final alpha right at the end of it.",
  "",
  ...Array.from({ length: 60 }, (_, i) => `line ${i + 1} padding text alpha-${i + 1}`),
  "last alpha before the trailing newline",
  "",
].join("\n");

let currentText = FIXTURE;
let currentEtag = '"harness-etag-1"';
let etagSeq = 1;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  // ---- API fixtures ------------------------------------------------------
  if (path.startsWith("/api/")) {
    if (path === "/api/storages") {
      return json(res, 200, [{ name: STORAGE, kind: "direct", accountName: "harnessacct" }]);
    }
    if (path === `/api/containers/${STORAGE}`) {
      return json(res, 200, [{ name: CONTAINER }]);
    }
    if (path === `/api/shares/${STORAGE}`) {
      return json(res, 200, []);
    }
    if (path === `/api/blobs/${STORAGE}/${CONTAINER}`) {
      return json(res, 200, [
        { name: BLOB, size: Buffer.byteLength(currentText), isPrefix: false },
      ]);
    }
    if (path === `/api/blob/${STORAGE}/${CONTAINER}`) {
      if (req.method === "PUT") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.ifMatch && body.ifMatch !== currentEtag) {
          return json(res, 412, { error: { message: "etag mismatch" } });
        }
        currentText = String(body.content ?? "");
        currentEtag = `"harness-etag-${++etagSeq}"`;
        return json(res, 200, { etag: currentEtag });
      }
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(currentText),
        etag: currentEtag,
        "x-editable": "true",
        "x-editable-reason": "text",
      });
      return res.end(currentText);
    }
    // Everything else (links, reverse-links, …) — the renderer treats a
    // failure here as "none present" and carries on.
    return json(res, 404, { error: { message: "not served by the harness" } });
  }

  // ---- Static files ------------------------------------------------------
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = join(PUBLIC_DIR, normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`editor harness on http://127.0.0.1:${PORT}/`);
  console.log(`  storage "${STORAGE}" → container "${CONTAINER}" → ${BLOB}`);
  console.log(`  click the file, press Edit, then Cmd/Ctrl+F`);
});
