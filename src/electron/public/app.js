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

  let currentStorage = "";
  let currentContainer = "";
  let activeTreeItem = null;
  let contextTarget = null; // { container, blobName, parentEl, prefix, depth }
  let syncTarget = null; // { container, meta }

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
    if (!res.ok) throw new Error(`API error: ${res.status}`);
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
        treeContent.appendChild(node);
      }
    } catch (e) {
      treeContent.innerHTML = `<p class="placeholder">Error: ${e.message}</p>`;
    }
  }

  function createTreeNode(name, icon, depth, hasChildren) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const item = document.createElement("div");
    item.className = "tree-item";
    item.style.setProperty("--depth", depth);
    item.innerHTML = `
      <span class="tree-toggle">${hasChildren ? "\u25B6" : ""}</span>
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${name}</span>
    `;
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

      // Check for repo sync metadata
      try {
        const metaRes = await fetch(`/api/sync-meta/${currentStorage}/${containerName}`);
        const meta = await metaRes.json();
        if (meta && meta.provider) {
          const badge = document.createElement("span");
          badge.className = "sync-badge";
          badge.textContent = "\u21BB"; // sync arrow
          badge.title = `Synced from ${meta.provider}: ${meta.repoUrl} (${meta.branch})`;
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            syncTarget = { container: containerName, meta };
            syncInfo.innerHTML = `
              <p><strong>Repository:</strong> ${meta.repoUrl}</p>
              <p><strong>Branch:</strong> ${meta.branch}</p>
              <p><strong>Provider:</strong> ${meta.provider}</p>
              <p><strong>Last synced:</strong> ${new Date(meta.lastSyncAt).toLocaleString()}</p>
              <p><strong>Files:</strong> ${Object.keys(meta.fileShas).length}</p>
            `;
            syncModal.classList.remove("hidden");
          });
          // Add badge to the container's tree-item
          const containerItem = node.querySelector(".tree-item");
          if (containerItem && !containerItem.querySelector(".sync-badge")) {
            containerItem.appendChild(badge);
          }
        }
      } catch { /* not a synced container */ }
    } catch (e) {
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired);font-size:12px">Error: ${e.message}</div>`;
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
      children.innerHTML = `<div style="padding:4px 24px;color:var(--expiry-expired)">Error: ${e.message}</div>`;
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
          contentBody.innerHTML = `<div class="docx-view">${html}</div>`;
        } catch (e) {
          contentBody.innerHTML = `<p class="placeholder">Error: ${e.message}</p>`;
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
      contentBody.innerHTML = `<p class="placeholder">Error: ${e.message}</p>`;
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
  document.addEventListener("click", () => ctxMenu.classList.add("hidden"));
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".tree-item")) ctxMenu.classList.add("hidden");
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
      alert("Sync failed: " + e.message);
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

  // --- Init ---
  loadStorages();
})();
