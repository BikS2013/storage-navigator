// ===========================================================================
// tests/unit/devops-write-client.test.ts
//
// Unit tests for DevOpsWriteClient (Phase A reverse-git).
//
// Strategy: every ADO REST call goes through `globalThis.fetch`. We replace
// it per-test with a fake that records call arguments and returns canned JSON
// responses. No real network access is made.
//
// Sections:
//   1. parseDevOpsRepoUrl
//   2. ensureRepo / getOrCreateRepo — lookup, 404 no-create, auto-create
//   3. getBranchTip / getCurrentRefSha
//   4. createCommit / pushChanges — zero oldObjectId, single push payload,
//      chunked push at 500, divergence detection
//   5. listRepoFiles
//   6. bootstrapEmpty (no-op)
//   7. Basic auth header format
//   8. Constructor validation + requireRepoId guard
// ===========================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  DevOpsWriteClient,
  parseDevOpsRepoUrl,
} from "../../src/core/devops-write-client.js";
import {
  RemoteDivergedError,
  RepoNotFoundError,
  InvalidPATError,
  DevOpsApiError,
} from "../../src/core/reverse-git-errors.js";
import type { RepoWriteClientCommitInput } from "../../src/core/reverse-git-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface CallRecord {
  url: string;
  method: string;
  body: unknown;
  authHeader: string | undefined;
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
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method,
      body: parsedBody,
      authHeader: headers["Authorization"],
    });

    if (idx >= responses.length) {
      throw new Error(
        `multiFetch exhausted: call ${idx + 1} but only ${responses.length} responses registered`,
      );
    }
    const resp = responses[idx++];
    return fakeResponse(resp.status, resp.body);
  }) as unknown as typeof fetch;

  return { fetchFn, calls: () => calls };
}

function singleFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(fakeResponse(status, body));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PAT = "my-ado-pat";
const ORG = "my-org";
const PROJECT = "my-project";
const REPO = "my-repo";
const REPO_ID = "repo-uuid-1234";
const AUTHOR = { name: "Test Bot", email: "bot@test.com" };

/** Build a DevOpsWriteClient with repoId pre-seeded (bypass ensureRepo). */
function makeClient(): DevOpsWriteClient {
  const c = new DevOpsWriteClient(PAT, ORG, PROJECT, REPO);
  // We need to call ensureRepo to set repoId. We'll use multiFetch in each test
  // or seed it via a helper that runs ensureRepo.
  return c;
}

/** Run ensureRepo against a mock that returns the repoId, then return the client. */
async function clientWithRepo(overrides?: Partial<{ repoId: string }>): Promise<{
  client: DevOpsWriteClient;
  repoId: string;
}> {
  const id = overrides?.repoId ?? REPO_ID;
  vi.stubGlobal(
    "fetch",
    singleFetch(200, { id }),
  );
  const client = makeClient();
  await client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: false });
  return { client, repoId: id };
}

function makeCommitInput(
  overrides: Partial<RepoWriteClientCommitInput> = {},
): RepoWriteClientCommitInput {
  return {
    branch: "main",
    parentCommitSha: "parent-commit-sha",
    parentTreeSha: null,
    message: "test commit",
    author: AUTHOR,
    changes: [
      { kind: "add", path: "hello.txt", contentBytes: new TextEncoder().encode("hello") },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. parseDevOpsRepoUrl
// ---------------------------------------------------------------------------

describe("parseDevOpsRepoUrl", () => {
  it("parses dev.azure.com URL", () => {
    const r = parseDevOpsRepoUrl(
      "https://dev.azure.com/my-org/my-project/_git/my-repo",
    );
    expect(r).toEqual({ org: "my-org", project: "my-project", repo: "my-repo" });
  });

  it("parses legacy visualstudio.com URL", () => {
    const r = parseDevOpsRepoUrl(
      "https://my-org.visualstudio.com/my-project/_git/my-repo",
    );
    expect(r).toEqual({ org: "my-org", project: "my-project", repo: "my-repo" });
  });

  it("throws on invalid URL", () => {
    expect(() => parseDevOpsRepoUrl("https://example.com/no-ado")).toThrow(
      "Invalid Azure DevOps repo URL",
    );
  });

  it("URL-decodes percent-encoded segments", () => {
    const r = parseDevOpsRepoUrl(
      "https://dev.azure.com/my%20org/my%20project/_git/my%20repo",
    );
    expect(r.org).toBe("my org");
    expect(r.project).toBe("my project");
    expect(r.repo).toBe("my repo");
  });
});

// ---------------------------------------------------------------------------
// 2. ensureRepo / getOrCreateRepo
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient.ensureRepo", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("resolves and stores repoId on 200", async () => {
    vi.stubGlobal("fetch", singleFetch(200, { id: REPO_ID, name: REPO }));
    const client = makeClient();
    await client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: false });
    expect(client.getRepoId()).toBe(REPO_ID);
  });

  it("throws RepoNotFoundError on 404 when createIfMissing=false", async () => {
    vi.stubGlobal("fetch", singleFetch(404, { message: "Repo not found" }));
    const client = makeClient();
    await expect(
      client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: false }),
    ).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("auto-creates repo when 404 + createIfMissing=true", async () => {
    const { fetchFn, calls } = multiFetch([
      { status: 404, body: { message: "Not Found" } },         // GET repo → 404
      { status: 200, body: { id: "project-uuid" } },           // GET project UUID
      { status: 201, body: { id: "new-repo-uuid" } },          // POST create repo
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const client = makeClient();
    await client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: true });
    expect(client.getRepoId()).toBe("new-repo-uuid");

    const c = calls();
    // Third call must be POST to create repo
    expect(c[2].method).toBe("POST");
    expect(c[2].url).toContain("/_apis/git/repositories");
  });

  it("throws InvalidPATError on 401", async () => {
    vi.stubGlobal("fetch", singleFetch(401, { message: "Unauthorized" }));
    const client = makeClient();
    await expect(
      client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: false }),
    ).rejects.toBeInstanceOf(InvalidPATError);
  });

  it("getOrCreateRepo is an alias for ensureRepo", async () => {
    vi.stubGlobal("fetch", singleFetch(200, { id: REPO_ID }));
    const client = makeClient();
    await expect(
      client.getOrCreateRepo({ name: REPO, visibility: "public", createIfMissing: false }),
    ).resolves.toBeUndefined();
    expect(client.getRepoId()).toBe(REPO_ID);
  });
});

// ---------------------------------------------------------------------------
// 3. getBranchTip / getCurrentRefSha
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient.getBranchTip", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns commitSha from matching ref entry", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks(); // reset ensureRepo mock

    vi.stubGlobal(
      "fetch",
      singleFetch(200, {
        value: [
          { name: "refs/heads/main", objectId: "commit-sha-main" },
        ],
      }),
    );
    const tip = await client.getBranchTip("main");
    expect(tip).toEqual({ commitSha: "commit-sha-main", treeSha: null });
  });

  it("returns null when branch not in ref list", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal("fetch", singleFetch(200, { value: [] }));
    expect(await client.getBranchTip("no-such-branch")).toBeNull();
  });

  it("returns null on 404", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal("fetch", singleFetch(404, {}));
    expect(await client.getBranchTip("main")).toBeNull();
  });

  it("getCurrentRefSha returns commitSha when branch exists", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal(
      "fetch",
      singleFetch(200, {
        value: [{ name: "refs/heads/main", objectId: "sha-current" }],
      }),
    );
    expect(await client.getCurrentRefSha("main")).toBe("sha-current");
  });

  it("getCurrentRefSha returns null when branch absent", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal("fetch", singleFetch(200, { value: [] }));
    expect(await client.getCurrentRefSha("ghost")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. createCommit / pushChanges
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient.createCommit", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // ---- 4a. Single-push payload shape ---------------------------------------

  it("sends a single POST /git/pushes with refUpdates + commits + changes", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    const { fetchFn, calls } = multiFetch([
      {
        status: 201,
        body: {
          commits: [{ commitId: "new-commit-001", treeId: "tree-001" }],
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const result = await client.createCommit(makeCommitInput());
    expect(result.commitSha).toBe("new-commit-001");
    expect(result.treeSha).toBe("tree-001");
    expect(result.perFileErrors).toHaveLength(0);

    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0].method).toBe("POST");
    expect(c[0].url).toContain("/pushes");

    const body = c[0].body as {
      refUpdates: Array<{ name: string; oldObjectId: string }>;
      commits: Array<{ changes: unknown[] }>;
    };
    expect(body.refUpdates).toHaveLength(1);
    expect(body.refUpdates[0].name).toBe("refs/heads/main");
    expect(body.refUpdates[0].oldObjectId).toBe("parent-commit-sha");
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].changes).toHaveLength(1);
  });

  // ---- 4b. 40-zeros oldObjectId for initial commit -------------------------

  it("uses 40-zeros oldObjectId when parentCommitSha is null (initial commit)", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    const { fetchFn, calls } = multiFetch([
      {
        status: 201,
        body: { commits: [{ commitId: "root-commit", treeId: null }] },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    await client.createCommit(makeCommitInput({ parentCommitSha: null }));

    const body = calls()[0].body as {
      refUpdates: Array<{ oldObjectId: string }>;
    };
    expect(body.refUpdates[0].oldObjectId).toBe(
      "0000000000000000000000000000000000000000",
    );
  });

  // ---- 4c. Chunked push at 500 changes -------------------------------------

  it("splits into 2 pushes when 600 changes supplied (chunk=500)", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    const changes = Array.from({ length: 600 }, (_, i) => ({
      kind: "add" as const,
      path: `file-${i}.txt`,
      contentBytes: new TextEncoder().encode(`content-${i}`),
    }));

    const { fetchFn, calls } = multiFetch([
      {
        status: 201,
        body: { commits: [{ commitId: "commit-chunk-1", treeId: null }] },
      },
      {
        status: 201,
        body: { commits: [{ commitId: "commit-chunk-2", treeId: null }] },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const result = await client.createCommit(
      makeCommitInput({ changes, parentCommitSha: "parent-sha" }),
    );

    expect(result.commitSha).toBe("commit-chunk-2");

    const c = calls();
    expect(c).toHaveLength(2);

    // First push: 500 changes, oldObjectId = original parentCommitSha
    const body1 = c[0].body as {
      refUpdates: Array<{ oldObjectId: string }>;
      commits: Array<{ changes: unknown[] }>;
    };
    expect(body1.commits[0].changes).toHaveLength(500);
    expect(body1.refUpdates[0].oldObjectId).toBe("parent-sha");

    // Second push: 100 changes, oldObjectId = first push's newObjectId
    const body2 = c[1].body as {
      refUpdates: Array<{ oldObjectId: string }>;
      commits: Array<{ changes: unknown[] }>;
    };
    expect(body2.commits[0].changes).toHaveLength(100);
    expect(body2.refUpdates[0].oldObjectId).toBe("commit-chunk-1");
  }, 10_000);

  // ---- 4d. 400 + GitRefUpdateNeedsForcePermissionException → RemoteDivergedError

  it("throws RemoteDivergedError on 400 with GitRefUpdateNeedsForcePermissionException", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal(
      "fetch",
      singleFetch(400, {
        typeKey: "GitRefUpdateNeedsForcePermissionException",
        message: "oldObjectId did not match",
      }),
    );

    await expect(client.createCommit(makeCommitInput())).rejects.toBeInstanceOf(
      RemoteDivergedError,
    );
  });

  it("throws RemoteDivergedError on 400 with oldObjectId did not match message", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal(
      "fetch",
      singleFetch(400, {
        typeKey: "GenericError",
        message: "oldObjectId did not match the current value",
      }),
    );

    await expect(client.createCommit(makeCommitInput())).rejects.toBeInstanceOf(
      RemoteDivergedError,
    );
  });

  // ---- 4e. All changes use base64encoded contentType ----------------------

  it("encodes all non-delete content as base64encoded", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    const { fetchFn, calls } = multiFetch([
      {
        status: 201,
        body: { commits: [{ commitId: "new-commit", treeId: null }] },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    const content = "Hello, World!";
    const contentBytes = new TextEncoder().encode(content);
    await client.createCommit(
      makeCommitInput({
        changes: [
          { kind: "add", path: "greet.txt", contentBytes },
          { kind: "edit", path: "other.txt", contentBytes },
        ],
      }),
    );

    const body = calls()[0].body as {
      commits: Array<{
        changes: Array<{
          changeType: string;
          newContent: { content: string; contentType: string };
        }>;
      }>;
    };
    const changesArr = body.commits[0].changes;
    expect(changesArr).toHaveLength(2);

    for (const entry of changesArr) {
      expect(entry.newContent.contentType).toBe("base64encoded");
      // Verify the encoded content decodes correctly
      const decoded = Buffer.from(entry.newContent.content, "base64").toString("utf8");
      expect(decoded).toBe(content);
    }
  });

  // ---- 4f. delete change has no newContent ---------------------------------

  it("delete entry has changeType=delete and no newContent", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    const { fetchFn, calls } = multiFetch([
      {
        status: 201,
        body: { commits: [{ commitId: "delete-commit", treeId: null }] },
      },
    ]);
    vi.stubGlobal("fetch", fetchFn);

    await client.createCommit(
      makeCommitInput({
        changes: [{ kind: "delete", path: "gone.txt" }],
      }),
    );

    const body = calls()[0].body as {
      commits: Array<{
        changes: Array<{ changeType: string; newContent?: unknown }>;
      }>;
    };
    const entry = body.commits[0].changes[0];
    expect(entry.changeType).toBe("delete");
    expect(entry.newContent).toBeUndefined();
  });

  // ---- 4g. empty changes returns early ------------------------------------

  it("returns early with parentCommitSha when changes is empty", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal("fetch", vi.fn());
    const result = await client.createCommit(makeCommitInput({ changes: [] }));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.commitSha).toBe("parent-commit-sha");
    expect(result.perFileErrors).toHaveLength(0);
  });

  // ---- 4h. pushChanges alias -----------------------------------------------

  it("pushChanges delegates to createCommit and returns same result", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal(
      "fetch",
      singleFetch(201, { commits: [{ commitId: "push-commit", treeId: null }] }),
    );

    const result = await client.pushChanges(makeCommitInput());
    expect(result.commitSha).toBe("push-commit");
  });
});

// ---------------------------------------------------------------------------
// 5. listRepoFiles
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient.listRepoFiles", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns blob paths with leading slashes stripped", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal(
      "fetch",
      singleFetch(200, {
        value: [
          { path: "/README.md", gitObjectType: "blob" },
          { path: "/src", gitObjectType: "tree" },
          { path: "/src/index.ts", gitObjectType: "blob" },
        ],
      }),
    );

    const files = await client.listRepoFiles("main");
    expect(files).toEqual(["README.md", "src/index.ts"]);
  });

  it("returns empty array on 404 (empty or absent branch)", async () => {
    const { client } = await clientWithRepo();
    vi.restoreAllMocks();

    vi.stubGlobal("fetch", singleFetch(404, {}));
    expect(await client.listRepoFiles("absent")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. bootstrapEmpty is a no-op for ADO
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient.bootstrapEmpty", () => {
  it("returns without making any fetch call", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = makeClient();
    // Does not require ensureRepo — bootstrapEmpty is a pure no-op
    await expect(client.bootstrapEmpty("main")).resolves.toBeUndefined();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Basic auth header format
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient Basic auth header", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("sends Basic base64(':' + pat) on every request", async () => {
    let capturedAuth: string | undefined;
    const fetchFn = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.["Authorization"];
      return fakeResponse(200, { id: REPO_ID });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchFn);

    const client = makeClient();
    await client.ensureRepo({ name: REPO, visibility: "private", createIfMissing: false });

    const expected = `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
    expect(capturedAuth).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 8. Constructor validation + requireRepoId guard
// ---------------------------------------------------------------------------

describe("DevOpsWriteClient constructor", () => {
  it("throws when PAT is empty", () => {
    expect(() => new DevOpsWriteClient("", ORG, PROJECT, REPO)).toThrow("missing PAT");
  });

  it("throws when org is empty", () => {
    expect(() => new DevOpsWriteClient(PAT, "", PROJECT, REPO)).toThrow("missing org");
  });

  it("throws when project is empty", () => {
    expect(() => new DevOpsWriteClient(PAT, ORG, "", REPO)).toThrow("missing project");
  });

  it("throws when repo name is empty", () => {
    expect(() => new DevOpsWriteClient(PAT, ORG, PROJECT, "")).toThrow("missing repo name");
  });

  it("fromRepoUrl builds client from dev.azure.com URL", () => {
    const c = DevOpsWriteClient.fromRepoUrl(
      PAT,
      "https://dev.azure.com/my-org/my-project/_git/my-repo",
    );
    expect(c).toBeInstanceOf(DevOpsWriteClient);
  });
});

describe("DevOpsWriteClient requireRepoId guard", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("getBranchTip throws DevOpsApiError when ensureRepo has not been called", async () => {
    vi.stubGlobal("fetch", vi.fn()); // should not be called
    const client = makeClient();
    await expect(client.getBranchTip("main")).rejects.toBeInstanceOf(DevOpsApiError);
  });

  it("listRepoFiles throws DevOpsApiError when repoId not resolved", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = makeClient();
    await expect(client.listRepoFiles("main")).rejects.toBeInstanceOf(DevOpsApiError);
  });
});
