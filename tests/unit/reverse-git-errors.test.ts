// ===========================================================================
// tests/unit/reverse-git-errors.test.ts
// Tests for every typed error class in src/core/reverse-git-errors.ts,
// plus the mapReverseGitErrorToHttp helper.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import {
  ReverseGitError,
  RepoNotFoundError,
  RemoteDivergedError,
  InsufficientScopesError,
  PayloadTooLargeError,
  RateLimitExceededError,
  InvalidPATError,
  AuthenticationError,
  GitHubApiError,
  GitHubEmptyRepoError,
  GitHubBlobTooLargeError,
  DevOpsApiError,
  PathCollisionError,
  ConfigurationError,
  mapReverseGitErrorToHttp,
} from '../../src/core/reverse-git-errors.js';

// ---------------------------------------------------------------------------
// Helper: assert the common contract shared by every subclass
// ---------------------------------------------------------------------------

function assertReverseGitErrorShape(
  err: ReverseGitError,
  expectedCode: string,
  expectedExitCode: 0 | 1 | 2 | 3,
  expectedHttpStatus: number,
): void {
  expect(err).toBeInstanceOf(ReverseGitError);
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe(expectedCode);
  expect(err.exitCode).toBe(expectedExitCode);
  expect(err.httpStatus).toBe(expectedHttpStatus);
  // name must match the concrete class name (set by the base constructor via new.target.name)
  expect(err.name).toBe(err.constructor.name);
}

// ---------------------------------------------------------------------------
// Per-class shape tests
// ---------------------------------------------------------------------------

describe('RepoNotFoundError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new RepoNotFoundError('repo not found');
    assertReverseGitErrorShape(err, 'REPO_NOT_FOUND', 2, 404);
    expect(err.message).toBe('repo not found');
  });

  it('is instanceof ReverseGitError', () => {
    expect(new RepoNotFoundError()).toBeInstanceOf(ReverseGitError);
  });
});

describe('RemoteDivergedError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new RemoteDivergedError('abc123', 'def456');
    assertReverseGitErrorShape(err, 'REMOTE_DIVERGED', 2, 409);
  });

  it('stores localKnownSha and remoteActualSha', () => {
    const err = new RemoteDivergedError('abc123', 'def456');
    expect(err.localKnownSha).toBe('abc123');
    expect(err.remoteActualSha).toBe('def456');
  });

  it('generates a default message when none supplied', () => {
    const err = new RemoteDivergedError('aaa', 'bbb');
    expect(err.message).toContain('aaa');
    expect(err.message).toContain('bbb');
  });

  it('accepts an explicit message', () => {
    const err = new RemoteDivergedError('aaa', 'bbb', 'custom msg');
    expect(err.message).toBe('custom msg');
  });
});

describe('InsufficientScopesError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new InsufficientScopesError('missing repo scope');
    assertReverseGitErrorShape(err, 'INSUFFICIENT_SCOPES', 2, 403);
  });
});

describe('PayloadTooLargeError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new PayloadTooLargeError();
    assertReverseGitErrorShape(err, 'PAYLOAD_TOO_LARGE', 2, 413);
  });
});

describe('RateLimitExceededError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new RateLimitExceededError();
    assertReverseGitErrorShape(err, 'RATE_LIMIT', 2, 503);
  });
});

describe('InvalidPATError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new InvalidPATError('bad token');
    assertReverseGitErrorShape(err, 'INVALID_PAT', 2, 401);
  });

  it('is exported as AuthenticationError alias', () => {
    const err = new AuthenticationError('bad token');
    expect(err).toBeInstanceOf(InvalidPATError);
    expect(err.code).toBe('INVALID_PAT');
    expect(err.httpStatus).toBe(401);
  });
});

describe('GitHubApiError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new GitHubApiError(422, 'unprocessable');
    assertReverseGitErrorShape(err, 'GITHUB_API', 2, 502);
  });

  it('stores raw HTTP status on .status', () => {
    const err = new GitHubApiError(422, 'unprocessable');
    expect(err.status).toBe(422);
    expect(err.message).toBe('unprocessable');
  });
});

describe('GitHubEmptyRepoError', () => {
  it('overrides code to GITHUB_EMPTY_REPO', () => {
    const err = new GitHubEmptyRepoError('empty repo');
    expect(err.code).toBe('GITHUB_EMPTY_REPO');
    // .status is 409 (from super(409, message))
    expect(err.status).toBe(409);
    // exitCode and httpStatus inherited from GitHubApiError
    expect(err.exitCode).toBe(2);
    expect(err.httpStatus).toBe(502);
  });

  it('is instanceof GitHubApiError and ReverseGitError', () => {
    const err = new GitHubEmptyRepoError('msg');
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toBeInstanceOf(ReverseGitError);
  });
});

describe('GitHubBlobTooLargeError', () => {
  it('overrides code, exitCode, and httpStatus', () => {
    const err = new GitHubBlobTooLargeError('blob too large');
    expect(err.code).toBe('GITHUB_BLOB_TOO_LARGE');
    expect(err.exitCode).toBe(1);   // NOT fatal — accumulates in PushResult.errors
    expect(err.httpStatus).toBe(200);
    expect(err.status).toBe(422);   // underlying API status
  });

  it('is instanceof GitHubApiError', () => {
    expect(new GitHubBlobTooLargeError('x')).toBeInstanceOf(GitHubApiError);
  });
});

describe('DevOpsApiError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new DevOpsApiError(400, 'GitRefUpdateRejectedException', 'rejected');
    assertReverseGitErrorShape(err, 'DEVOPS_API', 2, 502);
  });

  it('stores status and typeKey', () => {
    const err = new DevOpsApiError(400, 'GitRefUpdateRejectedException', 'rejected');
    expect(err.status).toBe(400);
    expect(err.typeKey).toBe('GitRefUpdateRejectedException');
    expect(err.message).toBe('rejected');
  });

  it('accepts undefined typeKey', () => {
    const err = new DevOpsApiError(500, undefined, 'unknown');
    expect(err.typeKey).toBeUndefined();
  });
});

describe('PathCollisionError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new PathCollisionError(['Foo/bar.txt', 'foo/bar.txt']);
    assertReverseGitErrorShape(err, 'PATH_COLLISION', 2, 422);
  });

  it('stores the two colliding paths', () => {
    const paths: [string, string] = ['Foo/bar.txt', 'foo/bar.txt'];
    const err = new PathCollisionError(paths);
    expect(err.collidingPaths).toEqual(paths);
    expect(err.message).toContain('Foo/bar.txt');
    expect(err.message).toContain('foo/bar.txt');
  });
});

describe('ConfigurationError', () => {
  it('has correct code, exitCode, httpStatus', () => {
    const err = new ConfigurationError('tokenName is required');
    assertReverseGitErrorShape(err, 'CONFIG_MISSING', 3, 400);
    expect(err.message).toBe('tokenName is required');
  });
});

// ---------------------------------------------------------------------------
// Prototype chain — all subclasses survive Object.setPrototypeOf round-trip
// ---------------------------------------------------------------------------

describe('prototype chain preservation', () => {
  const classes = [
    () => new RepoNotFoundError(),
    () => new RemoteDivergedError('a', 'b'),
    () => new InsufficientScopesError(),
    () => new PayloadTooLargeError(),
    () => new RateLimitExceededError(),
    () => new InvalidPATError(),
    () => new GitHubApiError(500, 'err'),
    () => new GitHubEmptyRepoError('err'),
    () => new GitHubBlobTooLargeError('err'),
    () => new DevOpsApiError(400, undefined, 'err'),
    () => new PathCollisionError(['a', 'b']),
    () => new ConfigurationError(),
  ];

  for (const factory of classes) {
    it(`${factory().constructor.name} instanceof checks hold after throw/catch`, () => {
      const thrown = factory();
      // Simulate the catch path that server handlers use
      try {
        throw thrown;
      } catch (e) {
        expect(e).toBeInstanceOf(ReverseGitError);
        expect(e).toBeInstanceOf(Error);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// mapReverseGitErrorToHttp
// ---------------------------------------------------------------------------

describe('mapReverseGitErrorToHttp', () => {
  it('returns error.httpStatus and code for a ReverseGitError subclass', () => {
    const err = new RepoNotFoundError('not found');
    const result = mapReverseGitErrorToHttp(err);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('REPO_NOT_FOUND');
    expect(result.body.error).toBe('not found');
  });

  it('maps RemoteDivergedError → 409', () => {
    const err = new RemoteDivergedError('a', 'b');
    expect(mapReverseGitErrorToHttp(err).status).toBe(409);
  });

  it('maps InsufficientScopesError → 403', () => {
    expect(mapReverseGitErrorToHttp(new InsufficientScopesError()).status).toBe(403);
  });

  it('maps PayloadTooLargeError → 413', () => {
    expect(mapReverseGitErrorToHttp(new PayloadTooLargeError()).status).toBe(413);
  });

  it('maps RateLimitExceededError → 503', () => {
    expect(mapReverseGitErrorToHttp(new RateLimitExceededError()).status).toBe(503);
  });

  it('maps InvalidPATError → 401', () => {
    expect(mapReverseGitErrorToHttp(new InvalidPATError()).status).toBe(401);
  });

  it('maps GitHubApiError → 502', () => {
    expect(mapReverseGitErrorToHttp(new GitHubApiError(500, 'bad')).status).toBe(502);
  });

  it('maps DevOpsApiError → 502', () => {
    expect(mapReverseGitErrorToHttp(new DevOpsApiError(400, undefined, 'bad')).status).toBe(502);
  });

  it('maps PathCollisionError → 422', () => {
    expect(mapReverseGitErrorToHttp(new PathCollisionError(['a', 'b'])).status).toBe(422);
  });

  it('maps ConfigurationError → 400', () => {
    expect(mapReverseGitErrorToHttp(new ConfigurationError('missing')).status).toBe(400);
  });

  it('wraps a plain Error as 500 with no code field', () => {
    const result = mapReverseGitErrorToHttp(new Error('oops'));
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('oops');
    expect(result.body.code).toBeUndefined();
  });

  it('wraps a thrown string as 500', () => {
    const result = mapReverseGitErrorToHttp('something bad');
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('something bad');
  });

  it('wraps null as 500', () => {
    const result = mapReverseGitErrorToHttp(null);
    expect(result.status).toBe(500);
    expect(typeof result.body.error).toBe('string');
  });

  it('body never leaks a code key for non-ReverseGitError', () => {
    const result = mapReverseGitErrorToHttp(42);
    expect('code' in result.body).toBe(false);
  });

  it('GitHubBlobTooLargeError → httpStatus 200 (per-file, non-fatal)', () => {
    const err = new GitHubBlobTooLargeError('too large');
    const result = mapReverseGitErrorToHttp(err);
    expect(result.status).toBe(200);
    expect(result.body.code).toBe('GITHUB_BLOB_TOO_LARGE');
  });
});
