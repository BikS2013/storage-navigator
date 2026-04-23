import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import type { StorageEntry, BlobItem, ContainerInfo, BlobContent } from "./types.js";

/**
 * Azure Blob Storage client for navigation and content retrieval.
 * Supports both SAS token and account key authentication.
 */
export class BlobClient {
  private serviceClient: BlobServiceClient;

  constructor(storage: StorageEntry) {
    if (storage.accountKey) {
      const credential = new StorageSharedKeyCredential(
        storage.accountName,
        storage.accountKey
      );
      this.serviceClient = new BlobServiceClient(
        `https://${storage.accountName}.blob.core.windows.net`,
        credential
      );
    } else if (storage.sasToken) {
      const sasUrl = `https://${storage.accountName}.blob.core.windows.net?${storage.sasToken}`;
      this.serviceClient = new BlobServiceClient(sasUrl);
    } else {
      throw new Error(`Storage '${storage.name}' has no accountKey or sasToken configured.`);
    }
  }

  /** List all containers in the storage account */
  async listContainers(): Promise<ContainerInfo[]> {
    const containers: ContainerInfo[] = [];
    for await (const container of this.serviceClient.listContainers()) {
      containers.push({ name: container.name });
    }
    return containers;
  }

  /** Create a new container */
  async createContainer(containerName: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    await containerClient.create();
  }

  /** Delete a container if it exists. Used by IStorageBackend.deleteContainer. */
  async deleteContainer(containerName: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    await containerClient.deleteIfExists();
  }

  /** List blobs in a container with optional prefix (for folder navigation) */
  async listBlobs(containerName: string, prefix?: string): Promise<BlobItem[]> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const items: BlobItem[] = [];

    const options = prefix
      ? { prefix, delimiter: "/" }
      : { delimiter: "/" };

    for await (const item of containerClient.listBlobsByHierarchy("/", options)) {
      if (item.kind === "prefix") {
        items.push({
          name: item.name,
          isPrefix: true,
        });
      } else {
        items.push({
          name: item.name,
          isPrefix: false,
          size: item.properties.contentLength,
          lastModified: item.properties.lastModified?.toISOString(),
          contentType: item.properties.contentType,
        });
      }
    }

    return items;
  }

  /** List ALL blobs in a container recursively (flat list, no hierarchy) */
  async listBlobsFlat(containerName: string): Promise<BlobItem[]> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const items: BlobItem[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      items.push({
        name: blob.name,
        isPrefix: false,
        size: blob.properties.contentLength,
        lastModified: blob.properties.lastModified?.toISOString(),
        contentType: blob.properties.contentType,
      });
    }
    return items;
  }

  /** Rename a blob (copy to new name, then delete original) */
  async renameBlob(containerName: string, oldName: string, newName: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const sourceBlob = containerClient.getBlockBlobClient(oldName);
    const targetBlob = containerClient.getBlockBlobClient(newName);

    // Ensure source exists
    const exists = await sourceBlob.exists();
    if (!exists) {
      throw new Error(`Blob '${oldName}' does not exist in container '${containerName}'.`);
    }

    // Copy source to target
    const copyPoller = await targetBlob.beginCopyFromURL(sourceBlob.url);
    await copyPoller.pollUntilDone();

    // Delete original
    await sourceBlob.delete();
  }

  /** Delete a blob */
  async deleteBlob(containerName: string, blobName: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);

    const exists = await blobClient.exists();
    if (!exists) {
      throw new Error(`Blob '${blobName}' does not exist in container '${containerName}'.`);
    }

    await blobClient.delete();
  }

  /** Create (upload) a blob from content */
  async createBlob(containerName: string, blobName: string, content: Buffer | string, contentType?: string): Promise<void> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);

    const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    await blobClient.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: contentType ?? "application/octet-stream" },
    });
  }

  /** Delete all blobs under a prefix (folder). Returns the count of deleted blobs. */
  async deleteFolder(containerName: string, prefix: string): Promise<number> {
    const containerClient = this.serviceClient.getContainerClient(containerName);

    // Ensure prefix ends with /
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix + "/";

    // List all blobs under the prefix (flat, recursive)
    const blobsToDelete: string[] = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix: normalizedPrefix })) {
      blobsToDelete.push(blob.name);
    }

    if (blobsToDelete.length === 0) {
      throw new Error(`No blobs found under prefix '${normalizedPrefix}' in container '${containerName}'.`);
    }

    for (const blobName of blobsToDelete) {
      await containerClient.getBlockBlobClient(blobName).delete();
    }

    return blobsToDelete.length;
  }

  /**
   * Alias of {@link createBlob} used by IStorageBackend.uploadBlob. Same
   * semantics: uploads `content` as a block blob with the given content type
   * (defaults to `application/octet-stream`).
   */
  async uploadBlob(containerName: string, blobName: string, content: Buffer | string, contentType?: string): Promise<void> {
    await this.createBlob(containerName, blobName, content, contentType);
  }

  /**
   * Alias of {@link getBlobContent} used by IStorageBackend.readBlob /
   * headBlob. Returns the blob bytes plus content-type and size.
   */
  async viewBlob(containerName: string, blobName: string): Promise<BlobContent> {
    return this.getBlobContent(containerName, blobName);
  }

  /** Download blob content */
  async getBlobContent(containerName: string, blobName: string): Promise<BlobContent> {
    const containerClient = this.serviceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);

    const downloadResponse = await blobClient.download(0);
    const body = downloadResponse.readableStreamBody;
    if (!body) {
      throw new Error(`Failed to download blob: ${blobName}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks);

    return {
      content,
      contentType: downloadResponse.contentType ?? "application/octet-stream",
      size: content.length,
      name: blobName,
    };
  }
}
