import mammoth from "mammoth";
import { resolveStorageBackend, type StorageOpts } from "./shared.js";
import type { BlobReadHandle } from "../../core/backend/backend.js";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function viewBlob(
  storageOpts: StorageOpts,
  container: string,
  blobName: string
): Promise<void> {
  const { backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  console.log(`Fetching ${container}/${blobName}...\n`);

  const handle: BlobReadHandle = await backend.readBlob(container, blobName);
  const buffer = await streamToBuffer(handle.stream);
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    console.log(result.value);
    return;
  }

  const text = buffer.toString("utf-8");

  if (ext === "json") {
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  } else if (ext === "md") {
    // Render markdown as plain text with structure hints
    console.log(text);
  } else if (ext === "pdf") {
    console.log(`[PDF file, ${buffer.length} bytes — use "storage-nav download" to save locally]`);
  } else {
    console.log(text);
  }
}

export async function listContainers(storageOpts: StorageOpts): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  const page = await backend.listContainers();
  const containers = page.items;
  console.log(`Containers in '${entry.name}' (${containers.length}):\n`);
  for (const c of containers) {
    console.log(`  ${c.name}`);
  }
}

export async function listBlobs(
  storageOpts: StorageOpts,
  container: string,
  prefix?: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  const page = await backend.listBlobs(container, { prefix, pageSize: undefined });
  const items = page.items;
  const location = prefix ? `${container}/${prefix}` : container;
  console.log(`Contents of '${entry.name}/${location}' (${items.length} items):\n`);

  for (const item of items) {
    if (item.isPrefix) {
      console.log(`  [DIR]  ${item.name}`);
    } else {
      const size = item.size ? `${(item.size / 1024).toFixed(1)}KB` : "";
      console.log(`  [FILE] ${item.name}  ${size}`);
    }
  }
}

export async function downloadBlob(
  storageOpts: StorageOpts,
  container: string,
  blobName: string,
  outputPath: string
): Promise<void> {
  const { backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  console.log(`Downloading ${container}/${blobName}...`);
  const handle = await backend.readBlob(container, blobName);

  const fs = await import("fs");
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    handle.stream.pipe(out);
    out.on("finish", () => resolve());
    out.on("error", (err) => reject(err));
    handle.stream.on("error", (err) => reject(err));
  });

  const stats = fs.statSync(outputPath);
  console.log(`Saved to: ${outputPath} (${stats.size} bytes)`);
}
