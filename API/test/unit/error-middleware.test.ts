import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ApiError } from '../../src/errors/api-error.js';
import { errorMiddleware } from '../../src/errors/error-middleware.js';
import { requestIdMiddleware } from '../../src/observability/request-id.js';

function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(requestIdMiddleware());
  app.get('/x', handler);
  app.use(errorMiddleware());
  return app;
}

describe('errorMiddleware', () => {
  it('serialises ApiError', async () => {
    const app = buildApp((_req, _res, next) =>
      next(ApiError.notFound("Container 'foo' not found"))
    );
    const res = await request(app).get('/x');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: "Container 'foo' not found",
        correlationId: expect.any(String),
      },
    });
  });

  it('masks unknown errors as INTERNAL with correlationId', async () => {
    const app = buildApp((_req, _res, next) => next(new Error('secret leak')));
    const res = await request(app).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toBe('Internal server error');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('echoes inbound X-Request-Id', async () => {
    const app = buildApp((_req, _res, next) => next(ApiError.badRequest('x')));
    const res = await request(app).get('/x').set('X-Request-Id', 'rid-abc');
    expect(res.body.error.correlationId).toBe('rid-abc');
    expect(res.headers['x-request-id']).toBe('rid-abc');
  });

  it('mints a fresh X-Request-Id when none supplied', async () => {
    const app = buildApp((_req, _res, next) => next(ApiError.badRequest('x')));
    const res = await request(app).get('/x');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
