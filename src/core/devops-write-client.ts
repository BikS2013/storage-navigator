// ===========================================================================
// src/core/devops-write-client.ts
//
// DevOpsWriteClient — implements the provider-agnostic RepoWriteClient
// contract (see src/core/reverse-git-types.ts) on top of the Azure
// DevOps Git Pushes API using raw `fetch`. No `azure-devops-node-api`,
// no other runtime dependency. Phase A of the reverse-git plan.
//
// Source of truth for endpoint sequences and payload shapes:
//   docs/research/azure-devops-git-pushes-api.md
//     §1  Single-call push schema
//     §2  changes[] entry shape (add / edit / delete; rawtext vs base64)
//     §3  Empty-repo bootstrap with 40-zeros oldObjectId
//     §4  Repository lookup
//     §5  Repository auto-creation (project UUID required in body)
//     §6  Authentication (Basic auth, empty username + PAT)
//     §10 Divergence detection (400 + GitRefUpdateNeedsForcePermissionException)
//     §11 Listing existing files (recursionLevel=Full)
//     §13 Error shapes
//     §14 TypeScript implementation (followed closely)
//     §17 add vs edit classification (engine responsibility)
//     §18 Chunked pushes for very large file sets (ADO_PUSH_CHUNK_SIZE)
//
// Phase A decisions made by this file (not pre-described in the research):
//   - As with github-write-client.ts, the existing rateLimitedFetch in
//     repo-utils.ts is GET-only. To keep Phase A from touching it, this
//     file implements a local `adoRequest` helper with method + body
//     support and 429/Retry-After handling.
//   - The design's "visibility" field for repo creation is silently
//     ignored on ADO — visibility is a project-level setting on Azure
//     DevOps, not a repo setting (research §5). The signature still
//     accepts visibility for interface parity with GitHub.
//   - All bytes are uploaded base64-encoded (`contentType: base64encoded`)
//     even for known-text content, matching design §5.10 (consistent
//     encoding, no UTF-8 edge cases).
// ===========================================================================

import {
  RepoWriteClient,
  RepoWriteClientCommitInput,
  RepoWriteClientCommitResult,
  RepoChange,
  RepoVisibility,
} from "./reverse-git-types.js";
import {
  DevOpsApiError,
  InsufficientScopesError,
  InvalidPATError,
  PayloadTooLargeError,
  RateLimitExceededError,
  RemoteDivergedError,
  RepoNotFoundError,
} from "./reverse-git-errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable Azure DevOps REST API version used for all calls. */
const ADO_API_VERSION = "7.1";

/** 40 hex zeros — initial-commit oldObjectId sentinel. See research §3. */
const ZERO_OBJECT_ID = "0000000000000000000000000000000000000000";

/**
 * Maximum number of `changes[]` per `POST /git/pushes` before the client
 * splits the operation into multiple sequential pushes. ADO accepts a
 * 5 GB payload per push (research §1, §18); 500 changes keeps the
 * payload well under that ceiling even for moderately large files.
 */
const ADO_PUSH_CHUNK_SIZE = 500;

/** Per-file size cap (informational — ADO returns HTTP 413 on overflow). */
// kept for reference / future use
// const ADO_FILE_SIZE_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB

/** Maximum 429-retry attempts before surfacing `RateLimitExceededError`. */
const MAX_RATE_LIMIT_RETRIES = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the Basic-auth header used by every ADO REST call. PATs are
 * sent with an empty username and a colon prefix per research §6.
 */
function adoHeaders(pat: string): Record<string, string> {
  const encoded = Buffer.from(`:${pat}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Parsed ADO error envelope. */
interface DevOpsErrorBody {
  typeKey?: string;
  message?: string;
  innerException?: DevOpsErrorBody | null;
}

/** Parse the response body as JSON; return an empty object on failure. */
async function safeJson(res: Response): Promise<DevOpsErrorBody> {
  try {
    return (await res.json()) as DevOpsErrorBody;
  } catch {
    return {};
  }
}

/**
 * Rate-limit-aware `fetch` wrapper for ADO. Mirrors the retry semantics
 * of `repo-utils.ts#rateLimitedFetch` but accepts method + body so the
 * existing helper does not need to be extended in Phase A.
 *
 * Honours `Retry-After` (seconds). After `MAX_RATE_LIMIT_RETRIES`
 * consecutive 429 responses throws `RateLimitExceededError`.
 */
async function adoRequest(
  url: string,
  pat: string,
  init?: { method?: string; body?: string },
  retryCount: number = 0,
): Promise<Response> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: adoHeaders(pat),
    body: init?.body,
  });

  if (res.status === 429) {
    if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
      throw new RateLimitExceededError(
        `Azure DevOps rate limit hit and ${MAX_RATE_LIMIT_RETRIES} retries exhausted: ${url}`,
      );
    }
    const retryAfterHeader = res.headers.get("Retry-After");
    let waitSec = 5;
    if (retryAfterHeader && /^\d+$/.test(retryAfterHeader)) {
      waitSec = Math.max(parseInt(retryAfterHeader, 10), 1);
    }
    const waitMs = Math.min(waitSec * 1000, 60_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return adoRequest(url, pat, init, retryCount + 1);
  }
  return res;
}

/** Predicate identifying an ADO divergence error from the response body. */
function isDivergenceError(body: DevOpsErrorBody): boolean {
  if (body.typeKey === "GitRefUpdateNeedsForcePermissionException") return true;
  if (body.typeKey === "GitRefUpdateRejectedByPolicyException") return true;
  const msg = (body.message ?? "").toLowerCase();
  return msg.includes("oldobjectid did not match");
}

/**
 * Translate a non-2xx response to a typed `ReverseGitError`. Centralises
 * the ADO status / typeKey taxonomy from research §13.
 */
async function mapErrorResponse(
  res: Response,
  defaultMessage: string,
  context: { branch?: string; oldSha?: string } = {},
): Promise<
  | DevOpsApiError
  | InvalidPATError
  | InsufficientScopesError
  | PayloadTooLargeError
  | RemoteDivergedError
  | RepoNotFoundError
> {
  const body = await safeJson(res);
  const message = body.message ?? defaultMessage;
  const typeKey = body.typeKey;

  if (res.status === 401 || typeKey === "UnauthorizedException") {
    return new InvalidPATError(
      `Azure DevOps: ${message}. The PAT is missing, expired, or malformed.`,
    );
  }
  if (
    res.status === 403 ||
    typeKey === "UnauthorizedRequestException"
  ) {
    return new InsufficientScopesError(
      `Azure DevOps: ${message}. The PAT lacks the required scope ` +
        `(need 'vso.code_write' for pushes; 'vso.code_manage' to create repos).`,
    );
  }
  if (res.status === 404 || typeKey === "GitRepositoryNotFoundException") {
    return new RepoNotFoundError(
      `Azure DevOps: ${message} (status 404).`,
    );
  }
  if (res.status === 413 || typeKey === "GitPushTooLargeException") {
    return new PayloadTooLargeError(
      `Azure DevOps push exceeded the 5 GB payload cap: ${message}`,
    );
  }
  if (res.status === 400 && isDivergenceError(body)) {
    return new RemoteDivergedError(
      context.oldSha ?? "(unknown)",
      "(unknown — fetch remote tip to compare)",
      `Azure DevOps: ${message}. Re-run with --allow-overwrite-remote to force-push (destructive).`,
    );
  }
  return new DevOpsApiError(res.status, typeKey, message);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse `(org, project, repo)` from an Azure DevOps URL. Supports both
 * `dev.azure.com/{org}/{project}/_git/{repo}` and the legacy
 * `{org}.visualstudio.com/{project}/_git/{repo}` forms.
 */
export function parseDevOpsRepoUrl(repoUrl: string): {
  org: string;
  project: string;
  repo: string;
} {
  let match = repoUrl.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/,
  );
  if (match) {
    return {
      org: decodeURIComponent(match[1]),
      project: decodeURIComponent(match[2]),
      repo: decodeURIComponent(match[3]),
    };
  }
  match = repoUrl.match(
    /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?#]+)/,
  );
  if (match) {
    return {
      org: decodeURIComponent(match[1]),
      project: decodeURIComponent(match[2]),
      repo: decodeURIComponent(match[3]),
    };
  }
  throw new Error(`Invalid Azure DevOps repo URL: ${repoUrl}`);
}

/** Ensure a path is prefixed with a single leading slash (research §2). */
function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

// ===========================================================================
// DevOpsWriteClient
// ===========================================================================

/**
 * Write-side companion to `DevOpsClient`. Implements `RepoWriteClient`
 * via the `POST /git/pushes` single-shot push API. One instance is
 * bound to a single `(org, project, repo)` triple. The engine
 * constructs a fresh client per reverse-link push.
 */
export class DevOpsWriteClient implements RepoWriteClient {
  private readonly pat: string;
  private readonly org: string;
  private readonly project: string;
  private readonly repoName: string;
  /** Resolved repository UUID. Populated lazily by `ensureRepo`. */
  private repoId: string | null = null;

  /**
   * @param pat       An Azure DevOps PAT with `vso.code_write` (for
   *                  pushes) or `vso.code_manage` (also for repo
   *                  creation).
   * @param org       Azure DevOps organization name.
   * @param project   Project name (will be URL-encoded). UUID also
   *                  accepted.
   * @param repoName  Repository name (NOT UUID — resolved at
   *                  `ensureRepo` time).
   */
  constructor(pat: string, org: string, project: string, repoName: string) {
    if (!pat) throw new Error("DevOpsWriteClient: missing PAT");
    if (!org) throw new Error("DevOpsWriteClient: missing org");
    if (!project) throw new Error("DevOpsWriteClient: missing project");
    if (!repoName) throw new Error("DevOpsWriteClient: missing repo name");
    this.pat = pat;
    this.org = org;
    this.project = project;
    this.repoName = repoName;
  }

  /**
   * Convenience constructor from a URL of the form
   * `https://dev.azure.com/{org}/{project}/_git/{repo}` or the legacy
   * `{org}.visualstudio.com/...`.
   */
  static fromRepoUrl(pat: string, repoUrl: string): DevOpsWriteClient {
    const { org, project, repo } = parseDevOpsRepoUrl(repoUrl);
    return new DevOpsWriteClient(pat, org, project, repo);
  }

  /** Return the resolved repository UUID; populate via `ensureRepo` first. */
  getRepoId(): string | null {
    return this.repoId;
  }

  // -------------------------------------------------------------------------
  // RepoWriteClient — primary API
  // -------------------------------------------------------------------------

  /**
   * Verify the repository exists; optionally create it. Sets the
   * internal `repoId` on success — every subsequent endpoint call uses
   * the UUID (safer than the name, which can be renamed mid-flight per
   * research §4).
   *
   * The `visibility` parameter is accepted for interface parity with
   * GitHub but ignored — ADO repository visibility is inherited from the
   * containing project (research §5).
   *
   * Throws `RepoNotFoundError` when the repo is absent AND
   * `createIfMissing` is false.
   */
  async ensureRepo(opts: {
    name: string;
    visibility: RepoVisibility;
    createIfMissing: boolean;
  }): Promise<void> {
    // `opts.visibility` is intentionally ignored on ADO (see JSDoc).
    void opts.visibility;
    // `opts.name` is informational; the constructor name is authoritative.
    void opts.name;

    const encodedProject = encodeURIComponent(this.project);
    const baseUrl =
      `https://dev.azure.com/${this.org}/${encodedProject}` +
      `/_apis/git/repositories`;

    // 1. GET the repo by name.
    const getRes = await adoRequest(
      `${baseUrl}/${encodeURIComponent(this.repoName)}?api-version=${ADO_API_VERSION}`,
      this.pat,
    );

    if (getRes.ok) {
      const data = (await getRes.json()) as { id?: string };
      if (!data.id) {
        throw new DevOpsApiError(
          200,
          undefined,
          `ADO repo lookup returned no id for ${this.repoName}`,
        );
      }
      this.repoId = data.id;
      return;
    }

    if (getRes.status === 404) {
      if (!opts.createIfMissing) {
        throw new RepoNotFoundError(
          `Azure DevOps repository "${this.repoName}" not found in project ` +
            `"${this.project}" (org "${this.org}"). Re-run with ` +
            `--create-repo to create it (requires PAT scope vso.code_manage).`,
        );
      }
      this.repoId = await this.createRepo();
      return;
    }

    throw await mapErrorResponse(
      getRes,
      `Unexpected status looking up repository ${this.repoName}`,
    );
  }

  /**
   * Read the tip commit SHA of `branch`. Returns `null` when the branch
   * does not exist (empty repo or branch never created). ADO does not
   * expose a tree SHA on the refs endpoint — `treeSha` is always
   * `null` (the engine layer never relies on it for ADO; see design
   * §5.6 and the `RepoWriteClient.getBranchTip` contract).
   */
  async getBranchTip(
    branch: string,
  ): Promise<{ commitSha: string; treeSha: string | null } | null> {
    const repoId = this.requireRepoId();
    const encodedProject = encodeURIComponent(this.project);
    const filter = encodeURIComponent(`heads/${branch}`);
    const url =
      `https://dev.azure.com/${this.org}/${encodedProject}` +
      `/_apis/git/repositories/${repoId}/refs` +
      `?filter=${filter}&api-version=${ADO_API_VERSION}`;

    const res = await adoRequest(url, this.pat);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw await mapErrorResponse(
        res,
        `Failed to read refs for branch ${branch}`,
      );
    }
    const data = (await res.json()) as {
      value: Array<{ name: string; objectId: string }>;
    };
    const ref = data.value.find((r) => r.name === `refs/heads/${branch}`);
    if (!ref) return null;
    return { commitSha: ref.objectId, treeSha: null };
  }

  /**
   * Build one commit from `changes` and advance `branch`. Implements
   * design §5.4 / §5.6:
   *
   *   1. Resolve `oldSha` — either the passed `parentCommitSha` (when
   *      non-null) or 40 hex zeros (empty repo).
   *   2. If `changes.length > ADO_PUSH_CHUNK_SIZE`, fan out into
   *      sequential chunked pushes (each chained via the just-pushed
   *      `newObjectId`). See research §18.
   *   3. Otherwise build a single push payload with `refUpdates`,
   *      `commits[0]`, and inline `changes[]` (every byte payload
   *      base64-encoded per design §5.10).
   *   4. POST `/git/pushes`. Map 400 + GitRefUpdateNeedsForcePermissionException
   *      to `RemoteDivergedError`.
   *
   * Notes:
   *  - ADO has no per-file 422 equivalent for blob size — oversize files
   *    fail the entire push with HTTP 413. The engine should filter
   *    files exceeding the per-file cap before invoking this method.
   *    `perFileErrors` is therefore always empty for this provider.
   *  - `allowForce` does not change the request shape — instead the
   *    engine resolves it by setting `parentCommitSha` to the current
   *    remote tip (bypassing the divergence check). The flag is
   *    accepted here purely for interface parity.
   *  - The `add` vs `edit` classification is the engine's responsibility
   *    (research §17 / D-16). This client trusts the `RepoChange.kind`
   *    discriminant verbatim.
   */
  async createCommit(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult> {
    const { branch, parentCommitSha, message, author, changes } = input;
    void input.allowForce; // see JSDoc — accepted but the engine controls it.

    if (changes.length === 0) {
      // Mirrors the GitHub client behaviour — return a no-op result; the
      // engine treats this as `pushed: false`.
      return {
        commitSha: parentCommitSha ?? "",
        treeSha: null,
        perFileErrors: [],
      };
    }

    const oldSha = parentCommitSha ?? ZERO_OBJECT_ID;

    let lastResult: { commitId: string; treeId: string | null } | null = null;

    if (changes.length <= ADO_PUSH_CHUNK_SIZE) {
      lastResult = await this.pushOnce(branch, oldSha, message, author, changes);
    } else {
      // Chunked push — chain successive commits via the returned commitId.
      let currentOldSha = oldSha;
      const totalChunks = Math.ceil(changes.length / ADO_PUSH_CHUNK_SIZE);
      let chunkIdx = 0;
      for (let i = 0; i < changes.length; i += ADO_PUSH_CHUNK_SIZE) {
        const chunk = changes.slice(i, i + ADO_PUSH_CHUNK_SIZE);
        chunkIdx += 1;
        const chunkMessage = `${message} (part ${chunkIdx}/${totalChunks})`;
        lastResult = await this.pushOnce(
          branch,
          currentOldSha,
          chunkMessage,
          author,
          chunk,
        );
        currentOldSha = lastResult.commitId;
      }
    }

    if (lastResult === null) {
      // Defensive: pushOnce always returns a non-null result above.
      throw new DevOpsApiError(
        500,
        undefined,
        "Internal error: ADO push completed with no result",
      );
    }
    return {
      commitSha: lastResult.commitId,
      treeSha: lastResult.treeId,
      perFileErrors: [],
    };
  }

  // -------------------------------------------------------------------------
  // RepoWriteClient — convenience helpers
  // -------------------------------------------------------------------------

  /** Alias for `ensureRepo`. */
  async getOrCreateRepo(opts: {
    name: string;
    visibility: RepoVisibility;
    createIfMissing: boolean;
  }): Promise<void> {
    return this.ensureRepo(opts);
  }

  /** Synonym for `getBranchTip().commitSha` — `null` when branch absent. */
  async getCurrentRefSha(branch: string): Promise<string | null> {
    const tip = await this.getBranchTip(branch);
    return tip?.commitSha ?? null;
  }

  /**
   * List existing file paths on `branch`. Uses
   * `GET /items?recursionLevel=Full`. Returns `[]` when the branch /
   * repo is empty (404 from the items endpoint, research §11).
   */
  async listRepoFiles(branch: string): Promise<string[]> {
    const repoId = this.requireRepoId();
    const encodedProject = encodeURIComponent(this.project);
    const url =
      `https://dev.azure.com/${this.org}/${encodedProject}` +
      `/_apis/git/repositories/${repoId}/items` +
      `?recursionLevel=Full` +
      `&versionDescriptor.version=${encodeURIComponent(branch)}` +
      `&api-version=${ADO_API_VERSION}`;

    const res = await adoRequest(url, this.pat);
    if (res.status === 404) return [];
    if (!res.ok) {
      throw await mapErrorResponse(
        res,
        `Failed to list files on branch ${branch}`,
      );
    }
    const data = (await res.json()) as {
      value: Array<{ path: string; gitObjectType: string }>;
    };
    return data.value
      .filter((v) => v.gitObjectType === "blob")
      .map((v) => (v.path.startsWith("/") ? v.path.slice(1) : v.path));
  }

  /** Provider-neutral alias for `createCommit`. */
  async pushChanges(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult> {
    return this.createCommit(input);
  }

  /**
   * No-op for ADO. The `RepoWriteClient` contract requires this method
   * because GitHub needs to materialise an init commit before the Git
   * Data API becomes usable. ADO has no equivalent — the very first
   * push uses `oldObjectId = "0"×40` to atomically create the branch
   * and root commit (research §3). The engine should call this method
   * unconditionally for both providers.
   */
  async bootstrapEmpty(_branch: string): Promise<void> {
    void _branch;
    return;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Throw if `ensureRepo` has not been called yet. */
  private requireRepoId(): string {
    if (this.repoId === null) {
      throw new DevOpsApiError(
        500,
        undefined,
        "DevOpsWriteClient: repoId not resolved — call ensureRepo() first.",
      );
    }
    return this.repoId;
  }

  /**
   * Create the repository. Requires resolving the project UUID first
   * (research §5: `project.id` is mandatory in the create body).
   */
  private async createRepo(): Promise<string> {
    const encodedProject = encodeURIComponent(this.project);
    // 1. Look up the project UUID.
    const projUrl =
      `https://dev.azure.com/${this.org}/_apis/projects/` +
      `${encodedProject}?api-version=${ADO_API_VERSION}`;
    const projRes = await adoRequest(projUrl, this.pat);
    if (!projRes.ok) {
      throw await mapErrorResponse(
        projRes,
        `Failed to look up project "${this.project}"`,
      );
    }
    const proj = (await projRes.json()) as { id?: string };
    if (!proj.id) {
      throw new DevOpsApiError(
        500,
        undefined,
        `ADO project lookup for "${this.project}" returned no id`,
      );
    }

    // 2. POST the new repository.
    const createUrl =
      `https://dev.azure.com/${this.org}/${encodedProject}` +
      `/_apis/git/repositories?api-version=${ADO_API_VERSION}`;
    const body = JSON.stringify({
      name: this.repoName,
      project: { id: proj.id },
    });
    const createRes = await adoRequest(createUrl, this.pat, {
      method: "POST",
      body,
    });
    if (!createRes.ok) {
      throw await mapErrorResponse(
        createRes,
        `Failed to create repository "${this.repoName}"`,
      );
    }
    const created = (await createRes.json()) as { id?: string };
    if (!created.id) {
      throw new DevOpsApiError(
        201,
        undefined,
        `ADO repo creation response missing id for "${this.repoName}"`,
      );
    }
    return created.id;
  }

  /**
   * Issue a single `POST /git/pushes` for one chunk of changes. Returns
   * the new commit SHA and tree SHA from the server response (research
   * §1 — `commits[0].commitId` / `commits[0].treeId`).
   */
  private async pushOnce(
    branch: string,
    oldSha: string,
    message: string,
    author: { name: string; email: string },
    changes: RepoChange[],
  ): Promise<{ commitId: string; treeId: string | null }> {
    const repoId = this.requireRepoId();
    const encodedProject = encodeURIComponent(this.project);
    const url =
      `https://dev.azure.com/${this.org}/${encodedProject}` +
      `/_apis/git/repositories/${repoId}/pushes` +
      `?api-version=${ADO_API_VERSION}`;

    const now = new Date().toISOString();
    const changeEntries = changes.map((c) => this.changeToAdoEntry(c));

    const payload = {
      refUpdates: [
        { name: `refs/heads/${branch}`, oldObjectId: oldSha },
      ],
      commits: [
        {
          comment: message,
          author: { name: author.name, email: author.email, date: now },
          committer: { name: author.name, email: author.email, date: now },
          changes: changeEntries,
        },
      ],
    };

    const res = await adoRequest(url, this.pat, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        commits?: Array<{ commitId?: string; treeId?: string }>;
      };
      const commit = data.commits?.[0];
      if (!commit?.commitId) {
        throw new DevOpsApiError(
          res.status,
          undefined,
          "ADO push response missing commits[0].commitId",
        );
      }
      return {
        commitId: commit.commitId,
        treeId: commit.treeId ?? null,
      };
    }

    throw await mapErrorResponse(
      res,
      `Push failed against branch ${branch}`,
      { branch, oldSha },
    );
  }

  /**
   * Translate one provider-neutral `RepoChange` into the ADO
   * `changes[]` entry shape (research §2). All non-delete content is
   * sent as `base64encoded` per design §5.10.
   */
  private changeToAdoEntry(change: RepoChange): Record<string, unknown> {
    const path = ensureLeadingSlash(change.path);
    if (change.kind === "delete") {
      return {
        changeType: "delete",
        item: { path },
      };
    }
    // `add` and `edit` share the same payload shape; only `changeType`
    // differs. The engine guarantees the correct discriminant (D-16).
    const changeType = change.kind === "add" ? "add" : "edit";
    return {
      changeType,
      item: { path },
      newContent: {
        content: Buffer.from(change.contentBytes).toString("base64"),
        contentType: "base64encoded",
      },
    };
  }
}
