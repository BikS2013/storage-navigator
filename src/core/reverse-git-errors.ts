// ===========================================================================
// src/core/reverse-git-errors.ts
// Typed error classes for the reverse-git feature.
//
// Each error carries:
//   - `code`        : stable machine-readable identifier
//   - `exitCode`    : CLI exit code (tri-state per plan-005 / R10.11)
//                       0 = success / no-op
//                       1 = changes pushed (or would be pushed in --dry-run)
//                       2 = fatal error
//                       3 = configuration error (missing required value)
//   - `httpStatus`  : HTTP status code surfaced by the server when the
//                       error escapes a handler
//
// All errors derive from `ReverseGitError` so callers can use a single
// `instanceof ReverseGitError` check and the `mapReverseGitErrorToHttp`
// helper to translate to an HTTP response.
//
// Source of truth: docs/design/project-design.md §"Typed errors".
// ===========================================================================

/**
 * Base class for every reverse-git typed error.
 *
 * Subclasses MUST override `code`, `exitCode`, and `httpStatus`.
 */
export abstract class ReverseGitError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: 0 | 1 | 2 | 3;
  abstract readonly httpStatus: number;

  constructor(message?: string) {
    super(message);
    // Preserve correct prototype chain when transpiled to ES5/ES2015.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

/**
 * Thrown by `ensureRepo` when the target repository does not exist and
 * `createIfMissing` is false. CLI exits 2; server returns 404.
 */
export class RepoNotFoundError extends ReverseGitError {
  readonly code = "REPO_NOT_FOUND";
  readonly exitCode = 2 as const;
  readonly httpStatus = 404;
}

/**
 * Thrown when the local `lastPushedCommitSha` disagrees with the current
 * remote branch tip, or when GitHub PATCH /git/refs returns 422 / ADO
 * POST /git/pushes returns 400 for divergence. CLI exits 2; server
 * returns 409.
 *
 * Carries both SHAs for diagnostic output.
 */
export class RemoteDivergedError extends ReverseGitError {
  readonly code = "REMOTE_DIVERGED";
  readonly exitCode = 2 as const;
  readonly httpStatus = 409;

  constructor(
    public readonly localKnownSha: string,
    public readonly remoteActualSha: string,
    message?: string,
  ) {
    super(
      message ??
        `Remote diverged (local=${localKnownSha} remote=${remoteActualSha})`,
    );
  }
}

/**
 * Thrown when the PAT lacks the OAuth scopes / permissions required for
 * the requested operation. CLI exits 2; server returns 403.
 */
export class InsufficientScopesError extends ReverseGitError {
  readonly code = "INSUFFICIENT_SCOPES";
  readonly exitCode = 2 as const;
  readonly httpStatus = 403;
}

/**
 * Thrown when the request body exceeds the provider's accepted payload
 * size (e.g., ADO 5 GB push limit). CLI exits 2; server returns 413.
 */
export class PayloadTooLargeError extends ReverseGitError {
  readonly code = "PAYLOAD_TOO_LARGE";
  readonly exitCode = 2 as const;
  readonly httpStatus = 413;
}

/**
 * Thrown after retries are exhausted on a persistent 429. CLI exits 2;
 * server returns 503.
 */
export class RateLimitExceededError extends ReverseGitError {
  readonly code = "RATE_LIMIT";
  readonly exitCode = 2 as const;
  readonly httpStatus = 503;
}

/**
 * Thrown on 401 / 403 from either provider when the PAT itself is
 * invalid (revoked, expired, malformed). CLI exits 2; server returns
 * 401.
 *
 * Aliased as `AuthenticationError` per the error taxonomy table.
 */
export class InvalidPATError extends ReverseGitError {
  readonly code = "INVALID_PAT";
  readonly exitCode = 2 as const;
  readonly httpStatus = 401;
}

/** Alias retained for taxonomy compatibility — see plan-011 error table. */
export { InvalidPATError as AuthenticationError };

/**
 * Catch-all for any GitHub API status not specifically classified above.
 * CLI exits 2; server returns 502.
 */
export class GitHubApiError extends ReverseGitError {
  readonly code: string = "GITHUB_API";
  readonly exitCode: 0 | 1 | 2 | 3 = 2 as const;
  readonly httpStatus: number = 502;

  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thrown when GitHub returns 409 on a Git Data API call because the
 * target repository is still empty (no initial commit). Specialisation
 * of `GitHubApiError`.
 */
export class GitHubEmptyRepoError extends GitHubApiError {
  override readonly code = "GITHUB_EMPTY_REPO";

  constructor(message: string) {
    super(409, message);
  }
}

/**
 * Thrown for per-file 422 "blob too large" responses from the Git Data
 * API. NOT fatal — accumulated into `PushResult.errors`. Exit code is
 * coerced to 1 so the parent push can still report partial progress.
 * httpStatus is intentionally 200 because the error never propagates as
 * a top-level HTTP failure.
 */
export class GitHubBlobTooLargeError extends GitHubApiError {
  override readonly code = "GITHUB_BLOB_TOO_LARGE";
  override readonly exitCode = 1 as const;
  override readonly httpStatus = 200;

  constructor(message: string) {
    super(422, message);
  }
}

/**
 * Catch-all for any Azure DevOps API status not specifically classified
 * above. CLI exits 2; server returns 502.
 *
 * `typeKey` is the ADO `typeKey` field from the error envelope when
 * present (e.g., `GitRefUpdateRejectedException`) — undefined when the
 * response did not include one.
 */
export class DevOpsApiError extends ReverseGitError {
  readonly code = "DEVOPS_API";
  readonly exitCode = 2 as const;
  readonly httpStatus = 502;

  constructor(
    public readonly status: number,
    public readonly typeKey: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thrown by the path-mapping step when two distinct storage paths map
 * to the same repo path (R5.5 default `abort` policy). CLI exits 2;
 * server returns 422.
 *
 * Carries the two colliding paths for diagnostic output.
 */
export class PathCollisionError extends ReverseGitError {
  readonly code = "PATH_COLLISION";
  readonly exitCode = 2 as const;
  readonly httpStatus = 422;

  constructor(public readonly collidingPaths: [string, string]) {
    super(
      `Storage paths collide when mapped to repo paths: ${collidingPaths.join(" vs ")}`,
    );
  }
}

/**
 * Thrown when a required configuration value is missing. Per the
 * project's `<structure-and-conventions>` no-fallback rule, every
 * missing config setting must raise this error rather than substitute a
 * default. CLI exits 3; server returns 400.
 */
export class ConfigurationError extends ReverseGitError {
  readonly code = "CONFIG_MISSING";
  readonly exitCode = 3 as const;
  readonly httpStatus = 400;
}

/**
 * Single source of truth for translating a thrown error into an HTTP
 * response envelope. Server handlers use this so the CLI ↔ HTTP mapping
 * stays consistent.
 *
 * Non-`ReverseGitError` instances are wrapped into a generic 500.
 */
export function mapReverseGitErrorToHttp(err: unknown): {
  status: number;
  body: { error: string; code?: string; details?: unknown };
} {
  if (err instanceof ReverseGitError) {
    return {
      status: err.httpStatus,
      body: { error: err.message, code: err.code },
    };
  }
  return {
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  };
}
