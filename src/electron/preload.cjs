// Electron preload — runs in an isolated Node context with access to
// `electron`. Bridges a tiny, allowlisted surface to the renderer's
// `window.electron` global. CommonJS on purpose: Electron's preload runner
// supports CJS directly, which lets us ship the file without an extra
// esbuild bundling step alongside main.ts.

const { contextBridge, ipcRenderer } = require("electron");

// Allowlist — both directions. Renderer can only invoke / subscribe to
// channels we explicitly enumerate here, so a compromised renderer can't
// reach arbitrary main-process handlers.
const INVOKE_CHANNELS = new Set([
  "oidc:login",
  "download-zip:start",
  "download-zip:cancel",
  "shell:open-external",
]);

const EVENT_CHANNELS = new Set([
  "download-zip:progress",
]);

function assertInvokeChannel(channel) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`preload: invoke channel not allowlisted: ${channel}`);
  }
}

function assertEventChannel(channel) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`preload: event channel not allowlisted: ${channel}`);
  }
}

contextBridge.exposeInMainWorld("electron", {
  invoke(channel, ...args) {
    assertInvokeChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    assertEventChannel(channel);
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    // Return an unsubscribe function — renderer code can keep references
    // local and clean up when the download completes.
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
