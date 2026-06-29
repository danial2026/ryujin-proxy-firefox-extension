/**
 * Ryujin Proxy - Background Service Worker
 * Handles proxy management, tab routing, data tracking, and URL filtering
 */


const STORAGE_KEYS = {
  PROXIES: 'ryujin_proxies',
  ACTIVE_PROXY: 'ryujin_active_proxy',
  TAB_ROUTING: 'ryujin_tab_routing',
  DATA_USAGE: 'ryujin_data_usage',
  URL_FILTERS: 'ryujin_url_filters',
  SETTINGS: 'ryujin_settings',
  PING_HISTORY: 'ryujin_ping_history',
  LOGS: 'ryujin_logs'
};

const DEFAULT_SETTINGS = {
  routeAllTabs: true,
  showNotifications: true,
  dataTrackingEnabled: true,
  pingMethod: 'http',
  pingUrl: 'http://www.google.com/generate_204',
  whitelistEnabled: false,
  blacklistEnabled: false
};

let activeProxyId = null;
let tabRouting = new Map();
let dataUsage = new Map();
let urlFilters = { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] };
let proxies = [];
let settings = { ...DEFAULT_SETTINGS };
let pingHistory = {};
let logs = [];
let _pingOverride = null;

async function init() {
  await loadAllData();
  setupProxyRequestListener();
  setupWebRequestListener();
  setupMessageListener();
}

async function loadAllData() {
  const data = await browser.storage.local.get([
    STORAGE_KEYS.PROXIES,
    STORAGE_KEYS.ACTIVE_PROXY,
    STORAGE_KEYS.TAB_ROUTING,
    STORAGE_KEYS.DATA_USAGE,
    STORAGE_KEYS.URL_FILTERS,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.PING_HISTORY,
    STORAGE_KEYS.LOGS
  ]);

  proxies = data[STORAGE_KEYS.PROXIES] || [];
  activeProxyId = data[STORAGE_KEYS.ACTIVE_PROXY] || null;
  tabRouting = new Map(Object.entries(data[STORAGE_KEYS.TAB_ROUTING] || {}));
  dataUsage = new Map(Object.entries(data[STORAGE_KEYS.DATA_USAGE] || {}));
  urlFilters = data[STORAGE_KEYS.URL_FILTERS] || { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] };
  settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
  pingHistory = data[STORAGE_KEYS.PING_HISTORY] || {};
  logs = data[STORAGE_KEYS.LOGS] || [];
  addLog('info', 'Background service initialized');
}

function setupProxyRequestListener() {
  browser.proxy.onRequest.addListener(
    (details) => {
      if (!activeProxyId) return { type: 'direct' };

      if (_pingOverride && _pingOverride.testUrl === details.url) {
        return { type: 'socks', host: _pingOverride.host, port: _pingOverride.port };
      }

      if (settings.blacklistEnabled || settings.whitelistEnabled) {
        const decision = checkUrlFilters(details.url);
        if (settings.blacklistEnabled && decision.cancel) {
          return { type: 'direct' };
        }
        if (settings.whitelistEnabled) {
          const onWhitelist = urlFilters.regexWhitelist.some(p => { try { return new RegExp(p).test(details.url); } catch(e) {} return false; }) ||
                              urlFilters.whitelist.some(w => details.url.includes(w));
          if (!onWhitelist) return { type: 'direct' };
        }
      }

      if (!settings.routeAllTabs && !tabRouting.get(details.tabId)) {
        return { type: 'direct' };
      }

      const proxy = proxies.find(p => p.id === activeProxyId);
      if (!proxy) return { type: 'direct' };

      return {
        type: 'socks',
        host: proxy.host,
        port: proxy.port,
        ...(proxy.username && { username: proxy.username }),
        ...(proxy.password && { password: proxy.password })
      };
    },
    { urls: ['<all_urls>', 'ws://*/*', 'wss://*/*'] }
  );

  browser.proxy.onError.addListener((error) => {
    console.error('Proxy error:', error.message);
  });
}

function setupMessageListener() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATE':
        getStateWithPing().then(sendResponse);
        return true;
      case 'ADD_PROXY':
        addProxy(message.proxy).then(sendResponse);
        return true;
      case 'UPDATE_PROXY':
        updateProxy(message.proxyId, message.proxy).then(sendResponse);
        return true;
      case 'REMOVE_PROXY':
        removeProxy(message.id).then(sendResponse);
        return true;
      case 'SET_ACTIVE_PROXY':
        setActiveProxy(message.id).then(sendResponse);
        return true;
      case 'TOGGLE_TAB_ROUTING':
        toggleTabRouting(message.tabId).then(sendResponse);
        return true;
      case 'SET_ROUTE_ALL_TABS':
        setRouteAllTabs(message.enabled).then(sendResponse);
        return true;
      case 'ADD_URL_FILTER':
        addUrlFilter(message.filter).then(sendResponse);
        return true;
      case 'REMOVE_URL_FILTER':
        removeUrlFilter(message.filterType, message.index).then(sendResponse);
        return true;
      case 'UPDATE_SETTINGS':
        {
          const { type: _, ...settingsData } = message;
          updateSettings(settingsData).then(sendResponse);
        }
        return true;
      case 'UPDATE_URL_FILTERS':
        updateUrlFilters(message.urlFilters).then(sendResponse);
        return true;
      case 'RESET_DATA_USAGE':
        resetDataUsage(message.proxyId).then(sendResponse);
        return true;
      case 'CLEAR_LOGS':
        clearLogs().then(sendResponse);
        return true;
      case 'GET_TABS':
        getTabs().then(sendResponse);
        return true;
      case 'PING_PROXY':
        pingProxy(message.proxyId, message.method, message.url).then(sendResponse);
        return true;
    }
  });
}

function getState() {
  return {
    proxies: proxies.map(p => ({
      ...p,
      dataUsage: dataUsage.get(p.id) || { sent: 0, received: 0 },
      lastPing: pingHistory[p.id] || null
    })),
    activeProxyId,
    tabRouting: Object.fromEntries(tabRouting),
    urlFilters,
    settings,
    logs
  };
}

async function getStateWithPing() {
  const data = await browser.storage.local.get([STORAGE_KEYS.PING_HISTORY]);
  const history = data[STORAGE_KEYS.PING_HISTORY] || {};

  return {
    proxies: proxies.map(p => ({
      ...p,
      dataUsage: dataUsage.get(p.id) || { sent: 0, received: 0 },
      lastPing: history[p.id] || null
    })),
    activeProxyId,
    tabRouting: Object.fromEntries(tabRouting),
    urlFilters,
    settings,
    logs
  };
}

async function addProxy(proxy) {
  const newProxy = {
    id: generateId(),
    name: proxy.name,
    host: proxy.host,
    port: parseInt(proxy.port),
    username: proxy.username || '',
    password: proxy.password || '',
    createdAt: Date.now()
  };
  proxies.push(newProxy);
  await saveProxies();
  addLog('success', `Added proxy [${newProxy.name}] (${newProxy.host}:${newProxy.port})`);
  return { success: true, proxy: newProxy };
}

async function removeProxy(id) {
  const proxy = proxies.find(p => p.id === id);
  const proxyName = proxy ? proxy.name : id;
  proxies = proxies.filter(p => p.id !== id);
  dataUsage.delete(id);
  if (activeProxyId === id) {
    activeProxyId = null;
    addLog('warning', `Disconnected - removed active proxy [${proxyName}]`);
  }
  await saveProxies();
  await saveDataUsage();
  addLog('success', `Removed proxy [${proxyName}]`);
  return { success: true };
}

async function setActiveProxy(id) {
  try {
    if (id === null) {
      const prevProxy = activeProxyId ? formatProxyName(activeProxyId) : 'none';
      activeProxyId = null;
      addLog('warning', `Disconnected from proxy [${prevProxy}]`);
    } else {
      const proxy = proxies.find(p => p.id === id);
      if (!proxy) return { success: false, error: 'Proxy not found' };
      activeProxyId = id;
      addLog('success', `Connected to proxy [${proxy.name}] (${proxy.host}:${proxy.port})`);
    }
    await browser.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROXY]: activeProxyId });
    broadcastStateChange();
    return { success: true };
  } catch (e) {
    addLog('error', `Failed to set proxy: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function updateProxy(proxyId, proxyData) {
  const index = proxies.findIndex(p => p.id === proxyId);
  if (index === -1) return { success: false, error: 'Proxy not found' };

  const updatedProxy = {
    ...proxies[index],
    name: proxyData.name,
    host: proxyData.host,
    port: parseInt(proxyData.port),
    username: proxyData.username || '',
    password: proxyData.password || ''
  };

  proxies[index] = updatedProxy;
  await saveProxies();

  if (activeProxyId === proxyId) {
    addLog('info', `Updated active proxy [${updatedProxy.name}]`);
  } else {
    addLog('info', `Updated proxy [${updatedProxy.name}]`);
  }

  broadcastStateChange();
  return { success: true, proxy: updatedProxy };
}

async function toggleTabRouting(tabId) {
  const current = tabRouting.get(tabId) || false;
  tabRouting.set(tabId, !current);
  await saveTabRouting();
  addLog('info', `Tab routing ${!current ? 'enabled' : 'disabled'} for tab ${tabId}`);
  broadcastStateChange();
  return { success: true, routing: tabRouting.get(tabId) };
}

async function setRouteAllTabs(enabled) {
  settings.routeAllTabs = enabled;
  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  addLog('info', `Route all tabs ${enabled ? 'enabled' : 'disabled'}`);
  broadcastStateChange();
  return { success: true };
}

async function addUrlFilter(filter) {
  const { type, value, isRegex } = filter;
  const key = isRegex ? (type === 'whitelist' ? 'regexWhitelist' : 'regexBlacklist') : (type === 'whitelist' ? 'whitelist' : 'blacklist');

  if (!urlFilters[key].includes(value)) {
    urlFilters[key].push(value);
    await saveUrlFilters();
    addLog('info', `Added ${key} filter: ${value}`);
  }
  broadcastStateChange();
  return { success: true };
}

async function removeUrlFilter(filterType, index) {
  const key = filterType === 'whitelist' ? 'whitelist' : filterType === 'blacklist' ? 'blacklist' : filterType === 'regexWhitelist' ? 'regexWhitelist' : 'regexBlacklist';
  const value = urlFilters[key][index];
  urlFilters[key].splice(index, 1);
  await saveUrlFilters();
  addLog('info', `Removed ${key} filter: ${value}`);
  broadcastStateChange();
  return { success: true };
}

async function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  addLog('info', 'Settings updated');
  broadcastStateChange();
  return { success: true };
}

async function updateUrlFilters(newFilters) {
  urlFilters = { ...urlFilters, ...newFilters };
  await saveUrlFilters();
  broadcastStateChange();
  return { success: true };
}

async function resetDataUsage(proxyId) {
  if (proxyId) {
    dataUsage.set(proxyId, { sent: 0, received: 0 });
  } else {
    dataUsage.clear();
  }
  await saveDataUsage();
  broadcastStateChange();
  return { success: true };
}

async function getTabs() {
  const tabs = await browser.tabs.query({});
  return tabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    routed: tabRouting.get(tab.id) || false
  }));
}

async function pingProxy(proxyId, method, url) {
  const proxy = proxies.find(p => p.id === proxyId);
  if (!proxy) {
    addLog('error', `Ping failed - proxy not found [${proxyId}]`);
    return { success: false, error: 'Proxy not found' };
  }

  const pingMethod = method || settings.pingMethod || 'http';
  const pingUrl = url || settings.pingUrl || 'http://www.google.com/generate_204';
  const startTime = Date.now();

  addLog('info', `Pinging [${proxy.name}] using ${pingMethod.toUpperCase()} method`);

  try {
    if (pingMethod === 'tcp') {
      await testTcpConnection(proxy.host, proxy.port, proxy.username, proxy.password, pingUrl);
    } else {
      await testHttpConnection(proxy, pingUrl);
    }

    const latency = Date.now() - startTime;
    const pingData = { success: true, latency, method: pingMethod, timestamp: Date.now() };
    await savePingHistory(proxyId, pingData);
    addLog('success', `Ping [${proxy.name}] - ${latency}ms (${pingMethod.toUpperCase()})`);
    broadcastStateChange();
    return { success: true, latency, method: pingMethod };
  } catch (error) {
    const latency = Date.now() - startTime;
    const pingData = { success: false, error: error.message, latency, method: pingMethod, timestamp: Date.now() };
    await savePingHistory(proxyId, pingData);
    addLog('error', `Ping [${proxy.name}] failed - ${error.message}`);
    broadcastStateChange();
    return { success: false, error: error.message, latency, method: pingMethod };
  }
}

async function testTcpConnection(host, port, username, password, pingUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    _pingOverride = { host, port, testUrl: pingUrl };
    await new Promise(r => setTimeout(r, 200));
    const response = await fetch(pingUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } finally {
    _pingOverride = null;
    clearTimeout(timeout);
  }
}

async function testHttpConnection(proxy, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    _pingOverride = { host: proxy.host, port: proxy.port, testUrl: url };
    await new Promise(r => setTimeout(r, 200));
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } finally {
    _pingOverride = null;
    clearTimeout(timeout);
  }
}

function setupWebRequestListener() {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (settings.dataTrackingEnabled && shouldTrackRequest(details)) {
        trackDataUsage(details.tabId, details.requestBody ? JSON.stringify(details.requestBody).length : 0, 'sent');
      }
      return { cancel: false };
    },
    { urls: ['<all_urls>'] },
    ['blocking', 'requestBody']
  );

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (settings.dataTrackingEnabled && shouldTrackRequest(details)) {
        const header = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length');
        if (header) {
          trackDataUsage(details.tabId, parseInt(header.value), 'received');
        }
      }
      return {};
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}

function shouldTrackRequest(details) {
  return details.tabId > 0 && (settings.routeAllTabs || tabRouting.get(details.tabId));
}

function checkUrlFilters(url) {
  try {
    if (settings.blacklistEnabled) {
      for (const pattern of urlFilters.regexBlacklist) {
        try {
          if (new RegExp(pattern).test(url)) return { cancel: true };
        } catch (e) {}
      }
      for (const pattern of urlFilters.blacklist) {
        if (url.includes(pattern)) return { cancel: true };
      }
    }

    if (settings.whitelistEnabled) {
      for (const pattern of urlFilters.regexWhitelist) {
        try {
          if (new RegExp(pattern).test(url)) return { cancel: false };
        } catch (e) {}
      }
      if (urlFilters.whitelist.length > 0 && !urlFilters.whitelist.some(w => url.includes(w))) {
        return { cancel: true };
      }
    }

    return { cancel: false };
  } catch (e) {
    console.error('checkUrlFilters error:', e, 'url:', url);
    return { cancel: false };
  }
}

function trackDataUsage(tabId, bytes, direction) {
  if (!activeProxyId) return;
  const current = dataUsage.get(activeProxyId) || { sent: 0, received: 0 };
  current[direction] += bytes;
  dataUsage.set(activeProxyId, current);
  saveDataUsage();
}

async function saveProxies() {
  await browser.storage.local.set({ [STORAGE_KEYS.PROXIES]: proxies });
}

async function saveTabRouting() {
  await browser.storage.local.set({ [STORAGE_KEYS.TAB_ROUTING]: Object.fromEntries(tabRouting) });
}

async function saveDataUsage() {
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.DATA_USAGE]: Object.fromEntries(dataUsage) });
  } catch (e) {
    console.error('Failed to save data usage:', e);
  }
}

async function saveUrlFilters() {
  await browser.storage.local.set({ [STORAGE_KEYS.URL_FILTERS]: urlFilters });
}

async function savePingHistory(proxyId, pingData) {
  const data = await browser.storage.local.get([STORAGE_KEYS.PING_HISTORY]);
  const history = data[STORAGE_KEYS.PING_HISTORY] || {};
  history[proxyId] = pingData;
  await browser.storage.local.set({ [STORAGE_KEYS.PING_HISTORY]: history });
  pingHistory[proxyId] = pingData;
}

function broadcastStateChange() {
  browser.runtime.sendMessage({ type: 'STATE_CHANGED', state: getState() }).catch(() => {});
}

function generateId() {
  return 'proxy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function saveLogs() {
  try {
    if (logs.length > 500) {
      logs = logs.slice(logs.length - 500);
    }
    await browser.storage.local.set({ [STORAGE_KEYS.LOGS]: logs });
  } catch (e) {
    console.error('Failed to save logs:', e);
  }
}

function addLog(level, message) {
  const entry = { level, message, timestamp: Date.now() };
  logs.push(entry);
  if (logs.length > 500) {
    logs.shift();
  }
  saveLogs();
  browser.runtime.sendMessage({ type: 'LOG_ENTRY', level, message }).catch(() => {});
}

function formatProxyName(proxyId) {
  const proxy = proxies.find(p => p.id === proxyId);
  return proxy ? proxy.name : proxyId;
}

async function clearLogs() {
  logs = [];
  await browser.storage.local.set({ [STORAGE_KEYS.LOGS]: [] });
  addLog('info', 'Logs cleared');
  return { success: true };
}

init().catch(e => console.error('Init failed:', e));
