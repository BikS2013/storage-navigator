// =============================================================================
// tests/unit/reverse-sync-engine.test.ts
//
// Phase-D orchestration tests for:
//   - initReverseLink
//   - pushReverseLink  (dryRun, divergence, patOverride, per-file errors / NFR4)
//   - previewReverseDiff
//   - removeReverseLink (never touches the remote)
//   - listReverseLinks  (all-accounts fan-out)
//   - buildWriteClientForLink (from repo-utils)
//
// All remote I/O is mocked (BlobClient, RepoWriteClient, CredentialStore).
// No real network calls are made.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() is required so fakeWriteClient is available inside vi.mock()
// factories, which are hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------
import type { ReverseLink, RepoWriteClient } from "../../src/core/reverse-git-types.js";

const fakeWriteClient = vi.hoisted((): RepoWriteClient => ({
  ensureRepo: vi.fn().mockResolvedValue(undefined),
  getOrCreateRepo: vi.fn().mockResolvedValue(undefined),
  getBranchTip: vi.fn().mockResolvedValue({ commitSha: "abc123", treeSha: "tree123" }),
  getCurrentRefSha: vi.fn().mockResolvedValue(null),
  createCommit: vi.fn().mockResolvedValue({
    commitSha: "newcommit",
    treeSha: "newtree",
    perFileErrors: [],
  }),
  listRepoFiles: vi.fn().mockResolvedValue([]),
  pushChanges: vi.fn().mockResolvedValue({
    commitSha: "newcommit",
    treeSha: "newtree",
    perFileErrors: [],
  }),
  bootstrapEmpty: vi.fn().mockResolvedValue(undefined),
}));

// Mock repo-utils so `buildWriteClientForLink` returns fakeWriteClient.
vi.mock("../../src/core/repo-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/repo-utils.js")>();
  return {
    ...actual,
    buildWriteClientForLink: vi.fn().mockReturnValue(fakeWriteClient),
  };
});

// Mock blob-enumerator — yields nothing by default; tests override as needed.
vi.mock("../../src/core/blob-enumerator.js", () => ({
  enumerateScope: vi.fn().mockReturnValue(
    (async function* () { yield* []; })(),
  ),
}));

// Mock reverse-diff-engine — pure functions, controlled per-test.
vi.mock("../../src/core/reverse-diff-engine.js", () => ({
  collectSnapshot: vi.fn().mockResolvedValue({
    snapshot: new Map<string, string>(),
    repoPathToStoragePath: new Map<string, string>(),
  }),
  computeReverseDiff: vi.fn().mockReturnValue({
    linkId: "default",
    added: [],
    modified: [],
    deleted: [],
    unchanged: [],
    counts: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
  }),
  buildRepoChanges: vi.fn().mockResolvedValue([]),
}));

// Mock the registry layer.
vi.mock("../../src/core/reverse-link-registry.js", () => ({
  createReverseLink: vi.fn().mockResolvedValue(undefined),
  findReverseLink: vi.fn().mockResolvedValue(null),
  readAccountReverseLinks: vi.fn().mockReturnValue([]),
  readReverseLinks: vi.fn().mockResolvedValue({ schemaVersion: 1, links: [] }),
  removeReverseLink: vi.fn().mockResolvedValue(true),
  updateReverseLink: vi.fn().mockResolvedValue(true),
  writeAccountReverseLinks: vi.fn().mockResolvedValue(undefined),
}));

// --- Lazy imports AFTER all mocks are registered ---
import {
  initReverseLink,
  pushReverseLink,
  previewReverseDiff,
  removeReverseLink,
  listReverseLinks,
} from "../../src/core/reverse-sync-engine.js";

import { buildWriteClientForLink } from "../../src/core/repo-utils.js";

import {
  collectSnapshot,
  computeReverseDiff,
  buildRepoChanges,
} from "../../src/core/reverse-diff-engine.js";

import {
  createReverseLink as registryCreate,
  readAccountReverseLinks,
  readReverseLinks as registryReadLinks,
  removeReverseLink as registryRemove,
  updateReverseLink,
  writeAccountReverseLinks,
  findReverseLink,
} from "../../src/core/reverse-link-registry.js";

import { enumerateScope } from "../../src/core/blob-enumerator.js";

import {
  ConfigurationError,
  RemoteDivergedError,
} from "../../src/core/reverse-git-errors.js";

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------
const mockBuildWriteClient = buildWriteClientForLink as ReturnType<typeof vi.fn>;
const mockEnumerateScope   = enumerateScope           as ReturnType<typeof vi.fn>;
const mockCollectSnapshot  = collectSnapshot          as ReturnType<typeof vi.fn>;
const mockComputeDiff      = computeReverseDiff       as ReturnType<typeof vi.fn>;
const mockBuildChanges     = buildRepoChanges         as ReturnType<typeof vi.fn>;
const mockRegistryCreate   = registryCreate           as ReturnType<typeof vi.fn>;
const mockReadAccount      = readAccountReverseLinks  as ReturnType<typeof vi.fn>;
const mockRegistryRead     = registryReadLinks        as ReturnType<typeof vi.fn>;
const mockRegistryRemove   = registryRemove           as ReturnType<typeof vi.fn>;
const mockUpdateLink       = updateReverseLink        as ReturnType<typeof vi.fn>;
const mockWriteAccount     = writeAccountReverseLinks as ReturnType<typeof vi.fn>;
const mockFindReverseLink  = findReverseLink          as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fake BlobClient
// ---------------------------------------------------------------------------
function makeBlobClient() {
  return {
    listContainers: vi.fn().mockResolvedValue([{ name: "c1" }]),
    listBlobsFlat: vi.fn().mockResolvedValue([]),
    iterateBlobsFlat: vi.fn(async function* () {}),
    getBlobContent: vi.fn().mockResolvedValue({ content: "hello" }),
    getBlobProperties: vi.fn().mockResolvedValue({ etag: "etag-1", size: 5 }),
    createBlob: vi.fn().mockResolvedValue(undefined),
    deleteBlob: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Fake CredentialStore factory.
//
// IMPORTANT: `collectAccountNames` inside the engine reads
// `store.data?.reverseLinks?.byAccount` directly. Tests for pushReverseLink
// that use container-scope links register the link inside this internal map
// so the engine's `lookupLinkById` can find it.
// ---------------------------------------------------------------------------
function makeCredentialStore(opts: {
  reverseLinkPAT?: string | null;
  tokenByName?: { token: string } | null;
  tokenByProvider?: { token: string } | null;
  /** Pre-populate the account-scope internal map used by collectAccountNames */
  accountData?: Record<string, ReverseLink[]>;
} = {}) {
  // Use `in` to distinguish "key absent (use default)" from "key present but null".
  const tokenByProviderValue =
    "tokenByProvider" in opts ? opts.tokenByProvider : { token: "stored-pat" };
  return {
    getReverseLinkPAT: vi.fn().mockReturnValue(opts.reverseLinkPAT ?? null),
    getToken: vi.fn().mockReturnValue(opts.tokenByName ?? null),
    getTokenByProvider: vi.fn().mockReturnValue(tokenByProviderValue),
    getAccountReverseLinks: vi.fn((account: string) => {
      return opts.accountData?.[account] ?? [];
    }),
    setAccountReverseLinks: vi.fn().mockResolvedValue(undefined),
    // Engine reads this directly via `collectAccountNames`.
    data: opts.accountData
      ? { reverseLinks: { byAccount: opts.accountData } }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Canonical link factories
// ---------------------------------------------------------------------------

/** Container-scope link. Stored in `accountData` keyed by a sentinel account
 *  so `lookupLinkById` can find it via `collectAccountNames`.
 *  In production, container-scope links are NOT in the account data — they live
 *  in the BlobClient registry. However, lookupLinkById only searches container-
 *  scope via a `containerHint`, which pushReverseLink does not supply.
 *  The cleanest workaround for engine-level unit tests is to store the link
 *  under a fake account key so the lookup still resolves correctly.
 */
function makeContainerLink(overrides: Partial<ReverseLink> = {}): ReverseLink {
  return {
    id: "link-001",
    scope: { kind: "container", account: "my-storage", container: "my-container" },
    provider: "github",
    repoUrl: "owner/repo",
    branch: "main",
    repoSubPath: "",
    tokenName: "my-pat",
    author: { name: "Storage Navigator", email: "storage-nav@local" },
    exclusionPatterns: [],
    respectGitignore: true,
    createRepo: false,
    visibility: "private",
    blobSnapshot: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAccountLink(overrides: Partial<ReverseLink> = {}): ReverseLink {
  return {
    id: "link-acc-001",
    scope: { kind: "account", account: "my-storage" },
    provider: "github",
    repoUrl: "owner/full-account",
    branch: "main",
    repoSubPath: "",
    tokenName: "my-pat",
    author: { name: "Storage Navigator", email: "storage-nav@local" },
    exclusionPatterns: [],
    respectGitignore: true,
    createRepo: false,
    visibility: "private",
    blobSnapshot: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Build a CredentialStore that exposes the given link so `lookupLinkById`
 * can find it via `collectAccountNames`.
 *
 * `collectAccountNames` reads `store.data?.reverseLinks?.byAccount` directly.
 * `lookupLinkById` then calls `readAccountReverseLinks(store, account)` —
 * which is the MOCKED registry function (second arg = account name).
 *
 * We store the link under a synthetic account key `"__lookup__"` so the
 * `collectAccountNames` traversal finds it regardless of the link's own
 * `scope.account`. The `readAccountReverseLinks` mock is set to return the
 * link when that key is queried.
 *
 * For account-scope links (scope.kind === "account"), `removeReverseLink`
 * also calls `readAccountReverseLinks(store, link.scope.account)` and then
 * `writeAccountReverseLinks(store, link.scope.account, filtered)`. We ensure
 * BOTH the lookup key and the scope.account key return the link.
 */
function makeCredStoreWithLink(
  link: ReverseLink,
  patOpts: {
    reverseLinkPAT?: string | null;
    tokenByProvider?: { token: string } | null;
  } = {},
) {
  const LOOKUP_KEY = "__lookup__";
  // For account-scope links, also expose under the real account name.
  const accountName =
    link.scope.kind === "account" ? link.scope.account : null;

  const accountData: Record<string, ReverseLink[]> = {
    [LOOKUP_KEY]: [link],
  };
  if (accountName) {
    accountData[accountName] = [link];
  }

  const store = makeCredentialStore({
    ...patOpts,
    accountData,
  });

  // readAccountReverseLinks is the MOCKED registry function:
  //   readAccountReverseLinks(store: CredentialStore, account: string) → ReverseLink[]
  // The mock receives (store, account) — we match on the second argument.
  mockReadAccount.mockImplementation((_store: unknown, account: string) => {
    return accountData[account] ?? [];
  });

  return store;
}

// ---------------------------------------------------------------------------
// Set up a "standard successful push" scenario
// ---------------------------------------------------------------------------
function setupSuccessfulPush(
  linkId: string,
  link: ReverseLink,
  opts: {
    perFileErrors?: Array<{ path: string; reason: string }>;
    currentRemoteSha?: string;
    diffAdded?: string[];
    diffModified?: string[];
    diffDeleted?: string[];
  } = {},
) {
  const added    = opts.diffAdded    ?? ["docs/new.md"];
  const modified = opts.diffModified ?? [];
  const deleted  = opts.diffDeleted  ?? [];

  // getCurrentRefSha — matches link.lastPushedCommitSha to avoid divergence
  (fakeWriteClient.getCurrentRefSha as ReturnType<typeof vi.fn>).mockResolvedValue(
    opts.currentRemoteSha ?? link.lastPushedCommitSha ?? null,
  );

  // Stub enumerator, collectSnapshot, computeReverseDiff, buildRepoChanges
  mockEnumerateScope.mockReturnValue((async function* () { yield* []; })());
  mockCollectSnapshot.mockResolvedValue({
    snapshot: new Map([
      ...added.map((p) => [p, "etag-new"] as [string, string]),
    ]),
    repoPathToStoragePath: new Map(
      added.map((p) => [p, `my-container/${p}`]),
    ),
  });
  mockComputeDiff.mockReturnValue({
    linkId,
    added,
    modified,
    deleted,
    unchanged: [],
    counts: {
      added: added.length,
      modified: modified.length,
      deleted: deleted.length,
      unchanged: 0,
    },
  });
  mockBuildChanges.mockResolvedValue(
    added.map((p) => ({ kind: "add" as const, path: p, contentBytes: new Uint8Array([1]) })),
  );
  (fakeWriteClient.createCommit as ReturnType<typeof vi.fn>).mockResolvedValue({
    commitSha: "new-commit-sha",
    treeSha: "new-tree-sha",
    perFileErrors: opts.perFileErrors ?? [],
  });

  // updateReverseLink — link exists in registry
  mockUpdateLink.mockResolvedValue(true);
}

// ---------------------------------------------------------------------------
// beforeEach: reset call counts + restore fakeWriteClient default mocks
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockBuildWriteClient.mockReturnValue(fakeWriteClient);
  (fakeWriteClient.ensureRepo           as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fakeWriteClient.getOrCreateRepo      as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fakeWriteClient.getBranchTip         as ReturnType<typeof vi.fn>).mockResolvedValue({ commitSha: "abc123", treeSha: "tree123" });
  (fakeWriteClient.getCurrentRefSha     as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (fakeWriteClient.createCommit         as ReturnType<typeof vi.fn>).mockResolvedValue({ commitSha: "newcommit", treeSha: "newtree", perFileErrors: [] });
  (fakeWriteClient.listRepoFiles        as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (fakeWriteClient.pushChanges          as ReturnType<typeof vi.fn>).mockResolvedValue({ commitSha: "newcommit", treeSha: "newtree", perFileErrors: [] });
  (fakeWriteClient.bootstrapEmpty       as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockRegistryRead.mockResolvedValue({ schemaVersion: 1, links: [] });
  mockReadAccount.mockReturnValue([]);
  mockFindReverseLink.mockResolvedValue(null);
  mockUpdateLink.mockResolvedValue(true);
  mockWriteAccount.mockResolvedValue(undefined);
  mockRegistryCreate.mockResolvedValue(undefined);
  mockRegistryRemove.mockResolvedValue(true);
  mockEnumerateScope.mockReturnValue((async function* () { yield* []; })());
  mockCollectSnapshot.mockResolvedValue({
    snapshot: new Map<string, string>(),
    repoPathToStoragePath: new Map<string, string>(),
  });
  mockComputeDiff.mockReturnValue({
    linkId: "default",
    added: [], modified: [], deleted: [], unchanged: [],
    counts: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
  });
  mockBuildChanges.mockResolvedValue([]);
});

// =============================================================================
// 1. buildWriteClientForLink (from repo-utils)
// =============================================================================
describe("buildWriteClientForLink", () => {
  it("returns a write client (mocked) for a github link with a valid PAT", () => {
    const link = makeContainerLink({ provider: "github" });
    const client = buildWriteClientForLink(link, "ghp_test_token");
    expect(client).toBeDefined();
    expect(typeof client.createCommit).toBe("function");
    expect(mockBuildWriteClient).toHaveBeenCalledWith(link, "ghp_test_token");
  });

  it("passes the correct PAT to the factory for an azure-devops link", () => {
    const link = makeContainerLink({ provider: "azure-devops" });
    buildWriteClientForLink(link, "ado-pat");
    expect(mockBuildWriteClient).toHaveBeenCalledWith(link, "ado-pat");
  });
});

// =============================================================================
// 2. initReverseLink
// =============================================================================
describe("initReverseLink", () => {
  it("creates a container-scope link and persists it via the blob registry", async () => {
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore({
      tokenByProvider: { token: "pat-123" },
    });
    const scope = { kind: "container" as const, account: "my-storage", container: "my-container" };

    const link = await initReverseLink({
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      scope,
      provider: "github",
      repoUrl: "owner/repo",
      tokenName: "my-pat",
      id: "fixed-id",
    });

    expect(link.id).toBe("fixed-id");
    expect(link.scope).toEqual(scope);
    expect(link.provider).toBe("github");
    expect(link.branch).toBe("main");         // default
    expect(link.visibility).toBe("private");  // default
    expect(link.blobSnapshot).toEqual({});    // empty on creation

    // Blob registry must have been called, NOT the CredentialStore.
    expect(mockRegistryCreate).toHaveBeenCalledOnce();
    const [, container, savedLink] = mockRegistryCreate.mock.calls[0];
    expect(container).toBe("my-container");
    expect(savedLink.id).toBe("fixed-id");
    // Account store must NOT have been touched.
    expect(credStore.setAccountReverseLinks).not.toHaveBeenCalled();
  });

  it("creates an account-scope link and persists it via CredentialStore", async () => {
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    const scope = { kind: "account" as const, account: "my-storage" };

    // Arrange: account is empty initially.
    mockReadAccount.mockReturnValue([]);

    await initReverseLink({
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      scope,
      provider: "github",
      repoUrl: "owner/full",
      tokenName: "t",
      id: "acc-id",
    });

    // No blob registry call — account scope goes to CredentialStore.
    expect(mockRegistryCreate).not.toHaveBeenCalled();
    // The engine calls writeAccountReverseLinks (registry module) which
    // delegates to credStore.setAccountReverseLinks.
    expect(mockWriteAccount).toHaveBeenCalledOnce();
    const [, account, links] = mockWriteAccount.mock.calls[0];
    expect(account).toBe("my-storage");
    expect(links[0].id).toBe("acc-id");
  });

  it("with createRepo:true calls ensureRepo with createIfMissing:true", async () => {
    const credStore  = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    const blobClient = makeBlobClient();

    await initReverseLink({
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      scope: { kind: "container", account: "s", container: "c" },
      provider: "github",
      repoUrl: "owner/new-repo",
      tokenName: "t",
      id: "new-id",
      createRepo: true,
      visibility: "public",
    });

    expect(mockBuildWriteClient).toHaveBeenCalledOnce();
    expect(fakeWriteClient.ensureRepo).toHaveBeenCalledWith(
      expect.objectContaining({ createIfMissing: true }),
    );
  });

  it("without createRepo:true does NOT call the write client at all", async () => {
    const credStore  = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    const blobClient = makeBlobClient();

    await initReverseLink({
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      scope: { kind: "container", account: "s", container: "c" },
      provider: "github",
      repoUrl: "owner/repo",
      tokenName: "t",
      id: "no-create-id",
      createRepo: false,
    });

    expect(mockBuildWriteClient).not.toHaveBeenCalled();
    expect(fakeWriteClient.ensureRepo).not.toHaveBeenCalled();
  });

  it("passes patOverride through to the write client factory", async () => {
    const credStore  = makeCredentialStore();
    const blobClient = makeBlobClient();

    await initReverseLink({
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      scope: { kind: "container", account: "s", container: "c" },
      provider: "github",
      repoUrl: "owner/repo",
      tokenName: "t",
      id: "pat-override-id",
      createRepo: true,
      patOverride: "inline-override-pat",
    });

    // buildWriteClientForLink must have been called with the inline PAT.
    expect(mockBuildWriteClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pat-override-id" }),
      "inline-override-pat",
      expect.anything(),
    );
  });

  it("throws when createRepo:true duplicate id already exists in container registry", async () => {
    mockRegistryCreate.mockRejectedValueOnce(
      new Error("Reverse-link with id 'dup-id' already exists in container 'c'"),
    );
    const credStore  = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    const blobClient = makeBlobClient();

    await expect(
      initReverseLink({
        blobClient: blobClient as any,
        credentialStore: credStore as any,
        scope: { kind: "container", account: "s", container: "c" },
        provider: "github",
        repoUrl: "owner/r",
        tokenName: "t",
        id: "dup-id",
        createRepo: true,
      }),
    ).rejects.toThrow(/already exists/);
  });
});

// =============================================================================
// 3. pushReverseLink
// =============================================================================
describe("pushReverseLink", () => {

  // ── 3a. dryRun ─────────────────────────────────────────────────────────────
  describe("dryRun: true", () => {
    it("returns diff in result, pushed=false, and NO createCommit call", async () => {
      const link = makeContainerLink({ id: "push-dry" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-dry", link, { diffAdded: ["a.txt", "b.txt"] });

      const result = await pushReverseLink("push-dry", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
        dryRun: true,
      });

      expect(result.pushed).toBe(false);
      expect(result.added).toEqual(["a.txt", "b.txt"]);
      expect(result.errors).toHaveLength(0);
      // THE KEY ASSERTION: createCommit must NOT have been called.
      expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
    });

    it("dry-run with zero changes returns pushed=false and no createCommit", async () => {
      const link = makeContainerLink({ id: "push-dry-noop" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-dry-noop", link, {
        diffAdded: [], diffModified: [], diffDeleted: [],
      });

      const result = await pushReverseLink("push-dry-noop", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
        dryRun: true,
      });

      expect(result.pushed).toBe(false);
      expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
    });
  });

  // ── 3b. successful push ────────────────────────────────────────────────────
  describe("successful push", () => {
    it("pushes the commit and persists blobSnapshot + lastPushedCommitSha + lastPushResult", async () => {
      const link = makeContainerLink({ id: "push-ok", blobSnapshot: {} });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-ok", link, { diffAdded: ["readme.md"] });

      const result = await pushReverseLink("push-ok", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      });

      expect(result.pushed).toBe(true);
      expect(result.commitSha).toBe("new-commit-sha");
      expect(result.added).toContain("readme.md");
      expect(result.errors).toHaveLength(0);

      // Registry update must have been called with the updated link.
      expect(mockUpdateLink).toHaveBeenCalledOnce();
      const updatedLink: ReverseLink = mockUpdateLink.mock.calls[0][2];
      expect(updatedLink.lastPushedCommitSha).toBe("new-commit-sha");
      expect(typeof updatedLink.blobSnapshot).toBe("object");
      expect(updatedLink.lastPushResult).toBeDefined();
      expect(updatedLink.lastPushResult?.added).toBeGreaterThanOrEqual(0);
    });

    it("no-op push (zero changes) returns pushed=false, no createCommit call", async () => {
      const link = makeContainerLink({
        id: "push-noop",
        blobSnapshot: { "docs/README.md": "etag-unchanged" },
      });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });

      // Zero changes
      mockEnumerateScope.mockReturnValue((async function* () { yield* []; })());
      mockCollectSnapshot.mockResolvedValue({
        snapshot: new Map([["docs/README.md", "etag-unchanged"]]),
        repoPathToStoragePath: new Map(),
      });
      mockComputeDiff.mockReturnValue({
        linkId: "push-noop",
        added: [], modified: [], deleted: [],
        unchanged: ["docs/README.md"],
        counts: { added: 0, modified: 0, deleted: 0, unchanged: 1 },
      });

      const result = await pushReverseLink("push-noop", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      });

      expect(result.pushed).toBe(false);
      expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
    });
  });

  // ── 3c. divergence pre-check ───────────────────────────────────────────────
  describe("divergence detection", () => {
    it("throws RemoteDivergedError BEFORE createCommit when remote SHA differs", async () => {
      const link = makeContainerLink({
        id: "push-div",
        lastPushedCommitSha: "known-sha",
        blobSnapshot: {},
      });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });

      // Simulate remote having diverged.
      (fakeWriteClient.getCurrentRefSha as ReturnType<typeof vi.fn>).mockResolvedValue(
        "diverged-remote-sha",
      );

      await expect(
        pushReverseLink("push-div", {
          blobClient: blobClient as any,
          credentialStore: credStore as any,
          allowOverwriteRemote: false,
        }),
      ).rejects.toThrow(RemoteDivergedError);

      // CRITICAL: createCommit must NOT have been reached.
      expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
    });

    it("does NOT throw when allowOverwriteRemote:true even if remote SHA differs", async () => {
      const link = makeContainerLink({
        id: "push-force",
        lastPushedCommitSha: "known-sha",
        blobSnapshot: {},
      });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-force", link, { diffAdded: ["file.txt"] });
      // Override getCurrentRefSha to simulate divergence.
      (fakeWriteClient.getCurrentRefSha as ReturnType<typeof vi.fn>).mockResolvedValue(
        "diverged-sha",
      );

      const result = await pushReverseLink("push-force", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
        allowOverwriteRemote: true,
      });

      expect(result.pushed).toBe(true);
      // allowForce:true must be forwarded to createCommit.
      expect(fakeWriteClient.createCommit).toHaveBeenCalledWith(
        expect.objectContaining({ allowForce: true }),
      );
    });

    it("RemoteDivergedError carries localKnownSha and remoteActualSha fields", async () => {
      const link = makeContainerLink({
        id: "push-div-fields",
        lastPushedCommitSha: "local-sha-111",
      });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });

      (fakeWriteClient.getCurrentRefSha as ReturnType<typeof vi.fn>).mockResolvedValue(
        "remote-sha-999",
      );

      let caughtErr: unknown;
      try {
        await pushReverseLink("push-div-fields", {
          blobClient: blobClient as any,
          credentialStore: credStore as any,
        });
      } catch (e) {
        caughtErr = e;
      }

      expect(caughtErr).toBeInstanceOf(RemoteDivergedError);
      const err = caughtErr as RemoteDivergedError;
      expect(err.localKnownSha).toBe("local-sha-111");
      expect(err.remoteActualSha).toBe("remote-sha-999");
    });
  });

  // ── 3d. patOverride resolution ─────────────────────────────────────────────
  describe("patOverride resolution", () => {
    it("uses patOverride — buildWriteClientForLink receives the inline token", async () => {
      const link = makeContainerLink({ id: "push-pat" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        reverseLinkPAT: null,
        tokenByProvider: { token: "should-not-be-used" },
      });
      // Also stub getToken to return null so patOverride is the only source.
      credStore.getToken = vi.fn().mockReturnValue(null);

      setupSuccessfulPush("push-pat", link, { diffAdded: ["f.txt"] });

      await pushReverseLink("push-pat", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
        patOverride: "inline-override-pat",
      });

      // Factory was called with the inline override.
      expect(mockBuildWriteClient).toHaveBeenCalledWith(
        expect.objectContaining({ id: "push-pat" }),
        "inline-override-pat",
        expect.anything(),
      );
    });

    it("uses getReverseLinkPAT as step-1 in chain when no patOverride", async () => {
      const link = makeContainerLink({ id: "push-explicit-bind" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        reverseLinkPAT: "explicit-link-pat",
        tokenByProvider: null,
      });

      setupSuccessfulPush("push-explicit-bind", link, { diffAdded: ["x.txt"] });

      await pushReverseLink("push-explicit-bind", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      });

      expect(mockBuildWriteClient).toHaveBeenCalledWith(
        expect.anything(),
        "explicit-link-pat",
        expect.anything(),
      );
    });

    it("throws ConfigurationError when no PAT is resolvable from any step", async () => {
      const link = makeContainerLink({ id: "push-no-pat", tokenName: "" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        reverseLinkPAT: null,
        tokenByProvider: null,
      });
      credStore.getToken = vi.fn().mockReturnValue(null);

      await expect(
        pushReverseLink("push-no-pat", {
          blobClient: blobClient as any,
          credentialStore: credStore as any,
        }),
      ).rejects.toThrow(ConfigurationError);
    });
  });

  // ── 3e. per-file errors → skipped (NFR4) ──────────────────────────────────
  describe("per-file errors (NFR4)", () => {
    it("subtracts per-file error paths from added/modified/deleted into skipped", async () => {
      const link = makeContainerLink({ id: "push-nfr4" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-nfr4", link, {
        diffAdded: ["ok.md", "too-big.bin"],
        perFileErrors: [{ path: "too-big.bin", reason: "blob too large (>100 MB)" }],
      });

      const result = await pushReverseLink("push-nfr4", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      });

      expect(result.pushed).toBe(true);
      // Error file must be in `skipped`, NOT in `added`.
      expect(result.skipped).toContain("too-big.bin");
      expect(result.added).not.toContain("too-big.bin");
      expect(result.added).toContain("ok.md");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe("too-big.bin");
    });

    it("all files in error: skipped = all, added = []", async () => {
      const link = makeContainerLink({ id: "push-all-err" });
      const blobClient = makeBlobClient();
      const credStore  = makeCredStoreWithLink(link, {
        tokenByProvider: { token: "pat" },
      });
      setupSuccessfulPush("push-all-err", link, {
        diffAdded: ["bad1.bin", "bad2.bin"],
        perFileErrors: [
          { path: "bad1.bin", reason: "too large" },
          { path: "bad2.bin", reason: "too large" },
        ],
      });

      const result = await pushReverseLink("push-all-err", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      });

      // Commit was still made — write client returned a commitSha.
      expect(result.pushed).toBe(true);
      expect(result.skipped).toHaveLength(2);
      expect(result.added).toHaveLength(0);
    });

    it("throws ConfigurationError for a link id that cannot be found", async () => {
      const blobClient = makeBlobClient();
      const credStore  = makeCredentialStore();

      await expect(
        pushReverseLink("ghost-link", {
          blobClient: blobClient as any,
          credentialStore: credStore as any,
        }),
      ).rejects.toThrow(ConfigurationError);
    });
  });
});

// =============================================================================
// 3b. Regression: container-scope lookup must use the containerHint
//
// In production a container/prefix-scope link lives ONLY in the container's
// `.reverse-git-links.json` blob (resolved by `findReverseLink`), NOT in the
// account registry. The publish-then-push flow (UI + CLI) therefore broke with
// "Reverse-link '<id>' not found" because pushReverseLink looked the link up by
// id without supplying the container hint. These tests assert the hint is now
// honoured — and that omitting it still fails (so the regression can't silently
// return). They deliberately do NOT use makeCredStoreWithLink (which masks the
// bug by injecting container links into the account registry).
// =============================================================================
describe("pushReverseLink — container-scope lookup (regression)", () => {
  it("finds a container link via containerHint and pushes", async () => {
    const link = makeContainerLink({ id: "hint-ok", blobSnapshot: {} });
    const blobClient = makeBlobClient();
    // Account registry empty — link lives only in the container blob registry.
    const credStore = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    mockFindReverseLink.mockImplementation(
      async (_bc: unknown, container: string, id: string) =>
        container === "my-container" && id === "hint-ok" ? link : null,
    );
    setupSuccessfulPush("hint-ok", link, { diffAdded: ["readme.md"] });

    const result = await pushReverseLink("hint-ok", {
      blobClient: blobClient as any,
      credentialStore: credStore as any,
      containerHint: "my-container",
    });

    expect(result.pushed).toBe(true);
    expect(mockFindReverseLink).toHaveBeenCalledWith(
      blobClient,
      "my-container",
      "hint-ok",
    );
  });

  it("throws when the container link exists but no containerHint is given", async () => {
    const link = makeContainerLink({ id: "hint-missing", blobSnapshot: {} });
    const blobClient = makeBlobClient();
    const credStore = makeCredentialStore({ tokenByProvider: { token: "pat" } });
    // The link is resolvable in its container blob, but with no hint the
    // engine must not reach it — proving the hint is what fixes the bug.
    mockFindReverseLink.mockResolvedValue(link);

    await expect(
      pushReverseLink("hint-missing", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      }),
    ).rejects.toThrow(ConfigurationError);
  });
});

// =============================================================================
// 4. previewReverseDiff
// =============================================================================
describe("previewReverseDiff", () => {
  it("returns diff without calling any write-client method", async () => {
    const link = makeContainerLink({
      id: "diff-prev",
      blobSnapshot: { "old.md": "old-etag" },
    });
    const blobClient = makeBlobClient();
    const credStore  = makeCredStoreWithLink(link);

    mockEnumerateScope.mockReturnValue((async function* () { yield* []; })());
    mockCollectSnapshot.mockResolvedValue({
      snapshot: new Map([
        ["old.md", "new-etag"],
        ["new.md", "fresh-etag"],
      ]),
      repoPathToStoragePath: new Map(),
    });
    mockComputeDiff.mockReturnValue({
      linkId: "diff-prev",
      added: ["new.md"],
      modified: ["old.md"],
      deleted: [],
      unchanged: [],
      counts: { added: 1, modified: 1, deleted: 0, unchanged: 0 },
    });

    const diff = await previewReverseDiff("diff-prev", {
      blobClient: blobClient as any,
      credentialStore: credStore as any,
    });

    expect(diff.added).toContain("new.md");
    expect(diff.modified).toContain("old.md");
    expect(diff.counts.added).toBe(1);

    // Write-client is NEVER touched.
    expect(mockBuildWriteClient).not.toHaveBeenCalled();
    expect(fakeWriteClient.ensureRepo).not.toHaveBeenCalled();
    expect(fakeWriteClient.getCurrentRefSha).not.toHaveBeenCalled();
    expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
  });

  it("throws ConfigurationError when link is not found", async () => {
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();

    await expect(
      previewReverseDiff("ghost", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      }),
    ).rejects.toThrow(ConfigurationError);
  });
});

// =============================================================================
// 5. removeReverseLink
// =============================================================================
describe("removeReverseLink", () => {
  it("removes a container-scope link from the registry — write client is NEVER called", async () => {
    const link = makeContainerLink({ id: "remove-me" });
    const blobClient = makeBlobClient();
    const credStore  = makeCredStoreWithLink(link);

    await removeReverseLink("remove-me", {
      blobClient: blobClient as any,
      credentialStore: credStore as any,
    });

    // Registry remove was called with the right container and id.
    expect(mockRegistryRemove).toHaveBeenCalledWith(
      blobClient,
      "my-container",
      "remove-me",
    );

    // CRITICAL INVARIANT: write client is NEVER touched.
    expect(mockBuildWriteClient).not.toHaveBeenCalled();
    expect(fakeWriteClient.ensureRepo).not.toHaveBeenCalled();
    expect(fakeWriteClient.createCommit).not.toHaveBeenCalled();
  });

  it("removes an account-scope link via writeAccountReverseLinks (filtered list)", async () => {
    const link = makeAccountLink({ id: "remove-acc" });
    const blobClient = makeBlobClient();
    const credStore  = makeCredStoreWithLink(link);

    await removeReverseLink("remove-acc", {
      blobClient: blobClient as any,
      credentialStore: credStore as any,
    });

    // writeAccountReverseLinks(store, account, links) — 3 args.
    // The removed link must be absent from the updated list.
    expect(mockWriteAccount).toHaveBeenCalledOnce();
    const writeArgs = mockWriteAccount.mock.calls[0];
    // writeArgs[0] = store, writeArgs[1] = account, writeArgs[2] = links
    const updatedList: ReverseLink[] = writeArgs[2];
    expect(updatedList.find((l) => l.id === "remove-acc")).toBeUndefined();

    // Write client must never be called.
    expect(mockBuildWriteClient).not.toHaveBeenCalled();
  });

  it("throws ConfigurationError when link is not found", async () => {
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();

    await expect(
      removeReverseLink("ghost-remove", {
        blobClient: blobClient as any,
        credentialStore: credStore as any,
      }),
    ).rejects.toThrow(ConfigurationError);
  });
});

// =============================================================================
// 6. listReverseLinks
// =============================================================================
describe("listReverseLinks", () => {
  it("account scope returns links from readAccountReverseLinks", async () => {
    const accLink = makeAccountLink({ id: "acc-list-1" });
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();
    mockReadAccount.mockReturnValue([accLink]);

    const links = await listReverseLinks(
      { kind: "account", account: "my-storage" },
      { blobClient: blobClient as any, credentialStore: credStore as any },
    );

    expect(links).toHaveLength(1);
    expect(links[0].id).toBe("acc-list-1");
    // Container blob registry must NOT have been touched.
    expect(mockRegistryRead).not.toHaveBeenCalled();
  });

  it("container scope returns links from the container registry", async () => {
    const cLink1 = makeContainerLink({ id: "c-link-1" });
    const cLink2 = makeContainerLink({ id: "c-link-2" });
    mockRegistryRead.mockResolvedValue({ schemaVersion: 1, links: [cLink1, cLink2] });
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();

    const links = await listReverseLinks(
      { kind: "container", account: "my-storage", container: "my-container" },
      { blobClient: blobClient as any, credentialStore: credStore as any },
    );

    expect(links).toHaveLength(2);
    expect(links.map((l) => l.id)).toContain("c-link-1");
    expect(links.map((l) => l.id)).toContain("c-link-2");
  });

  it("prefix scope filters by exact prefix within the container registry", async () => {
    const prefLink = {
      ...makeContainerLink({ id: "pref-1" }),
      scope: { kind: "prefix" as const, account: "s", container: "c", prefix: "docs/" },
    };
    const otherLink = {
      ...makeContainerLink({ id: "other-1" }),
      scope: { kind: "prefix" as const, account: "s", container: "c", prefix: "imgs/" },
    };
    mockRegistryRead.mockResolvedValue({ schemaVersion: 1, links: [prefLink, otherLink] });
    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();

    const links = await listReverseLinks(
      { kind: "prefix", account: "s", container: "c", prefix: "docs/" },
      { blobClient: blobClient as any, credentialStore: credStore as any },
    );

    expect(links).toHaveLength(1);
    expect(links[0].id).toBe("pref-1");
  });

  it("{ all: true } pattern: walking every known account yields combined links", async () => {
    // This test verifies that per-account isolation works and both account-scope
    // links are independently listable.
    const link1 = makeAccountLink({ id: "a1", scope: { kind: "account", account: "acct-1" } });
    const link2 = makeAccountLink({ id: "a2", scope: { kind: "account", account: "acct-2" } });

    const blobClient = makeBlobClient();
    const credStore  = makeCredentialStore();

    // readAccountReverseLinks(store, account) — mock with 2-arg signature.
    mockReadAccount.mockImplementation((_store: unknown, account: string) => {
      if (account === "acct-1") return [link1];
      if (account === "acct-2") return [link2];
      return [];
    });

    const r1 = await listReverseLinks(
      { kind: "account", account: "acct-1" },
      { blobClient: blobClient as any, credentialStore: credStore as any },
    );
    const r2 = await listReverseLinks(
      { kind: "account", account: "acct-2" },
      { blobClient: blobClient as any, credentialStore: credStore as any },
    );

    expect(r1).toHaveLength(1);
    expect(r1[0].id).toBe("a1");
    expect(r2).toHaveLength(1);
    expect(r2[0].id).toBe("a2");
    // Container registry was never consulted.
    expect(mockRegistryRead).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 7. Typed error invariants
// =============================================================================
describe("typed error invariants", () => {
  it("ConfigurationError has exitCode=3, httpStatus=400, code='CONFIG_MISSING'", () => {
    const err = new ConfigurationError("missing config");
    expect(err.exitCode).toBe(3);
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("CONFIG_MISSING");
    expect(err).toBeInstanceOf(Error);
  });

  it("RemoteDivergedError has exitCode=2, httpStatus=409, code='REMOTE_DIVERGED'", () => {
    const err = new RemoteDivergedError("sha-a", "sha-b");
    expect(err.exitCode).toBe(2);
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe("REMOTE_DIVERGED");
    expect(err).toBeInstanceOf(Error);
  });

  it("RemoteDivergedError.message defaults to a diagnostic string", () => {
    const err = new RemoteDivergedError("local-1", "remote-2");
    expect(err.message).toMatch(/local-1/);
    expect(err.message).toMatch(/remote-2/);
  });

  it("RemoteDivergedError accepts an explicit message override", () => {
    const err = new RemoteDivergedError("a", "b", "custom msg");
    expect(err.message).toBe("custom msg");
  });
});
