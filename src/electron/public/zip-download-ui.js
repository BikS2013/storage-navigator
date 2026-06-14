// Renderer-side controller for "Download as ZIP".
//
// When window.electron is exposed by the preload script (the desktop app),
// the download is performed by the main process: native save dialog, streams
// the response straight to disk, fires progress events back to the renderer.
// We render a small modal indicator while the bytes flow, with a Cancel
// button that calls back into main to abort + delete the partial file.
//
// When window.electron is NOT present (eg. a future browser-only deploy),
// we fall back to the legacy `fetch + Blob + a[download]` path so the
// feature still works.

(function () {
  function uuid() {
    // Good-enough random id — only used to correlate progress events with a
    // pending download in a single renderer session. Not cryptographic.
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function ensureIndicator() {
    let host = document.getElementById("zip-download-indicator");
    if (host) return host;
    host = document.createElement("div");
    host.id = "zip-download-indicator";
    host.className = "zip-dl-indicator hidden";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.innerHTML = [
      '<div class="zip-dl-box">',
      '  <div class="zip-dl-spinner" aria-hidden="true"></div>',
      '  <div class="zip-dl-text">',
      '    <div class="zip-dl-label">Creating ZIP…</div>',
      '    <div class="zip-dl-detail" id="zip-dl-detail">Starting download</div>',
      '  </div>',
      '  <button type="button" class="zip-dl-cancel" id="zip-dl-cancel">Cancel</button>',
      '</div>',
    ].join("");
    document.body.appendChild(host);
    return host;
  }

  function showIndicator(label) {
    const host = ensureIndicator();
    const detail = host.querySelector("#zip-dl-detail");
    if (detail) detail.textContent = label || "Starting download";
    host.classList.remove("hidden");
  }

  function setIndicatorDetail(text) {
    const host = document.getElementById("zip-download-indicator");
    if (!host) return;
    const detail = host.querySelector("#zip-dl-detail");
    if (detail) detail.textContent = text;
  }

  function hideIndicator() {
    const host = document.getElementById("zip-download-indicator");
    if (host) host.classList.add("hidden");
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function hasElectronBridge() {
    return typeof window !== "undefined"
      && !!window.electron
      && typeof window.electron.invoke === "function"
      && typeof window.electron.on === "function";
  }

  // Build the request body for the recursive-zip endpoint. Mirrors the
  // shape the embedded server expects (see /api/download-zip in server.ts).
  function buildBody({ prefix, archiveName }) {
    const normalized = prefix && !prefix.endsWith("/") ? prefix + "/" : prefix;
    if (!normalized) {
      // No prefix → whole-container download. Signal explicitly so the server
      // distinguishes "archive everything" from a malformed (missing) request.
      return { wholeContainer: true, archiveName };
    }
    return { prefix: normalized, archiveName };
  }

  // Browser-only fallback. Streams via the regular fetch path; the browser
  // accumulates the response in memory and the [download] anchor saves it.
  async function downloadViaBrowser({ urlPath, body, archiveName }) {
    showIndicator("Creating archive…");
    try {
      const res = await fetch(urlPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = archiveName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return { ok: true };
    } finally {
      hideIndicator();
    }
  }

  // Electron path — main process handles the save dialog + disk write.
  async function downloadViaElectron({ urlPath, body, archiveName }) {
    const requestId = uuid();
    const cancelBtn = ensureIndicator().querySelector("#zip-dl-cancel");
    let cancelled = false;

    const onCancelClick = async () => {
      cancelled = true;
      setIndicatorDetail("Cancelling…");
      try {
        await window.electron.invoke("download-zip:cancel", { requestId });
      } catch (_e) {
        // best-effort — the main handler will resolve {cancelled} regardless.
      }
    };
    cancelBtn.addEventListener("click", onCancelClick);

    const offProgress = window.electron.on("download-zip:progress", (msg) => {
      if (!msg || msg.requestId !== requestId) return;
      setIndicatorDetail(`Streaming… ${formatBytes(msg.bytesWritten)}`);
    });

    showIndicator("Choose where to save the archive…");

    try {
      const result = await window.electron.invoke("download-zip:start", {
        urlPath,
        body,
        archiveName,
        requestId,
      });

      if (!result || result.cancelled) return { cancelled: true };
      if (result.ok) {
        setIndicatorDetail(`Saved ${formatBytes(result.bytesWritten)} → ${result.path}`);
        return { ok: true, path: result.path };
      }
      throw new Error(result.error || "Download failed");
    } finally {
      offProgress?.();
      cancelBtn.removeEventListener("click", onCancelClick);
      // Give the user a beat to read the final state if it landed; on
      // cancel we hide immediately so they don't see lingering progress.
      if (cancelled) hideIndicator();
      else setTimeout(hideIndicator, 800);
    }
  }

  /**
   * Public entry point: kick off a folder/container zip download.
   *
   * @param {{
   *   urlPath: string,
   *   prefix: string,
   *   archiveName: string,
   * }} args
   * @returns {Promise<{ok?: true, cancelled?: true, path?: string}>}
   */
  async function downloadZipByPrefix(args) {
    const body = buildBody({ prefix: args.prefix, archiveName: args.archiveName });
    if (hasElectronBridge()) {
      return downloadViaElectron({ urlPath: args.urlPath, body, archiveName: args.archiveName });
    }
    return downloadViaBrowser({ urlPath: args.urlPath, body, archiveName: args.archiveName });
  }

  // Expose to app.js as a global. The renderer is a single page with a
  // single closure-wrapped app.js; this is the established pattern in the
  // codebase (cf. window.electron from the preload).
  window.zipDownload = {
    downloadZipByPrefix,
    // Exported for tests; not relied on by app.js.
    _internals: { hasElectronBridge, ensureIndicator, showIndicator, hideIndicator, formatBytes },
  };
})();
