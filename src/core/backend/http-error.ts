export type ApiErrorBody = {
  error: { code: string; message: string; correlationId?: string; details?: unknown };
};

export class HttpError extends Error {
  readonly status: number;
  readonly correlationId?: string;
  constructor(status: number, message: string, correlationId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.correlationId = correlationId;
  }
}

export class NeedsLoginError extends HttpError {
  constructor(apiBackendName: string) {
    super(401, `OIDC login required. Run: storage-nav login --name ${apiBackendName}`);
  }
}

export class AccessDeniedError extends HttpError {
  constructor(message = 'Insufficient role', correlationId?: string) {
    super(403, message, correlationId);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(404, message, correlationId);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(409, message, correlationId);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(400, message, correlationId);
  }
}

export class UpstreamError extends HttpError {
  constructor(message: string, correlationId?: string) {
    super(502, message, correlationId);
  }
}

export class ApiInternalError extends HttpError {
  constructor(correlationId?: string) {
    super(500, `API internal error (correlationId=${correlationId ?? 'unknown'})`, correlationId);
  }
}

export class NetworkError extends HttpError {
  constructor(cause: Error) {
    super(0, `Network failure: ${cause.message}`);
  }
}

export function fromResponseBody(status: number, body: unknown, apiBackendName: string): HttpError {
  const err = (body as ApiErrorBody | undefined)?.error;
  const code = err?.code;
  const message = err?.message ?? `HTTP ${status}`;
  const cid = err?.correlationId;
  switch (status) {
    case 401: return new NeedsLoginError(apiBackendName);
    case 403: return new AccessDeniedError(message, cid);
    case 404: return new NotFoundError(message, cid);
    case 409: return new ConflictError(message, cid);
    case 400: return new BadRequestError(message, cid);
    case 502:
    case 503:
      return new UpstreamError(message, cid);
    case 500: return new ApiInternalError(cid);
    default:
      if (code === 'UPSTREAM_ERROR') return new UpstreamError(message, cid);
      return new HttpError(status, message, cid);
  }
}
