export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthenticated(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Insufficient role'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }
  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static upstream(message: string): ApiError {
    return new ApiError(502, 'UPSTREAM_ERROR', message);
  }
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, 'INTERNAL', message);
  }
}
