// ===========================================================================
// tests/unit/reverse-git-cli.test.ts
//
// Unit tests for src/cli/commands/reverse-git.ts
//
// Strategy:
//   - Mock the engine (reverse-sync-engine.ts) so no real Azure or Git
//     calls are made.
//   - Mock `./shared.js` (resolveStorageEntry, resolvePatToken, promptYesNo)
//     so tests do not touch CredentialStore or the filesystem.
//   - Mock `BlobClient` constructor so no Azure SDK is invoked.
//   - Spy on `process.exit` to capture exit codes without terminating the
//     test runner.
//   - Spy on `console.error` / `console.log` to verify CLI output.
//
// Exit-code capture approach:
//   The handler functions wrap their body in a try/catch that calls
//   `reportError(err)` on any thrown value. Because our `process.exit` spy
//   throws an error, that error can be caught by the handler's catch block
//   and re-processed.  To avoid misrouting, the spy throws a subclass of
//   `ReverseGitError` (class `TestExitSignal`) so that `reportError` takes
//   the `instanceof ReverseGitError` branch and re-exits with the same code
//   — guaranteeing the propagated error always carries the intended exit code.
//
// Per project invariants:
//   - No production source modified.
//   - No shared test infrastructure modified.
// ===========================================================================

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (Vitest hoists these before any import)
// ---------------------------------------------------------------------------

vi.mock("../../src/core/reverse-sync-engine.js", () => ({
  initReverseLink: vi.fn(),
  pushReverseLink: vi.fn(),
  removeReverseLink: vi.fn(),
  listReverseLinks: vi.fn(),
  resolveReverseLinks: vi.fn(),
  previewReverseDiff: vi.fn(),
  publishRepo: vi.fn(),
}));

vi.mock("../../src/cli/commands/shared.js", () => ({
  resolveStorageEntry: vi.fn(),
  resolvePatToken: vi.fn(),
  resolveGitHubCredential: vi.fn(),
  promptYesNo: vi.fn(),
}));

// BlobClient constructor — must be new-callable (regular function, not arrow).
vi.mock("../../src/core/blob-client.js", () => ({
  BlobClient: vi.fn().mockImplementation(function (this: object) {
    // Minimal stub — no methods needed; the engine is fully mocked.
  }),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock so the mock registry is populated)
// ---------------------------------------------------------------------------

import {
  publishGitHub,
  publishDevOps,
  reverseLinkGitHub,
  reverseLinkDevOps,
  pushReverseLinkCmd,
  reverseUnlink,
  listReverseLinksCmd,
} from "../../src/cli/commands/reverse-git.js";

import * as engine from "../../src/core/reverse-sync-engine.js";
import * as shared from "../../src/cli/commands/shared.js";

import {
  ReverseGitError,
  ConfigurationError,
  RemoteDivergedError,
  InsufficientScopesError,
} from "../../src/core/reverse-git-errors.js";

import type {
  PushResult,
  ReverseLink,
} from "../../src/core/reverse-git-types.js";

// ---------------------------------------------------------------------------
// TestExitSignal — a ReverseGitError subclass thrown by our process.exit spy.
//
// The CLI handlers have this structure:
//   try { ... process.exit(N) ... }
//   catch (err) { reportError(err) }   // calls process.exit(err.exitCode)
//
// By throwing a ReverseGitError from the spy, reportError takes the
// `instanceof ReverseGitError` branch and calls process.exit(err.exitCode) —
// the same code as the original exit — so the final propagated error always
// carries the intended exit code.
// ---------------------------------------------------------------------------

class TestExitSignal extends ReverseGitError {
  override readonly code = "TEST_EXIT";
  override readonly httpStatus = 0;
  override readonly exitCode: 0 | 1 | 2 | 3;

  constructor(code: 0 | 1 | 2 | 3) {
    super(`Test exit signal: ${code}`);
    this.exitCode = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DirectStorageEntry (kind = direct). */
function makeDirectEntry(accountName = "myaccount") {
  return {
    kind: "direct" as const,
    name: "test-storage",
    accountName,
    accountKey: "key123",
    addedAt: "2026-01-01T00:00:00Z",
  };
}

/** Build a minimal credential-store stub. */
function makeStoreMock() {
  return {
    getToken: vi.fn().mockReturnValue({ token: "stored-pat", tokenName: "my-token" }),
    getTokenByProvider: vi.fn().mockReturnValue({ token: "provider-pat" }),
    getReverseLinkPAT: vi.fn().mockReturnValue(undefined),
    getFirstStorage: vi.fn().mockReturnValue(null),
    getStorage: vi.fn().mockReturnValue(null),
  };
}

/** Build a minimal PushResult (no-op — nothing to push). */
function makeNopPushResult(linkId = "link-001"): PushResult {
  return {
    linkId,
    pushed: false,
    added: [],
    modified: [],
    deleted: [],
    skipped: [],
    errors: [],
    at: "2026-06-01T00:00:00Z",
  };
}

/** Build a PushResult indicating changes were pushed. */
function makeActivePushResult(linkId = "link-001"): PushResult {
  return {
    linkId,
    pushed: true,
    commitSha: "abc123",
    added: ["file1.txt", "file2.txt"],
    modified: [],
    deleted: [],
    skipped: [],
    errors: [],
    at: "2026-06-01T00:00:00Z",
  };
}

/** Build a minimal ReverseLink fixture. */
function makeReverseLink(overrides: Partial<ReverseLink> = {}): ReverseLink {
  return {
    id: "link-001",
    scope: { kind: "container", account: "myaccount", container: "mycontainer" },
    provider: "github",
    repoUrl: "owner/repo",
    branch: "main",
    repoSubPath: "",
    tokenName: "my-token",
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
 * Assert that the handler will exit with the given code, by checking the
 * TestExitSignal thrown from the test's process.exit spy.
 */
async function assertExitCode(
  fn: () => Promise<void>,
  expectedCode: 0 | 1 | 2 | 3,
): Promise<TestExitSignal> {
  let thrown: unknown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(TestExitSignal);
  const signal = thrown as TestExitSignal;
  expect(signal.exitCode).toBe(expectedCode);
  return signal;
}

// Standard opts used in most tests.
const STORAGE_OPTS = { storage: "test-storage" };
const PAT_OPTS_INLINE = { pat: "inline-pat-value" };
const PAT_OPTS_EMPTY = {};

// ---------------------------------------------------------------------------
// Spy setup — process.exit and console
// ---------------------------------------------------------------------------

let exitSpy: MockInstance;
let consoleErrorSpy: MockInstance;
let consoleLogSpy: MockInstance;

beforeEach(() => {
  // Clear mock call history and return-value queues between tests.
  vi.clearAllMocks();

  // Throw a TestExitSignal so exit codes propagate correctly through
  // reportError's try/catch (see design note above).
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: unknown) => {
    const c = (typeof code === "number" ? code : 2) as 0 | 1 | 2 | 3;
    throw new TestExitSignal(c);
  });

  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  // Default shared mocks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(shared.resolveStorageEntry).mockResolvedValue({
    store: makeStoreMock(),
    entry: makeDirectEntry(),
  } as any);

  vi.mocked(shared.resolvePatToken).mockResolvedValue("inline-pat-value");
  vi.mocked(shared.resolveGitHubCredential).mockResolvedValue({
    token: "inline-pat-value",
    authType: "pat",
    credentialName: "(inline)",
  });
  vi.mocked(shared.promptYesNo).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// publishGitHub
// ===========================================================================

describe("publishGitHub", () => {
  it("calls initReverseLink with provider=github and the resolved PAT as patOverride", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishGitHub(
        { container: "mycontainer" },
        { repo: "owner/repo", branch: "main" },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.provider).toBe("github");
    expect(initCall.repoUrl).toBe("owner/repo");
    expect(initCall.branch).toBe("main");
    // AC-C3: inline --pat must be passed as patOverride to the engine.
    expect(initCall.patOverride).toBe("inline-pat-value");
  });

  it("also passes patOverride to the subsequent pushReverseLink call (AC-C3)", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishGitHub(
        { container: "mycontainer" },
        { repo: "owner/repo" },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      0,
    );

    const pushCall = vi.mocked(engine.pushReverseLink).mock.calls[0][1];
    expect(pushCall.patOverride).toBe("inline-pat-value");
  });

  it("exits 0 when push result has no changes (no-op)", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );
  });

  it("exits 1 when push result contains added files", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeActivePushResult());

    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      1,
    );
  });

  it("exits 3 (ConfigurationError) when --repo is missing", async () => {
    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });

  it("exits 3 (ConfigurationError) when storage kind is not direct", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(shared.resolveStorageEntry).mockResolvedValue({
      store: makeStoreMock(),
      entry: { kind: "api", name: "api-storage", baseUrl: "https://x", authEnabled: false, addedAt: "2026-01-01" },
    } as any);

    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });

  it("exits 2 on RemoteDivergedError from engine", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new RemoteDivergedError("aaa", "bbb"),
    );

    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      2,
    );
  });

  it("maps --visibility public to initReverseLink correctly", async () => {
    const link = makeReverseLink({ visibility: "public" });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishGitHub({ container: "c" }, { repo: "owner/repo", visibility: "public" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.visibility).toBe("public");
  });

  it("throws ConfigurationError (exit 3) for invalid --visibility value", async () => {
    await assertExitCode(
      () => publishGitHub(
        { container: "c" },
        { repo: "owner/repo", visibility: "protected" as unknown as string },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      3,
    );
  });

  it("builds prefix scope when --prefix and --container are both supplied", async () => {
    const link = makeReverseLink({
      scope: { kind: "prefix", account: "myaccount", container: "c", prefix: "docs/" },
    });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishGitHub({ container: "c", prefix: "docs/" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.scope).toMatchObject({ kind: "prefix", container: "c", prefix: "docs/" });
  });

  it("throws ConfigurationError (exit 3) when --prefix is set but --container is absent", async () => {
    await assertExitCode(
      () => publishGitHub({ prefix: "docs/" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });
});

// ===========================================================================
// publishDevOps
// ===========================================================================

describe("publishDevOps", () => {
  it("calls initReverseLink with provider=azure-devops and patOverride (AC-C3)", async () => {
    const link = makeReverseLink({ provider: "azure-devops", repoUrl: "https://dev.azure.com/org/proj/_git/repo" });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishDevOps(
        { container: "c" },
        { repo: "repo", org: "org", project: "proj" },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.provider).toBe("azure-devops");
    expect(initCall.repoUrl).toBe("https://dev.azure.com/org/proj/_git/repo");
    expect(initCall.patOverride).toBe("inline-pat-value");
  });

  it("accepts a full ADO URL as --repo directly (bypasses --org/--project)", async () => {
    const fullUrl = "https://dev.azure.com/myorg/myproj/_git/myrepo";
    const link = makeReverseLink({ provider: "azure-devops", repoUrl: fullUrl });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishDevOps({ container: "c" }, { repo: fullUrl }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.repoUrl).toBe(fullUrl);
  });

  it("throws ConfigurationError (exit 3) when --repo is bare name without --org/--project", async () => {
    await assertExitCode(
      () => publishDevOps({ container: "c" }, { repo: "bare-repo-name" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });

  it("exits 1 when push has changes", async () => {
    const link = makeReverseLink({ provider: "azure-devops" });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeActivePushResult());

    await assertExitCode(
      () => publishDevOps({ container: "c" }, { repo: "https://dev.azure.com/o/p/_git/r" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      1,
    );
  });

  it("exits 2 on InsufficientScopesError from engine", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink({ provider: "azure-devops" }));
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new InsufficientScopesError("PAT lacks repo write scope"),
    );

    await assertExitCode(
      () => publishDevOps({ container: "c" }, { repo: "https://dev.azure.com/o/p/_git/r" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      2,
    );
  });

  it("also passes patOverride to pushReverseLink (AC-C3)", async () => {
    const link = makeReverseLink({ provider: "azure-devops" });
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => publishDevOps({ container: "c" }, { repo: "https://dev.azure.com/o/p/_git/r" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    const pushCall = vi.mocked(engine.pushReverseLink).mock.calls[0][1];
    expect(pushCall.patOverride).toBe("inline-pat-value");
  });
});

// ===========================================================================
// reverseLinkGitHub
// ===========================================================================

describe("reverseLinkGitHub", () => {
  it("calls initReverseLink but does NOT call pushReverseLink", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.initReverseLink).mockResolvedValue(link);

    await assertExitCode(
      () => reverseLinkGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    expect(engine.initReverseLink).toHaveBeenCalledOnce();
    expect(engine.pushReverseLink).not.toHaveBeenCalled();
  });

  it("passes patOverride to initReverseLink (AC-C3)", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());
    // Override the mock to return the inline PAT, mirroring resolvePatToken's
    // real priority-1 behaviour (inline --pat takes precedence).
    vi.mocked(shared.resolvePatToken).mockResolvedValue("my-inline-pat");
    vi.mocked(shared.resolveGitHubCredential).mockResolvedValue({
      token: "my-inline-pat",
      authType: "pat",
      credentialName: "(inline)",
    });

    await assertExitCode(
      () => reverseLinkGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, { pat: "my-inline-pat" }, {}),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.patOverride).toBe("my-inline-pat");
  });

  it("exits 0 on success", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());
    await assertExitCode(
      () => reverseLinkGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );
  });

  it("exits 3 when --repo is missing", async () => {
    await assertExitCode(
      () => reverseLinkGitHub({ container: "c" }, { repo: "" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });

  it("maps --author-name/--author-email to CommitAuthor on the link", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(makeReverseLink());

    await assertExitCode(
      () => reverseLinkGitHub(
        { container: "c" },
        { repo: "owner/repo", authorName: "Alice", authorEmail: "alice@example.com" },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.author).toEqual({ name: "Alice", email: "alice@example.com" });
  });

  it("throws ConfigurationError (exit 3) when only --author-name is set (no email)", async () => {
    await assertExitCode(
      () => reverseLinkGitHub(
        { container: "c" },
        { repo: "owner/repo", authorName: "Alice" /* no email */ },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      3,
    );
  });

  it("exits 2 on non-ReverseGitError (generic Error)", async () => {
    vi.mocked(engine.initReverseLink).mockRejectedValue(new Error("network failure"));

    await assertExitCode(
      () => reverseLinkGitHub({ container: "c" }, { repo: "owner/repo" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      2,
    );
  });
});

// ===========================================================================
// reverseLinkDevOps
// ===========================================================================

describe("reverseLinkDevOps", () => {
  it("calls initReverseLink with provider=azure-devops, no push", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(
      makeReverseLink({ provider: "azure-devops" }),
    );

    await assertExitCode(
      () => reverseLinkDevOps({ container: "c" }, { repo: "https://dev.azure.com/o/p/_git/r" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.provider).toBe("azure-devops");
    expect(engine.pushReverseLink).not.toHaveBeenCalled();
  });

  it("synthesises ADO URL from --org/--project/--repo (bare name)", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(
      makeReverseLink({ provider: "azure-devops" }),
    );

    await assertExitCode(
      () => reverseLinkDevOps(
        { container: "c" },
        { repo: "myrepo", org: "myorg", project: "myproj" },
        STORAGE_OPTS,
        PAT_OPTS_INLINE, {},
      ),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.repoUrl).toBe("https://dev.azure.com/myorg/myproj/_git/myrepo");
  });

  it("passes patOverride to initReverseLink (AC-C3)", async () => {
    vi.mocked(engine.initReverseLink).mockResolvedValue(
      makeReverseLink({ provider: "azure-devops" }),
    );
    // Mirror resolvePatToken's real priority-1 behaviour for the inline PAT.
    vi.mocked(shared.resolvePatToken).mockResolvedValue("ado-pat");

    await assertExitCode(
      () => reverseLinkDevOps({ container: "c" }, { repo: "https://dev.azure.com/o/p/_git/r" }, STORAGE_OPTS, { pat: "ado-pat" }),
      0,
    );

    const initCall = vi.mocked(engine.initReverseLink).mock.calls[0][0];
    expect(initCall.patOverride).toBe("ado-pat");
  });

  it("exits 3 when --repo is missing", async () => {
    await assertExitCode(
      () => reverseLinkDevOps({ container: "c" }, { repo: "" }, STORAGE_OPTS, PAT_OPTS_INLINE, {}),
      3,
    );
  });
});

// ===========================================================================
// pushReverseLinkCmd (push)
// ===========================================================================

describe("pushReverseLinkCmd (push)", () => {
  it("resolves the single link by linkId and calls pushReverseLink", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      0,
    );

    expect(engine.resolveReverseLinks).toHaveBeenCalledOnce();
    expect(engine.pushReverseLink).toHaveBeenCalledWith(
      "link-001",
      expect.objectContaining({ blobClient: expect.anything() }),
    );
  });

  it("passes inline --pat as patOverride to pushReverseLink (Phase-7 bug fix regression)", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001" }, STORAGE_OPTS, { pat: "direct-pat-override" }),
      0,
    );

    const pushCall = vi.mocked(engine.pushReverseLink).mock.calls[0][1];
    // Phase-7 fix: patOverride must be the inline --pat value (not undefined).
    expect(pushCall.patOverride).toBe("direct-pat-override");
  });

  it("passes dryRun=true to pushReverseLink when --dry-run is set", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001", dryRun: true }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      0,
    );

    const pushCall = vi.mocked(engine.pushReverseLink).mock.calls[0][1];
    expect(pushCall.dryRun).toBe(true);
  });

  it("exits 1 on dry-run when changes are pending (would push)", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue({
      ...makeNopPushResult(),
      added: ["a.txt"],
    });

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001", dryRun: true }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      1,
    );
  });

  it("exits 0 on dry-run when no changes are pending", async () => {
    const link = makeReverseLink();
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001", dryRun: true }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      0,
    );
  });

  it("exits 2 when no matching reverse-links are found", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "nonexistent" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      2,
    );
  });

  it("exits 3 when --all and --link-id are both set (mutually exclusive)", async () => {
    await assertExitCode(
      () => pushReverseLinkCmd({}, { all: true, linkId: "link-001" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      3,
    );
  });

  it("--all: pushes all resolved links; aggregate exits 1 when any has changes", async () => {
    const link1 = makeReverseLink({ id: "link-001" });
    const link2 = makeReverseLink({ id: "link-002" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link1, link2]);
    vi.mocked(engine.pushReverseLink)
      .mockResolvedValueOnce(makeNopPushResult("link-001"))    // no changes
      .mockResolvedValueOnce(makeActivePushResult("link-002")); // has changes

    await assertExitCode(
      () => pushReverseLinkCmd({}, { all: true }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      1,
    );

    expect(engine.pushReverseLink).toHaveBeenCalledTimes(2);
  });

  it("--all: exits 0 when all links report no changes", async () => {
    const link1 = makeReverseLink({ id: "link-001" });
    const link2 = makeReverseLink({ id: "link-002" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link1, link2]);
    vi.mocked(engine.pushReverseLink)
      .mockResolvedValueOnce(makeNopPushResult("link-001"))
      .mockResolvedValueOnce(makeNopPushResult("link-002"));

    await assertExitCode(
      () => pushReverseLinkCmd({}, { all: true }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      0,
    );
  });

  it("--all: same inline --pat is threaded to every push call as patOverride", async () => {
    const link1 = makeReverseLink({ id: "link-001" });
    const link2 = makeReverseLink({ id: "link-002" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link1, link2]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { all: true }, STORAGE_OPTS, { pat: "shared-pat" }),
      0,
    );

    const calls = vi.mocked(engine.pushReverseLink).mock.calls;
    expect(calls[0][1].patOverride).toBe("shared-pat");
    expect(calls[1][1].patOverride).toBe("shared-pat");
  });

  it("exits 2 on RemoteDivergedError from the engine (REMOTE_DIVERGED in stderr)", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new RemoteDivergedError("aaa", "bbb"),
    );

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      2,
    );

    // Confirm the [REMOTE_DIVERGED] code was emitted to stderr.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("REMOTE_DIVERGED"),
    );
  });

  it("resolves patOverride from --token-name via store.getToken", async () => {
    const storeMock = makeStoreMock();
    storeMock.getToken.mockReturnValue({ token: "stored-named-pat", tokenName: "saved-token" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(shared.resolveStorageEntry).mockResolvedValue({
      store: storeMock,
      entry: makeDirectEntry(),
    } as any);

    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockResolvedValue(makeNopPushResult());

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001" }, STORAGE_OPTS, { tokenName: "saved-token" }),
      0,
    );

    const pushCall = vi.mocked(engine.pushReverseLink).mock.calls[0][1];
    expect(pushCall.patOverride).toBe("stored-named-pat");
  });

  it("exits 3 when --token-name refers to a token not in the store", async () => {
    const storeMock = makeStoreMock();
    storeMock.getToken.mockReturnValue(null); // token not found

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(shared.resolveStorageEntry).mockResolvedValue({
      store: storeMock,
      entry: makeDirectEntry(),
    } as any);

    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "link-001" }, STORAGE_OPTS, { tokenName: "ghost-token" }),
      3,
    );
  });
});

// ===========================================================================
// reverseUnlink
// ===========================================================================

describe("reverseUnlink", () => {
  it("exits 3 when --link-id is missing", async () => {
    await assertExitCode(
      () => reverseUnlink({}, undefined, STORAGE_OPTS, false),
      3,
    );

    expect(engine.removeReverseLink).not.toHaveBeenCalled();
  });

  it("exits 2 when the link is not found by resolveReverseLinks", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => reverseUnlink({}, "nonexistent-id", STORAGE_OPTS, true),
      2,
    );

    expect(engine.removeReverseLink).not.toHaveBeenCalled();
  });

  it("prompts for confirmation and removes when user confirms (assumeYes=false)", async () => {
    const link = makeReverseLink({ id: "link-007" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.removeReverseLink).mockResolvedValue(undefined);
    vi.mocked(shared.promptYesNo).mockResolvedValue(true);

    await assertExitCode(
      () => reverseUnlink({}, "link-007", STORAGE_OPTS, false),
      0,
    );

    expect(shared.promptYesNo).toHaveBeenCalledOnce();
    expect(engine.removeReverseLink).toHaveBeenCalledWith(
      "link-007",
      expect.objectContaining({ blobClient: expect.anything() }),
    );
  });

  it("cancels and exits 0 without removing when user denies prompt", async () => {
    const link = makeReverseLink({ id: "link-007" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(shared.promptYesNo).mockResolvedValue(false);

    await assertExitCode(
      () => reverseUnlink({}, "link-007", STORAGE_OPTS, false),
      0,
    );

    expect(engine.removeReverseLink).not.toHaveBeenCalled();
  });

  it("--yes bypasses the confirmation prompt and removes immediately", async () => {
    const link = makeReverseLink({ id: "link-007" });
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([link]);
    vi.mocked(engine.removeReverseLink).mockResolvedValue(undefined);

    await assertExitCode(
      () => reverseUnlink({}, "link-007", STORAGE_OPTS, true /* assumeYes */),
      0,
    );

    // promptYesNo must NOT be called when assumeYes=true.
    expect(shared.promptYesNo).not.toHaveBeenCalled();
    expect(engine.removeReverseLink).toHaveBeenCalledOnce();
  });

  it("exits 3 when storage is api-backend (not direct)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(shared.resolveStorageEntry).mockResolvedValue({
      store: makeStoreMock(),
      entry: { kind: "api", name: "api", baseUrl: "https://x", authEnabled: false, addedAt: "2026-01-01" },
    } as any);

    await assertExitCode(
      () => reverseUnlink({}, "link-007", STORAGE_OPTS, true),
      3,
    );
  });
});

// ===========================================================================
// listReverseLinksCmd
// ===========================================================================

describe("listReverseLinksCmd", () => {
  it("exits 0 and prints 'No reverse-links found' when registry is empty", async () => {
    vi.mocked(engine.listReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => listReverseLinksCmd({}, STORAGE_OPTS),
      0,
    );

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("No reverse-links found"),
    );
  });

  it("exits 0 and prints a table row for each link", async () => {
    const link1 = makeReverseLink({ id: "aaaa-aaaa-aaaa-aaaa", provider: "github", repoUrl: "owner/repo" });
    const link2 = makeReverseLink({
      id: "bbbb-bbbb-bbbb-bbbb",
      provider: "azure-devops",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
    });
    vi.mocked(engine.listReverseLinks).mockResolvedValue([link1, link2]);

    await assertExitCode(
      () => listReverseLinksCmd({ container: "c" }, STORAGE_OPTS),
      0,
    );

    const allOutput = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(allOutput).toContain("aaaa-aaa");
    expect(allOutput).toContain("bbbb-bbb");
  });

  it("routes container scope to listReverseLinks with kind=container", async () => {
    vi.mocked(engine.listReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => listReverseLinksCmd({ container: "mycontainer" }, STORAGE_OPTS),
      0,
    );

    const scope = vi.mocked(engine.listReverseLinks).mock.calls[0][0];
    expect(scope).toMatchObject({ kind: "container", container: "mycontainer" });
  });

  it("routes to account scope when no container is given", async () => {
    vi.mocked(engine.listReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => listReverseLinksCmd({}, STORAGE_OPTS),
      0,
    );

    const scope = vi.mocked(engine.listReverseLinks).mock.calls[0][0];
    expect(scope.kind).toBe("account");
  });

  it("routes to prefix scope when --prefix and --container are both given", async () => {
    vi.mocked(engine.listReverseLinks).mockResolvedValue([]);

    await assertExitCode(
      () => listReverseLinksCmd({ container: "c", prefix: "docs/" }, STORAGE_OPTS),
      0,
    );

    const scope = vi.mocked(engine.listReverseLinks).mock.calls[0][0];
    expect(scope).toMatchObject({ kind: "prefix", container: "c", prefix: "docs/" });
  });

  it("exits 2 on fatal engine error", async () => {
    vi.mocked(engine.listReverseLinks).mockRejectedValue(new Error("storage unavailable"));

    await assertExitCode(
      () => listReverseLinksCmd({}, STORAGE_OPTS),
      2,
    );
  });
});

// ===========================================================================
// Error-code taxonomy — exhaustive checks per plan-011 §"Error type taxonomy"
// ===========================================================================

describe("Error exit code taxonomy", () => {
  it("RemoteDivergedError → exit 2", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new RemoteDivergedError("sha1", "sha2"),
    );

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "x" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      2,
    );
  });

  it("ConfigurationError → exit 3", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new ConfigurationError("Missing required config"),
    );

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "x" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      3,
    );
  });

  it("InsufficientScopesError → exit 2", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockRejectedValue(
      new InsufficientScopesError("PAT insufficient"),
    );

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "x" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      2,
    );
  });

  it("plain Error (not ReverseGitError) → exit 2", async () => {
    vi.mocked(engine.resolveReverseLinks).mockResolvedValue([makeReverseLink()]);
    vi.mocked(engine.pushReverseLink).mockRejectedValue(new Error("unexpected failure"));

    await assertExitCode(
      () => pushReverseLinkCmd({}, { linkId: "x" }, STORAGE_OPTS, PAT_OPTS_EMPTY),
      2,
    );
  });
});
