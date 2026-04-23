import type { RequestHandler } from 'express';
import { v7 as uuidv7 } from 'uuid';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : uuidv7();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}
