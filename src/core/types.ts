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
  provider: "github" | "azure-devops" | "ssh";
  token: string;
  addedAt: string;
  expiresAt?: string;
}

/** Metadata stored in each synced container as .repo-sync-meta.json */
export interface RepoSyncMeta {
  provider: "github" | "azure-devops" | "ssh";
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

/** A single repository link within a container */
export interface RepoLink {
  /** Unique link identifier (UUID v4 via crypto.randomUUID()) */
  id: string;
  /** Repository provider */
  provider: "github" | "azure-devops" | "ssh";
  /** Full repository URL (e.g., "https://github.com/owner/repo") */
  repoUrl: string;
  /** Branch name (never undefined after creation -- resolved to default branch if not specified) */
  branch: string;
  /** Sub-path within the repository to sync from (e.g., "src/templates"). Undefined = entire repo */
  repoSubPath?: string;
  /** Blob prefix in the container (e.g., "prompts/coa"). Undefined = container root */
  targetPrefix?: string;
  /** ISO 8601 timestamp of last successful sync. Undefined if never synced */
  lastSyncAt?: string;
  /** Commit SHA of last successful sync */
  lastCommitSha?: string;
  /** Map of blobPath -> git SHA for all tracked files. Keys are blob paths (not repo paths) */
  fileShas: Record<string, string>;
  /** ISO 8601 timestamp of when the link was created */
  createdAt: string;
}

/** Container-level registry of all repository links */
export interface RepoLinksRegistry {
  /** Schema version for forward compatibility */
  version: 1;
  /** Array of link entries */
  links: RepoLink[];
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
