import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CredentialData, EncryptedPayload, StorageEntry, TokenEntry } from "./types.js";

const STORE_DIR = path.join(os.homedir(), ".storage-navigator");
const STORE_FILE = path.join(STORE_DIR, "credentials.json");
const KEY_FILE = path.join(STORE_DIR, "machine.key");
const ALGORITHM = "aes-256-gcm";

/**
 * Derive encryption key from a stable, persisted machine key.
 *
 * Previous versions used os.hostname() which is unstable on macOS — the
 * hostname changes depending on the network (e.g. "Mac-539" vs "Mac-539.home").
 * Now we persist a random 32-byte key on first use, stored alongside the
 * credentials. The key file itself is only readable by the owner.
 */
function deriveKey(): Buffer {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, "utf-8").trim(), "hex");
  }

  // First run: generate a random key and persist it
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string): EncryptedPayload {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    data: encrypted,
    tag: tag.toString("hex"),
  };
}

function decrypt(payload: EncryptedPayload): string {
  const key = deriveKey();
  const iv = Buffer.from(payload.iv, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  let decrypted = decipher.update(payload.data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Encrypted credential store for Azure Storage SAS tokens.
 * Stores credentials at ~/.storage-navigator/credentials.json
 * encrypted with AES-256-GCM using a machine-derived key.
 */
export class CredentialStore {
  private data: CredentialData = { storages: [] };

  constructor() {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(STORE_FILE)) {
      this.data = { storages: [] };
      return;
    }
    try {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      const payload = JSON.parse(raw) as EncryptedPayload;
      const decrypted = decrypt(payload);
      this.data = JSON.parse(decrypted) as CredentialData;
    } catch {
      // Try to migrate from the old hostname-based key derivation
      if (this.tryMigrateFromHostnameKey()) {
        return;
      }
      console.error("Failed to decrypt credentials. File may be corrupted or from another machine.");
      this.data = { storages: [] };
    }
  }

  /**
   * Attempt to decrypt credentials using the old hostname-based key derivation.
   * Tries the current hostname and common macOS variants (with/without .home, .local).
   * If successful, re-encrypts with the new stable key and returns true.
   */
  private tryMigrateFromHostnameKey(): boolean {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const payload = JSON.parse(raw) as EncryptedPayload;
    const username = os.userInfo().username;
    const baseHostname = os.hostname().replace(/\.(home|local|lan)$/i, "");

    const hostnameCandidates = [
      os.hostname(),
      baseHostname,
      `${baseHostname}.home`,
      `${baseHostname}.local`,
      `${baseHostname}.lan`,
    ];

    for (const hostname of hostnameCandidates) {
      try {
        const material = `${hostname}:${username}:storage-navigator-salt`;
        const oldKey = crypto.createHash("sha256").update(material).digest();
        const iv = Buffer.from(payload.iv, "hex");
        const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, iv);
        decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
        let decrypted = decipher.update(payload.data, "hex", "utf8");
        decrypted += decipher.final("utf8");
        this.data = JSON.parse(decrypted) as CredentialData;

        // Re-encrypt with the new stable key
        console.log(`Migrated credentials from hostname-based key (${hostname}). Re-encrypting with stable key...`);
        this.save();
        return true;
      } catch {
        // This hostname variant didn't work, try next
      }
    }

    return false;
  }

  private save(): void {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
    }
    const plaintext = JSON.stringify(this.data, null, 2);
    const payload = encrypt(plaintext);
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  /** Parse SAS token expiry date from the 'se' parameter */
  static parseSasExpiry(sasToken: string): string | null {
    try {
      const decoded = decodeURIComponent(sasToken);
      const match = decoded.match(/se=([^&]+)/);
      if (match) return match[1];
    } catch {}
    return null;
  }

  /** List all configured storage accounts (names only, no tokens) */
  listStorages(): { name: string; accountName: string; addedAt: string; authType: string; expiresAt: string | null; isExpired: boolean }[] {
    return this.data.storages.map((s) => {
      const authType = s.accountKey ? "account-key" : "sas-token";
      let expiresAt: string | null = null;
      let isExpired = false;
      if (s.sasToken) {
        expiresAt = CredentialStore.parseSasExpiry(s.sasToken);
        if (expiresAt) {
          isExpired = new Date(expiresAt) < new Date();
        }
      }
      return {
        name: s.name,
        accountName: s.accountName,
        addedAt: s.addedAt,
        authType,
        expiresAt,
        isExpired,
      };
    });
  }

  /** Export a storage entry for sharing (excludes secrets, includes metadata) */
  exportStorage(name: string): { name: string; accountName: string; authType: string; addedAt: string } | undefined {
    const entry = this.data.storages.find((s) => s.name === name);
    if (!entry) return undefined;
    return {
      name: entry.name,
      accountName: entry.accountName,
      authType: entry.accountKey ? "account-key" : "sas-token",
      addedAt: entry.addedAt,
    };
  }

  /** Get a storage entry by name */
  getStorage(name: string): StorageEntry | undefined {
    return this.data.storages.find((s) => s.name === name);
  }

  /** Add or update a storage account */
  addStorage(entry: Omit<StorageEntry, "addedAt">): void {
    const existing = this.data.storages.findIndex((s) => s.name === entry.name);
    const full: StorageEntry = { ...entry, addedAt: new Date().toISOString() };
    if (existing >= 0) {
      this.data.storages[existing] = full;
    } else {
      this.data.storages.push(full);
    }
    this.save();
  }

  /** Remove a storage account by name */
  removeStorage(name: string): boolean {
    const before = this.data.storages.length;
    this.data.storages = this.data.storages.filter((s) => s.name !== name);
    if (this.data.storages.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Check if any storages are configured */
  hasStorages(): boolean {
    return this.data.storages.length > 0;
  }

  /** Get the first storage (convenience for single-storage setups) */
  getFirstStorage(): StorageEntry | undefined {
    return this.data.storages[0];
  }

  /** Add or update a personal access token */
  addToken(entry: Omit<TokenEntry, "addedAt">): void {
    if (!this.data.tokens) this.data.tokens = [];
    const existing = this.data.tokens.findIndex((t) => t.name === entry.name);
    const full: TokenEntry = { ...entry, addedAt: new Date().toISOString() };
    if (existing >= 0) {
      this.data.tokens[existing] = full;
    } else {
      this.data.tokens.push(full);
    }
    this.save();
  }

  /** Get a token by name */
  getToken(name: string): TokenEntry | undefined {
    return this.data.tokens?.find((t) => t.name === name);
  }

  /** Get the first token matching a provider */
  getTokenByProvider(provider: "github" | "azure-devops"): TokenEntry | undefined {
    return this.data.tokens?.find((t) => t.provider === provider);
  }

  /** List all tokens (no secrets exposed) */
  listTokens(): { name: string; provider: string; addedAt: string; expiresAt: string | null; isExpired: boolean }[] {
    return (this.data.tokens ?? []).map((t) => ({
      name: t.name,
      provider: t.provider,
      addedAt: t.addedAt,
      expiresAt: t.expiresAt ?? null,
      isExpired: t.expiresAt ? new Date(t.expiresAt) < new Date() : false,
    }));
  }

  /** Remove a token by name */
  removeToken(name: string): boolean {
    if (!this.data.tokens) return false;
    const before = this.data.tokens.length;
    this.data.tokens = this.data.tokens.filter((t) => t.name !== name);
    if (this.data.tokens.length < before) {
      this.save();
      return true;
    }
    return false;
  }
}
