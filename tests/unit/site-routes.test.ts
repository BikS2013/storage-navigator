import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sn-site-rt-'));
  process.env.STORAGE_NAVIGATOR_DIR = tmp;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.STORAGE_NAVIGATOR_DIR;
  rmSync(tmp, { recursive: true, force: true });
  vi.doUnmock('../../src/core/backend/factory.js');
  vi.restoreAllMocks();
});

function fakeBackend(map: Record<string, { ct?: string; body: string }>) {
  return {
    readBlob: vi.fn(async (_c: string, p: string) => {
      const v = map[p];
      if (!v) throw new Error(`Blob '${p}' not found`);
      return { stream: Readable.from(Buffer.from(v.body)), contentType: v.ct, contentLength: v.body.length };
    }),
    readFile: vi.fn(async (_s: string, p: string) => {
      const v = map[p];
      if (!v) throw new Error(`File '${p}' not found`);
      return { stream: Readable.from(Buffer.from(v.body)), contentType: v.ct, contentLength: v.body.length };
    }),
  };
}

async function buildApp(backendMap: Record<string, { ct?: string; body: string }>) {
  const { CredentialStore } = await import('../../src/core/credential-store.js');
  const store = new CredentialStore();
  store.addStorage({ kind: 'direct', name: 's1', accountName: 'a1', sasToken: 'x' });

  vi.doMock('../../src/core/backend/factory.js', () => ({
    makeBackend: () => fakeBackend(backendMap),
  }));
  const { registerSiteRoutes } = await import('../../src/electron/site-routes.js');
  const app = express();
  app.use(express.json());
  registerSiteRoutes(app);
  return app;
}

describe('GET /api/site/:storage/:container/*path', () => {
  it('streams HTML with text/html and a restrictive default CSP', async () => {
    const app = await buildApp({ 'index.html': { ct: 'text/html', body: '<h1>hi</h1>' } });
    const r = await request(app).get('/api/site/s1/c1/index.html');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.text).toBe('<h1>hi</h1>');
  });

  it('uses relaxed CSP when the container is trusted', async () => {
    // buildApp adds the 's1' storage entry; set trust AFTER so addStorage does
    // not overwrite the trustedHtmlContainers array.
    const app = await buildApp({ 'index.html': { ct: 'text/html', body: '<h1>hi</h1>' } });
    const { CredentialStore } = await import('../../src/core/credential-store.js');
    const store = new CredentialStore();
    store.setHtmlTrust('s1', 'container', 'c1', true);
    const r = await request(app).get('/api/site/s1/c1/index.html');
    expect(r.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(r.headers['content-security-policy']).toContain("form-action 'self'");
  });

  it('allows https iframes (YouTube/Vimeo) and media via CSP', async () => {
    const app = await buildApp({ 'page.html': { ct: 'text/html', body: '<iframe src="https://www.youtube.com/embed/x"></iframe>' } });
    const r = await request(app).get('/api/site/s1/c1/page.html');
    const csp = r.headers['content-security-policy'];
    expect(csp).toContain('frame-src https:');
    expect(csp).toContain("media-src 'self' data: https:");
  });

  it('falls back to extension-derived content-type when the backend reports octet-stream', async () => {
    const app = await buildApp({ 'a.css': { ct: 'application/octet-stream', body: 'body{}' } });
    const r = await request(app).get('/api/site/s1/c1/a.css');
    expect(r.headers['content-type']).toMatch(/^text\/css/);
  });

  it('passes through non-HTML content as-is and does NOT set CSP', async () => {
    const app = await buildApp({ 'img.png': { ct: 'image/png', body: 'PNGDATA' } });
    const r = await request(app).get('/api/site/s1/c1/img.png');
    expect(r.headers['content-type']).toMatch(/^image\/png/);
    expect(r.headers['content-security-policy']).toBeUndefined();
  });

  it('returns 404 with JSON for missing non-HTML', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/missing.png');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns 404 with an HTML body when the request is for HTML', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/missing.html');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.text).toMatch(/not found/i);
  });

  it('rejects path traversal with 400', async () => {
    const app = await buildApp({});
    const r = await request(app).get('/api/site/s1/c1/..%2Fsecrets.txt');
    expect(r.status).toBe(400);
  });

  it('symmetric file-share route streams shares', async () => {
    const app = await buildApp({ 'page.html': { ct: 'text/html', body: '<p>x</p>' } });
    const r = await request(app).get('/api/site-file/s1/share1/page.html');
    expect(r.status).toBe(200);
    expect(r.text).toBe('<p>x</p>');
    expect(r.headers['content-security-policy']).toContain("connect-src 'none'");
  });
});
