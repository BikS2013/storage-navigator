import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { BlobReadHandle } from '../azure/blob-service.js';

export async function proxyDownload(res: Response, h: BlobReadHandle): Promise<void> {
  if (h.contentType) res.setHeader('Content-Type', h.contentType);
  if (h.contentLength !== undefined) res.setHeader('Content-Length', h.contentLength);
  if (h.etag) res.setHeader('ETag', h.etag);
  if (h.lastModified) res.setHeader('Last-Modified', h.lastModified);
  await pipeline(h.stream, res);
}
