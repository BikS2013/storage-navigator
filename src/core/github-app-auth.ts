// ===========================================================================
// src/core/github-app-auth.ts
//
// GitHub App installation token generation via JWT authentication.
//
// Source of truth for JWT + token flow:
//   docs/research/jose-rs256-github-app-jwt.md
//   docs/research/github-app-installation-auth-and-repo-scope.md
//
// Phase 2 (plan-012) — Core authentication module with in-memory caching.
// ===========================================================================

import { SignJWT, importPKCS8, importSPKI } from 'jose';
import { createPrivateKey } from 'crypto';
import { GitHubApiError, InvalidPATError, InsufficientScopesError } from './reverse-git-errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = "https://api.github.com";

/**
 * JWT expiry: GitHub accepts up to 10 minutes; we use 9 minutes to allow
 * for clock skew and network latency.
 */
const JWT_EXPIRY_SECONDS = 540;

/**
 * Installation token cache lifetime safety margin: we cache tokens for 1 hour
 * (GitHub default), but we invalidate the cache 1 minute before expiry to
 * prevent race conditions.
 */
const TOKEN_CACHE_SAFETY_MARGIN_MS = 60_000;

/**
 * Installation token default lifetime (1 hour per GitHub docs).
 */
const INSTALLATION_TOKEN_LIFETIME_MS = 3_600_000;

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

const installationTokenCache = new Map<string, CachedToken>();

/**
 * Clear the installation token cache. Exported for testing.
 */
export function clearInstallationTokenCache(): void {
  installationTokenCache.clear();
}

// ---------------------------------------------------------------------------
// PEM validation
// ---------------------------------------------------------------------------

/**
 * Validate a private key PEM string and detect its format.
 * Throws a descriptive error if the PEM is invalid or unsupported.
 * 
 * Per OQ5: basic validation (starts with -----BEGIN), defer cryptographic
 * validation to the signing attempt.
 */
export function validatePrivateKeyPem(pem: string): { format: 'pkcs1' | 'pkcs8' } {
  const trimmed = pem.trim();
  
  // Check for common mistakes
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error(
      'Invalid private key: the PEM appears to be a PUBLIC key. ' +
      'GitHub Apps require a PRIVATE key (PKCS#1 RSA PRIVATE KEY or PKCS#8 PRIVATE KEY).'
    );
  }
  
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      'Invalid private key: the PEM appears to be a certificate, not a private key. ' +
      'GitHub Apps require a PRIVATE key in PEM format.'
    );
  }
  
  if (trimmed.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
    throw new Error(
      'Invalid private key: the PEM is encrypted (passphrase-protected). ' +
      'storage-navigator does not support encrypted private keys. ' +
      'Remove the passphrase: `openssl rsa -in encrypted.pem -out decrypted.pem`'
    );
  }
  
  // Detect format
  if (trimmed.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return { format: 'pkcs1' };
  }
  
  if (trimmed.includes('-----BEGIN PRIVATE KEY-----')) {
    return { format: 'pkcs8' };
  }
  
  // Fallback: no recognized BEGIN marker
  throw new Error(
    'Invalid private key: PEM format not detected. ' +
    'Expected -----BEGIN RSA PRIVATE KEY----- (PKCS#1) or -----BEGIN PRIVATE KEY----- (PKCS#8).'
  );
}

// ---------------------------------------------------------------------------
// JWT generation
// ---------------------------------------------------------------------------

/**
 * Generate a GitHub App JWT signed with RS256.
 * 
 * @param appId GitHub App ID (numeric string from app settings)
 * @param privateKeyPem RSA private key in PKCS#1 or PKCS#8 PEM format
 * @returns Signed JWT valid for ~9 minutes
 * @throws Error if appId is invalid or key signing fails
 */
async function generateGitHubAppJWT(
  appId: string,
  privateKeyPem: string
): Promise<string> {
  // Validate appId is numeric
  if (!/^\d+$/.test(appId)) {
    throw new Error(
      `Invalid GitHub App ID: "${appId}" is not a numeric string. ` +
      `App IDs are found in GitHub App settings (e.g., "123456").`
    );
  }
  
  // Validate PEM format
  const { format } = validatePrivateKeyPem(privateKeyPem);
  
  // Import the private key using Node's crypto (handles both PKCS#1 and PKCS#8)
  let keyObject;
  try {
    keyObject = createPrivateKey(privateKeyPem);
  } catch (err) {
    throw new Error(
      `Failed to import private key: ${(err as Error).message}. ` +
      `Verify the PEM format is valid and not corrupted.`
    );
  }
  
  // Export as PKCS#8 for jose (jose requires PKCS#8)
  const pkcs8Pem = keyObject.export({ type: 'pkcs8', format: 'pem' }) as string;
  
  // Import into jose
  let privateKey;
  try {
    privateKey = await importPKCS8(pkcs8Pem, 'RS256');
  } catch (err) {
    throw new Error(
      `jose failed to import PKCS#8 key: ${(err as Error).message}`
    );
  }
  
  // Generate JWT
  const now = Math.floor(Date.now() / 1000);
  const iat = now - 60; // Clock skew tolerance (GitHub recommends -60)
  const exp = now + JWT_EXPIRY_SECONDS;
  
  try {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setIssuer(appId)
      .sign(privateKey);
    
    return jwt;
  } catch (err) {
    throw new Error(
      `Failed to sign JWT: ${(err as Error).message}. ` +
      `This usually indicates a key format mismatch or corrupted PEM.`
    );
  }
}

// ---------------------------------------------------------------------------
// Installation token generation
// ---------------------------------------------------------------------------

/**
 * Generate an installation access token for a GitHub App installation.
 * 
 * Tokens are cached in-memory keyed by installationId for the duration of
 * a single CLI command or UI action (per OQ6). The cache is invalidated
 * 1 minute before the token expires.
 * 
 * @param appId GitHub App ID
 * @param privateKeyPem RSA private key in PEM format
 * @param installationId Installation ID for the target account/org
 * @returns Installation access token (valid for ~1 hour)
 * @throws InvalidPATError (401) if JWT is expired/malformed
 * @throws InsufficientScopesError (403) if installation is suspended
 * @throws GitHubApiError (404) if installation not found/uninstalled
 */
export async function generateInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string
): Promise<string> {
  // Check cache
  const cached = installationTokenCache.get(installationId);
  const now = Date.now();
  
  if (cached && cached.expiresAt > now + TOKEN_CACHE_SAFETY_MARGIN_MS) {
    // Cache hit and still valid
    return cached.token;
  }
  
  // Generate JWT
  const jwt = await generateGitHubAppJWT(appId, privateKeyPem);
  
  // Exchange JWT for installation token
  const url = `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!res.ok) {
    const body = await safeJson(res);
    const message = body.message ?? `HTTP ${res.status}`;
    
    if (res.status === 401) {
      throw new InvalidPATError(
        `GitHub App authentication failed: ${message}. ` +
        `The JWT may be expired, the App ID may be incorrect, or the private key may be invalid.`
      );
    }
    
    if (res.status === 403) {
      throw new InsufficientScopesError(
        `GitHub App installation access denied: ${message}. ` +
        `The installation may be suspended or the app may lack required permissions.`
      );
    }
    
    if (res.status === 404) {
      throw new GitHubApiError(
        404,
        `GitHub App installation not found: ${message}. ` +
        `Verify the installation ID (${installationId}) is correct and the app is installed ` +
        `on the target account/organization.`
      );
    }
    
    // Other errors
    throw new GitHubApiError(res.status, `Failed to generate installation token: ${message}`);
  }
  
  // Parse response
  const data = (await res.json()) as { token?: string; expires_at?: string };
  if (!data.token) {
    throw new GitHubApiError(
      200,
      'Installation token response missing "token" field. This is a GitHub API contract violation.'
    );
  }
  
  // Cache the token
  // expires_at is ISO 8601; parse it to Unix timestamp
  const expiresAt = data.expires_at
    ? new Date(data.expires_at).getTime()
    : now + INSTALLATION_TOKEN_LIFETIME_MS;
  
  installationTokenCache.set(installationId, {
    token: data.token,
    expiresAt,
  });
  
  return data.token;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse response body as JSON; return an empty object on failure.
 */
async function safeJson(res: Response): Promise<{ message?: string }> {
  try {
    return (await res.json()) as { message?: string };
  } catch {
    return {};
  }
}
