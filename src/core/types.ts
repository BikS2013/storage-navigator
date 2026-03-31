/** A configured storage account with encrypted credentials */
export interface StorageEntry {
  name: string;
  accountName: string;
  sasToken?: string;       // SAS token (container or account level)
  accountKey?: string;     // Account key (full access)
  addedAt: string;
}

/** Personal access token for GitHub or Azure DevOps */
export interface TokenEntry {
  name: string;
  provider: "github" | "azure-devops";
  token: string;
  addedAt: string;
  expiresAt?: string;
}

/** Metadata stored in each synced container as .repo-sync-meta.json */
export interface RepoSyncMeta {
  provider: "github" | "azure-devops";
  repoUrl: string;
  branch: string;
  lastSyncAt: string;
  lastCommitSha?: string;
  fileShas: Record<string, string>;
}

/** A file entry from a remote repository */
export interface RepoFileEntry {
  path: string;
  sha: string;
  size?: number;
}

/** Result of a sync operation */
export interface SyncResult {
  uploaded: string[];
  deleted: string[];
  skipped: string[];
  errors: string[];
}

/** Credential store file format (decrypted) */
export interface CredentialData {
  storages: StorageEntry[];
  tokens?: TokenEntry[];
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
