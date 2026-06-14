// ===========================================================================
// tests/unit/github-app-auth.test.ts
//
// Unit tests for GitHub App authentication (src/core/github-app-auth.ts).
//
// Strategy: 
//   - Generate a real test RSA key pair via Node crypto for signing tests
//   - Mock globalThis.fetch for installation token exchange tests
//   - Test PEM validation, JWT generation, token caching, and error handling
//
// Sections:
//   1. PEM validation (validatePrivateKeyPem)
//   2. App ID validation
//   3. JWT generation (structure, claims, signing)
//   4. Installation token generation (fetch mocking, error mapping)
//   5. Token caching behavior
// ===========================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import { decodeJwt } from "jose";
import {
  validatePrivateKeyPem,
  generateInstallationToken,
  clearInstallationTokenCache,
} from "../../src/core/github-app-auth.js";
import {
  InvalidPATError,
  InsufficientScopesError,
  GitHubApiError,
} from "../../src/core/reverse-git-errors.js";

// ---------------------------------------------------------------------------
// Test keys
// ---------------------------------------------------------------------------

/** Generate a real RSA-2048 key pair for JWT signing tests. */
function generateTestKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

/** Generate PKCS#1 RSA private key (different format). */
function generatePKCS1Key() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return privateKey;
}

// ---------------------------------------------------------------------------
// Fetch mocking helpers
// ---------------------------------------------------------------------------

/** Build a fake Response-like object. */
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Record of one fetch call's arguments. */
interface CallRecord {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Multi-call fake fetch — returns responses in sequence and records calls. */
function multiFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchFn: typeof fetch;
  calls: () => CallRecord[];
} {
  let idx = 0;
  const calls: CallRecord[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    let parsedBody: unknown = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body as string);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, headers, body: parsedBody });

    if (idx >= responses.length) {
      throw new Error(
        `multiFetch exhausted: call ${idx + 1} made but only ${responses.length} responses registered`
      );
    }
    const resp = responses[idx++];
    return fakeResponse(resp.status, resp.body);
  }) as unknown as typeof fetch;

  return { fetchFn, calls: () => calls };
}

// ---------------------------------------------------------------------------
// 1. PEM validation
// ---------------------------------------------------------------------------

describe("validatePrivateKeyPem", () => {
  it("accepts PKCS#8 PEM (-----BEGIN PRIVATE KEY-----)", () => {
    const { privateKey } = generateTestKeyPair();
    const result = validatePrivateKeyPem(privateKey);
    expect(result.format).toBe("pkcs8");
  });

  it("accepts PKCS#1 PEM (-----BEGIN RSA PRIVATE KEY-----)", () => {
    const privateKey = generatePKCS1Key();
    const result = validatePrivateKeyPem(privateKey);
    expect(result.format).toBe("pkcs1");
  });

  it("rejects encrypted PEM (-----BEGIN ENCRYPTED PRIVATE KEY-----)", () => {
    const encrypted = `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIFHDBOBgkqhkiG9w0BBQ0wQTApBgkqhkiG9w0BBQwwHAQI...
-----END ENCRYPTED PRIVATE KEY-----`;
    expect(() => validatePrivateKeyPem(encrypted)).toThrow(
      /encrypted.*passphrase/i
    );
  });

  it("rejects public key PEM", () => {
    const { publicKey } = generateTestKeyPair();
    expect(() => validatePrivateKeyPem(publicKey)).toThrow(
      /public key.*private key/i
    );
  });

  it("rejects certificate PEM", () => {
    const cert = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKZV...
-----END CERTIFICATE-----`;
    expect(() => validatePrivateKeyPem(cert)).toThrow(/certificate/i);
  });

  it("rejects PEM with no recognized BEGIN marker", () => {
    const invalid = "not a valid PEM at all";
    expect(() => validatePrivateKeyPem(invalid)).toThrow(
      /format not detected/i
    );
  });
});

// ---------------------------------------------------------------------------
// 2. App ID validation (embedded in generateInstallationToken)
// ---------------------------------------------------------------------------

describe("generateInstallationToken - appId validation", () => {
  let originalFetch: typeof fetch;
  const { privateKey } = generateTestKeyPair();

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearInstallationTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects non-numeric appId", async () => {
    const mock = multiFetch([]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken("not-a-number", privateKey, "12345")
    ).rejects.toThrow(/not a numeric string/i);

    // Should not reach fetch
    expect(mock.calls().length).toBe(0);
  });

  it("accepts numeric appId", async () => {
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_abc123", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    const token = await generateInstallationToken("123456", privateKey, "789");
    expect(token).toBe("ghs_abc123");
    expect(mock.calls().length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. JWT generation (structure, claims, signing)
// ---------------------------------------------------------------------------

describe("generateInstallationToken - JWT structure", () => {
  let originalFetch: typeof fetch;
  const { privateKey } = generateTestKeyPair();
  const appId = "123456";
  const installationId = "999888";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearInstallationTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("generates a 3-part JWT (header.payload.signature)", async () => {
    let capturedJwt = "";
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_test", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    const spyFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      // Capture the Authorization header
      const headers = (init?.headers as Record<string, string>) ?? {};
      const auth = headers.Authorization || headers.authorization || "";
      capturedJwt = auth.replace(/^Bearer\s+/, "");
      return mock.fetchFn(input, init);
    });
    globalThis.fetch = spyFetch as unknown as typeof fetch;

    await generateInstallationToken(appId, privateKey, installationId);

    expect(capturedJwt).toBeTruthy();
    const parts = capturedJwt.split(".");
    expect(parts.length).toBe(3); // header.payload.signature
  });

  it("JWT has iss=appId", async () => {
    let capturedJwt = "";
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_test2", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    const spyFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      const auth = headers.Authorization || headers.authorization || "";
      capturedJwt = auth.replace(/^Bearer\s+/, "");
      return mock.fetchFn(input, init);
    });
    globalThis.fetch = spyFetch as unknown as typeof fetch;

    await generateInstallationToken(appId, privateKey, installationId);

    const decoded = decodeJwt(capturedJwt);
    expect(decoded.iss).toBe(appId);
  });

  it("JWT exp - iat <= 600 seconds", async () => {
    let capturedJwt = "";
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_test3", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    const spyFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      const auth = headers.Authorization || headers.authorization || "";
      capturedJwt = auth.replace(/^Bearer\s+/, "");
      return mock.fetchFn(input, init);
    });
    globalThis.fetch = spyFetch as unknown as typeof fetch;

    await generateInstallationToken(appId, privateKey, installationId);

    const decoded = decodeJwt(capturedJwt);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    const lifetime = (decoded.exp as number) - (decoded.iat as number);
    expect(lifetime).toBeLessThanOrEqual(600);
    expect(lifetime).toBeGreaterThan(500); // Should be ~540
  });

  it("JWT iat is backdated (iat < now)", async () => {
    let capturedJwt = "";
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_test4", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    const spyFetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      const auth = headers.Authorization || headers.authorization || "";
      capturedJwt = auth.replace(/^Bearer\s+/, "");
      return mock.fetchFn(input, init);
    });
    globalThis.fetch = spyFetch as unknown as typeof fetch;

    const beforeCall = Math.floor(Date.now() / 1000);
    await generateInstallationToken(appId, privateKey, installationId);

    const decoded = decodeJwt(capturedJwt);
    expect(decoded.iat).toBeDefined();
    expect((decoded.iat as number)).toBeLessThan(beforeCall);
  });
});

// ---------------------------------------------------------------------------
// 4. Installation token generation - fetch calls and error handling
// ---------------------------------------------------------------------------

describe("generateInstallationToken - fetch behavior", () => {
  let originalFetch: typeof fetch;
  const { privateKey } = generateTestKeyPair();
  const appId = "111222";
  const installationId = "333444";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearInstallationTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls POST /app/installations/{id}/access_tokens with Bearer JWT and correct headers", async () => {
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_success", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    await generateInstallationToken(appId, privateKey, installationId);

    const calls = mock.calls();
    expect(calls.length).toBe(1);

    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(
      `https://api.github.com/app/installations/${installationId}/access_tokens`
    );
    expect(call.headers.Authorization).toMatch(/^Bearer .+/);
    expect(call.headers.Accept).toBe("application/vnd.github+json");
    expect(call.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("returns the token from the response body on 200", async () => {
    const mock = multiFetch([
      { status: 200, body: { token: "ghs_returned_token", expires_at: "2026-12-31T23:59:59Z" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    const token = await generateInstallationToken(appId, privateKey, installationId);
    expect(token).toBe("ghs_returned_token");
  });

  it("throws InvalidPATError on 401", async () => {
    const mock = multiFetch([
      { status: 401, body: { message: "Bad credentials" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken(appId, privateKey, installationId)
    ).rejects.toThrow(InvalidPATError);
  });

  it("throws InsufficientScopesError on 403", async () => {
    const mock = multiFetch([
      { status: 403, body: { message: "Installation suspended" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken(appId, privateKey, installationId)
    ).rejects.toThrow(InsufficientScopesError);
  });

  it("throws GitHubApiError on 404", async () => {
    const mock = multiFetch([
      { status: 404, body: { message: "Installation not found" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken(appId, privateKey, installationId)
    ).rejects.toThrow(GitHubApiError);
  });

  it("throws GitHubApiError on other errors (e.g., 500)", async () => {
    const mock = multiFetch([
      { status: 500, body: { message: "Internal server error" } },
    ]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken(appId, privateKey, installationId)
    ).rejects.toThrow(GitHubApiError);
  });

  it("throws GitHubApiError if response body is missing 'token' field", async () => {
    const mock = multiFetch([
      { status: 200, body: { expires_at: "2026-12-31T23:59:59Z" } }, // missing token
    ]);
    globalThis.fetch = mock.fetchFn;

    await expect(
      generateInstallationToken(appId, privateKey, installationId)
    ).rejects.toThrow(GitHubApiError);
  });
});

// ---------------------------------------------------------------------------
// 5. Token caching behavior
// ---------------------------------------------------------------------------

describe("generateInstallationToken - caching", () => {
  let originalFetch: typeof fetch;
  const { privateKey } = generateTestKeyPair();
  const appId = "555666";

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearInstallationTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("second call with same installationId does NOT re-fetch within validity window", async () => {
    const mock = multiFetch([
      {
        status: 200,
        body: {
          token: "ghs_cached",
          expires_at: new Date(Date.now() + 3600_000).toISOString(), // expires in 1 hour
        },
      },
    ]);
    globalThis.fetch = mock.fetchFn;

    const installationId = "cache-test-1";

    // First call
    const token1 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token1).toBe("ghs_cached");
    expect(mock.calls().length).toBe(1);

    // Second call — should hit cache
    const token2 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token2).toBe("ghs_cached");
    expect(mock.calls().length).toBe(1); // Still 1 — no second fetch
  });

  it("different installationIds do NOT share cache", async () => {
    const mock = multiFetch([
      {
        status: 200,
        body: {
          token: "ghs_token_a",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
      {
        status: 200,
        body: {
          token: "ghs_token_b",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
    ]);
    globalThis.fetch = mock.fetchFn;

    const idA = "install-A";
    const idB = "install-B";

    const tokenA = await generateInstallationToken(appId, privateKey, idA);
    expect(tokenA).toBe("ghs_token_a");

    const tokenB = await generateInstallationToken(appId, privateKey, idB);
    expect(tokenB).toBe("ghs_token_b");

    expect(mock.calls().length).toBe(2); // Two separate fetches
  });

  it("expired cache triggers a re-fetch", async () => {
    const mock = multiFetch([
      {
        status: 200,
        body: {
          token: "ghs_first",
          expires_at: new Date(Date.now() + 30_000).toISOString(), // expires in 30s (within safety margin)
        },
      },
      {
        status: 200,
        body: {
          token: "ghs_refreshed",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
    ]);
    globalThis.fetch = mock.fetchFn;

    const installationId = "expiry-test";

    // First call
    const token1 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token1).toBe("ghs_first");
    expect(mock.calls().length).toBe(1);

    // Second call — token is within safety margin (60s), so should re-fetch
    const token2 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token2).toBe("ghs_refreshed");
    expect(mock.calls().length).toBe(2);
  });

  it("clearInstallationTokenCache() empties the cache", async () => {
    const mock = multiFetch([
      {
        status: 200,
        body: {
          token: "ghs_before_clear",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
      {
        status: 200,
        body: {
          token: "ghs_after_clear",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      },
    ]);
    globalThis.fetch = mock.fetchFn;

    const installationId = "clear-test";

    // First call
    const token1 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token1).toBe("ghs_before_clear");
    expect(mock.calls().length).toBe(1);

    // Clear cache
    clearInstallationTokenCache();

    // Second call after clear — should re-fetch
    const token2 = await generateInstallationToken(appId, privateKey, installationId);
    expect(token2).toBe("ghs_after_clear");
    expect(mock.calls().length).toBe(2);
  });
});
