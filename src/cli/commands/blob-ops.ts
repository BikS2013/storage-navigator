import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { CredentialStore } from "../../core/credential-store.js";
import { BlobClient } from "../../core/blob-client.js";

function resolveStorage(storageName?: string) {
  const store = new CredentialStore();
  if (storageName) {
    const entry = store.getStorage(storageName);
    if (!entry) {
      console.error(`Storage '${storageName}' not found.`);
      process.exit(1);
    }
    return entry;
  }
  const first = store.getFirstStorage();
  if (!first) {
    console.error('No storage accounts configured. Use "storage-nav add" first.');
    process.exit(1);
  }
  return first;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function renameBlob(
  storageName: string | undefined,
  container: string,
  oldBlob: string,
  newBlob: string
): Promise<void> {
  const entry = resolveStorage(storageName);
  const client = new BlobClient(entry);

  console.log(`Renaming '${oldBlob}' -> '${newBlob}' in ${entry.accountName}/${container}...`);
  await client.renameBlob(container, oldBlob, newBlob);
  console.log("Done.");
}

export async function deleteBlob(
  storageName: string | undefined,
  container: string,
  blobName: string
): Promise<void> {
  const entry = resolveStorage(storageName);

  const confirmed = await confirm(`Delete '${blobName}' from ${entry.accountName}/${container}?`);
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  const client = new BlobClient(entry);
  console.log(`Deleting '${blobName}'...`);
  await client.deleteBlob(container, blobName);
  console.log("Done.");
}

export async function createBlob(
  storageName: string | undefined,
  container: string,
  blobName: string,
  filePath?: string,
  content?: string
): Promise<void> {
  const entry = resolveStorage(storageName);
  const client = new BlobClient(entry);

  let data: Buffer;
  let contentType = "application/octet-stream";

  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".json") contentType = "application/json";
    else if (ext === ".md" || ext === ".txt") contentType = "text/plain";
    else if (ext === ".pdf") contentType = "application/pdf";
    else if (ext === ".html") contentType = "text/html";
  } else if (content !== undefined) {
    data = Buffer.from(content, "utf-8");
    const ext = path.extname(blobName).toLowerCase();
    if (ext === ".json") contentType = "application/json";
    else if (ext === ".md" || ext === ".txt") contentType = "text/plain";
  } else {
    console.error("Either --file or --content is required.");
    process.exit(1);
  }

  console.log(`Uploading to ${entry.accountName}/${container}/${blobName}...`);
  await client.createBlob(container, blobName, data, contentType);
  console.log(`Done. (${data.length} bytes)`);
}
