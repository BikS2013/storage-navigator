// UMD-ish surface — attaches to window.htmlView so app.js can dispatch to it.
(function (root) {
  function encPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  function buildSrc(scope, storage, parent, path) {
    const prefix = scope === 'share' ? '/api/site-file' : '/api/site';
    return `${prefix}/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}/${encPath(path)}`;
  }

  function sandboxAttr(trusted) {
    return trusted
      ? 'allow-scripts allow-same-origin allow-forms allow-popups'
      : 'allow-scripts';
  }

  async function fetchTrust(scope, storage, parent) {
    const url = scope === 'share'
      ? `/api/trust-file/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`
      : `/api/trust/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return false;
      const j = await r.json();
      return !!j.trusted;
    } catch { return false; }
  }

  async function setTrust(scope, storage, parent, trusted) {
    const url = scope === 'share'
      ? `/api/trust-file/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`
      : `/api/trust/${encodeURIComponent(storage)}/${encodeURIComponent(parent)}`;
    const r = await fetch(url, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trusted }),
    });
    if (!r.ok) throw new Error(`PUT ${url} → HTTP ${r.status}`);
    const j = await r.json();
    return !!j.trusted;
  }

  function buildToolbar({ scope, storage, parent, path, onTrustChange, getTrusted, setTrustedRef }) {
    const bar = root.document.createElement('div');
    bar.className = 'html-view-toolbar';

    const trustBtn = root.document.createElement('button');
    trustBtn.type = 'button';
    trustBtn.textContent = getTrusted() ? 'Untrust container' : 'Trust container';
    trustBtn.addEventListener('click', async () => {
      const next = !getTrusted();
      try {
        const applied = await setTrust(scope, storage, parent, next);
        setTrustedRef(applied);
        trustBtn.textContent = applied ? 'Untrust container' : 'Trust container';
        if (onTrustChange) onTrustChange(applied);
      } catch (e) {
        trustBtn.textContent = `Error: ${e.message}`;
      }
    });

    const openBtn = root.document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open in browser';
    openBtn.addEventListener('click', () => {
      const url = buildSrc(scope, storage, parent, path);
      const absolute = new URL(url, root.location.origin).toString();
      if (root.electron && root.electron.invoke) {
        root.electron.invoke('shell:open-external', absolute).catch(() => root.open(absolute, '_blank'));
      } else {
        root.open(absolute, '_blank');
      }
    });

    const sourceBtn = root.document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.textContent = 'View source';
    sourceBtn.addEventListener('click', () => {
      bar.dispatchEvent(new CustomEvent('html-view:view-source', { bubbles: true }));
    });

    bar.appendChild(trustBtn);
    bar.appendChild(openBtn);
    bar.appendChild(sourceBtn);
    return bar;
  }

  function buildIframe(scope, storage, parent, path, trusted) {
    const iframe = root.document.createElement('iframe');
    iframe.className = 'html-view';
    iframe.setAttribute('sandbox', sandboxAttr(trusted));
    iframe.src = buildSrc(scope, storage, parent, path);
    return iframe;
  }

  async function render(opts) {
    const { storage, container, path, scope, contentBody, onTrustChange } = opts;
    const parent = scope === 'share' ? (opts.share !== undefined ? opts.share : container) : container;
    let trusted = await fetchTrust(scope, storage, parent);

    contentBody.innerHTML = '';
    const toolbar = buildToolbar({
      scope, storage, parent, path,
      onTrustChange: function (t) { trusted = t; replaceIframe(); if (onTrustChange) onTrustChange(t); },
      getTrusted: function () { return trusted; },
      setTrustedRef: function (t) { trusted = t; },
    });
    contentBody.appendChild(toolbar);

    let iframe = buildIframe(scope, storage, parent, path, trusted);
    contentBody.appendChild(iframe);

    function replaceIframe() {
      const fresh = buildIframe(scope, storage, parent, path, trusted);
      contentBody.replaceChild(fresh, iframe);
      iframe = fresh;
    }
  }

  root.htmlView = { render: render };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
