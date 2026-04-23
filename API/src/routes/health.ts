import { Router } from 'express';

export type ReadinessChecks = {
  jwks?: () => Promise<boolean>;
  arm?: () => Promise<boolean>;
};

export function healthRouter(checks: ReadinessChecks = {}): Router {
  const r = Router();

  r.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  r.get('/readyz', async (_req, res) => {
    const results: Record<string, boolean> = {};
    for (const [name, fn] of Object.entries(checks)) {
      try {
        results[name] = await fn();
      } catch {
        results[name] = false;
      }
    }
    const allPass = Object.values(results).every(Boolean);
    res.status(allPass ? 200 : 503).json({
      status: allPass ? 'ready' : 'not_ready',
      checks: results,
    });
  });

  return r;
}
