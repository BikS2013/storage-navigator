// ===========================================================================
// tests/unit/github-write-client.test.ts
//
// Unit tests for GitHubWriteClient (Phase A reverse-git).
//
// Strategy: every GitHub REST call goes through `globalThis.fetch`. We
// replace it per-test with a fake that records call arguments and returns
// canned JSON responses. No real network access is made.
//
// Sections:
//   1. parseGitHubRepoUrl
//   2. ensureRepo / getOrCreateRepo
//   3. getBranchTip / getCurrentRefSha
//   4. createCommit / pushChanges — blob upload base64, tree chunking,
//      divergence detection, ref creation vs update
//   5. listRepoFiles
//   6. bootstrapEmpty
// ===========================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  GitHubWriteClient,
  parseGitHubRepoUrl,
} from "../../src/core/github-write-client.js";
import {
  RemoteDivergedError,
  RepoNotFoundError,
  InvalidPATError,
  GitHubBlobTooLargeError,
  GitHubEmptyRepoError,
  InsufficientScopesError,
} from "../../src/core/reverse-git-errors.js";
import type { RepoWriteClientCommitInput } from "../../src/core/reverse-git-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response-like object. */
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Create a single-call fake fetch that always returns one canned response. */
function singleFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(fakeResponse(status, body));
}

/** Record of one fetch call's arguments. */
interface CallRecord {
  url: string;
  method: string;
  body: unknown;
}

/** Multi-call fake fetch — returns responses in sequence. */
function multiFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchFn: typeof fetch;
  calls: () => CallRecord[];
} {
  let idx = 0;
  const calls: CallRecord[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body as string);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });

    if (idx >= responses.length) {
      throw new Error(
        `multiFetch exhausted: call ${idx + 1} made but only ${responses.length} responses registered`,
      );
    }
    const resp = responses[idx++];
    return fakeResponse(resp.status, resp.body);
  }) as unknown as typeof fetch;

  return { fetchFn, calls: () => calls };
}

// ---------------------------------------------------------------------------
// Shared commit input factory
// ---------------------------------------------------------------------------

const AUTHOR = { name: "Test Bot", email: "bot@example.com" };

function makeCommitInput(
  overrides: Partial<RepoWriteClientCommitInput> = {},
): RepoWriteClientCommitInput {
  return {
    branch: "main",
    parentCommitSha: "abc000",
    parentTreeSha: "tree000",
    message: "test commit",
    author: AUTHOR,
    changes: [
      { kind: "add", path: "hello.txt", contentBytes: new TextEncoder().encode("hello") },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. parseGitHubRepoUrl
// ---------------------------------------------------------------------------

describe("parseGitHubRepoUrl", () => {
  it("parses https URL with .git suffix", () => {
    const r = parseGitHubRepoUrl("https://github.com/acme/my-repo.git");
    expect(r).toEqual({ owner: "acme", repo: "my-repo" });
  });

  it("parses https URL without .git suffix", () => {
    const r = parseGitHubRepoUrl("https://github.com/acme/my-repo");
    expect(r).toEqual({ owner: "acme", repo: "my-repo" });
  });

  it("parses SSH URL", () => {
    const r = parseGitHubRepoUrl("git@github.com:acme/my-repo.git");
    expect(r).toEqual({ owner: "acme", repo: "my-repo" });
  });

  it("parses bare owner/repo string", () => {
    const r = parseGitHubRepoUrl("acme/my-repo");
    expect(r).toEqual({ owner: "acme", repo: "my-repo" });
  });

  it("throws on invalid string", () => {
    expect(() => parseGitHubRepoUrl("not-a-repo")).toThrow(
      "Invalid GitHub repo URL",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. ensureRepo / getOrCreateRepo
// ---------------------------------------------------------------------------

describe("GitHubWriteClient.ensureRepo", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("resolves when repo already exists (HTTP 200)", async () => {
    vi.stubGlobal("fetch", singleFetch(200, { id: 1, name: "my-repo" }));
    const client = new GitHubWriteClient("pat-123", "acme", "my-repo");
    await expect(
      client.ensureRepo({ name: "my-repo", visibility: "private", createIfMissing: false }),
    ).resolves.toBeUndefined();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("throws RepoNotFoundError on 404 when createIfMissing=false", async () => {
    vi.stubGlobal("fetch", singleFetch(404, { message: "Not Found" }));
    const client = new GitHubWriteClient("pat-123", "acme", "my-repo");
    await expect(
      client.ensureRepo({ name: "my-repo", visibility: "private", createIfMissing: false }),
    ).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("auto-creates via POST /user/repos with auto_init:true when 404 + createIfMissing=true", async () => {
    // Responses: GET /repos (404), GET /user (200 - same user), POST /user/repos (201)
    const { fetchFn, calls } = multiFetch([
      { status: 404, body: { message: "Not Found" } },
      { status: 200, body: { login: "acme" } },      // /user → owner matches
      { status: 201, body: { id: 99, name: "new-repo" } },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat-123", "acme", "new-repo");
    await client.ensureRepo({ name: "new-repo", visibility: "private", createIfMissing: true });

    const c = calls();
    expect(c).toHaveLength(3);
    // Third call must be POST to /user/repos with auto_init:true
    expect(c[2].method).toBe("POST");
    expect(c[2].url).toBe("https://api.github.com/user/repos");
    expect((c[2].body as { auto_init: boolean }).auto_init).toBe(true);
  });

  it("routes to /orgs/{org}/repos when authenticated user != owner", async () => {
    const { fetchFn, calls } = multiFetch([
      { status: 404, body: { message: "Not Found" } },
      { status: 200, body: { login: "other-user" } }, // /user → different login
      { status: 201, body: { id: 77, name: "org-repo" } },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat-123", "my-org", "org-repo");
    await client.ensureRepo({ name: "org-repo", visibility: "private", createIfMissing: true });

    const c = calls();
    expect(c[2].url).toBe("https://api.github.com/orgs/my-org/repos");
  });

  it("throws InvalidPATError on 401", async () => {
    vi.stubGlobal("fetch", singleFetch(401, { message: "Bad credentials" }));
    const client = new GitHubWriteClient("bad-pat", "acme", "r");
    await expect(
      client.ensureRepo({ name: "r", visibility: "private", createIfMissing: false }),
    ).rejects.toBeInstanceOf(InvalidPATError);
  });

  it("getOrCreateRepo is an alias for ensureRepo", async () => {
    vi.stubGlobal("fetch", singleFetch(200, { id: 1 }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    await expect(
      client.getOrCreateRepo({ name: "repo", visibility: "public", createIfMissing: false }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. getBranchTip / getCurrentRefSha
// ---------------------------------------------------------------------------

describe("GitHubWriteClient.getBranchTip", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns commitSha and treeSha on success", async () => {
    const { fetchFn } = multiFetch([
      {
        status: 200,
        body: { ref: "refs/heads/main", object: { sha: "commit-sha-001" } },
      },
      {
        status: 200,
        body: { sha: "commit-sha-001", tree: { sha: "tree-sha-001" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    const tip = await client.getBranchTip("main");
    expect(tip).toEqual({ commitSha: "commit-sha-001", treeSha: "tree-sha-001" });
  });

  it("returns null when branch not found (404)", async () => {
    vi.stubGlobal("fetch", singleFetch(404, { message: "Not Found" }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.getBranchTip("missing-branch")).toBeNull();
  });

  it("returns null when repo is empty (409)", async () => {
    vi.stubGlobal("fetch", singleFetch(409, { message: "Git Repository is empty" }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.getBranchTip("main")).toBeNull();
  });

  it("getCurrentRefSha returns commitSha when branch exists", async () => {
    const { fetchFn } = multiFetch([
      { status: 200, body: { object: { sha: "commit-aaa" } } },
      { status: 200, body: { sha: "commit-aaa", tree: { sha: "tree-aaa" } } },
    ]);
    vi.stubGlobal("fetch", fetchFn);
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.getCurrentRefSha("main")).toBe("commit-aaa");
  });

  it("getCurrentRefSha returns null when branch absent", async () => {
    vi.stubGlobal("fetch", singleFetch(404, { message: "Not Found" }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.getCurrentRefSha("no-branch")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. createCommit / pushChanges
// ---------------------------------------------------------------------------

describe("GitHubWriteClient.createCommit", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // ---- 4a. blob upload always uses base64 -----------------------------------

  it("uploads blobs as base64 (encoding field)", async () => {
    // Sequence: POST blob(201), POST tree(201), POST commit(201),
    //           GET ref for branch tip check → 200, PATCH ref(200)
    const { fetchFn, calls } = multiFetch([
      { status: 201, body: { sha: "blob-sha-001" } },           // POST /git/blobs
      { status: 201, body: { sha: "tree-sha-001" } },           // POST /git/trees
      { status: 201, body: { sha: "commit-sha-001" } },         // POST /git/commits
      { status: 200, body: { object: { sha: "abc000" } } },     // GET /git/ref (getBranchTip refUrl)
      { status: 200, body: { sha: "abc000", tree: { sha: "tree000" } } }, // GET /git/commits
      { status: 200, body: { ref: "refs/heads/main" } },        // PATCH /git/refs
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    await client.createCommit(makeCommitInput());

    const blobCall = calls().find((c) => c.url.endsWith("/git/blobs") && c.method === "POST");
    expect(blobCall).toBeDefined();
    const blobBody = blobCall!.body as { content: string; encoding: string };
    expect(blobBody.encoding).toBe("base64");
    // Verify the content field is non-empty base64 (not raw text)
    expect(typeof blobBody.content).toBe("string");
    const decoded = Buffer.from(blobBody.content, "base64").toString("utf8");
    expect(decoded).toBe("hello");
  });

  // ---- 4b. tree chunking at 700 entries ------------------------------------

  it("splits into 2 tree POST calls when 750 entries supplied", async () => {
    // 750 entries → chunk 1 (700) + chunk 2 (50)
    const entries = Array.from({ length: 750 }, (_, i) => ({
      kind: "add" as const,
      path: `file-${i}.txt`,
      contentBytes: new TextEncoder().encode(`content-${i}`),
    }));

    // 750 blob uploads → 750 × status 201
    const blobResponses = Array.from({ length: 750 }, () => ({
      status: 201,
      body: { sha: "blob-sha-stub" },
    }));

    const treeResponse1 = { status: 201, body: { sha: "tree-chunk-1" } };
    const treeResponse2 = { status: 201, body: { sha: "tree-chunk-2" } };
    const commitResponse = { status: 201, body: { sha: "commit-001" } };
    // getBranchTip internal calls after commit creation:
    const refGetResponse = { status: 200, body: { object: { sha: "abc000" } } };
    const commitGetResponse = { status: 200, body: { sha: "abc000", tree: { sha: "tree000" } } };
    const patchRefResponse = { status: 200, body: { ref: "refs/heads/main" } };

    const { fetchFn, calls } = multiFetch([
      ...blobResponses,
      treeResponse1,
      treeResponse2,
      commitResponse,
      refGetResponse,
      commitGetResponse,
      patchRefResponse,
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    const result = await client.createCommit({
      branch: "main",
      parentCommitSha: "abc000",
      parentTreeSha: "tree000",
      message: "big commit",
      author: AUTHOR,
      changes: entries,
    });

    expect(result.commitSha).toBe("commit-001");

    const treePosts = calls().filter(
      (c) => c.url.endsWith("/git/trees") && c.method === "POST",
    );
    expect(treePosts).toHaveLength(2);

    // First chunk should have 700 entries, second 50
    const chunk1Body = treePosts[0].body as { tree: unknown[] };
    const chunk2Body = treePosts[1].body as { tree: unknown[] };
    expect(chunk1Body.tree).toHaveLength(700);
    expect(chunk2Body.tree).toHaveLength(50);

    // Second chunk should chain the first chunk's sha as base_tree
    const chunk2Extended = treePosts[1].body as {
      tree: unknown[];
      base_tree: string;
    };
    expect(chunk2Extended.base_tree).toBe("tree-chunk-1");
  }, 15_000);

  // ---- 4c. PATCH /git/refs 422 → RemoteDivergedError -----------------------

  it("throws RemoteDivergedError when PATCH /git/refs returns 422 not-fast-forward", async () => {
    const { fetchFn } = multiFetch([
      { status: 201, body: { sha: "blob-sha" } },             // blob upload
      { status: 201, body: { sha: "tree-sha" } },             // tree
      { status: 201, body: { sha: "commit-sha" } },           // commit
      { status: 200, body: { object: { sha: "abc000" } } },   // getBranchTip refUrl
      { status: 200, body: { sha: "abc000", tree: { sha: "tree000" } } }, // getBranchTip commitUrl
      {
        status: 422,
        body: { message: "Update is not a fast forward" },    // PATCH divergence
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    await expect(
      client.createCommit(makeCommitInput()),
    ).rejects.toBeInstanceOf(RemoteDivergedError);
  });

  // ---- 4d. new ref created via POST when branch is absent ------------------

  it("POSTs a new ref when getBranchTip returns null (branch absent after commit)", async () => {
    const { fetchFn, calls } = multiFetch([
      { status: 201, body: { sha: "blob-sha" } },             // blob upload
      { status: 201, body: { sha: "tree-sha" } },             // tree
      { status: 201, body: { sha: "commit-sha" } },           // commit
      { status: 404, body: { message: "Not Found" } },        // getBranchTip → null
      { status: 201, body: { ref: "refs/heads/feature" } },   // POST /git/refs
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    await client.createCommit(
      makeCommitInput({
        branch: "feature",
        parentCommitSha: null,
        parentTreeSha: null,
      }),
    );

    const refPost = calls().find(
      (c) => c.url.endsWith("/git/refs") && c.method === "POST",
    );
    expect(refPost).toBeDefined();
    const refBody = refPost!.body as { ref: string; sha: string };
    expect(refBody.ref).toBe("refs/heads/feature");
    expect(refBody.sha).toBe("commit-sha");
  });

  // ---- 4e. per-file GitHubBlobTooLargeError is non-fatal -------------------

  it("accumulates per-file 422 too-large errors without throwing", async () => {
    const { fetchFn } = multiFetch([
      { status: 422, body: { message: "file too large", errors: [{ code: "too_large" }] } }, // blob
      { status: 201, body: { sha: "tree-sha" } },             // tree (only 0 entries → short-circuit)
    ]);
    vi.stubGlobal("fetch", fetchFn);

    // Single change that fails as too-large → nothing left to commit → early return
    const client = new GitHubWriteClient("pat", "owner", "repo");
    const result = await client.createCommit(makeCommitInput());
    expect(result.perFileErrors).toHaveLength(1);
    expect(result.perFileErrors[0].path).toBe("hello.txt");
  });

  // ---- 4f. pushChanges is an alias for createCommit ------------------------

  it("pushChanges delegates to createCommit and returns same result", async () => {
    const { fetchFn } = multiFetch([
      { status: 201, body: { sha: "blob-sha" } },
      { status: 201, body: { sha: "tree-sha" } },
      { status: 201, body: { sha: "commit-sha-push" } },
      { status: 200, body: { object: { sha: "abc000" } } },
      { status: 200, body: { sha: "abc000", tree: { sha: "tree000" } } },
      { status: 200, body: { ref: "refs/heads/main" } },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    const result = await client.pushChanges(makeCommitInput());
    expect(result.commitSha).toBe("commit-sha-push");
  });

  // ---- 4g. empty changes array returns early with parentCommitSha ----------

  it("returns early with parentCommitSha when changes is empty", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = new GitHubWriteClient("pat", "owner", "repo");
    const result = await client.createCommit(
      makeCommitInput({ changes: [] }),
    );
    // No fetch calls made
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.commitSha).toBe("abc000");
    expect(result.perFileErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. listRepoFiles
// ---------------------------------------------------------------------------

describe("GitHubWriteClient.listRepoFiles", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns only blob-type paths", async () => {
    vi.stubGlobal(
      "fetch",
      singleFetch(200, {
        tree: [
          { path: "README.md", type: "blob" },
          { path: "src", type: "tree" },
          { path: "src/index.ts", type: "blob" },
        ],
        truncated: false,
      }),
    );
    const client = new GitHubWriteClient("pat", "owner", "repo");
    const files = await client.listRepoFiles("main");
    expect(files).toEqual(["README.md", "src/index.ts"]);
  });

  it("returns empty array when branch is absent (404)", async () => {
    vi.stubGlobal("fetch", singleFetch(404, { message: "Not Found" }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.listRepoFiles("no-branch")).toEqual([]);
  });

  it("returns empty array when repo is empty (409)", async () => {
    vi.stubGlobal("fetch", singleFetch(409, { message: "Git Repository is empty." }));
    const client = new GitHubWriteClient("pat", "owner", "repo");
    expect(await client.listRepoFiles("main")).toEqual([]);
  });

  it("throws GitHubApiError when tree is truncated", async () => {
    vi.stubGlobal(
      "fetch",
      singleFetch(200, {
        tree: [{ path: "a.txt", type: "blob" }],
        truncated: true,
      }),
    );
    const client = new GitHubWriteClient("pat", "owner", "repo");
    await expect(client.listRepoFiles("main")).rejects.toThrow(/truncated/);
  });
});

// ---------------------------------------------------------------------------
// 6. bootstrapEmpty
// ---------------------------------------------------------------------------

describe("GitHubWriteClient.bootstrapEmpty", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("is a no-op when branch already exists (getBranchTip returns non-null)", async () => {
    // getBranchTip fetches ref + commit
    const { fetchFn, calls } = multiFetch([
      { status: 200, body: { object: { sha: "commit-aaa" } } },
      { status: 200, body: { sha: "commit-aaa", tree: { sha: "tree-aaa" } } },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    await client.bootstrapEmpty("main");

    // Only 2 calls — getBranchTip resolution; no PUT /contents/.gitkeep
    expect(calls()).toHaveLength(2);
    expect(calls().every((c) => !c.url.endsWith(".gitkeep"))).toBe(true);
  });

  it("PUTs .gitkeep via Contents API when branch is absent (repo empty)", async () => {
    const { fetchFn, calls } = multiFetch([
      { status: 404, body: { message: "Not Found" } },        // getBranchTip → null
      { status: 201, body: { content: { path: ".gitkeep" } } }, // PUT .gitkeep
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("pat", "owner", "repo");
    await client.bootstrapEmpty("main");

    const putCall = calls().find((c) => c.url.endsWith(".gitkeep") && c.method === "PUT");
    expect(putCall).toBeDefined();
    const putBody = putCall!.body as { message: string; content: string; branch: string };
    expect(putBody.branch).toBe("main");
    expect(putBody.content).toBe(""); // empty base64 for empty file
  });
});

// ---------------------------------------------------------------------------
// 7. Constructor validation
// ---------------------------------------------------------------------------

describe("GitHubWriteClient constructor", () => {
  it("throws when PAT is empty string", () => {
    expect(() => new GitHubWriteClient("", "owner", "repo")).toThrow(
      "missing PAT",
    );
  });

  it("throws when owner is empty string", () => {
    expect(() => new GitHubWriteClient("pat", "", "repo")).toThrow(
      "missing owner",
    );
  });

  it("throws when repo is empty string", () => {
    expect(() => new GitHubWriteClient("pat", "owner", "")).toThrow(
      "missing repo",
    );
  });

  it("fromRepoUrl builds client from https URL", () => {
    const c = GitHubWriteClient.fromRepoUrl(
      "my-pat",
      "https://github.com/acme/my-repo",
    );
    expect(c).toBeInstanceOf(GitHubWriteClient);
  });
});

// ---------------------------------------------------------------------------
// 8. Authorization header shape
// ---------------------------------------------------------------------------

describe("GitHubWriteClient auth header", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("sends Bearer token in Authorization header on every request", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchFn = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return fakeResponse(200, { id: 1 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchFn);

    const client = new GitHubWriteClient("my-secret-pat", "owner", "repo");
    await client.ensureRepo({ name: "repo", visibility: "private", createIfMissing: false });

    expect(capturedHeaders?.["Authorization"]).toBe("Bearer my-secret-pat");
    expect(capturedHeaders?.["Accept"]).toBe("application/vnd.github+json");
  });
});
