// Storage Navigator — Frontend Application
(function () {
  const storageSelect = document.getElementById("storage-select");
  const addBtn = document.getElementById("add-storage-btn");
  const exportBtn = document.getElementById("export-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const themeBtn = document.getElementById("theme-btn");
  const treeContent = document.getElementById("tree-content");
  const contentTitle = document.getElementById("content-title");
  const contentMeta = document.getElementById("content-meta");
  const contentBody = document.getElementById("content-body");
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
  const linksPanelClose = document.getElementById("links-panel-close");

  // --- Add Token Modal elements ---
  const addTokenModal = document.getElementById("add-token-modal");
  const addTokenMessage = document.getElementById("add-token-message");
  const addTokenName = document.getElementById("add-token-name");
  const addTokenProvider = document.getElementById("add-token-provider");
  const addTokenValue = document.getElementById("add-token-value");
  const addTokenCancel = document.getElementById("add-token-cancel");
  const addTokenSave = document.getElementById("add-token-save");

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

  // --- Theme ---
  let theme = localStorage.getItem("sn-theme") || "dark";
  applyTheme(theme);

  function applyTheme(t) {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("sn-theme", t);
    themeBtn.textContent = t === "dark" ? "\u2600" : "\u263E"; // sun / moon
    document.getElementById("hljs-dark").disabled = t !== "dark";
    document.getElementById("hljs-light").disabled = t !== "light";
  }

  themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));

  // --- Auth type toggle in modal ---
  modalAuthType.addEventListener("change", () => {
    const label = modalAuthType.value === "sas-token" ? "SAS Token" : "Account Key";
    modalKeyLabel.querySelector("textarea").placeholder = label;
    modalKeyLabel.childNodes[0].textContent = label;
  });

  // --- API helpers ---
  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch {}
      const err = new Error(body.error || `API error: ${res.status}`);
      err.code = body.code;
      err.provider = body.provider;
      throw err;
    }
    return res;
  }
  async function apiJson(url, opts) { return (await api(url, opts)).json(); }

  // --- Storages ---
  async function loadStorages() {
    const storages = await apiJson("/api/storages");
    storageSelect.innerHTML = '<option value="">Select storage...</option>';
    for (const s of storages) {
      const opt = document.createElement("option");
      opt.value = s.name;
      let label = `${s.name} (${s.accountName})`;
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
  }

  storageSelect.addEventListener("change", async () => {
    currentStorage = storageSelect.value;
    currentContainer = "";
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
      const containers = await apiJson(`/api/containers/${currentStorage}`);
      treeContent.innerHTML = "";

      for (const c of containers) {
        const node = createTreeNode(c.name, "\uD83D\uDCE6", 0, true);
        node.dataset.container = c.name;
        node.querySelector(".tree-item").addEventListener("click", () => toggleContainer(node, c.name));
        node.querySelector(".tree-item").addEventListener("contextmenu", (e) => {
          e.preventDefault();
          containerContextTarget = { containerName: c.name, node };
          containerCtxMenu.style.left = e.clientX + "px";
          containerCtxMenu.style.top = e.clientY + "px";
          containerCtxMenu.classList.remove("hidden");
        });
        treeContent.appendChild(node);
      }
    } catch (e) {
      treeContent.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

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
    iconSpan.textContent = icon;

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
            badge.textContent = "\u21BB"; // sync arrow
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
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadTreeLevel(parentEl, container, prefix, depth) {
    let url = `/api/blobs/${currentStorage}/${container}`;
    if (prefix) url += `?prefix=${encodeURIComponent(prefix)}`;
    const items = await apiJson(url);

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
    return "\uD83D\uDCCE";
  }

  // --- File Viewer ---
  async function viewFile(container, blobName, size) {
    const shortName = blobName.split("/").pop();
    contentTitle.textContent = shortName;
    contentMeta.textContent = size ? `${(size / 1024).toFixed(1)} KB` : "";
    contentBody.innerHTML = '<p class="placeholder">Loading...</p>';

    const ext = blobName.split(".").pop()?.toLowerCase();
    const url = `/api/blob/${currentStorage}/${container}?blob=${encodeURIComponent(blobName)}`;

    try {
      if (ext === "pdf") {
        contentBody.innerHTML = `<iframe class="pdf-embed" src="${url}"></iframe>`;
        return;
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

      if (ext === "json") {
        try {
          const parsed = JSON.parse(text);
          contentBody.innerHTML = `<pre><code class="language-json">${escapeHtml(JSON.stringify(parsed, null, 2))}</code></pre>`;
          if (window.hljs) hljs.highlightAll();
        } catch {
          contentBody.innerHTML = `<pre class="text-view">${escapeHtml(text)}</pre>`;
        }
      } else if (ext === "md") {
        if (window.marked) {
          contentBody.innerHTML = `<div class="markdown-view">${marked.parse(text)}</div>`;
          if (window.hljs) contentBody.querySelectorAll("pre code").forEach(el => hljs.highlightElement(el));
        } else {
          contentBody.innerHTML = `<pre class="text-view">${escapeHtml(text)}</pre>`;
        }
      } else {
        contentBody.innerHTML = `<pre class="text-view">${escapeHtml(text)}</pre>`;
      }
    } catch (e) {
      contentBody.innerHTML = `<p class="placeholder">Error: ${escapeHtml(e.message)}</p>`;
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

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

  // --- Refresh ---
  refreshBtn.addEventListener("click", async () => {
    if (!currentStorage) { return; }
    contentTitle.textContent = "No file selected";
    contentMeta.textContent = "";
    contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>';
    activeTreeItem = null;
    await buildTree();
  });

  // --- Add Storage Modal ---
  addBtn.addEventListener("click", () => modal.classList.remove("hidden"));
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

  // --- Context menu ---
  document.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
    folderCtxMenu.classList.add("hidden");
    containerCtxMenu.classList.add("hidden");
  });
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".tree-item")) {
      ctxMenu.classList.add("hidden");
      folderCtxMenu.classList.add("hidden");
      containerCtxMenu.classList.add("hidden");
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
      await apiJson(`/api/rename/${currentStorage}/${contextTarget.container}`, {
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
      const url = `/api/blob/${currentStorage}/${contextTarget.container}?blob=${encodeURIComponent(contextTarget.blobName)}`;
      await apiJson(url, { method: "DELETE" });

      deleteModal.classList.add("hidden");

      // If the deleted file was being viewed, clear the content panel
      if (contentTitle.textContent === contextTarget.blobName.split("/").pop()) {
        contentTitle.textContent = "No file selected";
        contentMeta.textContent = "";
        contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>';
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
      const url = `/api/folder/${currentStorage}/${folderContextTarget.container}?prefix=${encodeURIComponent(folderContextTarget.folderPrefix)}`;
      await apiJson(url, { method: "DELETE" });

      deleteFolderModal.classList.add("hidden");

      // Clear content panel if a file from the deleted folder was being viewed
      contentTitle.textContent = "No file selected";
      contentMeta.textContent = "";
      contentBody.innerHTML = '<p class="placeholder">Click a file to view its contents</p>';
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
      const containers = await apiJson(`/api/containers/${currentStorage}`);
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

      const url = `/api/blob/${currentStorage}/${container}?blob=${encodeURIComponent(blobPath)}&contentType=${encodeURIComponent(contentType)}`;
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
      html += `<td class="link-url" title="${escapeHtml(link.repoUrl)}">${escapeHtml(shortUrl)}</td>`;
      html += `<td>${escapeHtml(link.branch)}</td>`;
      html += `<td>${escapeHtml(target)}</td>`;
      html += `<td>${escapeHtml(subPath)}</td>`;
      html += `<td>${escapeHtml(lastSync)}</td>`;
      html += '<td class="link-actions">';
      html += `<button class="link-sync-btn" data-link-id="${escapeHtml(link.id)}">Sync</button>`;
      html += `<button class="link-unlink-btn" data-link-id="${escapeHtml(link.id)}">Unlink</button>`;
      html += '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    linksPanelBody.innerHTML = html;

    // Attach per-link action handlers
    linksPanelBody.querySelectorAll(".link-sync-btn").forEach((btn) => {
      btn.addEventListener("click", () => syncSingleLink(containerName, btn.dataset.linkId, btn));
    });
    linksPanelBody.querySelectorAll(".link-unlink-btn").forEach((btn) => {
      btn.addEventListener("click", () => unlinkSingleLink(containerName, btn.dataset.linkId));
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

  // --- Handle sync errors (detect missing PAT and offer to add) ---
  let pendingRetryAction = null; // async function to retry after token is added

  function handleSyncError(e, context, retryAction) {
    if (e.code === "MISSING_PAT") {
      pendingRetryAction = retryAction || null;
      openAddTokenModal(e.provider, context);
    } else {
      alert(context + ": " + e.message);
    }
  }

  function openAddTokenModal(provider, context) {
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

      // Automatically retry the sync that triggered the missing PAT error
      if (pendingRetryAction) {
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

  linksPanelClose.addEventListener("click", () => {
    linksPanelModal.classList.add("hidden");
    linksPanelContainer = null;
  });

  // --- Init ---
  loadStorages();
})();
