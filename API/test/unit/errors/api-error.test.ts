import { describe, it, expect } from 'vitest';
import { ApiError } from '../../../src/errors/api-error.js';

describe('ApiError', () => {
  it('is an Error subclass with status, code, message', () => {
    const e = new ApiError(404, 'NOT_FOUND', 'Container foo not found');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Container foo not found');
    expect(e.details).toBeUndefined();
  });

  it('preserves details', () => {
    const e = new ApiError(409, 'CONFLICT', 'exists', { etag: 'x' });
    expect(e.details).toEqual({ etag: 'x' });
  });

  it('factory helpers produce expected codes', () => {
    expect(ApiError.notFound('x').status).toBe(404);
    expect(ApiError.notFound('x').code).toBe('NOT_FOUND');
    expect(ApiError.forbidden().status).toBe(403);
    expect(ApiError.unauthenticated().status).toBe(401);
    expect(ApiError.badRequest('bad').status).toBe(400);
    expect(ApiError.conflict('boom').status).toBe(409);
    expect(ApiError.internal('oops').status).toBe(500);
    expect(ApiError.upstream('storage 503').status).toBe(502);
  });
});
