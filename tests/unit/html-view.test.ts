// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadModule() {
  // Force re-import so each test gets fresh window state.
  // The renderer attaches to window.htmlView UMD-style.
  vi.resetModules();
  // Read the script source, then eval into the happy-dom window so it picks up the global.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'electron', 'public', 'html-view.js'),
    'utf-8'
  );
  // eslint-disable-next-line no-new-func
  new Function('window', src)(window);
  return (window as unknown as { htmlView: HtmlView }).htmlView;
}

interface HtmlView {
  render(opts: {
    storage: string;
    container: string;
    share?: string;
    path: string;
    scope: 'container' | 'share';
    contentBody: HTMLElement;
    onTrustChange?: (trusted: boolean) => void;
  }): Promise<void>;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('htmlView.render', () => {
  it('renders a sandboxed iframe with restrictive sandbox when untrusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'c1', path: 'a/b.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.src).toContain('/api/site/s1/c1/a/b.html');
  });

  it('renders a permissive sandbox when trusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: true }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'c1', path: 'index.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
  });

  it('uses /api/site-file/... for share scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's1', container: 'sh1', share: 'sh1', path: 'r.html', scope: 'share', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/site-file/s1/sh1/r.html');
  });

  it('URL-encodes each path segment but preserves the slashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ trusted: false }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
    const htmlView = await loadModule();
    const host = document.createElement('div'); document.body.appendChild(host);
    await htmlView.render({ storage: 's 1', container: 'c+1', path: 'a b/c d.html', scope: 'container', contentBody: host });
    const iframe = host.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/site/s%201/c%2B1/a%20b/c%20d.html');
  });
});
