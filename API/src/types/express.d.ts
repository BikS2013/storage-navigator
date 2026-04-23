import 'express-serve-static-core';
import type { Principal } from '../auth/oidc-middleware.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    principal?: Principal;
  }
}
