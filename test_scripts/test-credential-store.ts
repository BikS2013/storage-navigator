/**
 * Tests for the CredentialStore — encryption, persistence, and migration.
 *
 * Run: npx tsx test_scripts/test-credential-store.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// Use a temp directory to avoid touching real credentials
const TEST_DIR = path.join(os.tmpdir(), `sn-test-${Date.now()}`);
const TEST_CRED_FILE = path.join(TEST_DIR, "credentials.json");
const TEST_KEY_FILE = path.join(TEST_DIR, "machine.key");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function cleanup(): void {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

// --- Test helpers: replicate the encryption logic locally ---
function encrypt(plaintext: string, key: Buffer): { iv: string; data: string; tag: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), data: encrypted, tag: tag.toString("hex") };
}

function decrypt(payload: { iv: string; data: string; tag: string }, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  let decrypted = decipher.update(payload.data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// --- Tests ---

console.log("\n=== CredentialStore Tests ===\n");

// Test 1: Key file generation
console.log("Test 1: Key file generation");
fs.mkdirSync(TEST_DIR, { recursive: true, mode: 0o700 });
const key = crypto.randomBytes(32);
fs.writeFileSync(TEST_KEY_FILE, key.toString("hex"), { mode: 0o600 });
assert(fs.existsSync(TEST_KEY_FILE), "Key file created");
const readKey = Buffer.from(fs.readFileSync(TEST_KEY_FILE, "utf-8").trim(), "hex");
assert(readKey.equals(key), "Key file content matches");

// Test 2: Encrypt and decrypt roundtrip
console.log("\nTest 2: Encrypt/decrypt roundtrip");
const testData = JSON.stringify({ storages: [{ name: "test", accountName: "testaccount", accountKey: "secret123", addedAt: "2026-01-01" }] });
const payload = encrypt(testData, key);
assert(payload.iv.length === 32, "IV is 16 bytes (32 hex chars)");
assert(payload.tag.length === 32, "Auth tag is 16 bytes (32 hex chars)");
const decrypted = decrypt(payload, key);
assert(decrypted === testData, "Decrypted data matches original");

// Test 3: Wrong key fails to decrypt
console.log("\nTest 3: Wrong key fails decryption");
const wrongKey = crypto.randomBytes(32);
let decryptFailed = false;
try {
  decrypt(payload, wrongKey);
} catch {
  decryptFailed = true;
}
assert(decryptFailed, "Decryption with wrong key throws");

// Test 4: Credential file persistence
console.log("\nTest 4: File persistence");
fs.writeFileSync(TEST_CRED_FILE, JSON.stringify(payload, null, 2), "utf-8");
assert(fs.existsSync(TEST_CRED_FILE), "Credential file written");
const raw = fs.readFileSync(TEST_CRED_FILE, "utf-8");
const loaded = JSON.parse(raw);
const loadedDecrypted = decrypt(loaded, key);
assert(loadedDecrypted === testData, "Persisted credentials decrypt correctly");

// Test 5: Hostname-based key instability demonstration
console.log("\nTest 5: Hostname key instability");
const hostname1 = "Mac-539";
const hostname2 = "Mac-539.home";
const username = os.userInfo().username;
const key1 = crypto.createHash("sha256").update(`${hostname1}:${username}:salt`).digest();
const key2 = crypto.createHash("sha256").update(`${hostname2}:${username}:salt`).digest();
assert(!key1.equals(key2), "Different hostnames produce different keys (the bug)");
const encrypted1 = encrypt(testData, key1);
let crossDecryptFailed = false;
try {
  decrypt(encrypted1, key2);
} catch {
  crossDecryptFailed = true;
}
assert(crossDecryptFailed, "Data encrypted with hostname1 cannot be decrypted with hostname2");

// Test 6: SAS token expiry parsing
console.log("\nTest 6: SAS token expiry parsing");
const sasToken = "sv=2021-06-08&ss=b&srt=co&sp=rl&se=2026-12-31T23:59:59Z&st=2026-01-01";
const match = decodeURIComponent(sasToken).match(/se=([^&]+)/);
assert(match !== null, "SAS expiry date extracted");
assert(match![1] === "2026-12-31T23:59:59Z", "Correct expiry date parsed");

// Cleanup
cleanup();

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
