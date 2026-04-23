import type { Request } from 'express';

/**
 * Build an AbortSignal that fires only when the client disconnects *before*
 * the response is sent. We listen on `res.close` (not `req.close`) because
 * `req.close` fires as soon as the inbound body is fully read — which would
 * abort the upstream Azure SDK call mid-flight even on a normal request.
 *
 * `res.close` always fires after the connection terminates. If `res.finish`
 * already fired (i.e. we successfully sent a response), aborting is a no-op
 * since by then the only listeners are gone.
 */
export function abortSignalForRequest(req: Request): AbortSignal {
  const ac = new AbortController();
  req.res?.once('close', () => {
    if (!req.res?.writableFinished) ac.abort();
  });
  return ac.signal;
}
