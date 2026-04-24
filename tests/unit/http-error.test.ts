import { describe, it, expect } from 'vitest';
import {
  HttpError,
  NeedsLoginError,
  AccessDeniedError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  UpstreamError,
  ApiInternalError,
  NetworkError,
  StaticAuthFailedError,
  fromResponseBody,
} from '../../src/core/backend/http-error.js';

describe('http-error', () => {
  it('NeedsLoginError carries hint', () => {
    const e = new NeedsLoginError('nbg-dev');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).toMatch(/nbg-dev/);
    expect(e.status).toBe(401);
  });

  it('fromResponseBody dispatches by status + code', () => {
    expect(fromResponseBody(401, { error: { code: 'UNAUTHENTICATED', message: 'x', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(NeedsLoginError);
    expect(fromResponseBody(403, { error: { code: 'FORBIDDEN', message: 'x', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(AccessDeniedError);
    expect(fromResponseBody(404, { error: { code: 'NOT_FOUND', message: 'no', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(NotFoundError);
    expect(fromResponseBody(409, { error: { code: 'CONFLICT', message: 'c', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(ConflictError);
    expect(fromResponseBody(400, { error: { code: 'BAD_REQUEST', message: 'b', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(BadRequestError);
    expect(fromResponseBody(502, { error: { code: 'UPSTREAM_ERROR', message: 'u', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(UpstreamError);
    expect(fromResponseBody(500, { error: { code: 'INTERNAL', message: 'i', correlationId: 'c' } }, 'a'))
      .toBeInstanceOf(ApiInternalError);
  });

  it('fromResponseBody routes STATIC_AUTH_FAILED to StaticAuthFailedError', () => {
    const e = fromResponseBody(401,
      { error: { code: 'STATIC_AUTH_FAILED', message: 'bad header', correlationId: 'c' } },
      'nbg-dev');
    expect(e).toBeInstanceOf(StaticAuthFailedError);
    expect(e.message).toMatch(/nbg-dev/);
    expect(e.status).toBe(401);
  });
});
