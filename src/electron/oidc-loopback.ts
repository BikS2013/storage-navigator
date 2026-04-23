import { createServer, type Server } from 'node:http';

export type LoopbackHandle = {
  redirectUri: string;
  waitForCallback: () => Promise<{ code: string; state: string }>;
  close: () => void;
};

export async function startLoopback(): Promise<LoopbackHandle> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('bad addr');
  const redirectUri = `http://127.0.0.1:${addr.port}/cb`;
  let resolveCb!: (v: { code: string; state: string }) => void;
  let rejectCb!: (e: Error) => void;
  const cb = new Promise<{ code: string; state: string }>((res, rej) => { resolveCb = res; rejectCb = rej; });
  server.on('request', (req, res) => {
    const u = new URL(req.url ?? '', 'http://127.0.0.1');
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!code || !state) {
      res.statusCode = 400;
      res.end('Missing code/state');
      rejectCb(new Error('Missing code/state'));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<html><body><h2>Login successful</h2><p>You can close this window.</p></body></html>`);
    resolveCb({ code, state });
  });
  return { redirectUri, waitForCallback: () => cb, close: () => server.close() };
}
