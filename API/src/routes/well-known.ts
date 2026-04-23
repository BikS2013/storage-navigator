import { Router } from 'express';
import type { Config } from '../config.js';

export function wellKnownRouter(config: Config): Router {
  const r = Router();
  r.get('/.well-known/storage-nav-config', (_req, res) => {
    if (config.oidc.mode === 'enabled') {
      res.json({
        authEnabled: true,
        issuer: config.oidc.issuer,
        clientId: config.oidc.clientId,
        audience: config.oidc.audience,
        scopes: config.oidc.scopes,
      });
    } else {
      res.json({ authEnabled: false });
    }
  });
  return r;
}
