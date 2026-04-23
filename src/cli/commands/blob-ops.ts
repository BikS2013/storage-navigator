import * as fs from "fs";
import * as path from "path";
import { resolveStorageBackend, promptYesNo, type StorageOpts } from "./shared.js";

export async function createContainer(
  storageOpts: StorageOpts,
  containerName: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  console.log(`Creating container '${containerName}' in ${entry.name}...`);
  await backend.createContainer(containerName);
  console.log("Done.");
}

export async function renameBlob(
  storageOpts: StorageOpts,
  container: string,
  oldBlob: string,
  newBlob: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  console.log(`Renaming '${oldBlob}' -> '${newBlob}' in ${entry.name}/${container}...`);
  await backend.renameBlob(container, oldBlob, newBlob);
  console.log("Done.");
}

export async function deleteBlob(
  storageOpts: StorageOpts,
  container: string,
  blobName: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  const confirmed = await promptYesNo(`Delete '${blobName}' from ${entry.name}/${container}?`);
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  console.log(`Deleting '${blobName}'...`);
  await backend.deleteBlob(container, blobName);
  console.log("Done.");
}

export async function deleteFolder(
  storageOpts: StorageOpts,
  container: string,
  prefix: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

  const confirmed = await promptYesNo(`Delete ALL blobs under '${prefix}' from ${entry.name}/${container}?`);
  if (!confirmed) {
    console.log("Cancelled.");
    return;
  }

  console.log(`Deleting all blobs under '${prefix}'...`);
  const count = await backend.deleteFolder(container, prefix);
  console.log(`Done. ${count} blob(s) deleted.`);
}

export async function createBlob(
  storageOpts: StorageOpts,
  container: string,
  blobName: string,
  filePath?: string,
  content?: string
): Promise<void> {
  const { entry, backend } = await resolveStorageBackend(storageOpts, storageOpts.account);

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

  console.log(`Uploading to ${entry.name}/${container}/${blobName}...`);
  await backend.uploadBlob(container, blobName, data, data.length, contentType);
  console.log(`Done. (${data.length} bytes)`);
}
