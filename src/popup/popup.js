(function() {
  'use strict';

  let state = {
    proxies: [],
    activeProxyId: null,
    tabRouting: {},
    urlFilters: { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] },
    settings: { routeAllTabs: true, showNotifications: true, dataTrackingEnabled: true }
  };

  const elements = {
    proxyList: document.getElementById('proxyList'),
    emptyState: document.getElementById('emptyState'),
    addProxyBtn: document.getElementById('addProxyBtn'),
    addFirstProxyBtn: document.getElementById('addFirstProxyBtn'),
    activeProxy: document.getElementById('activeProxy'),
    activeProxyEmpty: document.getElementById('activeProxyEmpty'),
    activeProxyInfo: document.getElementById('activeProxyInfo'),
    statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'),
    activeProxyName: document.getElementById('activeProxyName'),
    activeProxyHost: document.getElementById('activeProxyHost'),
    statSent: document.getElementById('statSent'),
    statReceived: document.getElementById('statReceived'),
    routeAllTabs: document.getElementById('routeAllTabs'),
    tabsList: document.getElementById('tabsList'),
    emptyTabs: document.getElementById('emptyTabs'),
    modalOverlay: document.getElementById('modalOverlay'),
    proxyModal: document.getElementById('proxyModal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModal: document.getElementById('closeModal'),
    proxyForm: document.getElementById('proxyForm'),
    proxyId: document.getElementById('proxyId'),
    proxyName: document.getElementById('proxyName'),
    proxyHost: document.getElementById('proxyHost'),
    proxyPort: document.getElementById('proxyPort'),
    proxyUsername: document.getElementById('proxyUsername'),
    proxyPassword: document.getElementById('proxyPassword'),
    cancelBtn: document.getElementById('cancelBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    deleteModalOverlay: document.getElementById('deleteModalOverlay'),
    closeDeleteModal: document.getElementById('closeDeleteModal'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    deleteProxyId: document.getElementById('deleteProxyId'),
    deleteProxyName: document.getElementById('deleteProxyName')
  };

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatHost(host, port) {
    return `${host}:${port}`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return date.toLocaleDateString();
  }

  async function sendMessage(type, data = {}) {
    return new Promise((resolve) => {
      browser.runtime.sendMessage({ type, ...data }, resolve);
    });
  }

  function renderProxies() {
    const { proxies, activeProxyId } = state;
    elements.proxyList.innerHTML = '';

    if (proxies.length === 0) {
      elements.proxyList.style.display = 'none';
      elements.emptyState.style.display = 'flex';
      return;
    }

    elements.proxyList.style.display = 'flex';
    elements.emptyState.style.display = 'none';

    proxies.forEach(proxy => {
      const li = document.createElement('li');
      li.className = 'proxy-item' + (proxy.id === activeProxyId ? ' selected' : '');
      li.dataset.id = proxy.id;

      const usage = proxy.dataUsage || { sent: 0, received: 0 };

      const infoDiv = document.createElement('div');
      infoDiv.className = 'proxy-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'proxy-name';
      nameSpan.textContent = proxy.name;

      const hostSpan = document.createElement('span');
      hostSpan.className = 'proxy-host';
      hostSpan.textContent = formatHost(proxy.host, proxy.port);

      const pingInfoSpan = document.createElement('span');
      pingInfoSpan.className = 'proxy-ping-info';
      if (proxy.lastPing) {
        const pingResult = proxy.lastPing;
        if (pingResult.success) {
          pingInfoSpan.textContent = `Ping: ${pingResult.latency}ms (${formatTime(pingResult.timestamp)})`;
          pingInfoSpan.className = 'proxy-ping-info ping-success';
        } else {
          pingInfoSpan.textContent = `Failed: ${pingResult.error || 'Unknown'} (${formatTime(pingResult.timestamp)})`;
          pingInfoSpan.className = 'proxy-ping-info ping-error';
        }
      }

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(hostSpan);
      infoDiv.appendChild(pingInfoSpan);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'proxy-actions';

      const pingBtn = document.createElement('button');
      pingBtn.className = 'proxy-action-btn ping';
      pingBtn.dataset.action = 'ping';
      pingBtn.setAttribute('aria-label', 'Test proxy connection');
      pingBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      `;

      const editBtn = document.createElement('button');
      editBtn.className = 'proxy-action-btn edit';
      editBtn.dataset.action = 'edit';
      editBtn.setAttribute('aria-label', 'Edit proxy');
      editBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      `;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'proxy-action-btn delete';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.setAttribute('aria-label', 'Delete proxy');
      deleteBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      `;

      actionsDiv.appendChild(pingBtn);
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(infoDiv);
      li.appendChild(actionsDiv);

      li.addEventListener('click', (e) => {
        if (e.target.closest('.proxy-action-btn')) return;
        selectProxy(proxy.id);
      });

      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(proxy);
      });

      pingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pingProxy(proxy.id, pingBtn);
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(proxy.id, proxy.name);
      });

      elements.proxyList.appendChild(li);
    });
  }

  function renderActiveProxy() {
    const { proxies, activeProxyId } = state;
    const activeProxy = proxies.find(p => p.id === activeProxyId);

    if (!activeProxy) {
      elements.activeProxyEmpty.style.display = 'flex';
      elements.activeProxyInfo.style.display = 'none';
      return;
    }

    const usage = activeProxy.dataUsage || { sent: 0, received: 0 };

    elements.activeProxyEmpty.style.display = 'none';
    elements.activeProxyInfo.style.display = 'flex';
    elements.activeProxyName.textContent = activeProxy.name;
    elements.activeProxyHost.textContent = formatHost(activeProxy.host, activeProxy.port);
    elements.statSent.textContent = formatBytes(usage.sent);
    elements.statReceived.textContent = formatBytes(usage.received);

    elements.statusIndicator.className = 'status-indicator connected';
    elements.statusText.textContent = 'Connected';
    elements.statusText.className = 'status-text connected';
  }

  function renderTabs() {
    const { tabRouting, proxies, activeProxyId } = state;
    elements.tabsList.innerHTML = '';

    if (!activeProxyId) {
      elements.tabsList.style.display = 'none';
      elements.emptyTabs.style.display = 'flex';
      elements.emptyTabs.innerHTML = '<p>Connect a proxy to route tabs</p>';
      return;
    }

    browser.tabs.query({}, (tabs) => {
      if (tabs.length === 0) {
        elements.tabsList.style.display = 'none';
        elements.emptyTabs.style.display = 'flex';
        elements.emptyTabs.innerHTML = '<p>No tabs open</p>';
        return;
      }

      elements.tabsList.style.display = 'flex';
      elements.emptyTabs.style.display = 'none';

      tabs.forEach(tab => {
        const isRouted = state.settings.routeAllTabs || tabRouting[tab.id] === true;
        const li = document.createElement('li');
        li.className = 'tab-item';
        li.dataset.id = tab.id;

        const favicon = document.createElement('img');
        favicon.className = 'tab-favicon';
        favicon.src = tab.favIconUrl || '';
        favicon.onerror = () => { favicon.style.display = 'none'; };

        const infoDiv = document.createElement('div');
        infoDiv.className = 'tab-info';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'tab-title';
        titleSpan.textContent = tab.title || 'Untitled';
        const urlSpan = document.createElement('span');
        urlSpan.className = 'tab-url';
        try {
          urlSpan.textContent = new URL(tab.url).hostname;
        } catch (e) {
          urlSpan.textContent = '';
        }
        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(urlSpan);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'tab-toggle';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isRouted;
        checkbox.disabled = state.settings.routeAllTabs;
        const slider = document.createElement('span');
        slider.className = 'toggle-slider';
        toggleLabel.appendChild(checkbox);
        toggleLabel.appendChild(slider);

        li.appendChild(favicon);
        li.appendChild(infoDiv);
        li.appendChild(toggleLabel);

        checkbox.addEventListener('change', () => toggleTabRouting(tab.id, checkbox.checked));

        elements.tabsList.appendChild(li);
      });
    });
  }

  function updateRouteAllToggle() {
    elements.routeAllTabs.checked = state.settings.routeAllTabs;
    renderTabs();
  }

  async function loadState() {
    const response = await sendMessage('GET_STATE');
    if (response) {
      state = response;
      renderAll();
    }
  }

  function renderAll() {
    renderProxies();
    renderActiveProxy();
    updateRouteAllToggle();
  }

  async function selectProxy(proxyId) {
    const response = await sendMessage('SET_ACTIVE_PROXY', { id: proxyId });
    if (response.success) {
      state.activeProxyId = proxyId;
      renderAll();
    }
  }

  async function deleteProxy(proxyId) {
    const response = await sendMessage('REMOVE_PROXY', { id: proxyId });
    if (response.success) {
      state.proxies = state.proxies.filter(p => p.id !== proxyId);
      if (state.activeProxyId === proxyId) state.activeProxyId = null;
      renderAll();
    }
  }

  async function pingProxy(proxyId, btn) {
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('pinging');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/>
      </svg>
    `;

    try {
      const response = await sendMessage('PING_PROXY', {
        proxyId,
        method: state.settings.pingMethod || 'GET',
        url: state.settings.pingUrl || 'https://www.google.com/generate_204',
        httpMethod: state.settings.pingMethod || 'GET'
      });
      if (response.success) {
        btn.classList.remove('pinging');
        btn.classList.add('success');
        btn.title = `Ping: ${response.latency}ms`;
        setTimeout(() => {
          btn.classList.remove('success');
          btn.title = '';
          btn.innerHTML = originalHTML;
          btn.disabled = false;
        }, 30000);
      } else {
        btn.classList.remove('pinging');
        btn.classList.add('error');
        btn.title = `Failed: ${response.error}`;
        setTimeout(() => {
          btn.classList.remove('error');
          btn.title = '';
          btn.innerHTML = originalHTML;
          btn.disabled = false;
        }, 5000);
      }
    } catch (e) {
      btn.classList.remove('pinging');
      btn.classList.add('error');
      btn.title = `Error: ${e.message}`;
      setTimeout(() => {
        btn.classList.remove('error');
        btn.title = '';
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }, 5000);
    }
  }

  async function toggleTabRouting(tabId, enabled) {
    if (state.settings.routeAllTabs) return;
    const response = await sendMessage('TOGGLE_TAB_ROUTING', { tabId });
    if (response.success) {
      state.tabRouting[tabId] = response.routing;
      renderTabs();
    }
  }

  async function setRouteAllTabs(enabled) {
    const response = await sendMessage('SET_ROUTE_ALL_TABS', { enabled });
    if (response.success) {
      state.settings.routeAllTabs = enabled;
      updateRouteAllToggle();
    }
  }

  async function disconnectProxy() {
    const response = await sendMessage('SET_ACTIVE_PROXY', { id: null });
    if (response.success) {
      state.activeProxyId = null;
      renderAll();
    }
  }

  function openModal(editProxy = null) {
    elements.proxyForm.reset();
    elements.proxyId.value = '';

    if (editProxy) {
      elements.modalTitle.textContent = 'Edit Proxy';
      elements.proxyId.value = editProxy.id;
      elements.proxyName.value = editProxy.name;
      elements.proxyHost.value = editProxy.host;
      elements.proxyPort.value = editProxy.port;
      elements.proxyUsername.value = editProxy.username || '';
      elements.proxyPassword.value = editProxy.password || '';
    } else {
      elements.modalTitle.textContent = 'Add Proxy';
      elements.proxyHost.value = '127.0.0.1';
      elements.proxyPort.value = '10808';
    }

    elements.modalOverlay.classList.add('active');
    elements.proxyName.focus();
  }

  function closeModal() {
    elements.modalOverlay.classList.remove('active');
  }

  async function saveProxy(e) {
    e.preventDefault();

    const proxyData = {
      name: elements.proxyName.value.trim(),
      host: elements.proxyHost.value.trim(),
      port: parseInt(elements.proxyPort.value),
      username: elements.proxyUsername.value.trim(),
      password: elements.proxyPassword.value
    };

    if (!proxyData.name || !proxyData.host || !proxyData.port) {
      alert('Please fill in all required fields');
      return;
    }

    const proxyId = elements.proxyId.value;
    let response;

    if (proxyId) {
      response = await sendMessage('UPDATE_PROXY', {
        proxyId,
        proxy: proxyData
      });
      if (response.success) {
        const idx = state.proxies.findIndex(p => p.id === proxyId);
        if (idx !== -1) {
          state.proxies[idx] = { ...state.proxies[idx], ...proxyData };
        }
      }
    } else {
      response = await sendMessage('ADD_PROXY', { proxy: proxyData });
      if (response.success) {
        state.proxies.push(response.proxy);
      }
    }

    if (response.success) {
      closeModal();
      renderAll();
    } else {
      alert(response.error || 'Failed to save proxy');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function openDeleteModal(proxyId, proxyName) {
    elements.deleteProxyId.value = proxyId;
    elements.deleteProxyName.textContent = proxyName;
    elements.deleteModalOverlay.classList.add('active');
  }

  function closeDeleteModal() {
    elements.deleteModalOverlay.classList.remove('active');
  }

  async function confirmDeleteProxy() {
    const proxyId = elements.deleteProxyId.value;
    closeDeleteModal();
    await deleteProxy(proxyId);
  }

  elements.addProxyBtn.addEventListener('click', () => openModal());
  elements.addFirstProxyBtn.addEventListener('click', () => openModal());
  elements.closeModal.addEventListener('click', closeModal);
  elements.cancelBtn.addEventListener('click', closeModal);
  elements.proxyForm.addEventListener('submit', saveProxy);
  elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
  });
  elements.routeAllTabs.addEventListener('change', (e) => setRouteAllTabs(e.target.checked));
  elements.settingsBtn.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('src/options/options.html') });
  });
  elements.disconnectBtn.addEventListener('click', disconnectProxy);

  elements.closeDeleteModal.addEventListener('click', closeDeleteModal);
  elements.cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  elements.confirmDeleteBtn.addEventListener('click', confirmDeleteProxy);
  elements.deleteModalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.deleteModalOverlay) closeDeleteModal();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_CHANGED') {
      state.proxies = message.state.proxies;
      state.activeProxyId = message.state.activeProxyId;
      state.tabRouting = message.state.tabRouting;
      state.urlFilters = message.state.urlFilters;
      state.settings = message.state.settings;
      renderAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeDeleteModal();
    }
  });

  loadState().catch(e => console.error('Popup loadState failed:', e));
})();