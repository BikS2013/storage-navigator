/** A configured storage account with encrypted credentials */
export interface StorageEntry {
  name: string;
  accountName: string;
  sasToken?: string;       // SAS token (container or account level)
  accountKey?: string;     // Account key (full access)
  addedAt: string;
}

/** Credential store file format (decrypted) */
export interface CredentialData {
  storages: StorageEntry[];
}

/** Encrypted payload stored on disk */
export interface EncryptedPayload {
  iv: string;       // hex-encoded IV
  data: string;     // hex-encoded ciphertext
  tag: string;      // hex-encoded auth tag
}

/** Blob item from Azure listing */
export interface BlobItem {
  name: string;
  isPrefix: boolean;       // true = virtual directory, false = blob
  size?: number;
  lastModified?: string;
  contentType?: string;
}

/** Container info */
export interface ContainerInfo {
  name: string;
}

/** API response for blob content */
export interface BlobContent {
  content: Buffer | string;
  contentType: string;
  size: number;
  name: string;
}
