(function() {
  'use strict';

  let state = {
    urlFilters: { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] },
    settings: {
      routeAllTabs: true,
      showNotifications: true,
      dataTrackingEnabled: true,
      pingMethod: 'http',
      pingUrl: 'http://www.google.com/generate_204',
      whitelistEnabled: false,
      blacklistEnabled: false
    },
    logs: [],
    logFilter: 'all'
  };

  const elements = {
    whitelistList: document.getElementById('whitelistList'),
    blacklistList: document.getElementById('blacklistList'),
    regexWhitelistList: document.getElementById('regexWhitelistList'),
    regexBlacklistList: document.getElementById('regexBlacklistList'),
    emptyWhitelist: document.getElementById('emptyWhitelist'),
    emptyBlacklist: document.getElementById('emptyBlacklist'),
    emptyRegexWhitelist: document.getElementById('emptyRegexWhitelist'),
    emptyRegexBlacklist: document.getElementById('emptyRegexBlacklist'),
    dataTrackingEnabled: document.getElementById('dataTrackingEnabled'),
    showNotifications: document.getElementById('showNotifications'),
    pingMethod: document.getElementById('pingMethod'),
    pingUrl: document.getElementById('pingUrl'),
    whitelistEnabled: document.getElementById('whitelistEnabled'),
    blacklistEnabled: document.getElementById('blacklistEnabled'),
    resetDataBtn: document.getElementById('resetDataBtn'),
    resetAllBtn: document.getElementById('resetAllBtn'),
    viewChangelog: document.getElementById('viewChangelog'),
    viewLicense: document.getElementById('viewLicense'),
    modalOverlay: document.getElementById('modalOverlay'),
    closeModal: document.getElementById('closeModal'),
    cancelBtn: document.getElementById('cancelBtn'),
    modalTitle: document.getElementById('modalTitle'),
    filterForm: document.getElementById('filterForm'),
    filterType: document.getElementById('filterType'),
    filterIndex: document.getElementById('filterIndex'),
    filterLabel: document.getElementById('filterLabel'),
    filterValue: document.getElementById('filterValue'),
    filterHint: document.getElementById('filterHint'),
    regexTestGroup: document.getElementById('regexTestGroup'),
    regexTestInput: document.getElementById('regexTestInput'),
    regexTestResult: document.getElementById('regexTestResult'),
    changelogModal: document.getElementById('changelogModal'),
    closeChangelog: document.getElementById('closeChangelog'),
    changelogBody: document.getElementById('changelogBody'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    filterPanels: document.querySelectorAll('.filter-panel'),
    addWhitelistBtn: document.getElementById('addWhitelistBtn'),
    addBlacklistBtn: document.getElementById('addBlacklistBtn'),
    addRegexWhitelistBtn: document.getElementById('addRegexWhitelistBtn'),
    addRegexBlacklistBtn: document.getElementById('addRegexBlacklistBtn'),
    logContainer: document.getElementById('logContainer'),
    logList: document.getElementById('logList'),
    emptyLogs: document.getElementById('emptyLogs'),
    logFilterBtns: document.querySelectorAll('.log-filter-btn')
  };

  let CHANGELOG = '';

  async function loadChangelog() {
    if (CHANGELOG) return CHANGELOG;
    try {
      const response = await fetch(browser.runtime.getURL('CHANGELOG.md'));
      if (!response.ok) throw new Error('Failed to fetch');
      CHANGELOG = await response.text();
    } catch (e) {
      console.warn('Failed to load changelog:', e);
      CHANGELOG = '# Changelog\n\nUnable to load changelog. <a href="#" onclick="window.open(\'https://github.com/danial2026/ryujin-proxy-firefox-extension/blob/main/CHANGELOG.md\', \'_blank\')">View on GitHub</a>';
    }
    return CHANGELOG;
  }

  async function init() {
    await loadState();
  }

  async function sendMessage(type, data = {}) {
    return new Promise((resolve) => {
      browser.runtime.sendMessage({ type, ...data }, resolve);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function testRegex(pattern, testString) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(testString);
    } catch (e) {
      return null;
    }
  }

  function renderFilterList(type) {
    const listEl = elements[`${type}List`];
    const emptyEl = elements[`empty${type.charAt(0).toUpperCase() + type.slice(1)}`];
    const filters = state.urlFilters[type] || [];

    listEl.innerHTML = '';

    if (filters.length === 0) {
      listEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }

    listEl.style.display = 'flex';
    emptyEl.style.display = 'none';

    const isRegex = type.startsWith('regex');

    filters.forEach((value, index) => {
      const li = document.createElement('li');
      li.className = 'filter-item' + (isRegex ? ' regex' : '');
      li.dataset.index = index;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'filter-value';
      valueSpan.title = value;
      valueSpan.textContent = value;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'filter-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'filter-btn edit';
      editBtn.dataset.action = 'edit';
      editBtn.setAttribute('aria-label', 'Edit');
      editBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      `;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'filter-btn delete';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      `;

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(valueSpan);
      li.appendChild(actionsDiv);

      editBtn.addEventListener('click', () => openFilterModal(type, index, value));
      deleteBtn.addEventListener('click', () => deleteFilter(type, index));

      listEl.appendChild(li);
    });
  }

  function renderAllFilters() {
    Object.keys(state.urlFilters).forEach(renderFilterList);
  }

  function renderSettings() {
    elements.dataTrackingEnabled.checked = state.settings.dataTrackingEnabled;
    elements.showNotifications.checked = state.settings.showNotifications;
    elements.pingMethod.value = state.settings.pingMethod || 'http';
    elements.pingUrl.value = state.settings.pingUrl || 'http://www.google.com/generate_204';
    elements.whitelistEnabled.checked = state.settings.whitelistEnabled !== false;
    elements.blacklistEnabled.checked = state.settings.blacklistEnabled !== false;
  }

  async function renderChangelog() {
    const changelog = await loadChangelog();
    const lines = changelog.split('\n');
    let currentVersion = null;
    let currentDate = null;
    let changes = [];
    let currentChangeType = null;

    elements.changelogBody.innerHTML = '';

    lines.forEach(line => {
      const versionMatch = line.match(/^##\s*\[(.+?)\]\s*-\s*(.+)$/);
      if (versionMatch) {
        if (currentVersion) {
          elements.changelogBody.appendChild(renderVersionBlock(currentVersion, currentDate, changes));
        }
        currentVersion = versionMatch[1];
        currentDate = versionMatch[2];
        changes = [];
        currentChangeType = null;
        return;
      }

      const changeMatch = line.match(/^###\s*(Added|Changed|Fixed|Removed)$/);
      if (changeMatch) {
        currentChangeType = changeMatch[1].toLowerCase();
        return;
      }

      const itemMatch = line.match(/^-\s*(.+)$/);
      if (itemMatch && currentChangeType) {
        changes.push({ type: currentChangeType, text: itemMatch[1] });
      }
    });

    if (currentVersion) {
      elements.changelogBody.appendChild(renderVersionBlock(currentVersion, currentDate, changes));
    }
  }

  function renderVersionBlock(version, date, changes) {
    const versionDiv = document.createElement('div');
    versionDiv.className = 'changelog-version';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'changelog-header';

    const versionTag = document.createElement('span');
    versionTag.className = 'changelog-version-tag';
    versionTag.textContent = `v${version}`;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'changelog-date';
    dateSpan.textContent = date;

    headerDiv.appendChild(versionTag);
    headerDiv.appendChild(dateSpan);
    versionDiv.appendChild(headerDiv);

    const changesList = document.createElement('ul');
    changesList.className = 'changelog-changes';

    const grouped = {};
    changes.forEach(c => {
      if (!grouped[c.type]) grouped[c.type] = [];
      grouped[c.type].push(c.text);
    });

    ['added', 'changed', 'fixed', 'removed'].forEach(type => {
      if (grouped[type]) {
        grouped[type].forEach(text => {
          const li = document.createElement('li');
          li.className = type;
          li.textContent = text;
          changesList.appendChild(li);
        });
      }
    });

    versionDiv.appendChild(changesList);
    return versionDiv;
  }

  function openFilterModal(type, index = null, value = '') {
    const isRegex = type.startsWith('regex');
    const isWhitelist = type.includes('whitelist');

    elements.filterType.value = type;
    elements.filterIndex.value = index !== null ? index : '';
    elements.filterLabel.textContent = isRegex ? 'Regex Pattern' : 'Domain';
    elements.filterValue.placeholder = isRegex ? '^https?://.*\\.example\\.com.*$' : 'example.com';
    elements.filterHint.textContent = isRegex
      ? 'Enter a valid JavaScript regex pattern'
      : 'Enter a domain (e.g., example.com or sub.example.com)';
    elements.filterValue.value = value;
    elements.regexTestGroup.style.display = isRegex ? 'block' : 'none';
    elements.regexTestInput.value = '';
    elements.regexTestResult.style.display = 'none';
    elements.modalTitle.textContent = index !== null ? 'Edit Entry' : 'Add Entry';
    elements.modalOverlay.classList.add('active');
    elements.filterValue.focus();
  }

  function closeFilterModal() {
    elements.modalOverlay.classList.remove('active');
    elements.filterForm.reset();
  }

  async function saveFilter(e) {
    e.preventDefault();

    const type = elements.filterType.value;
    const index = elements.filterIndex.value;
    const value = elements.filterValue.value.trim();

    if (!value) {
      alert('Please enter a value');
      return;
    }

    if (type.startsWith('regex')) {
      try {
        new RegExp(value);
      } catch (err) {
        alert('Invalid regex pattern: ' + err.message);
        return;
      }
    }

    if (index !== '') {
      state.urlFilters[type][parseInt(index)] = value;
    } else {
      state.urlFilters[type].push(value);
    }

    const response = await sendMessage('UPDATE_URL_FILTERS', { urlFilters: state.urlFilters });
    if (response.success) {
      closeFilterModal();
      renderFilterList(type);
    }
  }

  async function deleteFilter(type, index) {
    if (!confirm('Delete this entry?')) return;
    state.urlFilters[type].splice(index, 1);
    const response = await sendMessage('UPDATE_URL_FILTERS', { urlFilters: state.urlFilters });
    if (response.success) {
      renderFilterList(type);
    }
  }

  function switchTab(tabName) {
    elements.filterTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    elements.filterPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
  }

  async function toggleSetting(key, value) {
    const response = await sendMessage('UPDATE_SETTINGS', { [key]: value });
    if (response.success) {
      state.settings[key] = value;
    } else {
      elements[key].checked = !value;
    }
  }

  async function resetDataUsage() {
    if (!confirm('Reset all data usage counters? This cannot be undone.')) return;
    const response = await sendMessage('RESET_DATA_USAGE', { proxyId: null });
    if (response.success) {
      showNotification('Data usage reset');
    }
  }

  async function resetAllSettings() {
    if (!confirm('Reset ALL settings, proxies, filters, and data? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure?')) return;

    await browser.storage.local.clear();
    const response = await sendMessage('GET_STATE');
    if (response) {
      state = response;
      renderAll();
    }
    showNotification('All settings reset');
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      background: var(--surface);
      border: 1px solid var(--success);
      border-radius: var(--radius);
      color: var(--success);
      font-size: 13px;
      font-weight: 600;
      z-index: 2000;
      animation: slideIn 200ms ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.style.animation = 'slideIn 200ms ease reverse';
      setTimeout(() => notification.remove(), 200);
    }, 3000);
  }

  function testRegexPattern() {
    const pattern = elements.filterValue.value;
    const testString = elements.regexTestInput.value;

    if (!pattern || !testString) {
      elements.regexTestResult.style.display = 'none';
      return;
    }

    const result = testRegex(pattern, testString);
    if (result === null) {
      elements.regexTestResult.textContent = 'Invalid regex';
      elements.regexTestResult.className = 'regex-test-result no-match';
    } else if (result) {
      elements.regexTestResult.textContent = '\u2713 Pattern matches';
      elements.regexTestResult.className = 'regex-test-result match';
    } else {
      elements.regexTestResult.textContent = '\u2717 Pattern does not match';
      elements.regexTestResult.className = 'regex-test-result no-match';
    }
    elements.regexTestResult.style.display = 'block';
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
  }

  function renderLogs() {
    if (!elements.logList) return;

    const filteredLogs = state.logFilter === 'all'
      ? state.logs
      : state.logs.filter(log => log.level === state.logFilter);

    elements.logList.innerHTML = '';

    if (filteredLogs.length === 0) {
      elements.logList.style.display = 'none';
      if (elements.emptyLogs) elements.emptyLogs.style.display = 'flex';
      return;
    }

    elements.logList.style.display = 'block';
    if (elements.emptyLogs) elements.emptyLogs.style.display = 'none';

    [...filteredLogs].reverse().forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.dataset.level = log.level;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = formatTime(log.timestamp);

      const levelSpan = document.createElement('span');
      levelSpan.className = `log-level ${log.level}`;
      levelSpan.textContent = log.level.toUpperCase();

      const messageSpan = document.createElement('span');
      messageSpan.className = 'log-message';
      messageSpan.innerHTML = escapeHtml(log.message)
        .replace(/\[([^\]]+)\]/g, '<span class="proxy-name">[$1]</span>')
        .replace(/(https?:\/\/[^\s]+)/g, '<span class="url">$1</span>');

      entry.appendChild(timeSpan);
      entry.appendChild(levelSpan);
      entry.appendChild(messageSpan);

      elements.logList.appendChild(entry);
    });
  }

  function filterLogs(level) {
    state.logFilter = level;
    elements.logFilterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.level === level);
    });
    renderLogs();
  }

  function addLog(level, message) {
    const log = {
      level,
      message,
      timestamp: Date.now()
    };
    state.logs.unshift(log);
    if (state.logs.length > 500) {
      state.logs = state.logs.slice(0, 500);
    }
    renderLogs();
  }

  async function loadState() {
    const response = await sendMessage('GET_STATE');
    if (response) {
      state.urlFilters = response.urlFilters;
      state.settings = response.settings;
      state.logs = response.logs || [];
      renderAllFilters();
      renderSettings();
      renderLogs();
    }
    await renderChangelog();
  }

  function renderAll() {
    renderAllFilters();
    renderSettings();
  }

  elements.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  elements.addWhitelistBtn.addEventListener('click', () => openFilterModal('whitelist'));
  elements.addBlacklistBtn.addEventListener('click', () => openFilterModal('blacklist'));
  elements.addRegexWhitelistBtn.addEventListener('click', () => openFilterModal('regexWhitelist'));
  elements.addRegexBlacklistBtn.addEventListener('click', () => openFilterModal('regexBlacklist'));

  elements.closeModal.addEventListener('click', closeFilterModal);
  elements.cancelBtn.addEventListener('click', closeFilterModal);
  elements.filterForm.addEventListener('submit', saveFilter);
  elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeFilterModal();
  });

  elements.dataTrackingEnabled.addEventListener('change', (e) => toggleSetting('dataTrackingEnabled', e.target.checked));
  elements.showNotifications.addEventListener('change', (e) => toggleSetting('showNotifications', e.target.checked));
  elements.pingMethod.addEventListener('change', (e) => toggleSetting('pingMethod', e.target.value));
  elements.pingUrl.addEventListener('change', (e) => toggleSetting('pingUrl', e.target.value));
  elements.whitelistEnabled.addEventListener('change', (e) => toggleSetting('whitelistEnabled', e.target.checked));
  elements.blacklistEnabled.addEventListener('change', (e) => toggleSetting('blacklistEnabled', e.target.checked));

  elements.resetDataBtn.addEventListener('click', resetDataUsage);
  elements.resetAllBtn.addEventListener('click', resetAllSettings);

  elements.viewChangelog.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(browser.runtime.getURL('src/options/changelog.html'), '_blank', 'noopener,noreferrer');
  });

  elements.viewLicense.addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://github.com/danial2026/ryujin-proxy-firefox-extension/blob/main/LICENSE', '_blank', 'noopener,noreferrer');
  });

  elements.closeChangelog.addEventListener('click', () => {
    elements.changelogModal.classList.remove('active');
  });

  elements.changelogModal.addEventListener('click', (e) => {
    if (e.target === elements.changelogModal) {
      elements.changelogModal.classList.remove('active');
    }
  });

  elements.regexTestInput.addEventListener('input', testRegexPattern);
  elements.filterValue.addEventListener('input', testRegexPattern);

  if (elements.logFilterBtns) {
    elements.logFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => filterLogs(btn.dataset.level));
    });
  }

  // Clear logs button
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
      const response = await sendMessage('CLEAR_LOGS');
      if (response.success) {
        state.logs = [];
        renderLogs();
        showNotification('Logs cleared');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFilterModal();
      elements.changelogModal.classList.remove('active');
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_CHANGED') {
      state.urlFilters = message.state.urlFilters;
      state.settings = message.state.settings;
      renderAll();
    }
    if (message.type === 'LOG_ENTRY') {
      addLog(message.level, message.message);
    }
  });

  init().catch(e => console.error('Options init failed:', e));
})();