import { BlobClient } from "../../core/blob-client.js";
import mammoth from "mammoth";
import { resolveStorageEntry, type StorageOpts } from "./shared.js";

export async function viewBlob(
  storageOpts: StorageOpts,
  container: string,
  blobName: string
): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const client = new BlobClient(entry);

  console.log(`Fetching ${entry.accountName}/${container}/${blobName}...\n`);

  const blob = await client.getBlobContent(container, blobName);
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "docx" || ext === "doc") {
    const buffer = Buffer.isBuffer(blob.content) ? blob.content : Buffer.from(blob.content);
    const result = await mammoth.extractRawText({ buffer });
    console.log(result.value);
    return;
  }

  const text = blob.content.toString("utf-8");

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
    console.log(`[PDF file, ${blob.size} bytes — use "storage-nav download" to save locally]`);
  } else {
    console.log(text);
  }
}

export async function listContainers(storageOpts: StorageOpts): Promise<void> {
  const { entry } = await resolveStorageEntry(storageOpts);
  const client = new BlobClient(entry);

  const containers = await client.listContainers();
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
  const { entry } = await resolveStorageEntry(storageOpts);
  const client = new BlobClient(entry);

  const items = await client.listBlobs(container, prefix);
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
  const { entry } = await resolveStorageEntry(storageOpts);
  const client = new BlobClient(entry);

  console.log(`Downloading ${entry.accountName}/${container}/${blobName}...`);
  const blob = await client.getBlobContent(container, blobName);

  const fs = await import("fs");
  fs.writeFileSync(outputPath, blob.content);
  console.log(`Saved to: ${outputPath} (${blob.size} bytes)`);
}
