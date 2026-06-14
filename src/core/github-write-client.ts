// ===========================================================================
// src/core/github-write-client.ts
//
// GitHubWriteClient — implements the provider-agnostic RepoWriteClient
// contract (see src/core/reverse-git-types.ts) on top of the GitHub Git
// Data API using raw `fetch`. No `@octokit/rest`, no other runtime
// dependency. Phase A of the reverse-git plan.
//
// Source of truth for endpoint sequences and payload shapes:
//   docs/research/github-git-data-api.md
//     §3  Canonical "add many files in one commit" sequence
//     §4  Endpoint reference (blobs / trees / commits / refs)
//     §5  File modes and tree object semantics
//     §6  Binary file handling (always base64)
//     §7  Bootstrapping an empty repository (auto_init + .gitkeep fallback)
//     §8  Repository auto-creation
//     §9  Detecting an empty repository
//     §10 Divergence detection (PATCH /git/refs 422)
//     §11 Large-tree chunking (TREE_CHUNK_SIZE = 700, base_tree chained)
//     §12 Rate limits (concurrent uploads capped at 10, 100 ms inter-batch)
//     §13 Error response shapes
//     §15 Implementation-ready TypeScript code shapes (followed closely)
//
// Phase A decisions made by this file (not pre-described in the research):
//   - The existing rateLimitedFetch in repo-utils.ts is GET-only (URL +
//     headers + retryCount). To keep Phase A from touching repo-utils.ts
//     (out-of-scope per plan-011 §Phase A), this file implements a local
//     `ghRequest` helper that mirrors rateLimitedFetch's 403/429 retry
//     semantics but accepts method + body for POST / PATCH / PUT.
//   - When `ensureRepo` creates the repo with `auto_init: true`, the new
//     init README ends up at the root and is inherited via `base_tree` on
//     subsequent pushes. The design (§5.3) does NOT delete it; the user
//     can overwrite it by pushing their own README.md.
// ===========================================================================

import {
  RepoWriteClient,
  RepoWriteClientCommitInput,
  RepoWriteClientCommitResult,
  RepoChange,
  RepoVisibility,
} from "./reverse-git-types.js";
import {
  GitHubApiError,
  GitHubBlobTooLargeError,
  GitHubEmptyRepoError,
  InsufficientScopesError,
  InvalidPATError,
  RateLimitExceededError,
  RemoteDivergedError,
  RepoNotFoundError,
} from "./reverse-git-errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GitHub API base URL. */
const GITHUB_API_BASE = "https://api.github.com";

/**
 * Maximum number of tree entries per `POST /git/trees` call. Trees with
 * more entries are split into chunks chained via `base_tree`. See
 * github-git-data-api.md §11.
 */
const TREE_CHUNK_SIZE = 700;

/**
 * Concurrent blob uploads in-flight. Capped to keep below GitHub's
 * "80 content-creating requests per minute" secondary rate-limit
 * threshold. See github-git-data-api.md §12.
 */
const BLOB_UPLOAD_CONCURRENCY = 10;

/** Sleep between blob-upload batches (milliseconds). */
const BLOB_UPLOAD_INTER_BATCH_MS = 100;

/** Maximum retries on a 403/429 rate-limit response. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Standard file mode for every blob the reverse-git feature uploads. */
const BLOB_MODE = "100644" as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Standard request headers for the GitHub REST API. */
function ghHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/** Parsed GitHub error envelope. */
interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
  errors?: Array<{ resource?: string; field?: string; code?: string }>;
}

/** Parse the response body as JSON; return an empty object on failure. */
async function safeJson(res: Response): Promise<GitHubErrorBody> {
  try {
    return (await res.json()) as GitHubErrorBody;
  } catch {
    return {};
  }
}

/**
 * Rate-limit-aware fetch wrapper for write requests (POST / PATCH / PUT /
 * DELETE). Mirrors the retry semantics of
 * `repo-utils.ts#rateLimitedFetch` but accepts method + body so the
 * existing helper does not need to be extended in Phase A.
 *
 * Honours `Retry-After` (delta seconds) and `x-ratelimit-reset` (Unix
 * epoch). After `MAX_RATE_LIMIT_RETRIES` consecutive 403/429 responses
 * throws `RateLimitExceededError`.
 */
async function ghRequest(
  url: string,
  pat: string,
  init?: { method?: string; body?: string },
  retryCount: number = 0,
): Promise<Response> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: ghHeaders(pat),
    body: init?.body,
  });
  if (res.status === 403 || res.status === 429) {
    // Distinguish "real" rate-limit from "insufficient scope" 403 by
    // inspecting the error body. The caller (status-code switch) handles
    // the scope case AFTER we exit this wrapper — so only retry when the
    // response is a true rate-limit signal.
    const cloned = res.clone();
    const body = await safeJson(cloned);
    const msg = (body.message ?? "").toLowerCase();
    const isRateLimit =
      msg.includes("rate limit") ||
      msg.includes("abuse") ||
      msg.includes("secondary rate limit");

    if (isRateLimit) {
      if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
        throw new RateLimitExceededError(
          `GitHub rate limit hit and ${MAX_RATE_LIMIT_RETRIES} retries exhausted: ${url}`,
        );
      }
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const retryAfterHeader = res.headers.get("Retry-After");

      let waitSec = 5;
      if (retryAfterHeader && /^\d+$/.test(retryAfterHeader)) {
        waitSec = Math.max(parseInt(retryAfterHeader, 10), 1);
      } else if (resetHeader && /^\d+$/.test(resetHeader)) {
        waitSec = Math.max(
          parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000),
          1,
        );
      }
      const waitMs = Math.min(waitSec * 1000, 60_000);
      await new Promise((r) => setTimeout(r, waitMs));
      return ghRequest(url, pat, init, retryCount + 1);
    }
  }
  return res;
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate a non-2xx response to a typed `ReverseGitError`. Centralised
 * so every endpoint surfaces the same taxonomy. Caller should `throw`
 * the result.
 */
async function mapErrorResponse(
  res: Response,
  defaultMessage: string,
): Promise<GitHubApiError | InvalidPATError | InsufficientScopesError> {
  const body = await safeJson(res);
  const message = body.message ?? defaultMessage;

  if (res.status === 401) {
    return new InvalidPATError(
      `GitHub: ${message}. The PAT is missing, expired, or malformed.`,
    );
  }
  if (res.status === 403) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("secondary rate limit")) {
      // Shouldn't reach here — ghRequest retries — but defend in depth.
      return new GitHubApiError(403, message);
    }
    return new InsufficientScopesError(
      `GitHub: ${message}. The PAT lacks the required scope (need 'repo' classic or 'Contents: Read & Write' fine-grained).`,
    );
  }
  return new GitHubApiError(res.status, message);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse `owner/repo` from a GitHub URL or a bare `owner/repo` string.
 * Accepts:
 *   - `https://github.com/owner/repo`
 *   - `https://github.com/owner/repo.git`
 *   - `git@github.com:owner/repo.git`
 *   - `owner/repo`
 */
export function parseGitHubRepoUrl(repoUrl: string): {
  owner: string;
  repo: string;
} {
  // Match against the full URL form first.
  const urlMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }
  // Bare "owner/repo" form.
  const bareMatch = repoUrl.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (bareMatch) {
    return { owner: bareMatch[1], repo: bareMatch[2].replace(/\.git$/, "") };
  }
  throw new Error(`Invalid GitHub repo URL or identifier: ${repoUrl}`);
}

// ---------------------------------------------------------------------------
// Tree-entry shape (internal — not exported on the public RepoWriteClient
// surface; consumers see only RepoChange).
// ---------------------------------------------------------------------------

interface TreeEntry {
  path: string;
  mode: typeof BLOB_MODE;
  type: "blob";
  /** `null` denotes deletion (requires `base_tree`). Otherwise blob SHA. */
  sha: string | null;
}

// ===========================================================================
// GitHubWriteClient
// ===========================================================================

/**
 * Write-side companion to `GitHubClient`. Implements `RepoWriteClient`
 * via the Git Data API. One instance is bound to a single
 * `(owner, repo)` pair — the engine constructs a fresh client per
 * reverse-link push.
 */
export class GitHubWriteClient implements RepoWriteClient {
  private readonly pat: string;
  private readonly owner: string;
  private readonly repo: string;

  /**
   * @param pat     A GitHub PAT with `repo` (classic) or `Contents:
   *                Read & Write` + `Administration: Read & Write` (fine-
   *                grained) scope. `Administration: Read & Write` is only
   *                needed when the client may auto-create the repo.
   * @param owner   GitHub account or organization that owns the repo.
   * @param repo    Repository name (without owner prefix, no `.git`).
   */
  constructor(pat: string, owner: string, repo: string) {
    if (!pat) throw new Error("GitHubWriteClient: missing PAT");
    if (!owner) throw new Error("GitHubWriteClient: missing owner");
    if (!repo) throw new Error("GitHubWriteClient: missing repo");
    this.pat = pat;
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Convenience constructor that derives `owner`/`repo` from a URL or
   * bare `owner/repo` string.
   */
  static fromRepoUrl(pat: string, repoUrl: string): GitHubWriteClient {
    const { owner, repo } = parseGitHubRepoUrl(repoUrl);
    return new GitHubWriteClient(pat, owner, repo);
  }

  // -------------------------------------------------------------------------
  // RepoWriteClient — primary API
  // -------------------------------------------------------------------------

  /**
   * Verify the repo exists; optionally create it. Always uses
   * `auto_init: true` on creation so the post-create state is "one
   * commit, one tree" — see github-git-data-api.md §7 / §8 / design §5.3.
   *
   * Throws `RepoNotFoundError` when the repo is absent and
   * `createIfMissing` is false. The 404 message text explicitly mentions
   * the GitHub-private-repo ambiguity (research §13).
   */
  async ensureRepo(opts: {
    name: string;
    visibility: RepoVisibility;
    createIfMissing: boolean;
  }): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}`;
    const res = await ghRequest(url, this.pat);

    if (res.status === 200) {
      // Repo already exists — done. We deliberately do NOT verify the
      // visibility matches `opts.visibility`: changing visibility on an
      // existing repo is out of scope for this feature.
      return;
    }

    if (res.status === 404) {
      if (!opts.createIfMissing) {
        throw new RepoNotFoundError(
          `Repository ${this.owner}/${this.repo} not found. ` +
            `Note: on GitHub a 404 means EITHER the repo does not exist OR ` +
            `the PAT lacks permission. Verify the repo name and PAT scope ` +
            `('repo' classic or 'Contents: Read & Write' fine-grained). ` +
            `Re-run with --create-repo to create the repository.`,
        );
      }
      await this.createRepo(opts);
      return;
    }

    if (res.status === 401) {
      const body = await safeJson(res);
      throw new InvalidPATError(
        `GitHub: ${body.message ?? "Bad credentials"} when looking up ${this.owner}/${this.repo}.`,
      );
    }
    if (res.status === 403) {
      const body = await safeJson(res);
      throw new InsufficientScopesError(
        `GitHub: ${body.message ?? "forbidden"} when looking up ${this.owner}/${this.repo}.`,
      );
    }
    throw await mapErrorResponse(
      res,
      `Unexpected status looking up ${this.owner}/${this.repo}`,
    );
  }

  /**
   * Read the tip commit + tree of `branch`. Returns `null` when the
   * branch is absent — that signals an empty repo OR a never-created
   * branch (see github-git-data-api.md §9).
   */
  async getBranchTip(
    branch: string,
  ): Promise<{ commitSha: string; treeSha: string | null } | null> {
    const refUrl = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/ref/heads/${encodeURIComponent(branch)}`;
    const refRes = await ghRequest(refUrl, this.pat);

    if (refRes.status === 404 || refRes.status === 409) {
      // 404: branch absent. 409: repo empty / unavailable. Either way:
      // signal "no tip" to the engine.
      return null;
    }
    if (!refRes.ok) {
      throw await mapErrorResponse(
        refRes,
        `Failed to read ref refs/heads/${branch}`,
      );
    }

    const refData = (await refRes.json()) as { object?: { sha?: string } };
    const commitSha = refData.object?.sha;
    if (!commitSha) {
      throw new GitHubApiError(
        500,
        `GitHub ref response for ${branch} missing object.sha`,
      );
    }

    // Resolve the tree SHA from the commit.
    const commitUrl = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/commits/${commitSha}`;
    const commitRes = await ghRequest(commitUrl, this.pat);
    if (!commitRes.ok) {
      throw await mapErrorResponse(
        commitRes,
        `Failed to read commit ${commitSha}`,
      );
    }
    const commitData = (await commitRes.json()) as {
      tree?: { sha?: string };
    };
    return {
      commitSha,
      treeSha: commitData.tree?.sha ?? null,
    };
  }

  /**
   * Build one commit from `changes` and advance `branch`. Implements
   * design §5.3 / §5.5:
   *
   *   1. Upload blobs for every add/edit change (concurrency 10).
   *   2. Build tree entries (deletes become `sha: null`; requires
   *      `base_tree`).
   *   3. Chunked tree creation, chaining via `base_tree`.
   *   4. Create the commit.
   *   5. PATCH the ref (or POST it if branch did not exist).
   *
   * Per-file 422 "blob too large" errors are accumulated in
   * `perFileErrors` and the offending entry is dropped from the tree —
   * the push proceeds. All other errors propagate.
   *
   * Divergence is signalled by `PATCH /git/refs` returning 422 "Update
   * is not a fast forward" (mapped to `RemoteDivergedError`).
   */
  async createCommit(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult> {
    const { branch, parentCommitSha, parentTreeSha, message, author, changes } =
      input;
    const allowForce = input.allowForce === true;
    const perFileErrors: Array<{ path: string; reason: string }> = [];

    // ----- 1. Blob upload --------------------------------------------------
    const addOrEdit = changes.filter(
      (c): c is Extract<RepoChange, { kind: "add" | "edit" }> =>
        c.kind === "add" || c.kind === "edit",
    );
    const blobShaByPath = new Map<string, string>();

    for (let i = 0; i < addOrEdit.length; i += BLOB_UPLOAD_CONCURRENCY) {
      const batch = addOrEdit.slice(i, i + BLOB_UPLOAD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((change) => this.uploadBlob(change.contentBytes)),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const change = batch[j];
        if (result.status === "fulfilled") {
          blobShaByPath.set(change.path, result.value);
        } else if (result.reason instanceof GitHubBlobTooLargeError) {
          perFileErrors.push({
            path: change.path,
            reason: (result.reason as Error).message,
          });
        } else {
          throw result.reason;
        }
      }
      if (i + BLOB_UPLOAD_CONCURRENCY < addOrEdit.length) {
        await sleep(BLOB_UPLOAD_INTER_BATCH_MS);
      }
    }

    // ----- 2. Tree entries -------------------------------------------------
    const treeEntries: TreeEntry[] = [];
    for (const change of changes) {
      if (change.kind === "delete") {
        treeEntries.push({
          path: change.path,
          mode: BLOB_MODE,
          type: "blob",
          sha: null,
        });
        continue;
      }
      const sha = blobShaByPath.get(change.path);
      if (!sha) continue; // dropped due to per-file 422 — already in perFileErrors
      treeEntries.push({
        path: change.path,
        mode: BLOB_MODE,
        type: "blob",
        sha,
      });
    }

    // If absolutely nothing to commit (all blobs failed AND there were no
    // delete entries), return early — the caller will treat this as
    // pushed=false at the engine layer.
    if (treeEntries.length === 0) {
      return {
        commitSha: parentCommitSha ?? "",
        treeSha: parentTreeSha,
        perFileErrors,
      };
    }

    // ----- 3. Tree (chunked) ----------------------------------------------
    const newTreeSha = await this.createTreeChunked(
      parentTreeSha,
      treeEntries,
    );

    // ----- 4. Commit -------------------------------------------------------
    const parents = parentCommitSha ? [parentCommitSha] : [];
    const newCommitSha = await this.createCommitObject(
      message,
      newTreeSha,
      parents,
      author,
    );

    // ----- 5. Ref update ---------------------------------------------------
    // If the branch did not exist before this push (`parentCommitSha` is
    // null AND the branch is absent — i.e. a true root-commit scenario),
    // POST a new ref. Otherwise PATCH the existing ref.
    const tip = await this.getBranchTip(branch);
    if (tip === null) {
      await this.createRef(branch, newCommitSha);
    } else {
      await this.updateRef(branch, newCommitSha, allowForce);
    }

    return {
      commitSha: newCommitSha,
      treeSha: newTreeSha,
      perFileErrors,
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
   * `GET /git/trees/{branch}?recursive=1`. Throws if GitHub truncates
   * the response (the caller should use a sub-path scope instead).
   * Returns `[]` when the branch / repo is empty.
   */
  async listRepoFiles(branch: string): Promise<string[]> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const res = await ghRequest(url, this.pat);
    if (res.status === 404 || res.status === 409) {
      return [];
    }
    if (!res.ok) {
      throw await mapErrorResponse(res, `Failed to list files on ${branch}`);
    }
    const data = (await res.json()) as {
      tree: Array<{ path: string; type: string }>;
      truncated: boolean;
    };
    if (data.truncated) {
      throw new GitHubApiError(
        200,
        `GitHub tree for ${this.owner}/${this.repo}@${branch} was truncated (>100k entries or >7MB). ` +
          `Use a narrower repo-path / scope.`,
      );
    }
    return data.tree.filter((t) => t.type === "blob").map((t) => t.path);
  }

  /** Provider-neutral alias for `createCommit`. */
  async pushChanges(
    input: RepoWriteClientCommitInput,
  ): Promise<RepoWriteClientCommitResult> {
    return this.createCommit(input);
  }

  /**
   * Bootstrap an empty repository so the Git Data API becomes usable.
   *
   * - Path A (preferred): the repo was created with `auto_init: true` —
   *   `getBranchTip()` already returns the init commit; this method is a
   *   no-op.
   * - Path B (fallback): the repo was created externally with
   *   `auto_init: false` — PUT a `.gitkeep` via the Contents API.
   *   See github-git-data-api.md §7 "Strategy B".
   *
   * After this call returns, `getBranchTip(branch)` is guaranteed to
   * return a non-null tip OR an error is thrown.
   */
  async bootstrapEmpty(branch: string): Promise<void> {
    const tip = await this.getBranchTip(branch);
    if (tip !== null) {
      // Already bootstrapped (auto_init path).
      return;
    }
    // Strategy B fallback: PUT /repos/{o}/{r}/contents/.gitkeep
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/contents/.gitkeep`;
    const res = await ghRequest(url, this.pat, {
      method: "PUT",
      body: JSON.stringify({
        message: "Initialize repository (storage-nav bootstrap)",
        content: "", // empty base64 → empty file
        branch,
      }),
    });
    if (!res.ok) {
      throw await mapErrorResponse(
        res,
        `Failed to bootstrap empty repo ${this.owner}/${this.repo}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal endpoint wrappers
  // -------------------------------------------------------------------------

  /**
   * `POST /user/repos` (or `/orgs/{org}/repos`) with `auto_init: true`.
   * Detects user-vs-org by checking the authenticated user against the
   * `owner` field — if they differ, the call is routed to `/orgs`.
   */
  private async createRepo(opts: {
    visibility: RepoVisibility;
    name: string;
  }): Promise<void> {
    const meRes = await ghRequest(`${GITHUB_API_BASE}/user`, this.pat);
    let useOrgEndpoint = false;
    if (meRes.ok) {
      const me = (await meRes.json()) as { login?: string };
      if (
        me.login &&
        me.login.toLowerCase() !== this.owner.toLowerCase()
      ) {
        useOrgEndpoint = true;
      }
    } else if (meRes.status === 401) {
      throw new InvalidPATError(
        `GitHub: Bad credentials when calling /user — PAT is invalid or lacks 'read:user' scope.`,
      );
    }

    const url = useOrgEndpoint
      ? `${GITHUB_API_BASE}/orgs/${this.owner}/repos`
      : `${GITHUB_API_BASE}/user/repos`;

    const body = JSON.stringify({
      name: this.repo,
      private: opts.visibility === "private",
      auto_init: true,
      default_branch: "main",
      description: "Created by storage-nav reverse-git publication",
    });

    const res = await ghRequest(url, this.pat, { method: "POST", body });
    if (res.status === 201) {
      return;
    }
    if (res.status === 422) {
      const errBody = await safeJson(res);
      throw new GitHubApiError(
        422,
        `Repository creation rejected: ${errBody.message ?? "validation error"}`,
      );
    }
    throw await mapErrorResponse(
      res,
      `Failed to create repository ${this.owner}/${this.repo}`,
    );
  }

  /**
   * `POST /git/blobs` — upload one blob as base64. Returns the blob SHA.
   *
   * Per design §5.10, every blob is base64-encoded — safe for binary and
   * text alike.
   *
   * Maps:
   *   - 422 "file too large" → `GitHubBlobTooLargeError` (per-file,
   *                             non-fatal).
   *   - 409 → `GitHubEmptyRepoError` (caller should bootstrap then retry).
   *   - 404 → `GitHubApiError(404, ...)` (ambiguous on private repos).
   */
  private async uploadBlob(contentBytes: Uint8Array): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/blobs`;
    const body = JSON.stringify({
      content: Buffer.from(contentBytes).toString("base64"),
      encoding: "base64",
    });
    const res = await ghRequest(url, this.pat, { method: "POST", body });

    if (res.status === 201) {
      const data = (await res.json()) as { sha?: string };
      if (!data.sha) {
        throw new GitHubApiError(201, "Blob POST response missing sha");
      }
      return data.sha;
    }

    const errBody = await safeJson(res);
    const msg = (errBody.message ?? "").toLowerCase();

    if (res.status === 422) {
      const tooLarge =
        msg.includes("too large") ||
        msg.includes("file too large") ||
        (errBody.errors ?? []).some(
          (e) => (e.code ?? "").toLowerCase() === "too_large",
        );
      if (tooLarge) {
        throw new GitHubBlobTooLargeError(
          `Blob exceeds GitHub size limit (size=${contentBytes.length} bytes)`,
        );
      }
      throw new GitHubApiError(422, errBody.message ?? "Validation failed");
    }
    if (res.status === 409) {
      throw new GitHubEmptyRepoError(
        `Repository ${this.owner}/${this.repo} is empty — bootstrap required before uploading blobs.`,
      );
    }
    if (res.status === 404) {
      throw new GitHubApiError(
        404,
        `Repository ${this.owner}/${this.repo} not found OR PAT lacks permission (private-repo 404 ambiguity).`,
      );
    }
    throw await mapErrorResponse(res, "Failed to upload blob");
  }

  /**
   * `POST /git/trees` for a single chunk. Use `createTreeChunked` for
   * collections larger than `TREE_CHUNK_SIZE` entries.
   */
  private async createTree(
    baseTreeSha: string | null,
    entries: TreeEntry[],
  ): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/trees`;
    const bodyObj: Record<string, unknown> = { tree: entries };
    if (baseTreeSha !== null) {
      bodyObj.base_tree = baseTreeSha;
    }
    const res = await ghRequest(url, this.pat, {
      method: "POST",
      body: JSON.stringify(bodyObj),
    });
    if (res.status === 201) {
      const data = (await res.json()) as { sha?: string };
      if (!data.sha) {
        throw new GitHubApiError(201, "Tree POST response missing sha");
      }
      return data.sha;
    }
    if (res.status === 409) {
      throw new GitHubEmptyRepoError(
        `Repository ${this.owner}/${this.repo} is empty — bootstrap required before creating trees.`,
      );
    }
    throw await mapErrorResponse(res, "Failed to create tree");
  }

  /**
   * Chunked tree creation per github-git-data-api.md §11.
   * Splits entries into chunks of `TREE_CHUNK_SIZE`, chaining via
   * `base_tree`. Returns the final tree SHA.
   *
   * @param baseTreeSha  Initial base — typically the tip's tree SHA.
   *                     `null` for a root commit on a brand-new repo
   *                     (though Strategy A almost always supplies one).
   */
  private async createTreeChunked(
    baseTreeSha: string | null,
    entries: TreeEntry[],
  ): Promise<string> {
    if (entries.length === 0) {
      if (baseTreeSha === null) {
        throw new Error(
          "createTreeChunked: cannot build a tree from zero entries with no base_tree",
        );
      }
      return baseTreeSha;
    }
    let currentBase = baseTreeSha;
    for (let i = 0; i < entries.length; i += TREE_CHUNK_SIZE) {
      const chunk = entries.slice(i, i + TREE_CHUNK_SIZE);
      currentBase = await this.createTree(currentBase, chunk);
    }
    // currentBase is guaranteed non-null because entries.length > 0 and
    // createTree always returns a non-null sha.
    return currentBase as string;
  }

  /** `POST /git/commits`. Returns the commit SHA. */
  private async createCommitObject(
    message: string,
    treeSha: string,
    parents: string[],
    author: { name: string; email: string },
  ): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/commits`;
    const date = new Date().toISOString();
    const bodyObj: Record<string, unknown> = {
      message,
      tree: treeSha,
      parents,
      author: { name: author.name, email: author.email, date },
      committer: { name: author.name, email: author.email, date },
    };
    const res = await ghRequest(url, this.pat, {
      method: "POST",
      body: JSON.stringify(bodyObj),
    });
    if (res.status === 201) {
      const data = (await res.json()) as { sha?: string };
      if (!data.sha) {
        throw new GitHubApiError(201, "Commit POST response missing sha");
      }
      return data.sha;
    }
    throw await mapErrorResponse(res, "Failed to create commit");
  }

  /**
   * `PATCH /git/refs/heads/{branch}`. Uses `force: true` only when the
   * caller passes `allowForce` (corresponds to the
   * `--allow-overwrite-remote` flag).
   *
   * Maps 422 "Update is not a fast forward" → `RemoteDivergedError`.
   */
  private async updateRef(
    branch: string,
    newCommitSha: string,
    force: boolean,
  ): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(branch)}`;
    const res = await ghRequest(url, this.pat, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitSha, force }),
    });
    if (res.status === 200) return;
    if (res.status === 422) {
      const errBody = await safeJson(res);
      const msg = errBody.message ?? "";
      if (msg.toLowerCase().includes("not a fast forward")) {
        // We don't know the actual remote SHA here — the engine layer
        // performs a getBranchTip() pre-check that produces the precise
        // SHAs. Surface the available context.
        throw new RemoteDivergedError(
          "(unknown — local snapshot)",
          "(unknown — see remote branch)",
          `Remote branch '${branch}' has diverged. ${msg}. ` +
            `Re-run with --allow-overwrite-remote to force-push (destructive).`,
        );
      }
      throw new GitHubApiError(422, msg);
    }
    throw await mapErrorResponse(res, `Failed to update ref heads/${branch}`);
  }

  /**
   * `POST /git/refs` — first-time creation of a branch ref. Called when
   * `getBranchTip` returns null after the bootstrap path (truly empty
   * repo at the moment of root-commit creation).
   *
   * Treats 422 "Reference already exists" as success (a concurrent push
   * created it; subsequent code paths converge).
   */
  private async createRef(branch: string, sha: string): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/git/refs`;
    const res = await ghRequest(url, this.pat, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    if (res.status === 201) return;
    if (res.status === 422) {
      const errBody = await safeJson(res);
      if ((errBody.message ?? "").toLowerCase().includes("already exists")) {
        return;
      }
      throw new GitHubApiError(
        422,
        errBody.message ?? "Reference creation failed",
      );
    }
    throw await mapErrorResponse(res, `Failed to create ref refs/heads/${branch}`);
  }
}
