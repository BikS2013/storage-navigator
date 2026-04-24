import { Router } from 'express';
import type { Config } from '../config.js';

export function wellKnownRouter(config: Config): Router {
  const r = Router();
  r.get('/.well-known/storage-nav-config', (_req, res) => {
    const staticActive = config.staticAuth.values.length > 0;
    const staticFields = staticActive
      ? { staticAuthHeaderRequired: true as const, staticAuthHeaderName: config.staticAuth.headerName }
      : {};

    if (config.oidc.mode === 'enabled') {
      res.json({
        authEnabled: true,
        issuer: config.oidc.issuer,
        clientId: config.oidc.clientId,
        audience: config.oidc.audience,
        scopes: config.oidc.scopes,
        ...staticFields,
      });
    } else {
      res.json({ authEnabled: false, ...staticFields });
    }
  });
  return r;
}
