// Storage Navigator — Frontend Application
(function () {
  const storageSelect = document.getElementById("storage-select");
  const addBtn = document.getElementById("add-storage-btn");
  const deleteStorageBtn = document.getElementById("delete-storage-btn");
  const deleteStorageModal = document.getElementById("delete-storage-modal");
  const deleteStorageMessage = document.getElementById("delete-storage-message");
  const deleteStorageCancel = document.getElementById("delete-storage-cancel");
  const deleteStorageConfirm = document.getElementById("delete-storage-confirm");
  const exportBtn = document.getElementById("export-btn");
  const githubAppsBtn = document.getElementById("github-apps-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const themeBtn = document.getElementById("theme-btn");
  const treeContent = document.getElementById("tree-content");
  const contentTitle = document.getElementById("content-title");
  const contentMeta = document.getElementById("content-meta");
  const contentBody = document.getElementById("content-body");
  // Edit controls (PR #5 — in-place text editing)
  const editControls = document.getElementById("content-edit-controls");
  const editBtn = document.getElementById("edit-btn");
  const editSaveBtn = document.getElementById("edit-save");
  const editCancelBtn = document.getElementById("edit-cancel");
  const editStatusEl = document.getElementById("edit-status");
  const editFindBtn = document.getElementById("edit-find");
  const editFindHint = document.getElementById("edit-find-hint");
  const modal = document.getElementById("add-modal");
  const modalCancel = document.getElementById("modal-cancel");
  const modalSave = document.getElementById("modal-save");
  const modalAuthType = document.getElementById("modal-auth-type");
  const modalKeyLabel = document.getElementById("modal-key-label");

  const createBtn = document.getElementById("create-btn");
  const ctxMenu = document.getElementById("context-menu");
  const ctxRename = document.getElementById("ctx-rename");
  const ctxDelete = document.getElementById("ctx-delete");
  const renameModal = document.getElementById("rename-modal");
  const renameOld = document.getElementById("rename-old");
  const renameNew = document.getElementById("rename-new");
  const renameCancel = document.getElementById("rename-cancel");
  const renameSave = document.getElementById("rename-save");
  const deleteModal = document.getElementById("delete-modal");
  const deleteMessage = document.getElementById("delete-message");
  const deleteCancel = document.getElementById("delete-cancel");
  const deleteConfirm = document.getElementById("delete-confirm");
  const createModal = document.getElementById("create-modal");
  const createContainer = document.getElementById("create-container");
  const createPath = document.getElementById("create-path");
  const createContent = document.getElementById("create-content");
  const createCancel = document.getElementById("create-cancel");
  const createSave = document.getElementById("create-save");

  const syncModal = document.getElementById("sync-modal");
  const syncInfo = document.getElementById("sync-info");
  const syncCancel = document.getElementById("sync-cancel");
  const syncConfirm = document.getElementById("sync-confirm");

  const ctxRefresh = document.getElementById("ctx-refresh");
  const folderCtxMenu = document.getElementById("folder-context-menu");
  const ctxRefreshFolder = document.getElementById("ctx-refresh-folder");
  const ctxDeleteFolder = document.getElementById("ctx-delete-folder");
  const deleteFolderModal = document.getElementById("delete-folder-modal");
  const deleteFolderMessage = document.getElementById("delete-folder-message");
  const deleteFolderCancel = document.getElementById("delete-folder-cancel");
  const deleteFolderConfirm = document.getElementById("delete-folder-confirm");
  const containerCtxMenu = document.getElementById("container-context-menu");
  const ctxRefreshContainer = document.getElementById("ctx-refresh-container");
  const ctxDownload = document.getElementById("ctx-download");
  const ctxDownloadFolder = document.getElementById("ctx-download-folder");
  const ctxDownloadContainer = document.getElementById("ctx-download-container");
  const ctxLinkContainer = document.getElementById("ctx-link-container");
  const ctxViewLinks = document.getElementById("ctx-view-links");
  const ctxLinkFolder = document.getElementById("ctx-link-folder");

  // --- Link Modal elements ---
  const linkModal = document.getElementById("link-modal");
  const linkProvider = document.getElementById("link-provider");
  const linkRepoUrl = document.getElementById("link-repo-url");
  const linkBranch = document.getElementById("link-branch");
  const linkTargetPrefix = document.getElementById("link-target-prefix");
  const linkRepoSubpath = document.getElementById("link-repo-subpath");
  const linkCancel = document.getElementById("link-cancel");
  const linkSave = document.getElementById("link-save");

  // --- Links Panel elements ---
  const linksPanelModal = document.getElementById("links-panel-modal");
  const linksPanelBody = document.getElementById("links-panel-body");
  const linksSyncAll = document.getElementById("links-sync-all");
  const linksDiffAll = document.getElementById("links-diff-all");
  const linksPanelClose = document.getElementById("links-panel-close");

  // --- Reverse-Git: Publish Modal elements ---
  const publishModal = document.getElementById("publish-modal");
  const publishModalTitle = document.getElementById("publish-modal-title");
  const publishScopeInfo = document.getElementById("publish-scope-info");
  const publishProvider = document.getElementById("publish-provider");
  const publishRepoUrl = document.getElementById("publish-repo-url");
  const publishBranch = document.getElementById("publish-branch");
  const publishRepoSubpath = document.getElementById("publish-repo-subpath");
  const publishToken = document.getElementById("publish-token");
  const publishAddToken = document.getElementById("publish-add-token");
  const publishExclusions = document.getElementById("publish-exclusions");
  const publishRespectGitignore = document.getElementById("publish-respect-gitignore");
  const publishVisibility = document.getElementById("publish-visibility");
  const publishCreateRepo = document.getElementById("publish-create-repo");
  const publishCommitMsg = document.getElementById("publish-commit-msg");
  const publishStatus = document.getElementById("publish-status");
  const publishCancel = document.getElementById("publish-cancel");
  const publishInit = document.getElementById("publish-init");
  const publishInitPush = document.getElementById("publish-init-push");

  // --- Reverse-Git: Reverse Links Panel elements ---
  const reverseLinksPanelModal = document.getElementById("reverse-links-panel-modal");
  const reverseLinksPanelBody = document.getElementById("reverse-links-panel-body");
  const reverseLinksPushAll = document.getElementById("reverse-links-push-all");
  const reverseLinksPanelClose = document.getElementById("reverse-links-panel-close");

  // --- Reverse-Git: storage-account context menu ---
  const storageAccountCtxMenu = document.getElementById("storage-account-context-menu");
  const ctxPublishStorageAccount = document.getElementById("ctx-publish-storage-account");
  const ctxViewReverseLinksAccount = document.getElementById("ctx-view-reverse-links-account");
  const ctxPublishContainer = document.getElementById("ctx-publish-container");
  const ctxViewReverseLinks = document.getElementById("ctx-view-reverse-links");
  const ctxPublishFolder = document.getElementById("ctx-publish-folder");

  // --- Add Token Modal elements ---
  const addTokenModal = document.getElementById("add-token-modal");
  const addTokenMessage = document.getElementById("add-token-message");
  const addTokenName = document.getElementById("add-token-name");
  const addTokenProvider = document.getElementById("add-token-provider");
  const addTokenValue = document.getElementById("add-token-value");
  const addTokenCancel = document.getElementById("add-token-cancel");
  const addTokenSave = document.getElementById("add-token-save");
  const githubAppsModal = document.getElementById("github-apps-modal");
  const githubAppsList = document.getElementById("github-apps-list");
  const addGitHubAppBtn = document.getElementById("add-github-app-btn");
  const githubAppsClose = document.getElementById("github-apps-close");
  const addGitHubAppModal = document.getElementById("add-github-app-modal");
  const addAppName = document.getElementById("add-app-name");
  const addAppId = document.getElementById("add-app-id");
  const addAppInstallationId = document.getElementById("add-app-installation-id");
  const addAppPrivateKey = document.getElementById("add-app-private-key");
  const addAppCompanionPat = document.getElementById("add-app-companion-pat");
  const addAppCancel = document.getElementById("add-app-cancel");
  const addAppSave = document.getElementById("add-app-save");

  let currentStorage = "";
  let currentContainer = "";
  let activeTreeItem = null;
  let contextTarget = null; // { container, blobName, parentEl, prefix, depth }
  let folderContextTarget = null; // { container, folderName, folderPrefix, parentEl, prefix, depth, node }
  let containerContextTarget = null; // { containerName, node }
  let syncTarget = null; // { container, meta }
  let linkTarget = null; // { container, targetPrefix }
  let linksPanelContainer = null; // container name for the currently open links panel
  let containerLinksCache = {}; // container -> RepoLinksRegistry

  // --- Reverse-Git state ---
  let storageAccountContextTarget = null; // { accountName, node } — for api-kind account-level menu
  let publishContext = null;              // { scope: 'account'|'container'|'prefix', container?, prefix?, accountName? }
  let reverseLinksPanelScope = null;      // same shape as publishContext — drives the panel
  let containerReverseLinksCache = {};    // key (e.g. "<container>") -> ReverseLink[]
  let accountReverseLinksCache = [];      // ReverseLink[] (account scope)

  // --- Theme ---
  // No stored preference -> follow the macOS system appearance (live);
  // the manual toggle persists an override under the same "sn-theme" key.
  const THEME_BTN_SVG = {
    // shown while dark (sun = "switch to light")
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    // shown while light (moon = "switch to dark")
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  };
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = localStorage.getItem("sn-theme") || (systemDark.matches ? "dark" : "light");
  applyTheme(theme);

  systemDark.addEventListener("change", (e) => {
    if (localStorage.getItem("sn-theme")) return; // manual override wins
    applyTheme(e.matches ? "dark" : "light");
  });

  function applyTheme(t, opts) {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    if (opts && opts.persist) localStorage.setItem("sn-theme", t);
    themeBtn.innerHTML = t === "dark" ? THEME_BTN_SVG.dark : THEME_BTN_SVG.light;
    document.getElementById("hljs-dark").disabled = t !== "dark";
    document.getElementById("hljs-light").disabled = t !== "light";
  }

  themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark", { persist: true }));

  // --- Auth type toggle in modal ---
  modalAuthType.addEventListener("change", () => {
    const label = modalAuthType.value === "sas-token" ? "SAS Token" : "Account Key";
    modalKeyLabel.querySelector("textarea").placeholder = label;
    modalKeyLabel.childNodes[0].textContent = label;
  });

  // --- Tab switching inside the Add Storage modal ---
  function activateTab(tabName) {
    const buttons = modal.querySelectorAll(".tab-btn");
    const bodies = modal.querySelectorAll(".tab-body");
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    bodies.forEach((body) => {
      if (body.dataset.tab === tabName) body.removeAttribute("hidden");
      else body.setAttribute("hidden", "");
    });
    if (tabName === "api") resetApiStaticRow();
  }
  modal.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // --- Reset static-header row in the API tab (called when modal/tab opens) ---
  function resetApiStaticRow() {
    const row = document.getElementById('api-static-secret-row');
    const valueEl = document.getElementById('api-static-secret');
    if (row) row.hidden = true;
    if (valueEl) valueEl.value = '';
  }

  // --- Storage kind icon helper ---
  function storageIcon(kind) {
    return kind === "api" ? "\u{1F517}" : "\u{1F511}"; // link vs key
  }

  // --- API helpers ---
  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch {}
      const errField = body.error;
      const msg = (errField && typeof errField === 'object')
        ? (errField.message || JSON.stringify(errField))
        : (errField || `API error: ${res.status}`);
      const err = new Error(msg);
      err.code = body.code || (errField && errField.code);
      err.provider = body.provider;
      throw err;
    }
    return res;
  }
  async function apiJson(url, opts) { return (await api(url, opts)).json(); }

  // --- Storages ---
  // One dropdown entry per backend connection. For api backends with many
  // Azure accounts, those appear as a top-level branch INSIDE the tree.
  let storageInfo = {}; // entry name -> { kind, accountName? }

  async function loadStorages() {
    const storages = await apiJson("/api/storages");
    storageSelect.innerHTML = '<option value="">Select storage...</option>';
    storageInfo = {};
    for (const s of storages) {
      const kind = s.kind || "direct";
      storageInfo[s.name] = { kind, accountName: s.accountName };
      const opt = document.createElement("option");
      opt.value = s.name;
      let label = `${storageIcon(kind)} ${s.name}`;
      if (kind === "direct" && s.accountName) label += ` (${s.accountName})`;
      if (s.expiresAt) {
        const days = Math.ceil((new Date(s.expiresAt) - Date.now()) / 86400000);
        if (s.isExpired) label += " [EXPIRED]";
        else if (days < 30) label += ` [${days}d left]`;
      }
      opt.textContent = label;
      storageSelect.appendChild(opt);
    }
    if (storages.length === 1) {
      storageSelect.value = storages[0].name;
      storageSelect.dispatchEvent(new Event("change"));
    }
    updateDeleteStorageBtn();
  }

  function updateDeleteStorageBtn() {
    deleteStorageBtn.disabled = !storageSelect.value;
  }

  // currentAccount = Azure account currently active for view/right-click ops.
  // For direct kind: empty (server falls back to entry.accountName).
  // For api kind: set when the user clicks an account node in the tree.
  let currentAccount = "";

  function withAccount(url) {
    if (!currentAccount) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}account=${encodeURIComponent(currentAccount)}`;
  }

  storageSelect.addEventListener("change", async () => {
    currentStorage = storageSelect.value;
    currentAccount = "";
    currentContainer = "";
    updateDeleteStorageBtn();
    if (!currentStorage) {
      treeContent.innerHTML = '<p class="placeholder">Select a storage account</p>';
      return;
    }
    await buildTree();
  });

  // --- Tree builder ---
  async function buildTree() {
    treeContent.innerHTML = '<p class="placeholder">Loading...</p>';
    try {
      const info = storageInfo[currentStorage] || { kind: "direct" };
      treeContent.innerHTML = "";
      if (info.kind === "api") {
        const r = await apiJson(`/api/accounts/${encodeURIComponent(currentStorage)}`);
        const accounts = (r && r.items) || [];
        if (accounts.length === 0) {
          treeContent.innerHTML = '<p class="placeholder">No storage accounts visible to this API.</p>';
          return;
        }
        for (const a of accounts) {
          const node = createTreeNode(a.name, "🔑", 0, true);
          node.dataset.account = a.name;
          node.querySelector(".tree-item").addEventListener("click", () => toggleAccount(node, a.name));
          node.querySelector(".tree-item").addEventListener("contextmenu", (e) => {
            e.preventDefault();
            storageAccountContextTarget = { accountName: a.name, node };
            storageAccountCtxMenu.style.left = e.clientX + "px";
            storageAccountCtxMenu.style.top = e.clientY + "px";
            storageAccountCtxMenu.classList.remove("hidden");
          });
          treeContent.appendChild(node);
        }
        if (accounts.length === 1) {
          const onlyNode = treeContent.firstElementChild;
          if (onlyNode) onlyNode.querySelector(".tree-item").click();
        }
      } else {
        await renderContainersAndShares(treeContent, 0);
      }
    } catch (e) {
      treeContent.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  async function toggleAccount(node, accountName) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");
    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "▶";
      return;
    }
    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "▼";
      currentAccount = accountName;
      return;
    }
    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
    children.classList.add("expanded");
    toggle.textContent = "▼";
    currentAccount = accountName;
    try {
      children.innerHTML = "";
      await renderContainersAndShares(children, 1);
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function renderContainersAndShares(parentEl, depth) {
    const containers = await apiJson(withAccount(`/api/containers/${currentStorage}`));
    for (const c of containers) {
      const node = createTreeNode(c.name, "📦", depth, true);
      node.dataset.container = c.name;
      node.querySelector(".tree-item").addEventListener("click", () => toggleContainer(node, c.name));
      node.querySelector(".tree-item").addEventListener("contextmenu", (e) => {
        e.preventDefault();
        containerContextTarget = { containerName: c.name, node };
        containerCtxMenu.style.left = e.clientX + "px";
        containerCtxMenu.style.top = e.clientY + "px";
        containerCtxMenu.classList.remove("hidden");
      });
      parentEl.appendChild(node);
    }
    const sharesRoot = createTreeNode("Shares", "📁", depth, true);
    sharesRoot.classList.add("shares-tree");
    sharesRoot.querySelector(".tree-item").addEventListener("click", () => toggleSharesRoot(sharesRoot));
    parentEl.appendChild(sharesRoot);
  }

  async function toggleSharesRoot(node) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");

    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "▶";
      return;
    }
    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "▼";
      return;
    }

    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading shares...</div>';
    children.classList.add("expanded");
    toggle.textContent = "▼";

    try {
      await loadSharesNode(currentStorage, currentAccount, children);
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadSharesNode(storage, account, parentEl) {
    // For api-kind storages the server expects the Azure account name as a
    // query param. For direct-kind it's optional (entry carries the account).
    const qs = account ? `?account=${encodeURIComponent(account)}` : "";
    const result = await apiJson(`/api/shares/${encodeURIComponent(storage)}${qs}`);
    const shares = Array.isArray(result) ? result : (result && result.items) || [];

    parentEl.innerHTML = "";
    if (shares.length === 0) {
      parentEl.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px;font-style:italic">No shares</div>';
      return;
    }

    for (const s of shares) {
      const shareName = typeof s === "string" ? s : (s && (s.name || s.shareName)) || String(s);
      const node = createTreeNode(shareName, "📂", 1, true);
      node.dataset.share = shareName;
      node.querySelector(".tree-item").addEventListener("click", () => toggleShare(node, shareName));
      parentEl.appendChild(node);
    }
  }

  async function toggleShare(node, shareName) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");
    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "▶";
      return;
    }
    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "▼";
      return;
    }
    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
    children.classList.add("expanded");
    toggle.textContent = "▼";
    try {
      await loadShareDir(children, shareName, "", 2);
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadShareDir(parentEl, shareName, path, depth) {
    let url = `/api/files/${encodeURIComponent(currentStorage)}/${encodeURIComponent(shareName)}`;
    if (path) url += `?path=${encodeURIComponent(path)}`;
    const result = await apiJson(withAccount(url));
    const items = (result && result.items) || [];
    parentEl.innerHTML = "";
    if (items.length === 0) {
      parentEl.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px;font-style:italic">Empty</div>';
      return;
    }
    for (const it of items) {
      if (it.isDirectory) {
        const node = createTreeNode(it.name, "📁", depth, true);
        const childPath = path ? `${path}/${it.name}` : it.name;
        node.querySelector(".tree-item").addEventListener("click", () => toggleShareDir(node, shareName, childPath, depth + 1));
        parentEl.appendChild(node);
      } else {
        const node = createTreeNode(it.name, "📄", depth, false);
        const filePath = path ? `${path}/${it.name}` : it.name;
        const sizeStr = it.size !== undefined ? ` ${(it.size / 1024).toFixed(1)}K` : "";
        const meta = node.querySelector(".tree-name");
        if (meta && sizeStr) {
          const m = document.createElement("span");
          m.className = "blob-size";
          m.textContent = sizeStr;
          node.querySelector(".tree-item").appendChild(m);
        }
        node.querySelector(".tree-item").addEventListener("click", () => viewShareFile(shareName, filePath, it.size));
        parentEl.appendChild(node);
      }
    }
  }

  async function toggleShareDir(node, shareName, path, depth) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");
    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "▶";
      return;
    }
    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "▼";
      return;
    }
    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
    children.classList.add("expanded");
    toggle.textContent = "▼";
    try {
      await loadShareDir(children, shareName, path, depth);
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function viewShareFile(shareName, filePath, size) {
    const shortName = filePath.split("/").pop();
    contentTitle.textContent = shortName;
    contentMeta.textContent = size ? `${(size / 1024).toFixed(1)} KB` : "";
    contentBody.innerHTML = '<p class="placeholder">Loading...</p>';
    resetEditor();
    const _shareExt = (filePath.split(".").pop() || "").toLowerCase();
    if ((_shareExt === "html" || _shareExt === "htm") && !location.hash.includes("view=source")) {
      if (window.htmlView) {
        contentBody.addEventListener('html-view:view-source', () => {
          location.hash = 'view=source';
          viewShareFile(shareName, filePath, size);
        }, { once: true });
        await window.htmlView.render({
          storage: currentStorage,
          container: shareName,
          share: shareName,
          path: filePath,
          scope: 'share',
          contentBody,
        });
        return;
      }
    }
    const url = withAccount(`/api/file/${encodeURIComponent(currentStorage)}/${encodeURIComponent(shareName)}?path=${encodeURIComponent(filePath)}`);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err && err.error && err.error.message) || `HTTP ${res.status}`);
      }
      const text = await res.text();
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      const renderView = (t) => {
        if (ext === "json") {
          try { contentBody.innerHTML = `<pre><code>${escapeHtml(JSON.stringify(JSON.parse(t), null, 2))}</code></pre>`; }
          catch { contentBody.innerHTML = `<pre>${escapeHtml(t)}</pre>`; }
        } else {
          contentBody.innerHTML = `<pre>${escapeHtml(t)}</pre>`;
        }
      };
      renderView(text);
      const meta = readEditability(res);
      if (meta.editable) {
        arm("file", {
          storage: currentStorage,
          share: shareName,
          path: filePath,
          contentType: res.headers.get("content-type") || "text/plain; charset=utf-8",
          originalText: text,
          etag: meta.etag,
          restoreView: renderView,
        });
      }
    } catch (err) {
      contentBody.innerHTML = `<p class="placeholder">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  // Inline-SVG replacements for the emoji tree icons. Keyed by the emoji
  // strings the call sites already pass, so no call site changes. i-nav
  // icons tint with the accent (Finder-style); i-doc icons stay secondary.
  const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const TREE_ICON_SVG = {
    // key (storage account / API account root)
    "🔑": `<svg class="i-nav" ${SVG_ATTRS}><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
    // container (archive box)
    "📦": `<svg class="i-nav" ${SVG_ATTRS}><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
    // folder
    "📁": `<svg class="i-nav" ${SVG_ATTRS}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
    // open folder (file share)
    "📂": `<svg class="i-nav" ${SVG_ATTRS}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
    // generic file / pdf
    "📄": `<svg class="i-doc" ${SVG_ATTRS}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
    // json (braces)
    "📋": `<svg class="i-doc" ${SVG_ATTRS}><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>`,
    // markdown (file with text lines)
    "📝": `<svg class="i-doc" ${SVG_ATTRS}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
    // txt (file with text lines)
    "📃": `<svg class="i-doc" ${SVG_ATTRS}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
    // docx (book)
    "📖": `<svg class="i-doc" ${SVG_ATTRS}><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
    // html (globe)
    "🌐": `<svg class="i-doc" ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
    // other (paperclip)
    "📎": `<svg class="i-doc" ${SVG_ATTRS}><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485L21 12.3"/></svg>`,
  };

  function createTreeNode(name, icon, depth, hasChildren) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const item = document.createElement("div");
    item.className = "tree-item";
    item.style.setProperty("--depth", depth);

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = hasChildren ? "\u25B6" : "";

    const iconSpan = document.createElement("span");
    iconSpan.className = "tree-icon";
    if (TREE_ICON_SVG[icon]) {
      iconSpan.innerHTML = TREE_ICON_SVG[icon];
    } else {
      iconSpan.textContent = icon;
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = name;

    item.appendChild(toggle);
    item.appendChild(iconSpan);
    item.appendChild(nameSpan);
    wrapper.appendChild(item);

    if (hasChildren) {
      const children = document.createElement("div");
      children.className = "tree-children";
      wrapper.appendChild(children);
    }

    return wrapper;
  }

  async function toggleContainer(node, containerName) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");

    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "\u25B6";
      return;
    }

    // If already loaded, just expand
    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "\u25BC";
      return;
    }

    // Load blobs
    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
    children.classList.add("expanded");
    toggle.textContent = "\u25BC";
    currentContainer = containerName;

    try {
      await loadTreeLevel(children, containerName, "", 1);

      // Fetch links for this container and add indicators
      try {
        const registry = await apiJson(`/api/links/${currentStorage}/${containerName}`);
        containerLinksCache[containerName] = registry;
        if (registry && registry.links && registry.links.length > 0) {
          // Add sync badge to container node (opens links panel on click)
          const containerItem = node.querySelector(".tree-item");
          if (containerItem && !containerItem.querySelector(".sync-badge")) {
            const badge = document.createElement("span");
            badge.className = "sync-badge";
            badge.innerHTML = `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>`;
            badge.title = `${registry.links.length} repo link(s)`;
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              openLinksPanel(containerName);
            });
            containerItem.appendChild(badge);
          }

          // Add link-badge indicators to folders that have a targetPrefix matching
          addLinkIndicators(children, containerName, registry.links);
        }
      } catch { /* no links */ }

      // Reverse-link badge (Phase G — outbound storage→repo links).
      // Runs independently from the forward-link fetch above; failure is silent.
      if (typeof window.__addReverseLinkBadgesForContainer === "function") {
        try { await window.__addReverseLinkBadgesForContainer(node, containerName); } catch {}
      }
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadTreeLevel(parentEl, container, prefix, depth) {
    let url = `/api/blobs/${currentStorage}/${container}`;
    if (prefix) url += `?prefix=${encodeURIComponent(prefix)}`;
    const items = await apiJson(withAccount(url));

    parentEl.innerHTML = "";

    for (const item of items) {
      const shortName = item.name.replace(prefix, "").replace(/\/$/, "");
      if (shortName === ".keep") continue;

      if (item.isPrefix) {
        const node = createTreeNode(shortName, "\uD83D\uDCC1", depth, true);
        node.querySelector(".tree-item").addEventListener("click", () => toggleFolder(node, container, item.name, depth + 1));
        node.querySelector(".tree-item").addEventListener("contextmenu", (e) => {
          e.preventDefault();
          folderContextTarget = { container, folderName: shortName, folderPrefix: item.name, parentEl, prefix, depth, node };
          folderCtxMenu.style.left = e.clientX + "px";
          folderCtxMenu.style.top = e.clientY + "px";
          folderCtxMenu.classList.remove("hidden");
        });
        parentEl.appendChild(node);
      } else {
        const icon = getFileIcon(shortName);
        const size = item.size ? `${(item.size / 1024).toFixed(1)}K` : "";
        const node = createTreeNode(shortName, icon, depth, false);
        if (size) {
          const meta = document.createElement("span");
          meta.className = "tree-meta";
          meta.textContent = size;
          node.querySelector(".tree-item").appendChild(meta);
        }
        node.querySelector(".tree-item").addEventListener("click", () => {
          if (activeTreeItem) activeTreeItem.classList.remove("active");
          node.querySelector(".tree-item").classList.add("active");
          activeTreeItem = node.querySelector(".tree-item");
          viewFile(container, item.name, item.size);
        });
        node.querySelector(".tree-item").addEventListener("contextmenu", (e) => {
          e.preventDefault();
          contextTarget = { container, blobName: item.name, parentEl, prefix, depth };
          ctxMenu.style.left = e.clientX + "px";
          ctxMenu.style.top = e.clientY + "px";
          ctxMenu.classList.remove("hidden");
        });
        parentEl.appendChild(node);
      }
    }

    if (items.length === 0) {
      parentEl.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px;font-style:italic">Empty</div>';
    }
  }

  async function toggleFolder(node, container, prefix, depth) {
    const toggle = node.querySelector(".tree-toggle");
    const children = node.querySelector(".tree-children");

    if (children.classList.contains("expanded")) {
      children.classList.remove("expanded");
      toggle.textContent = "\u25B6";
      return;
    }

    if (children.children.length > 0) {
      children.classList.add("expanded");
      toggle.textContent = "\u25BC";
      return;
    }

    children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
    children.classList.add("expanded");
    toggle.textContent = "\u25BC";

    try {
      await loadTreeLevel(children, container, prefix, depth);
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired)">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function getFileIcon(name) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "json") return "\uD83D\uDCCB";
    if (ext === "md") return "\uD83D\uDCDD";
    if (ext === "pdf") return "\uD83D\uDCC4";
    if (ext === "txt") return "\uD83D\uDCC3";
    if (ext === "docx" || ext === "doc") return "\uD83D\uDCD6";
    if (ext === "html" || ext === "htm") return "\uD83C\uDF10";
    return "\uD83D\uDCCE";
  }

  // --- File Viewer ---
  async function viewFile(container, blobName, size) {
    const shortName = blobName.split("/").pop();
    contentTitle.textContent = shortName;
    contentMeta.textContent = size ? `${(size / 1024).toFixed(1)} KB` : "";
    contentBody.innerHTML = '<p class="placeholder">Loading...</p>';
    resetEditor();

    const ext = blobName.split(".").pop()?.toLowerCase();
    const url = withAccount(`/api/blob/${currentStorage}/${container}?blob=${encodeURIComponent(blobName)}`);

    try {
      if (ext === "pdf") {
        try {
          const pdfRes = await fetch(url);
          if (!pdfRes.ok) throw new Error(`API error: ${pdfRes.status}`);
          const pdfBlob = await pdfRes.blob();
          const blobUrl = URL.createObjectURL(new Blob([pdfBlob], { type: "application/pdf" }));
          contentBody.innerHTML = `<iframe class="pdf-embed" src="${escapeHtml(blobUrl)}"></iframe>`;
        } catch (e) {
          contentBody.innerHTML = `<p class="placeholder">Error loading PDF: ${escapeHtml(e.message)}</p>`;
        }
        return;
      }

      if ((ext === "html" || ext === "htm") && !location.hash.includes("view=source")) {
        if (window.htmlView) {
          contentBody.addEventListener('html-view:view-source', () => {
            location.hash = 'view=source';
            viewFile(container, blobName, size);
          }, { once: true });
          await window.htmlView.render({
            storage: currentStorage,
            container,
            path: blobName,
            scope: 'container',
            contentBody,
          });
          return;
        }
        // Fall through if html-view.js failed to load — render as escaped text.
      }

      if (ext === "docx" || ext === "doc") {
        try {
          const res = await api(url + "&format=html");
          const html = await res.text();
          // Sanitize: strip script/iframe/object/embed tags to prevent XSS from untrusted docx
          const sanitized = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<(iframe|object|embed|link|meta|form)[^>]*>/gi, "");
          contentBody.innerHTML = `<div class="docx-view">${sanitized}</div>`;
        } catch (e) {
          contentBody.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
        }
        return;
      }

      const res = await api(url);
      const text = await res.text();

      const renderView = (t) => {
        if (ext === "json") {
          try {
            const parsed = JSON.parse(t);
            contentBody.innerHTML = `<pre><code class="language-json">${escapeHtml(JSON.stringify(parsed, null, 2))}</code></pre>`;
            if (window.hljs) hljs.highlightAll();
          } catch {
            contentBody.innerHTML = `<pre class="text-view">${escapeHtml(t)}</pre>`;
          }
        } else if (ext === "md") {
          if (window.marked) {
            contentBody.innerHTML = `<div class="markdown-view">${marked.parse(t)}</div>`;
            if (window.hljs) contentBody.querySelectorAll("pre code").forEach(el => hljs.highlightElement(el));
          } else {
            contentBody.innerHTML = `<pre class="text-view">${escapeHtml(t)}</pre>`;
          }
        } else {
          contentBody.innerHTML = `<pre class="text-view">${escapeHtml(t)}</pre>`;
        }
      };
      renderView(text);

      const meta = readEditability(res);
      if (meta.editable) {
        arm("blob", {
          storage: currentStorage,
          container,
          path: blobName,
          contentType: res.headers.get("content-type") || "text/plain; charset=utf-8",
          originalText: text,
          etag: meta.etag,
          restoreView: renderView,
        });
      }
    } catch (e) {
      contentBody.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // --- Inline Text Editor (PR #5) ---
  // Single editor context per content panel. resetEditor() is called every
  // time the panel loads a new file or clears, so stale Save handlers from
  // a previous file can't fire against the new path.
  let currentEditor = null;

  // Find-bar state and constants live here — above resetEditor(), which runs
  // during the first panel render and reaches teardownEditorSurface().
  //
  // Ceiling on highlighted matches. A one-character query against a large file
  // would otherwise create tens of thousands of <mark> nodes on every keystroke.
  // When the cap is hit the count reads "N+" and says so in its tooltip — the
  // truncation is never silent.
  const FIND_MATCH_CAP = 5000;

  // Properties that must be identical on the textarea and the highlight mirror
  // for the two to wrap text the same way.
  const MIRROR_STYLE_PROPS = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
    "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "boxSizing", "whiteSpace", "overflowWrap", "wordBreak", "tabSize", "direction",
  ];

  // The query and the option toggles survive editor teardown (so Cmd+F in the
  // next file starts where the user left off); matches and marks do not.
  const findState = {
    open: false,
    query: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    matches: [],
    marks: [],
    index: -1,
    capped: false,
    error: false,
  };

  // Platform-correct label for the find shortcut. It is the only place the user
  // is told the shortcut exists, so it must match the key they actually press.
  // Case-insensitive on purpose: userAgentData reports "macOS", the legacy
  // navigator.platform reports "MacIntel".
  const IS_MAC = /mac|iphone|ipad|ipod/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent
  );
  const FIND_SHORTCUT_LABEL = IS_MAC ? "⌘F" : "Ctrl+F";
  editFindHint.textContent = FIND_SHORTCUT_LABEL;
  editFindBtn.title = `Find in this file (${FIND_SHORTCUT_LABEL})`;

  function clearEditControls() {
    editControls.hidden = true;
    editBtn.hidden = true;
    editSaveBtn.hidden = true;
    editCancelBtn.hidden = true;
    editFindBtn.hidden = true;
    editFindBtn.classList.remove("active");
    editStatusEl.textContent = "";
    editStatusEl.classList.remove("error");
  }

  function resetEditor() {
    teardownEditorSurface();
    currentEditor = null;
    clearEditControls();
  }

  // Determine whether the file is editable from the response headers the
  // server emits. The renderer mirrors the server's decision rather than
  // re-implementing it — keeps the detection rules in one place.
  function readEditability(res) {
    return {
      editable: res.headers.get("x-editable") === "true",
      reason: res.headers.get("x-editable-reason") || "unknown",
      etag: res.headers.get("etag") || "",
    };
  }

  function arm(kind, ctx) {
    // ctx fields: { storage, container?, share?, path, contentType, originalText, etag, restoreView }
    currentEditor = { kind, ...ctx, modified: false };
    editControls.hidden = false;
    editBtn.hidden = false;
    editSaveBtn.hidden = true;
    editCancelBtn.hidden = true;
    editFindBtn.hidden = true; // find is an edit-mode affordance only
    editFindBtn.classList.remove("active");
    editStatusEl.textContent = "";
    editStatusEl.classList.remove("error");
  }

  function enterEditMode() {
    if (!currentEditor) return;

    // Editing surface: [highlight mirror] + [textarea] + [find bar], all inside
    // one wrapper so the whole thing is discarded together when the panel
    // reloads. See buildEditorSurface() for why the mirror exists.
    const surface = buildEditorSurface(currentEditor.originalText);
    contentBody.innerHTML = "";
    contentBody.appendChild(surface.wrap);

    const ta = surface.textarea;
    Object.assign(currentEditor, surface, { modified: false });

    editBtn.hidden = true;
    editSaveBtn.hidden = false;
    editSaveBtn.disabled = true;
    editCancelBtn.hidden = false;
    editFindBtn.hidden = false; // announces that find exists, and opens it
    editFindBtn.classList.remove("active");
    editStatusEl.textContent = "Editing…";
    editStatusEl.classList.remove("error");
    ta.addEventListener("input", () => {
      const changed = ta.value !== currentEditor.originalText;
      currentEditor.modified = changed;
      editSaveBtn.disabled = !changed;
      editStatusEl.textContent = changed ? "Unsaved changes" : "Editing…";
      // Matches are offsets into the text — every edit invalidates them.
      if (findState.open) runFind({ keepIndex: true });
    });
    ta.addEventListener("scroll", syncHighlightScroll);
    surface.wrap.addEventListener("keydown", onEditorKeydown);
    surface.findBar.addEventListener("click", onFindBarClick);
    surface.findInput.addEventListener("input", () => {
      findState.query = surface.findInput.value;
      runFind({ preferFrom: ta.selectionStart });
    });

    // The mirror must re-wrap exactly when the textarea does, so its box is
    // re-measured on every size change (panel resize, window resize).
    syncHighlightMetrics();
    if (typeof ResizeObserver === "function") {
      currentEditor.resizeObs = new ResizeObserver(() => {
        syncHighlightMetrics();
        syncHighlightScroll();
      });
      currentEditor.resizeObs.observe(ta);
    }

    // The find bar always starts closed; the query and the option toggles
    // persist across files, the way a real editor's find does.
    findState.open = false;
    findState.matches = [];
    findState.marks = [];
    findState.index = -1;

    ta.focus();
  }

  // --- Editor find (Cmd/Ctrl+F) ----------------------------------------------
  // A textarea cannot render styled ranges, so matches are painted by a mirror
  // <div> positioned exactly behind it — same font metrics, padding, border and
  // wrapping rules, scroll-synced — holding the same text with <mark> around
  // every hit. The textarea itself is transparent (see .editor-wrap in
  // styles.css), so the marks show through underneath the real caret and
  // selection. Match navigation scrolls by reading the current <mark>'s
  // offsetTop out of the mirror, which needs no text measurement of its own.

  function buildEditorSurface(text) {
    const wrap = document.createElement("div");
    wrap.className = "editor-wrap";

    const highlights = document.createElement("div");
    highlights.className = "editor-highlights";
    highlights.setAttribute("aria-hidden", "true");
    const mirror = document.createElement("div");
    mirror.className = "editor-mirror";
    highlights.appendChild(mirror);

    const ta = document.createElement("textarea");
    ta.className = "text-editor";
    ta.spellcheck = false;
    ta.value = text;

    const findBar = document.createElement("div");
    findBar.className = "editor-find";
    findBar.hidden = true;
    findBar.innerHTML =
      '<input type="text" class="editor-find-input" placeholder="Find" spellcheck="false" aria-label="Find in file">' +
      '<span class="editor-find-count" aria-live="polite"></span>' +
      '<span class="editor-find-toggles">' +
        '<button type="button" class="editor-find-toggle" data-opt="caseSensitive" title="Match case" aria-pressed="false">Aa</button>' +
        '<button type="button" class="editor-find-toggle" data-opt="wholeWord" title="Whole word" aria-pressed="false">ab</button>' +
        '<button type="button" class="editor-find-toggle" data-opt="regex" title="Regular expression" aria-pressed="false">.*</button>' +
      '</span>' +
      '<button type="button" class="editor-find-nav" data-nav="prev" title="Previous match (Shift+Enter)">‹</button>' +
      '<button type="button" class="editor-find-nav" data-nav="next" title="Next match (Enter)">›</button>' +
      '<button type="button" class="editor-find-close" title="Close (Esc)" aria-label="Close find">×</button>';

    // Mirror first (z-index 0), textarea over it, find bar on top.
    wrap.appendChild(highlights);
    wrap.appendChild(ta);
    wrap.appendChild(findBar);

    return {
      wrap,
      highlights,
      mirror,
      textarea: ta,
      findBar,
      findInput: findBar.querySelector(".editor-find-input"),
      findCount: findBar.querySelector(".editor-find-count"),
      findNavs: Array.prototype.slice.call(findBar.querySelectorAll(".editor-find-nav")),
      findToggles: Array.prototype.slice.call(findBar.querySelectorAll(".editor-find-toggle")),
    };
  }

  function teardownEditorSurface() {
    const ed = currentEditor;
    findState.open = false;
    findState.matches = [];
    findState.marks = [];
    findState.index = -1;
    if (!ed) return;
    if (ed.resizeObs) {
      ed.resizeObs.disconnect();
      ed.resizeObs = null;
    }
    // Drop the DOM references; the nodes themselves go away with contentBody.
    ed.wrap = ed.highlights = ed.mirror = null;
    ed.findBar = ed.findInput = ed.findCount = ed.findNavs = ed.findToggles = null;
  }

  function syncHighlightMetrics() {
    const ed = currentEditor;
    if (!ed || !ed.highlights) return;
    const cs = getComputedStyle(ed.textarea);
    for (const prop of MIRROR_STYLE_PROPS) ed.highlights.style[prop] = cs[prop];
    ed.highlights.style.borderStyle = "solid";
    ed.highlights.style.borderColor = "transparent";
    ed.borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const borderY = ed.borderTop + (parseFloat(cs.borderBottomWidth) || 0);
    // clientWidth/clientHeight exclude the borders AND the scrollbar gutter, so
    // adding the borders back gives the mirror a border box that wraps text over
    // exactly the width the textarea has available.
    ed.highlights.style.width = (ed.textarea.clientWidth + borderX) + "px";
    ed.highlights.style.height = (ed.textarea.clientHeight + borderY) + "px";
  }

  function syncHighlightScroll() {
    const ed = currentEditor;
    if (!ed || !ed.highlights) return;
    ed.highlights.scrollTop = ed.textarea.scrollTop;
    ed.highlights.scrollLeft = ed.textarea.scrollLeft;
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function computeMatches(text) {
    findState.capped = false;
    findState.error = false;
    if (!findState.query) return [];
    let re;
    try {
      let source = findState.regex ? findState.query : escapeRegExp(findState.query);
      if (findState.wholeWord) source = "\\b(?:" + source + ")\\b";
      re = new RegExp(source, findState.caseSensitive ? "gm" : "gmi");
    } catch {
      findState.error = true;
      return [];
    }
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      // A pattern that can match empty (e.g. "a*") would never advance.
      if (m[0].length === 0) {
        re.lastIndex += 1;
        if (re.lastIndex > text.length) break;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length });
      if (out.length >= FIND_MATCH_CAP) {
        findState.capped = true;
        break;
      }
    }
    return out;
  }

  function renderHighlights() {
    const ed = currentEditor;
    if (!ed || !ed.mirror) return;
    const text = ed.textarea.value;
    const matches = findState.matches;
    let html = "";
    let last = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      html += escapeHtml(text.slice(last, m.start));
      html += i === findState.index
        ? '<mark class="current">' + escapeHtml(text.slice(m.start, m.end)) + "</mark>"
        : "<mark>" + escapeHtml(text.slice(m.start, m.end)) + "</mark>";
      last = m.end;
    }
    html += escapeHtml(text.slice(last));
    // A textarea renders the empty line after a trailing newline; pre-wrap in a
    // div does not. The zero-width space keeps the two scroll heights equal.
    if (text.endsWith("\n")) html += "\u200b";
    ed.mirror.innerHTML = html;
    findState.marks = Array.prototype.slice.call(ed.mirror.querySelectorAll("mark"));
  }

  function markCurrent() {
    for (let i = 0; i < findState.marks.length; i++) {
      findState.marks[i].classList.toggle("current", i === findState.index);
    }
  }

  function updateFindStatus() {
    const ed = currentEditor;
    if (!ed || !ed.findCount) return;
    const count = ed.findCount;
    const bad = findState.error;
    ed.findInput.classList.toggle("error", bad);
    count.classList.toggle("error", bad);
    const total = findState.matches.length;
    const hasNav = total > 0;
    ed.findNavs.forEach((b) => { b.disabled = !hasNav; });
    if (bad) {
      count.textContent = "Invalid pattern";
      count.title = "";
    } else if (!findState.query) {
      count.textContent = "";
      count.title = "";
    } else if (total === 0) {
      count.textContent = "No results";
      count.title = "";
    } else {
      count.textContent = (findState.index + 1) + " of " + total + (findState.capped ? "+" : "");
      count.title = findState.capped
        ? "Only the first " + FIND_MATCH_CAP + " matches are highlighted"
        : "";
    }
  }

  // opts.keepIndex — hold the current position (used while the file is edited).
  // opts.preferFrom — otherwise select the first match at/after this offset.
  function runFind(opts) {
    const ed = currentEditor;
    if (!ed || !ed.textarea) return;
    const options = opts || {};
    findState.matches = computeMatches(ed.textarea.value);
    const total = findState.matches.length;
    if (total === 0) {
      findState.index = -1;
    } else if (options.keepIndex) {
      findState.index = Math.min(Math.max(findState.index, 0), total - 1);
    } else {
      const from = typeof options.preferFrom === "number" ? options.preferFrom : 0;
      let i = -1;
      for (let k = 0; k < total; k++) {
        if (findState.matches[k].start >= from) { i = k; break; }
      }
      findState.index = i === -1 ? 0 : i;
    }
    renderHighlights();
    updateFindStatus();
    if (!options.keepIndex) revealCurrentMatch();
    else syncHighlightScroll();
  }

  function stepFind(delta) {
    const total = findState.matches.length;
    if (total === 0) return;
    findState.index = (findState.index + delta + total) % total;
    markCurrent();
    updateFindStatus();
    revealCurrentMatch();
  }

  function revealCurrentMatch() {
    const ed = currentEditor;
    const el = findState.marks[findState.index];
    if (!ed || !el) return;
    const ta = ed.textarea;
    // offsetTop is measured from the mirror's border-box top in unscrolled
    // content coordinates, so subtracting the border gives the textarea's
    // equivalent scrollTop for that line.
    const top = el.offsetTop - (ed.borderTop || 0);
    const bottom = top + el.offsetHeight;
    // The find bar floats over the top of the viewport, so a match in that band
    // counts as hidden even though it is technically scrolled in. Centering the
    // match clears the band. (At the very start of the file, where scrolling
    // cannot help, .find-open's reserved padding keeps the text clear instead.)
    const occluded = ed.findBar && !ed.findBar.hidden ? ed.findBar.offsetHeight + 10 : 0;
    if (top < ta.scrollTop + occluded || bottom > ta.scrollTop + ta.clientHeight) {
      ta.scrollTop = Math.max(0, top - (ta.clientHeight - el.offsetHeight) / 2);
    }
    syncHighlightScroll();
  }

  function syncFindToggles() {
    const ed = currentEditor;
    if (!ed || !ed.findToggles) return;
    ed.findToggles.forEach((btn) => {
      const on = !!findState[btn.dataset.opt];
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function openFind() {
    const ed = currentEditor;
    if (!ed || !ed.findBar) return;
    // Seed from the selection, like every other editor's Cmd+F.
    const selection = ed.textarea.value.slice(ed.textarea.selectionStart, ed.textarea.selectionEnd);
    if (selection && !selection.includes("\n")) findState.query = selection;
    findState.open = true;
    ed.findBar.hidden = false;
    editFindBtn.classList.add("active");
    ed.wrap.classList.add("find-open"); // reserves the bar's height in the textarea
    syncHighlightMetrics();
    ed.findInput.value = findState.query;
    syncFindToggles();
    runFind({ preferFrom: ed.textarea.selectionStart });
    ed.findInput.focus();
    ed.findInput.select();
  }

  function closeFind() {
    const ed = currentEditor;
    const match = findState.matches[findState.index];
    findState.open = false;
    findState.matches = [];
    findState.marks = [];
    findState.index = -1;
    editFindBtn.classList.remove("active");
    if (!ed || !ed.findBar) return;
    ed.findBar.hidden = true;
    ed.wrap.classList.remove("find-open");
    syncHighlightMetrics();
    ed.mirror.textContent = "";
    ed.findInput.classList.remove("error");
    ed.textarea.focus();
    // Leave the caret on the match the user was looking at.
    if (match) ed.textarea.setSelectionRange(match.start, match.end);
  }

  function onEditorKeydown(e) {
    const ed = currentEditor;
    if (!ed || !ed.findBar) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && (e.key === "f" || e.key === "F")) {
      e.preventDefault(); // suppress the host browser's own find-in-page
      if (findState.open) {
        ed.findInput.focus();
        ed.findInput.select();
      } else {
        openFind();
      }
      return;
    }
    if (!findState.open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
      return;
    }
    if (e.key === "F3" || (mod && (e.key === "g" || e.key === "G"))) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Enter" && e.target === ed.findInput) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    }
  }

  function onFindBarClick(e) {
    const ed = currentEditor;
    const btn = e.target.closest("button");
    if (!ed || !btn) return;
    if (btn.classList.contains("editor-find-close")) {
      closeFind();
      return;
    }
    if (btn.dataset.nav) {
      stepFind(btn.dataset.nav === "prev" ? -1 : 1);
      ed.findInput.focus();
      return;
    }
    if (btn.dataset.opt) {
      findState[btn.dataset.opt] = !findState[btn.dataset.opt];
      syncFindToggles();
      runFind({ preferFrom: ed.textarea.selectionStart });
      ed.findInput.focus();
    }
  }

  function exitEditMode() {
    if (!currentEditor) return;
    teardownEditorSurface();
    editBtn.hidden = false;
    editSaveBtn.hidden = true;
    editCancelBtn.hidden = true;
    editFindBtn.hidden = true;
    editFindBtn.classList.remove("active");
    editStatusEl.textContent = "";
    editStatusEl.classList.remove("error");
    // Re-render the viewer with whatever original text is now current. The
    // caller updates currentEditor.originalText after a successful save so
    // the viewer reflects the new content without a server round-trip.
    if (typeof currentEditor.restoreView === "function") {
      currentEditor.restoreView(currentEditor.originalText);
    }
  }

  async function saveEdit() {
    if (!currentEditor) return;
    const newText = currentEditor.textarea.value;
    editSaveBtn.disabled = true;
    editCancelBtn.disabled = true;
    editStatusEl.textContent = "Saving…";
    editStatusEl.classList.remove("error");

    const url = currentEditor.kind === "blob"
      ? withAccount(`/api/blob/${encodeURIComponent(currentEditor.storage)}/${encodeURIComponent(currentEditor.container)}?blob=${encodeURIComponent(currentEditor.path)}`)
      : withAccount(`/api/file/${encodeURIComponent(currentEditor.storage)}/${encodeURIComponent(currentEditor.share)}?path=${encodeURIComponent(currentEditor.path)}`);

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newText,
          ifMatch: currentEditor.etag || undefined,
          contentType: currentEditor.contentType,
        }),
      });
      if (res.status === 412) {
        editStatusEl.textContent = "File changed in storage. Reload to see the latest version.";
        editStatusEl.classList.add("error");
        editSaveBtn.disabled = false;
        editCancelBtn.disabled = false;
        return;
      }
      if (res.status === 413) {
        editStatusEl.textContent = "File too large to save through the editor.";
        editStatusEl.classList.add("error");
        editSaveBtn.disabled = false;
        editCancelBtn.disabled = false;
        return;
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); detail = (j.error && j.error.message) || j.error || detail; } catch {}
        throw new Error(detail);
      }
      const result = await res.json().catch(() => ({}));
      currentEditor.originalText = newText;
      if (result.etag) currentEditor.etag = result.etag;
      editStatusEl.textContent = "Saved";
      editStatusEl.classList.remove("error");
      exitEditMode();
    } catch (err) {
      editStatusEl.textContent = "Save failed: " + err.message;
      editStatusEl.classList.add("error");
      editSaveBtn.disabled = false;
      editCancelBtn.disabled = false;
    }
  }

  editBtn.addEventListener("click", enterEditMode);
  editCancelBtn.addEventListener("click", () => { exitEditMode(); });
  editSaveBtn.addEventListener("click", () => { saveEdit(); });
  // Acts as a toggle so the button reflects, and controls, the bar's state.
  editFindBtn.addEventListener("click", () => {
    if (!currentEditor || !currentEditor.findBar) return;
    if (findState.open) closeFind();
    else openFind();
  });

  // --- Export ---
  exportBtn.addEventListener("click", async () => {
    if (!currentStorage) { alert("Select a storage account first."); return; }
    try {
      const data = await apiJson(`/api/export/${currentStorage}`);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${currentStorage}-config.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("Export failed: " + e.message);
    }
  });

  // --- GitHub Apps ---
  githubAppsBtn.addEventListener("click", async () => {
    await loadGitHubApps();
    githubAppsModal.classList.remove("hidden");
  });

  // --- Refresh ---
  refreshBtn.addEventListener("click", async () => {
    if (!currentStorage) { return; }
    contentTitle.textContent = "No file selected";
    contentMeta.textContent = "";
    contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>'; resetEditor();
    activeTreeItem = null;
    await buildTree();
  });

  // --- Add Storage Modal ---
  addBtn.addEventListener("click", () => {
    resetApiStaticRow();
    modal.classList.remove("hidden");
  });
  modalCancel.addEventListener("click", () => modal.classList.add("hidden"));
  modalSave.addEventListener("click", async () => {
    const name = document.getElementById("modal-name").value.trim();
    const account = document.getElementById("modal-account").value.trim();
    const key = document.getElementById("modal-key").value.trim();
    const authType = modalAuthType.value;
    if (!name || !account || !key) { alert("All fields are required"); return; }

    const body = { name, accountName: account };
    if (authType === "sas-token") body.sasToken = key;
    else body.accountKey = key;

    try {
      await apiJson("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      modal.classList.add("hidden");
      document.getElementById("modal-name").value = "";
      document.getElementById("modal-account").value = "";
      document.getElementById("modal-key").value = "";
      await loadStorages();
    } catch (e) {
      alert("Failed: " + e.message);
    }
  });

  // --- Add Storage Modal: API tab ("Connect to Storage Navigator API") ---
  const apiCancelBtn = document.getElementById("api-cancel");
  const apiAddBtn = document.getElementById("api-add-btn");
  const apiNameInput = document.getElementById("api-name");
  const apiUrlInput = document.getElementById("api-url");
  const apiStatus = document.getElementById("api-status");

  if (apiCancelBtn) {
    apiCancelBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      if (apiStatus) apiStatus.textContent = "";
    });
  }

  if (apiAddBtn) {
    apiAddBtn.addEventListener("click", async () => {
      const name = apiNameInput.value.trim();
      const baseUrl = apiUrlInput.value.trim().replace(/\/$/, "");
      if (!name || !baseUrl) {
        apiStatus.textContent = "Name and base URL are required";
        return;
      }

      apiAddBtn.disabled = true;
      try {
        apiStatus.textContent = "Probing API...";
        // Proxy through the embedded server — direct fetch from the renderer
        // hits CORS on the deployed Azure URL.
        const probeRes = await fetch(`/api/discovery?url=${encodeURIComponent(baseUrl)}`);
        if (!probeRes.ok) {
          const err = await probeRes.json().catch(() => ({}));
          apiStatus.textContent = `Probe failed: ${(err && err.error && err.error.message) || `HTTP ${probeRes.status}`}`;
          return;
        }
        const probe = await probeRes.json();

        // Static-header gate
        let staticAuthHeader;
        if (probe.staticAuthHeaderRequired) {
          const headerName = probe.staticAuthHeaderName || 'X-Storage-Nav-Auth';
          const row = document.getElementById('api-static-secret-row');
          document.getElementById('api-static-label').textContent = headerName;
          row.hidden = false;
          const valueEl = document.getElementById('api-static-secret');
          const value = (valueEl.value || '').trim();
          if (!value) {
            apiStatus.textContent = `${headerName} is required — enter the value above and click Connect again.`;
            valueEl.focus();
            return;
          }
          staticAuthHeader = { name: headerName, value };
        }

        if (probe.authEnabled) {
          apiStatus.textContent = "Opening browser for OIDC login...";
          // Electron preload should expose window.electron.invoke. If not
          // exposed, fall back to a register-only path: the CLI can finish
          // the login afterwards via `storage-nav login --name <name>`.
          if (window.electron && typeof window.electron.invoke === "function") {
            const r = await window.electron.invoke("oidc:login", {
              name,
              issuer: probe.issuer,
              clientId: probe.clientId,
              audience: probe.audience,
              scopes: probe.scopes,
            });
            if (!r || !r.ok) { apiStatus.textContent = "OIDC login failed"; return; }
          } else {
            apiStatus.textContent = `OIDC login required — run \`storage-nav login --name ${name}\` after registration.`;
          }
        }

        const res = await fetch("/api/storage/api-backend", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            baseUrl,
            authEnabled: probe.authEnabled,
            oidc: probe.authEnabled
              ? { issuer: probe.issuer, clientId: probe.clientId, audience: probe.audience, scopes: probe.scopes }
              : undefined,
            staticAuthHeader,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          apiStatus.textContent = (err && err.error && err.error.message) || `HTTP ${res.status}`;
          return;
        }

        apiStatus.textContent = `Added "${name}".`;
        apiNameInput.value = "";
        apiUrlInput.value = "";
        modal.classList.add("hidden");
        await loadStorages();
      } catch (err) {
        apiStatus.textContent = "Error: " + (err && err.message ? err.message : String(err));
      } finally {
        apiAddBtn.disabled = false;
      }
    });
  }

  // --- Delete Storage ---
  deleteStorageBtn.addEventListener("click", () => {
    if (!currentStorage) return;
    const opt = storageSelect.options[storageSelect.selectedIndex];
    const label = opt ? opt.textContent : currentStorage;
    deleteStorageMessage.textContent = `Are you sure you want to delete the storage account "${label}"?`;
    deleteStorageModal.classList.remove("hidden");
  });

  deleteStorageCancel.addEventListener("click", () => {
    deleteStorageModal.classList.add("hidden");
  });

  deleteStorageConfirm.addEventListener("click", async () => {
    if (!currentStorage) return;
    const nameToDelete = currentStorage;

    deleteStorageConfirm.disabled = true;
    deleteStorageConfirm.textContent = "Deleting...";

    try {
      await apiJson(`/api/storages/${encodeURIComponent(nameToDelete)}`, { method: "DELETE" });
      deleteStorageModal.classList.add("hidden");

      // Reset the UI
      currentStorage = "";
      currentContainer = "";
      activeTreeItem = null;
      treeContent.innerHTML = '<p class="placeholder">Select a storage account to browse</p>';
      contentTitle.textContent = "No file selected";
      contentMeta.textContent = "";
      contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>'; resetEditor();

      await loadStorages();
    } catch (e) {
      alert("Delete failed: " + e.message);
    } finally {
      deleteStorageConfirm.disabled = false;
      deleteStorageConfirm.textContent = "Delete";
    }
  });

  // --- Context menu ---
  document.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
    folderCtxMenu.classList.add("hidden");
    containerCtxMenu.classList.add("hidden");
    storageAccountCtxMenu.classList.add("hidden");
  });
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".tree-item")) {
      ctxMenu.classList.add("hidden");
      folderCtxMenu.classList.add("hidden");
      containerCtxMenu.classList.add("hidden");
      storageAccountCtxMenu.classList.add("hidden");
    }
  });

  ctxRename.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
    if (!contextTarget) return;
    const fileName = contextTarget.blobName.split("/").pop();
    renameOld.value = fileName;
    renameNew.value = fileName;
    renameModal.classList.remove("hidden");
    renameNew.focus();
    renameNew.select();
  });

  renameCancel.addEventListener("click", () => {
    renameModal.classList.add("hidden");
    contextTarget = null;
  });

  renameSave.addEventListener("click", async () => {
    if (!contextTarget) return;
    const newFileName = renameNew.value.trim();
    if (!newFileName) { alert("File name cannot be empty"); return; }

    const oldName = contextTarget.blobName;
    const prefix = oldName.substring(0, oldName.lastIndexOf("/") + 1);
    const newName = prefix + newFileName;

    if (newName === oldName) { renameModal.classList.add("hidden"); return; }

    renameSave.disabled = true;
    renameSave.textContent = "Renaming...";

    try {
      await apiJson(withAccount(`/api/rename/${currentStorage}/${contextTarget.container}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName }),
      });

      renameModal.classList.add("hidden");

      // Refresh the parent folder level
      await loadTreeLevel(
        contextTarget.parentEl,
        contextTarget.container,
        contextTarget.prefix,
        contextTarget.depth
      );

      // If the renamed file was being viewed, update the content header
      if (contentTitle.textContent === oldName.split("/").pop()) {
        contentTitle.textContent = newFileName;
      }
    } catch (e) {
      alert("Rename failed: " + e.message);
    } finally {
      renameSave.disabled = false;
      renameSave.textContent = "Rename";
      contextTarget = null;
    }
  });

  // --- Refresh (file context) ---
  ctxRefresh.addEventListener("click", async () => {
    ctxMenu.classList.add("hidden");
    if (!contextTarget) return;
    await loadTreeLevel(
      contextTarget.parentEl,
      contextTarget.container,
      contextTarget.prefix,
      contextTarget.depth
    );
    contextTarget = null;
  });

  // --- Refresh (folder context) ---
  ctxRefreshFolder.addEventListener("click", async () => {
    folderCtxMenu.classList.add("hidden");
    if (!folderContextTarget) return;
    const children = folderContextTarget.node.querySelector(".tree-children");
    if (children && children.classList.contains("expanded")) {
      await loadTreeLevel(children, folderContextTarget.container, folderContextTarget.folderPrefix, folderContextTarget.depth + 1);
    }
    folderContextTarget = null;
  });

  // --- Refresh (container context) ---
  ctxRefreshContainer.addEventListener("click", async () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    const children = containerContextTarget.node.querySelector(".tree-children");
    if (children) {
      children.innerHTML = '<div style="padding:4px 24px;color:var(--text-dim);font-size:12px">Loading...</div>';
      children.classList.add("expanded");
      containerContextTarget.node.querySelector(".tree-toggle").textContent = "\u25BC";
      await loadTreeLevel(children, containerContextTarget.containerName, "", 1);
    }
    containerContextTarget = null;
  });

  // --- Download (single file) ---
  // Uses the embedded /api/download endpoint which sets Content-Disposition,
  // so the browser triggers Save As natively. Same code path is used by the
  // "Download as ZIP" actions below — they POST a path list to the
  // /api/download-zip endpoint and let the browser save the streamed archive.
  ctxDownload.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
    if (!contextTarget) return;
    const url = withAccount(`/api/download/${encodeURIComponent(currentStorage)}/${encodeURIComponent(contextTarget.container)}?blob=${encodeURIComponent(contextTarget.blobName)}`);
    triggerBrowserDownload(url);
    contextTarget = null;
  });

  // --- Download folder as ZIP ---
  ctxDownloadFolder.addEventListener("click", async () => {
    folderCtxMenu.classList.add("hidden");
    if (!folderContextTarget) return;
    const t = folderContextTarget;
    folderContextTarget = null;
    try {
      // Hand the prefix to the server — it walks every descendant blob in one
      // flat listing and streams them into the zip. The previous approach
      // listed hierarchically on the client and dropped subfolder contents
      // entirely because the listing came back with `isPrefix` placeholders.
      await downloadZipByPrefix(t.container, t.folderPrefix, `${t.folderName}.zip`);
    } catch (e) {
      alert("Download failed: " + e.message);
    }
  });

  // --- Download entire container as ZIP ---
  ctxDownloadContainer.addEventListener("click", async () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    const t = containerContextTarget;
    containerContextTarget = null;
    try {
      // Empty prefix = whole container. Server walks every blob.
      await downloadZipByPrefix(t.containerName, "", `${t.containerName}.zip`);
    } catch (e) {
      alert("Download failed: " + e.message);
    }
  });

  // Server-side recursive enumeration, routed through zip-download-ui.js so
  // the UX includes a progress indicator and (under Electron) a native
  // save-as dialog with the archive streamed straight to disk. The
  // controller picks the right transport based on window.electron.
  async function downloadZipByPrefix(container, prefix, archiveName) {
    const urlPath = withAccount(`/api/download-zip/${encodeURIComponent(currentStorage)}/${encodeURIComponent(container)}`);
    if (!window.zipDownload || typeof window.zipDownload.downloadZipByPrefix !== "function") {
      throw new Error("zip-download-ui not loaded");
    }
    const r = await window.zipDownload.downloadZipByPrefix({ urlPath, prefix, archiveName });
    if (r && r.cancelled) return; // user backed out — silent
    if (r && r.ok) return;
    throw new Error((r && r.error) || "Download failed");
  }

  // Retained for any future callers that already have a known path list (eg
  // multi-select of explicit files). Not used by folder/container downloads
  // anymore — those go through downloadZipByPrefix so the server can recurse.
  async function downloadZip(container, paths, basePath, archiveName) {
    const url = withAccount(`/api/download-zip/${encodeURIComponent(currentStorage)}/${encodeURIComponent(container)}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, basePath: basePath || undefined, archiveName }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, archiveName);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  function triggerBrowserDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // --- Delete ---
  ctxDelete.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
    if (!contextTarget) return;
    const fileName = contextTarget.blobName.split("/").pop();
    deleteMessage.textContent = `Are you sure you want to delete "${fileName}"?`;
    deleteModal.classList.remove("hidden");
  });

  deleteCancel.addEventListener("click", () => {
    deleteModal.classList.add("hidden");
    contextTarget = null;
  });

  deleteConfirm.addEventListener("click", async () => {
    if (!contextTarget) return;

    deleteConfirm.disabled = true;
    deleteConfirm.textContent = "Deleting...";

    try {
      const url = withAccount(`/api/blob/${currentStorage}/${contextTarget.container}?blob=${encodeURIComponent(contextTarget.blobName)}`);
      await apiJson(url, { method: "DELETE" });

      deleteModal.classList.add("hidden");

      // If the deleted file was being viewed, clear the content panel
      if (contentTitle.textContent === contextTarget.blobName.split("/").pop()) {
        contentTitle.textContent = "No file selected";
        contentMeta.textContent = "";
        contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>'; resetEditor();
        activeTreeItem = null;
      }

      // Refresh the parent folder level
      await loadTreeLevel(
        contextTarget.parentEl,
        contextTarget.container,
        contextTarget.prefix,
        contextTarget.depth
      );
    } catch (e) {
      alert("Delete failed: " + e.message);
    } finally {
      deleteConfirm.disabled = false;
      deleteConfirm.textContent = "Delete";
      contextTarget = null;
    }
  });

  // --- Delete Folder ---
  ctxDeleteFolder.addEventListener("click", () => {
    folderCtxMenu.classList.add("hidden");
    if (!folderContextTarget) return;
    deleteFolderMessage.textContent = `Are you sure you want to delete the folder "${folderContextTarget.folderName}" and ALL its contents?`;
    deleteFolderModal.classList.remove("hidden");
  });

  deleteFolderCancel.addEventListener("click", () => {
    deleteFolderModal.classList.add("hidden");
    folderContextTarget = null;
  });

  deleteFolderConfirm.addEventListener("click", async () => {
    if (!folderContextTarget) return;

    deleteFolderConfirm.disabled = true;
    deleteFolderConfirm.textContent = "Deleting...";

    try {
      const url = withAccount(`/api/folder/${currentStorage}/${folderContextTarget.container}?prefix=${encodeURIComponent(folderContextTarget.folderPrefix)}`);
      await apiJson(url, { method: "DELETE" });

      deleteFolderModal.classList.add("hidden");

      // Clear content panel if a file from the deleted folder was being viewed
      contentTitle.textContent = "No file selected";
      contentMeta.textContent = "";
      contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>'; resetEditor();
      activeTreeItem = null;

      // Refresh the parent folder level
      await loadTreeLevel(
        folderContextTarget.parentEl,
        folderContextTarget.container,
        folderContextTarget.prefix,
        folderContextTarget.depth
      );
    } catch (e) {
      alert("Delete folder failed: " + e.message);
    } finally {
      deleteFolderConfirm.disabled = false;
      deleteFolderConfirm.textContent = "Delete Folder";
      folderContextTarget = null;
    }
  });

  // --- Create File ---
  createBtn.addEventListener("click", async () => {
    if (!currentStorage) { alert("Select a storage account first."); return; }

    // Populate container dropdown
    try {
      const containers = await apiJson(withAccount(`/api/containers/${currentStorage}`));
      createContainer.innerHTML = '<option value="">Select container...</option>';
      for (const c of containers) {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = c.name;
        createContainer.appendChild(opt);
      }
    } catch (e) {
      alert("Failed to load containers: " + e.message);
      return;
    }

    createPath.value = "";
    createContent.value = "";
    createModal.classList.remove("hidden");
    createPath.focus();
  });

  createCancel.addEventListener("click", () => {
    createModal.classList.add("hidden");
  });

  createSave.addEventListener("click", async () => {
    const container = createContainer.value;
    const blobPath = createPath.value.trim();
    const content = createContent.value;

    if (!container) { alert("Select a container."); return; }
    if (!blobPath) { alert("File path is required."); return; }

    createSave.disabled = true;
    createSave.textContent = "Creating...";

    try {
      const ext = blobPath.split(".").pop()?.toLowerCase();
      let contentType = "text/plain";
      if (ext === "json") contentType = "application/json";
      else if (ext === "html") contentType = "text/html";
      else if (ext === "md") contentType = "text/plain";

      const url = withAccount(`/api/blob/${currentStorage}/${container}?blob=${encodeURIComponent(blobPath)}&contentType=${encodeURIComponent(contentType)}`);
      await apiJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      createModal.classList.add("hidden");

      // Refresh the tree to show the new file
      await buildTree();
    } catch (e) {
      alert("Create failed: " + e.message);
    } finally {
      createSave.disabled = false;
      createSave.textContent = "Create";
    }
  });

  // --- Sync ---
  syncCancel.addEventListener("click", () => {
    syncModal.classList.add("hidden");
    syncTarget = null;
  });

  syncConfirm.addEventListener("click", async () => {
    if (!syncTarget) return;
    syncConfirm.disabled = true;
    syncConfirm.textContent = "Syncing...";

    try {
      const res = await apiJson(`/api/sync/${currentStorage}/${syncTarget.container}`, {
        method: "POST",
      });
      syncModal.classList.add("hidden");
      alert(`Sync complete!\nUploaded: ${res.uploaded.length}\nDeleted: ${res.deleted.length}\nSkipped: ${res.skipped.length}\nErrors: ${res.errors.length}`);
      // Refresh the tree to reflect changes
      await buildTree();
    } catch (e) {
      const retryContainer = syncTarget.container;
      handleSyncError(e, "Sync failed", async () => {
        syncTarget = { container: retryContainer };
        syncConfirm.click();
      });
    } finally {
      syncConfirm.disabled = false;
      syncConfirm.textContent = "Sync Now";
      syncTarget = null;
    }
  });

  // --- Resizer ---
  const resizer = document.getElementById("resizer");
  const treePanel = document.getElementById("tree-panel");
  let isResizing = false;
  resizer.addEventListener("mousedown", () => { isResizing = true; });
  document.addEventListener("mousemove", (e) => { if (isResizing) treePanel.style.width = e.clientX + "px"; });
  document.addEventListener("mouseup", () => { isResizing = false; });

  // ============================================================
  // --- Link Management ---
  // ============================================================

  // Helper: add link badge indicators to folder tree items
  function addLinkIndicators(parentEl, containerName, links) {
    for (const link of links) {
      const prefix = link.targetPrefix;
      if (!prefix) continue; // container-root links get the sync-badge instead

      // Find the folder tree-item whose data matches this prefix
      const folderNodes = parentEl.querySelectorAll(".tree-node");
      for (const fNode of folderNodes) {
        const item = fNode.querySelector(".tree-item");
        if (!item) continue;
        const nameSpan = item.querySelector(".tree-name");
        if (!nameSpan) continue;
        // The folder name in the tree is the last segment; the prefix ends with /
        const normalizedPrefix = prefix.replace(/\/$/, "");
        const folderName = normalizedPrefix.split("/").pop();
        if (nameSpan.textContent === folderName && !item.querySelector(".link-badge")) {
          const badge = document.createElement("span");
          badge.className = "link-badge";
          badge.textContent = "\u{1F517}"; // link symbol
          badge.title = `Linked: ${link.repoUrl} (${link.branch})`;
          item.appendChild(badge);
        }
      }
    }
  }

  // --- Link Modal: open from container context menu ---
  ctxLinkContainer.addEventListener("click", () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    linkTarget = { container: containerContextTarget.containerName, targetPrefix: "" };
    linkProvider.value = "github";
    linkRepoUrl.value = "";
    linkBranch.value = "";
    linkTargetPrefix.value = "";
    linkRepoSubpath.value = "";
    linkModal.classList.remove("hidden");
    linkRepoUrl.focus();
  });

  // --- Link Modal: open from folder context menu ---
  ctxLinkFolder.addEventListener("click", () => {
    folderCtxMenu.classList.add("hidden");
    if (!folderContextTarget) return;
    linkTarget = { container: folderContextTarget.container, targetPrefix: folderContextTarget.folderPrefix };
    linkProvider.value = "github";
    linkRepoUrl.value = "";
    linkBranch.value = "";
    linkTargetPrefix.value = folderContextTarget.folderPrefix;
    linkRepoSubpath.value = "";
    linkModal.classList.remove("hidden");
    linkRepoUrl.focus();
  });

  linkCancel.addEventListener("click", () => {
    linkModal.classList.add("hidden");
    linkTarget = null;
  });

  linkSave.addEventListener("click", async () => {
    if (!linkTarget) return;
    const provider = linkProvider.value;
    const repoUrl = linkRepoUrl.value.trim();
    const branch = linkBranch.value.trim();
    const targetPrefix = linkTargetPrefix.value.trim();
    const repoSubPath = linkRepoSubpath.value.trim();

    if (!repoUrl) { alert("Repository URL is required."); return; }
    if (!branch) { alert("Branch is required."); return; }

    linkSave.disabled = true;
    linkSave.textContent = "Creating...";

    try {
      const body = { provider, repoUrl, branch };
      if (targetPrefix) body.targetPrefix = targetPrefix;
      if (repoSubPath) body.repoSubPath = repoSubPath;

      const result = await apiJson(`/api/links/${currentStorage}/${linkTarget.container}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      linkModal.classList.add("hidden");
      let msg = "Link created successfully.";
      if (result.warning) msg += "\nWarning: " + result.warning;
      alert(msg);

      // Refresh tree to show new indicators
      await buildTree();
    } catch (e) {
      alert("Failed to create link: " + e.message);
    } finally {
      linkSave.disabled = false;
      linkSave.textContent = "Create Link";
      linkTarget = null;
    }
  });

  // --- View Links: open from container context menu ---
  ctxViewLinks.addEventListener("click", () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    openLinksPanel(containerContextTarget.containerName);
  });

  async function openLinksPanel(containerName) {
    linksPanelContainer = containerName;
    linksPanelBody.innerHTML = '<p class="placeholder">Loading links...</p>';
    linksPanelModal.classList.remove("hidden");

    try {
      const registry = await apiJson(`/api/links/${currentStorage}/${containerName}`);
      containerLinksCache[containerName] = registry;
      renderLinksPanel(registry, containerName);
    } catch (e) {
      linksPanelBody.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  function renderLinksPanel(registry, containerName) {
    if (!registry || !registry.links || registry.links.length === 0) {
      linksPanelBody.innerHTML = '<p class="placeholder">No links configured for this container.</p>';
      return;
    }

    const providerIcon = (p) => p === "github" ? "\u{1F4BB}" : "\u{2601}\uFE0F";
    let html = '<table class="links-table"><thead><tr>';
    html += '<th></th><th>Repository</th><th>Branch</th><th>Target</th><th>Sub-Path</th><th>Last Sync</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const link of registry.links) {
      const target = link.targetPrefix || "(root)";
      const subPath = link.repoSubPath || "(all)";
      const lastSync = link.lastSyncAt ? new Date(link.lastSyncAt).toLocaleString() : "never";
      const shortUrl = link.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");

      html += '<tr>';
      html += `<td><span class="link-provider-icon">${providerIcon(link.provider)}</span></td>`;
      html += `<td class="link-url" title="Click to copy: ${escapeHtml(link.repoUrl)}" data-url="${escapeHtml(link.repoUrl)}">${escapeHtml(shortUrl)}</td>`;
      html += `<td>${escapeHtml(link.branch)}</td>`;
      html += `<td>${escapeHtml(target)}</td>`;
      html += `<td>${escapeHtml(subPath)}</td>`;
      html += `<td>${escapeHtml(lastSync)}</td>`;
      html += '<td class="link-actions">';
      html += `<button class="link-diff-btn" data-link-id="${escapeHtml(link.id)}">Diff</button>`;
      html += `<button class="link-sync-btn" data-link-id="${escapeHtml(link.id)}">Sync</button>`;
      html += `<button class="link-unlink-btn" data-link-id="${escapeHtml(link.id)}">Unlink</button>`;
      html += '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    linksPanelBody.innerHTML = html;

    // Attach per-link action handlers
    linksPanelBody.querySelectorAll(".link-diff-btn").forEach((btn) => {
      btn.addEventListener("click", () => diffSingleLink(containerName, btn.dataset.linkId, btn));
    });
    linksPanelBody.querySelectorAll(".link-sync-btn").forEach((btn) => {
      btn.addEventListener("click", () => syncSingleLink(containerName, btn.dataset.linkId, btn));
    });
    linksPanelBody.querySelectorAll(".link-unlink-btn").forEach((btn) => {
      btn.addEventListener("click", () => unlinkSingleLink(containerName, btn.dataset.linkId));
    });
    linksPanelBody.querySelectorAll(".link-url").forEach((cell) => {
      cell.style.cursor = "pointer";
      cell.addEventListener("click", () => {
        const url = cell.dataset.url;
        navigator.clipboard.writeText(url).then(() => {
          const orig = cell.textContent;
          cell.textContent = "Copied!";
          setTimeout(() => { cell.textContent = orig; }, 1500);
        });
      });
    });
  }

  async function syncSingleLink(containerName, linkId, btn) {
    if (!confirm("Sync this link now?")) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Syncing...";

    try {
      const result = await apiJson(`/api/sync-link/${currentStorage}/${containerName}/${linkId}`, {
        method: "POST",
      });
      alert(
        `Sync complete!\nUploaded: ${result.uploaded.length}\nDeleted: ${result.deleted.length}\nSkipped: ${result.skipped.length}\nErrors: ${result.errors.length}`
      );
      // Refresh panel data
      await openLinksPanel(containerName);
      // Refresh tree
      await buildTree();
    } catch (e) {
      handleSyncError(e, "Sync failed", async () => {
        await syncSingleLink(containerName, linkId, btn);
      });
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  async function unlinkSingleLink(containerName, linkId) {
    if (!confirm("Remove this link? (Files will not be deleted.)")) return;

    try {
      await apiJson(`/api/links/${currentStorage}/${containerName}/${linkId}`, {
        method: "DELETE",
      });
      // Refresh panel
      await openLinksPanel(containerName);
      // Refresh tree to update indicators
      await buildTree();
    } catch (e) {
      alert("Unlink failed: " + e.message);
    }
  }

  // --- Diff single link ---
  async function diffSingleLink(containerName, linkId, btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Diffing...";

    try {
      const report = await apiJson(`/api/diff/${currentStorage}/${containerName}/${linkId}`);
      renderDiffResult(report, containerName);
    } catch (e) {
      handleSyncError(e, "Diff failed", async () => {
        await diffSingleLink(containerName, linkId, btn);
      });
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  // --- Diff all links ---
  async function diffAllLinks(containerName) {
    try {
      const data = await apiJson(`/api/diff-all/${currentStorage}/${containerName}`);
      renderDiffAllResults(data, containerName);
    } catch (e) {
      handleSyncError(e, "Diff All failed", async () => {
        await diffAllLinks(containerName);
      });
    }
  }

  // --- Build diff result HTML for a single report (does not touch the DOM) ---
  function buildDiffResultHtml(report, containerName) {
    const isInSync = report.summary.isInSync;
    const syncClass = isInSync ? "diff-in-sync" : "diff-out-of-sync";
    const syncLabel = isInSync ? "IN SYNC" : `${report.summary.modifiedCount + report.summary.repoOnlyCount + report.summary.containerOnlyCount} difference(s) found`;

    const shortUrl = report.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
    const lastSync = report.lastSyncAt ? new Date(report.lastSyncAt).toLocaleString() : "never";
    const generatedAt = new Date(report.generatedAt).toLocaleString();

    let html = '<div class="diff-result">';
    html += `<div class="diff-summary ${syncClass}">${isInSync ? "&#10003;" : "&#9888;"} ${escapeHtml(syncLabel)}</div>`;
    html += `<div class="diff-meta">`;
    html += `<strong>Repo:</strong> ${escapeHtml(shortUrl)} &nbsp;|&nbsp; `;
    html += `<strong>Branch:</strong> ${escapeHtml(report.branch)} &nbsp;|&nbsp; `;
    if (report.targetPrefix) html += `<strong>Target:</strong> ${escapeHtml(report.targetPrefix)} &nbsp;|&nbsp; `;
    html += `<strong>Last sync:</strong> ${escapeHtml(lastSync)} &nbsp;|&nbsp; `;
    html += `<strong>Generated:</strong> ${escapeHtml(generatedAt)}`;
    html += `</div>`;

    if (report.note) {
      html += `<div class="diff-note">&#9432; ${escapeHtml(report.note)}</div>`;
    }

    // MODIFIED
    if (report.modified.length > 0) {
      html += `<details class="diff-section" open>`;
      html += `<summary>Modified (${report.modified.length})</summary>`;
      html += `<div class="diff-file-list">`;
      for (const entry of report.modified) {
        const storedSha = entry.storedSha ? entry.storedSha.slice(0, 8) : "n/a";
        const remoteSha = entry.remoteSha ? entry.remoteSha.slice(0, 8) : "n/a";
        html += `<div class="diff-file"><span class="diff-prefix-m">M</span> ${escapeHtml(entry.blobPath)} <span style="color:var(--text-dim)">[stored:${escapeHtml(storedSha)} &rarr; remote:${escapeHtml(remoteSha)}]</span></div>`;
      }
      html += `</div></details>`;
    }

    // REPO-ONLY
    if (report.repoOnly.length > 0) {
      html += `<details class="diff-section" open>`;
      html += `<summary>Repo Only (${report.repoOnly.length})</summary>`;
      html += `<div class="diff-file-list">`;
      for (const entry of report.repoOnly) {
        const remoteSha = entry.remoteSha ? entry.remoteSha.slice(0, 8) : "n/a";
        const physicalNote = entry.physicallyExists === true ? ` <span style="color:var(--expiry-warn)">[exists in container]</span>` : "";
        html += `<div class="diff-file"><span class="diff-prefix-add">+</span> ${escapeHtml(entry.blobPath)} <span style="color:var(--text-dim)">[${escapeHtml(remoteSha)}]</span>${physicalNote}</div>`;
      }
      html += `</div></details>`;
    }

    // CONTAINER-ONLY
    if (report.containerOnly.length > 0) {
      html += `<details class="diff-section" open>`;
      html += `<summary>Container Only (${report.containerOnly.length})</summary>`;
      html += `<div class="diff-file-list">`;
      for (const entry of report.containerOnly) {
        const storedSha = entry.storedSha ? entry.storedSha.slice(0, 8) : "n/a";
        html += `<div class="diff-file"><span class="diff-prefix-del">-</span> ${escapeHtml(entry.blobPath)} <span style="color:var(--text-dim)">[${escapeHtml(storedSha)}]</span></div>`;
      }
      html += `</div></details>`;
    }

    // UNTRACKED
    if (report.untracked && report.untracked.length > 0) {
      html += `<details class="diff-section" open>`;
      html += `<summary>Untracked (${report.untracked.length})</summary>`;
      html += `<div class="diff-file-list">`;
      for (const entry of report.untracked) {
        html += `<div class="diff-file"><span class="diff-prefix-unk">?</span> ${escapeHtml(entry.blobPath)}</div>`;
      }
      html += `</div></details>`;
    }

    // IDENTICAL (collapsed by default — no `open` attribute)
    if (report.identical && report.identical.length > 0) {
      html += `<details class="diff-section">`;
      html += `<summary>Identical (${report.identical.length})</summary>`;
      html += `<div class="diff-file-list">`;
      for (const entry of report.identical) {
        const sha = entry.remoteSha ? entry.remoteSha.slice(0, 8) : "n/a";
        html += `<div class="diff-file"><span class="diff-prefix-eq">=</span> ${escapeHtml(entry.blobPath)} <span style="color:var(--text-dim)">[${escapeHtml(sha)}]</span></div>`;
      }
      html += `</div></details>`;
    } else if (report.summary.identicalCount > 0) {
      // identicalCount is set but identical array was stripped by server (showIdentical=false)
      html += `<div class="diff-section" style="font-size:12px;color:var(--text-dim);padding:4px 0;">&#61; ${report.summary.identicalCount} identical file(s)</div>`;
    }

    // Sync Now button if out of sync
    if (!isInSync && containerName) {
      html += `<div class="diff-actions">`;
      html += `<button class="diff-sync-now-btn primary" data-link-id="${escapeHtml(report.linkId)}" style="font-size:12px;padding:4px 12px;">Sync Now</button>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  // --- Attach Sync Now button handlers inside a container element ---
  function attachDiffSyncHandlers(containerEl, containerName) {
    containerEl.querySelectorAll(".diff-sync-now-btn").forEach((syncNowBtn) => {
      syncNowBtn.addEventListener("click", async () => {
        const linkId = syncNowBtn.dataset.linkId;
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = "Syncing...";
        try {
          const result = await apiJson(`/api/sync-link/${currentStorage}/${containerName}/${linkId}`, { method: "POST" });
          alert(`Sync complete!\nUploaded: ${result.uploaded.length}\nDeleted: ${result.deleted.length}\nSkipped: ${result.skipped.length}\nErrors: ${result.errors.length}`);
          await openLinksPanel(containerName);
          await buildTree();
        } catch (e) {
          handleSyncError(e, "Sync failed", null);
        } finally {
          syncNowBtn.disabled = false;
          syncNowBtn.textContent = "Sync Now";
        }
      });
    });
  }

  // --- Render diff result for a single link ---
  function renderDiffResult(report, containerName) {
    const panel = document.getElementById("diff-result-panel") || createDiffResultPanel();
    panel.innerHTML = buildDiffResultHtml(report, containerName);
    panel.style.display = "";
    attachDiffSyncHandlers(panel, containerName);
  }

  // --- Render diff results for all links ---
  function renderDiffAllResults(data, containerName) {
    const panel = document.getElementById("diff-result-panel") || createDiffResultPanel();
    if (!data || !data.results || data.results.length === 0) {
      panel.innerHTML = '<div class="diff-result"><p class="placeholder">No diff results returned.</p></div>';
      panel.style.display = "";
      return;
    }

    let combined = "";
    for (const item of data.results) {
      combined += buildDiffResultHtml(item.report, containerName);
    }
    panel.innerHTML = combined;
    panel.style.display = "";
    attachDiffSyncHandlers(panel, containerName);
  }

  // --- Render diff error inline ---
  function renderDiffError(e) {
    const panel = document.getElementById("diff-result-panel") || createDiffResultPanel();
    panel.style.display = "";
    panel.innerHTML = `<div class="diff-error">&#10007; ${escapeHtml(e.message || String(e))}</div>`;
  }

  // --- Create (or get) the diff result panel below the links table ---
  function createDiffResultPanel() {
    let panel = document.getElementById("diff-result-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "diff-result-panel";
      panel.style.display = "none";
      linksPanelBody.appendChild(panel);
    }
    return panel;
  }

  // --- Sync All ---
  linksSyncAll.addEventListener("click", async () => {
    if (!linksPanelContainer) return;
    if (!confirm("Sync ALL links for this container?")) return;

    linksSyncAll.disabled = true;
    linksSyncAll.textContent = "Syncing...";

    try {
      const data = await apiJson(`/api/sync-all/${currentStorage}/${linksPanelContainer}`, {
        method: "POST",
      });

      let summary = "Sync All complete:\n";
      for (const r of data.results) {
        const shortUrl = r.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
        summary += `\n${shortUrl}: uploaded=${r.result.uploaded.length}, deleted=${r.result.deleted.length}, errors=${r.result.errors.length}`;
      }
      alert(summary);

      // Refresh panel and tree
      await openLinksPanel(linksPanelContainer);
      await buildTree();
    } catch (e) {
      const retryContainer = linksPanelContainer;
      handleSyncError(e, "Sync All failed", async () => {
        linksPanelContainer = retryContainer;
        linksSyncAll.click();
      });
    } finally {
      linksSyncAll.disabled = false;
      linksSyncAll.textContent = "Sync All";
    }
  });

  // --- Diff All ---
  linksDiffAll.addEventListener("click", async () => {
    if (!linksPanelContainer) return;

    linksDiffAll.disabled = true;
    linksDiffAll.textContent = "Diffing...";

    try {
      await diffAllLinks(linksPanelContainer);
    } finally {
      linksDiffAll.disabled = false;
      linksDiffAll.textContent = "Diff All";
    }
  });

  // --- Handle sync errors (detect missing PAT and offer to add) ---
  let pendingRetryAction = null; // async function to retry after token is added
  let addTokenForPublish = false; // true when the add-token modal was opened from the Publish dialog

  function handleSyncError(e, context, retryAction) {
    if (e.code === "MISSING_PAT") {
      pendingRetryAction = retryAction || null;
      openAddTokenModal(e.provider, context);
    } else {
      alert(context + ": " + e.message);
    }
  }

  function openAddTokenModal(provider, context) {
    addTokenForPublish = false;
    const providerLabel = provider === "github" ? "GitHub" : "Azure DevOps";
    addTokenMessage.textContent = `A ${providerLabel} personal access token is required to sync. Please add one below.`;
    addTokenProvider.value = provider;
    addTokenName.value = "";
    addTokenValue.value = "";
    addTokenModal.classList.remove("hidden");
    addTokenValue.focus();
  }

  addTokenCancel.addEventListener("click", () => {
    addTokenModal.classList.add("hidden");
    pendingRetryAction = null;
    addTokenForPublish = false;
  });

  addTokenSave.addEventListener("click", async () => {
    const name = addTokenName.value.trim();
    const provider = addTokenProvider.value;
    const token = addTokenValue.value.trim();

    if (!name) { alert("Token name is required."); return; }
    if (!token) { alert("Token value is required."); return; }

    addTokenSave.disabled = true;
    addTokenSave.textContent = "Saving...";

    try {
      await apiJson("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider, token }),
      });
      addTokenModal.classList.add("hidden");

      if (addTokenForPublish) {
        // Opened from the Publish dialog (still open underneath): refresh its PAT
        // dropdown and auto-select the token we just added.
        addTokenForPublish = false;
        publishProvider.value = provider;
        await populatePublishCredentials(provider);
        publishToken.value = "pat:" + name;
        setPublishStatus('Token "' + name + '" added and selected.', "info");
      } else if (pendingRetryAction) {
        // Automatically retry the sync that triggered the missing PAT error
        const retry = pendingRetryAction;
        pendingRetryAction = null;
        await retry();
      }
    } catch (e) {
      alert("Failed to save token: " + e.message);
    } finally {
      addTokenSave.disabled = false;
      addTokenSave.textContent = "Save Token";
    }
  });

  // --- GitHub Apps modal ---
  addGitHubAppBtn.addEventListener("click", () => {
    githubAppsModal.classList.add("hidden");
    addAppName.value = "";
    addAppId.value = "";
    addAppInstallationId.value = "";
    addAppPrivateKey.value = "";
    addAppCompanionPat.value = "";
    addGitHubAppModal.classList.remove("hidden");
    addAppName.focus();
  });

  githubAppsClose.addEventListener("click", () => {
    githubAppsModal.classList.add("hidden");
  });

  addAppCancel.addEventListener("click", () => {
    addGitHubAppModal.classList.add("hidden");
  });

  addAppSave.addEventListener("click", async () => {
    const name = addAppName.value.trim();
    const appId = addAppId.value.trim();
    const installationId = addAppInstallationId.value.trim();
    const privateKeyPem = addAppPrivateKey.value.trim();
    const companionPatTokenName = addAppCompanionPat.value.trim() || undefined;

    if (!name) { alert("App name is required."); return; }
    if (!appId) { alert("App ID is required."); return; }
    if (!installationId) { alert("Installation ID is required."); return; }
    if (!privateKeyPem) { alert("Private key PEM is required."); return; }

    addAppSave.disabled = true;
    addAppSave.textContent = "Saving...";

    try {
      await apiJson("/api/github-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, appId, installationId, privateKeyPem, companionPatTokenName }),
      });
      addGitHubAppModal.classList.add("hidden");
      await loadGitHubApps();
    } catch (e) {
      alert("Failed to save GitHub App: " + e.message);
    } finally {
      addAppSave.disabled = false;
      addAppSave.textContent = "Save GitHub App";
    }
  });

  async function loadGitHubApps() {
    try {
      const apps = await apiJson("/api/github-apps");
      githubAppsList.innerHTML = "";
      if (!apps || apps.length === 0) {
        githubAppsList.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 12px;">No GitHub Apps configured. Click "+ Add GitHub App" above.</div>';
        return;
      }
      apps.forEach(app => {
        const div = document.createElement("div");
        div.style.cssText = "padding: 12px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;";
        const info = document.createElement("div");
        info.innerHTML = `
          <div style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(app.name)}</div>
          <div style="font-size: 12px; color: var(--text-muted);">App ID: ${escapeHtml(app.appId)} | Installation: ${escapeHtml(app.installationId)}</div>
          ${app.hasCompanionPat ? '<div style="font-size: 11px; color: var(--link);">✓ Companion PAT configured</div>' : ''}
        `;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.className = "danger";
        removeBtn.style.cssText = "padding: 6px 12px; font-size: 12px;";
        removeBtn.addEventListener("click", async () => {
          if (!confirm(`Remove GitHub App "${app.name}"?`)) return;
          try {
            await apiJson(`/api/github-apps/${encodeURIComponent(app.name)}`, { method: "DELETE" });
            await loadGitHubApps();
          } catch (e) {
            alert("Failed to remove GitHub App: " + e.message);
          }
        });
        div.appendChild(info);
        div.appendChild(removeBtn);
        githubAppsList.appendChild(div);
      });
    } catch (e) {
      githubAppsList.innerHTML = `<div style="color: var(--expiry-expired); padding: 12px;">Error loading GitHub Apps: ${escapeHtml(e.message)}</div>`;
    }
  }

  linksPanelClose.addEventListener("click", () => {
    linksPanelModal.classList.add("hidden");
    linksPanelContainer = null;
  });

  // ============================================================
  // --- Reverse-Git Publication (Phase G) ---
  // ============================================================
  // All reverse-git UI logic. Mirrors the forward Links panel pattern but
  // uses the Phase F endpoints under /api/reverse-links, /api/push,
  // /api/push-all, and /api/reverse-diff. Errors from the API carry a
  // `ReverseGitError` shape (`{ error, code, provider? }`) and are surfaced
  // inline via the publish-status banner or the reverse-links panel.

  // --- Status helpers (avoid alert() per design NFR; see plan-011 risk row) ---
  function setPublishStatus(message, kind) {
    publishStatus.className = "status-line status-" + (kind || "info");
    publishStatus.textContent = message || "";
  }
  function classifyStatusKind(httpStatus) {
    if (!httpStatus) return "error";
    if (httpStatus >= 500) return "error";
    if (httpStatus >= 400) return "warning";
    return "info";
  }
  function buildReverseScopePath(scope) {
    // scope = { scope: 'account'|'container'|'prefix', container?, prefix?, accountName? }
    // Returns the URL suffix after `/api/<route>/<storage>` — i.e. `/<container>?` or empty.
    if (scope.scope === "account") return "";
    return "/" + encodeURIComponent(scope.container);
  }
  function buildReverseScopeLabel(scope) {
    if (scope.scope === "account") {
      return "Account: " + (scope.accountName || currentAccount || currentStorage);
    }
    if (scope.scope === "prefix") {
      return "Prefix: " + scope.container + "/" + scope.prefix;
    }
    return "Container: " + scope.container;
  }

  // --- Credential-selector population (called when publish modal opens) ---
  // Loads both PATs and GitHub Apps (GitHub only), using optgroups to distinguish
  async function populatePublishCredentials(provider) {
    publishToken.innerHTML = '<option value="">Loading credentials...</option>';
    publishInit.disabled = true;
    publishInitPush.disabled = true;
    try {
      const [pats, apps] = await Promise.all([
        apiJson("/api/tokens"),
        provider === "github" ? apiJson("/api/github-apps").catch(() => []) : Promise.resolve([])
      ]);
      const matchingPats = pats.filter((t) => t.provider === provider);
      
      if (matchingPats.length === 0 && apps.length === 0) {
        publishToken.innerHTML = '<option value="">(no ' + provider + " credentials — add one first)</option>";
        setPublishStatus(
          "No " + provider + " PAT or GitHub App found. Add one, then re-open Publish.",
          "warning",
        );
        return;
      }
      
      let html = '<option value="">-- Select a credential --</option>';
      
      if (apps.length > 0) {
        html += '<optgroup label="GitHub Apps">';
        html += apps.map((app) =>
          '<option value="app:' + escapeHtml(app.name) + '">🤖 ' +
          escapeHtml(app.name) +
          '</option>'
        ).join("");
        html += '</optgroup>';
      }
      
      if (matchingPats.length > 0) {
        html += '<optgroup label="Personal Access Tokens">';
        html += matchingPats.map((t) =>
          '<option value="pat:' + escapeHtml(t.name) + '">🔑 ' +
          escapeHtml(t.name) +
          (t.isExpired ? " [EXPIRED]" : "") +
          '</option>'
        ).join("");
        html += '</optgroup>';
      }
      
      publishToken.innerHTML = html;
      publishInit.disabled = false;
      publishInitPush.disabled = false;
      setPublishStatus("", "info");
    } catch (e) {
      setPublishStatus("Failed to load credentials: " + e.message, "error");
    }
  }

  publishProvider.addEventListener("change", () => {
    populatePublishCredentials(publishProvider.value);
  });

  // --- "+ Add" PAT button inside the Publish dialog ---
  // Opens the existing add-token modal pre-set to the selected provider. The
  // Publish modal stays open underneath; on save we refresh + select the token.
  publishAddToken.addEventListener("click", () => {
    const provider = publishProvider.value;
    const providerLabel = provider === "github" ? "GitHub" : "Azure DevOps";
    addTokenForPublish = true;
    pendingRetryAction = null;
    addTokenMessage.textContent =
      "Add a " + providerLabel + " personal access token. It will be selected for this publish.";
    addTokenProvider.value = provider;
    addTokenName.value = "";
    addTokenValue.value = "";
    addTokenModal.classList.remove("hidden");
    addTokenName.focus();
  });

  // --- Open publish modal (entry point for all 3 scope variants) ---
  function openPublishModal(ctx) {
    // ctx = { scope, container?, prefix?, accountName? }
    publishContext = ctx;
    publishModalTitle.textContent = "Publish to Git Repository";
    publishScopeInfo.textContent = buildReverseScopeLabel(ctx);
    publishProvider.value = "github";
    publishRepoUrl.value = "";
    publishBranch.value = "main";
    publishRepoSubpath.value = "";
    publishExclusions.value = "";
    publishRespectGitignore.checked = true;
    publishVisibility.value = "private";
    publishCreateRepo.checked = false;
    publishCommitMsg.value = "";
    setPublishStatus("", "info");
    publishModal.classList.remove("hidden");
    populatePublishCredentials("github");
    publishRepoUrl.focus();
  }

  // --- Wire each "Publish to Git Repository" menu entry ---
  ctxPublishContainer.addEventListener("click", () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    openPublishModal({
      scope: "container",
      container: containerContextTarget.containerName,
    });
  });

  ctxPublishFolder.addEventListener("click", () => {
    folderCtxMenu.classList.add("hidden");
    if (!folderContextTarget) return;
    // folderPrefix ends with `/`; the server's scopeFromRequest accepts the
    // exact string. Strip trailing slash for visual label parity.
    const prefix = folderContextTarget.folderPrefix.replace(/\/$/, "");
    openPublishModal({
      scope: "prefix",
      container: folderContextTarget.container,
      prefix,
    });
  });

  ctxPublishStorageAccount.addEventListener("click", () => {
    storageAccountCtxMenu.classList.add("hidden");
    if (!storageAccountContextTarget) return;
    openPublishModal({
      scope: "account",
      accountName: storageAccountContextTarget.accountName,
    });
  });

  publishCancel.addEventListener("click", () => {
    publishModal.classList.add("hidden");
    publishContext = null;
  });

  // Look up an existing reverse-link in the given scope by repo URL. Used to
  // recover from a 409 "already exists" on create (e.g. when a prior push
  // failed after the link was already created).
  async function findExistingLink(scopePath, repoUrl) {
    try {
      const url = "/api/reverse-links/" + encodeURIComponent(currentStorage) + scopePath;
      const data = await apiJson(url);
      const links = (data && data.links) || [];
      return links.find((l) => l.repoUrl === repoUrl) || null;
    } catch {
      return null;
    }
  }

  // --- Submit publish — init only OR init + immediate push ---
  async function submitPublish(pushImmediately) {
    if (!publishContext) return;
    const provider = publishProvider.value;
    const repoUrl = publishRepoUrl.value.trim();
    const branch = publishBranch.value.trim() || "main";
    const repoSubPath = publishRepoSubpath.value.trim();
    const credentialValue = publishToken.value;
    const exclusionRaw = publishExclusions.value.trim();
    const exclusionPatterns = exclusionRaw
      ? exclusionRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
    const respectGitignore = publishRespectGitignore.checked;
    const visibility = publishVisibility.value;
    const createRepo = publishCreateRepo.checked;
    const commitMsg = publishCommitMsg.value.trim();

    if (!repoUrl) { setPublishStatus("Repository URL is required.", "warning"); return; }
    if (!credentialValue) { setPublishStatus("A credential must be selected.", "warning"); return; }
    
    // Parse credential: "app:name" or "pat:name"
    let authType = "pat";
    let credentialName = credentialValue;
    if (credentialValue.startsWith("app:")) {
      authType = "github-app";
      credentialName = credentialValue.substring(4);
    } else if (credentialValue.startsWith("pat:")) {
      authType = "pat";
      credentialName = credentialValue.substring(4);
    }

    publishInit.disabled = true;
    publishInitPush.disabled = true;
    setPublishStatus("Creating reverse-link...", "info");

    const body = {
      scope: { kind: publishContext.scope }, // engine layer recomputes from URL — informational
      provider,
      repoUrl,
      branch,
      authType,
      authCredentialName: credentialName,
      exclusionPatterns,
      respectGitignore,
      createRepo,
      visibility,
    };
    // Include tokenName for backward compat when using PAT
    if (authType === "pat") {
      body.tokenName = credentialName;
    }
    if (repoSubPath) body.repoSubPath = repoSubPath;
    if (publishContext.scope === "prefix") body.prefix = publishContext.prefix;

    const scopePath = buildReverseScopePath(publishContext);
    const createUrl = "/api/reverse-links/" + encodeURIComponent(currentStorage) + scopePath;

    let createdLink;
    try {
      const res = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = a reverse-link for this repo already exists in this scope —
        // commonly because a previous push failed *after* the link was
        // created. Recover instead of dead-ending: for "Publish & Push Now"
        // push the existing link; otherwise tell the user it already exists.
        if (res.status === 409) {
          const existing = await findExistingLink(scopePath, repoUrl);
          if (existing && pushImmediately) {
            createdLink = existing;
            setPublishStatus(
              "Link already exists — pushing existing link (id " +
                existing.id.slice(0, 8) + ")…",
              "info",
            );
          } else {
            setPublishStatus(
              existing
                ? 'A reverse-link for this repo already exists (id ' +
                    existing.id.slice(0, 8) +
                    '). Click "Publish & Push Now" to push it, or use the ' +
                    "Reverse Links panel to manage it."
                : "Create failed: " + ((data && data.error) || "link already exists"),
              "warning",
            );
            publishInit.disabled = false;
            publishInitPush.disabled = false;
            return;
          }
        } else {
          setPublishStatus(
            "Create failed: " + ((data && data.error) || "HTTP " + res.status),
            classifyStatusKind(res.status),
          );
          publishInit.disabled = false;
          publishInitPush.disabled = false;
          return;
        }
      } else {
        createdLink = data.link;
        setPublishStatus("Reverse-link created (id " + createdLink.id.slice(0, 8) + ")", "success");
      }
    } catch (e) {
      setPublishStatus("Create failed: " + e.message, "error");
      publishInit.disabled = false;
      publishInitPush.disabled = false;
      return;
    }

    if (!pushImmediately) {
      publishModal.classList.add("hidden");
      publishContext = null;
      return;
    }

    // Immediate push of the new link
    setPublishStatus("Pushing...", "info");
    try {
      const pushUrl =
        "/api/push/" + encodeURIComponent(currentStorage) + scopePath +
        "/" + encodeURIComponent(createdLink.id);
      const res = await fetch(pushUrl, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data && data.error) || ("HTTP " + res.status);
        setPublishStatus("Push failed: " + msg + " (link was still created)", classifyStatusKind(res.status));
        publishInit.disabled = false;
        publishInitPush.disabled = false;
        return;
      }
      const r = data.result || {};
      const summary =
        "Push complete — added " + (r.added?.length || 0) +
        ", modified " + (r.modified?.length || 0) +
        ", deleted " + (r.deleted?.length || 0) +
        ", errors " + (r.errors?.length || 0);
      setPublishStatus(summary, r.errors?.length ? "warning" : "success");
      publishModal.classList.add("hidden");
      publishContext = null;
    } catch (e) {
      setPublishStatus("Push failed: " + e.message + " (link was still created)", "error");
      publishInit.disabled = false;
      publishInitPush.disabled = false;
    }
  }
  publishInit.addEventListener("click", () => submitPublish(false));
  publishInitPush.addEventListener("click", () => submitPublish(true));

  // --- Open Reverse Links panel (entry point for all 3 scope variants) ---
  async function openReverseLinksPanel(scope) {
    reverseLinksPanelScope = scope;
    reverseLinksPanelBody.innerHTML = '<p class="placeholder">Loading reverse-links...</p>';
    reverseLinksPanelModal.classList.remove("hidden");
    try {
      const scopePath = buildReverseScopePath(scope);
      const url = "/api/reverse-links/" + encodeURIComponent(currentStorage) + scopePath;
      const data = await apiJson(url);
      const links = (data && data.links) || [];
      if (scope.scope === "account") accountReverseLinksCache = links;
      else containerReverseLinksCache[scope.container] = links;
      renderReverseLinksPanel(links, scope);
    } catch (e) {
      reverseLinksPanelBody.innerHTML =
        '<p class="placeholder">Error: ' + escapeHtml(e.message) + "</p>";
    }
  }

  ctxViewReverseLinks.addEventListener("click", () => {
    containerCtxMenu.classList.add("hidden");
    if (!containerContextTarget) return;
    openReverseLinksPanel({
      scope: "container",
      container: containerContextTarget.containerName,
    });
  });
  ctxViewReverseLinksAccount.addEventListener("click", () => {
    storageAccountCtxMenu.classList.add("hidden");
    if (!storageAccountContextTarget) return;
    openReverseLinksPanel({
      scope: "account",
      accountName: storageAccountContextTarget.accountName,
    });
  });
  reverseLinksPanelClose.addEventListener("click", () => {
    reverseLinksPanelModal.classList.add("hidden");
    reverseLinksPanelScope = null;
  });

  // --- Render reverse-links table ---
  function renderReverseLinksPanel(links, scope) {
    if (!links || links.length === 0) {
      reverseLinksPanelBody.innerHTML =
        '<p class="placeholder">No reverse-links configured for ' +
        escapeHtml(buildReverseScopeLabel(scope)) + ".</p>";
      return;
    }
    const providerIcon = (p) => (p === "github" ? "\u{1F4BB}" : "\u{2601}️");
    const authTypeLabel = (authType) => {
      if (authType === "github-app") return "\ud83e\udd16 App";
      if (authType === "ado-app") return "\ud83e\udd16 App";
      return "\ud83d\udd11 PAT";
    };
    let html = '<table class="reverse-links-table"><thead><tr>';
    html += "<th></th><th>Repository</th><th>Branch</th><th>Auth</th><th>Scope</th><th>Last Push</th><th>Actions</th>";
    html += "</tr></thead><tbody>";
    for (const link of links) {
      const shortUrl = link.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
      const lastPush = link.lastPushedAt
        ? new Date(link.lastPushedAt).toLocaleString()
        : "never";
      let scopeLabel = link.scope?.kind || "?";
      if (link.scope?.kind === "container") scopeLabel += " (" + link.scope.container + ")";
      else if (link.scope?.kind === "prefix") scopeLabel += " (" + link.scope.container + "/" + link.scope.prefix + ")";
      else if (link.scope?.kind === "account") scopeLabel += " (" + link.scope.account + ")";
      html += "<tr>";
      html += "<td><span class=\"link-provider-icon\">" + providerIcon(link.provider) + "</span></td>";
      html += '<td class="link-url" title="' + escapeHtml(link.repoUrl) + '">' + escapeHtml(shortUrl) + "</td>";
      html += "<td>" + escapeHtml(link.branch) + "</td>";
      html += "<td>" + authTypeLabel(link.authType) + "</td>";
      html += "<td>" + escapeHtml(scopeLabel) + "</td>";
      html += "<td>" + escapeHtml(lastPush) + "</td>";
      html += '<td class="link-actions">';
      html += '<button class="reverse-diff-btn" data-link-id="' + escapeHtml(link.id) + '">Dry-Run Diff</button>';
      html += '<button class="reverse-push-btn" data-link-id="' + escapeHtml(link.id) + '">Push Now</button>';
      html += '<button class="reverse-unlink-btn" data-link-id="' + escapeHtml(link.id) + '">Unlink</button>';
      html += "</td>";
      html += "</tr>";
    }
    html += "</tbody></table>";
    html += '<div id="reverse-diff-result-panel" style="display:none;"></div>';
    html += '<div id="reverse-push-status" class="status-line" style="font-size:12px;margin-top:8px;"></div>';
    reverseLinksPanelBody.innerHTML = html;

    reverseLinksPanelBody.querySelectorAll(".reverse-diff-btn").forEach((btn) => {
      btn.addEventListener("click", () => reverseDiffSingle(scope, btn.dataset.linkId, btn));
    });
    reverseLinksPanelBody.querySelectorAll(".reverse-push-btn").forEach((btn) => {
      btn.addEventListener("click", () => reversePushSingle(scope, btn.dataset.linkId, btn));
    });
    reverseLinksPanelBody.querySelectorAll(".reverse-unlink-btn").forEach((btn) => {
      btn.addEventListener("click", () => reverseUnlinkSingle(scope, btn.dataset.linkId));
    });
  }

  function setReversePushStatus(message, kind) {
    const el = document.getElementById("reverse-push-status");
    if (!el) return;
    el.className = "status-line status-" + (kind || "info");
    el.textContent = message || "";
  }

  // --- Dry-Run Diff for a single link ---
  async function reverseDiffSingle(scope, linkId, btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Diffing...";
    try {
      const scopePath = buildReverseScopePath(scope);
      const url =
        "/api/reverse-diff/" + encodeURIComponent(currentStorage) + scopePath +
        "/" + encodeURIComponent(linkId);
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReversePushStatus(
          "Diff failed: " + ((data && data.error) || ("HTTP " + res.status)),
          classifyStatusKind(res.status),
        );
        return;
      }
      renderReverseDiffResult(data.diff);
    } catch (e) {
      setReversePushStatus("Diff failed: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function renderReverseDiffResult(diff) {
    const panel = document.getElementById("reverse-diff-result-panel");
    if (!panel) return;
    const c = diff.counts || { added: 0, modified: 0, deleted: 0, unchanged: 0 };
    let html = '<div class="reverse-diff-result">';
    html += '<div class="reverse-diff-summary">Diff: +' + c.added + " ~" + c.modified +
            " -" + c.deleted + " =" + c.unchanged + "</div>";
    const section = (title, prefixCls, prefix, items) => {
      if (!items || items.length === 0) return "";
      let s = '<details class="reverse-diff-section" open>';
      s += "<summary>" + escapeHtml(title) + " (" + items.length + ")</summary>";
      for (const path of items) {
        s += '<div class="reverse-diff-file"><span class="' + prefixCls +
             '">' + prefix + "</span> " + escapeHtml(path) + "</div>";
      }
      s += "</details>";
      return s;
    };
    html += section("Added", "reverse-diff-prefix-add", "+", diff.added);
    html += section("Modified", "reverse-diff-prefix-mod", "~", diff.modified);
    html += section("Deleted", "reverse-diff-prefix-del", "-", diff.deleted);
    html += "</div>";
    panel.innerHTML = html;
    panel.style.display = "";
  }

  // --- Push a single reverse-link ---
  async function reversePushSingle(scope, linkId, btn) {
    if (!confirm("Push this reverse-link now? Storage state will be written to the remote repository.")) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Pushing...";
    try {
      const scopePath = buildReverseScopePath(scope);
      const url =
        "/api/push/" + encodeURIComponent(currentStorage) + scopePath +
        "/" + encodeURIComponent(linkId);
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Diverged — confirm before retrying with allowOverwriteRemote.
        const msg = (data && data.error) || "Remote diverged from local snapshot.";
        if (
          confirm(
            msg +
              "\n\nForce-push (overwrite remote)? This rewrites the remote branch and may discard upstream commits.",
          )
        ) {
          const force = await fetch(url + "?allowOverwriteRemote=true", { method: "POST" });
          const forceData = await force.json().catch(() => ({}));
          if (!force.ok) {
            setReversePushStatus(
              "Force-push failed: " + ((forceData && forceData.error) || ("HTTP " + force.status)),
              classifyStatusKind(force.status),
            );
            return;
          }
          summarizePushResult(forceData.result);
        } else {
          setReversePushStatus("Push aborted (remote diverged, force not confirmed).", "warning");
        }
        return;
      }
      if (!res.ok) {
        setReversePushStatus(
          "Push failed: " + ((data && data.error) || ("HTTP " + res.status)),
          classifyStatusKind(res.status),
        );
        return;
      }
      summarizePushResult(data.result);
      // Refresh the panel to show new lastPushedAt.
      await openReverseLinksPanel(scope);
    } catch (e) {
      setReversePushStatus("Push failed: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function summarizePushResult(r) {
    if (!r) { setReversePushStatus("Push complete.", "success"); return; }
    const msg =
      "Push complete — added " + (r.added?.length || 0) +
      ", modified " + (r.modified?.length || 0) +
      ", deleted " + (r.deleted?.length || 0) +
      ", skipped " + (r.skipped?.length || 0) +
      ", errors " + (r.errors?.length || 0);
    setReversePushStatus(msg, r.errors?.length ? "warning" : "success");
  }

  // --- Unlink (delete) a reverse-link ---
  async function reverseUnlinkSingle(scope, linkId) {
    if (
      !confirm(
        "Remove this reverse-link? The remote repository is NOT deleted; only the local link record (and its snapshot) are dropped.",
      )
    ) return;
    try {
      const scopePath = buildReverseScopePath(scope);
      const url =
        "/api/reverse-links/" + encodeURIComponent(currentStorage) + scopePath +
        "/" + encodeURIComponent(linkId);
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReversePushStatus(
          "Unlink failed: " + ((data && data.error) || ("HTTP " + res.status)),
          classifyStatusKind(res.status),
        );
        return;
      }
      await openReverseLinksPanel(scope);
    } catch (e) {
      setReversePushStatus("Unlink failed: " + e.message, "error");
    }
  }

  // --- Push All reverse-links in scope ---
  reverseLinksPushAll.addEventListener("click", async () => {
    if (!reverseLinksPanelScope) return;
    if (!confirm("Push ALL reverse-links in this scope?")) return;
    const origText = reverseLinksPushAll.textContent;
    reverseLinksPushAll.disabled = true;
    reverseLinksPushAll.textContent = "Pushing...";
    try {
      const scopePath = buildReverseScopePath(reverseLinksPanelScope);
      const url = "/api/push-all/" + encodeURIComponent(currentStorage) + scopePath;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // 502 = partial failure with per-link results — render the table anyway.
      if (!res.ok && res.status !== 502) {
        setReversePushStatus(
          "Push-all failed: " + ((data && data.error) || ("HTTP " + res.status)),
          classifyStatusKind(res.status),
        );
        return;
      }
      const results = (data && data.results) || [];
      let ok = 0;
      let failed = 0;
      let added = 0;
      let modified = 0;
      let deleted = 0;
      for (const r of results) {
        if (r.ok) {
          ok++;
          added += r.result?.added?.length || 0;
          modified += r.result?.modified?.length || 0;
          deleted += r.result?.deleted?.length || 0;
        } else {
          failed++;
        }
      }
      setReversePushStatus(
        "Push-all: " + ok + " ok / " + failed + " failed — totals: +" + added + " ~" + modified + " -" + deleted,
        failed ? "warning" : "success",
      );
      await openReverseLinksPanel(reverseLinksPanelScope);
    } catch (e) {
      setReversePushStatus("Push-all failed: " + e.message, "error");
    } finally {
      reverseLinksPushAll.disabled = false;
      reverseLinksPushAll.textContent = origText;
    }
  });

  // --- Reverse-link badge rendering ---
  // Called after the forward-link badge logic in toggleContainer (where we
  // already fetched `/api/links/...`). For reverse-links we issue a parallel
  // fetch to `/api/reverse-links/...` and decorate the same container node
  // with a distinct badge.
  async function addReverseLinkBadgesForContainer(node, containerName) {
    try {
      const url =
        "/api/reverse-links/" + encodeURIComponent(currentStorage) +
        "/" + encodeURIComponent(containerName);
      const data = await apiJson(url);
      const links = (data && data.links) || [];
      containerReverseLinksCache[containerName] = links;
      if (links.length === 0) return;
      const containerItem = node.querySelector(".tree-item");
      if (containerItem && !containerItem.querySelector(".reverse-link-badge")) {
        const badge = document.createElement("span");
        badge.className = "reverse-link-badge";
        badge.textContent = "↗"; // north-east arrow → outbound (storage → repo)
        badge.title = links.length + " reverse-link(s) — storage publishes to repo";
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          openReverseLinksPanel({ scope: "container", container: containerName });
        });
        containerItem.appendChild(badge);
      }
    } catch {
      /* no reverse-links or endpoint failed — silent like the forward badge */
    }
  }
  // Expose for the existing toggleContainer flow.
  window.__addReverseLinkBadgesForContainer = addReverseLinkBadgesForContainer;

  // --- Init ---
  loadStorages();
})();
