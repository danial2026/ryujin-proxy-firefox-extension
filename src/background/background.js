/**
 * Ryujin Proxy - Background Service Worker
 * Handles proxy management, tab routing, data tracking, and URL filtering
 */

// Storage keys for local persistence
const STORAGE_KEYS = {
  PROXIES: 'ryujin_proxies',
  ACTIVE_PROXY: 'ryujin_active_proxy',
  TAB_ROUTING: 'ryujin_tab_routing',
  DATA_USAGE: 'ryujin_data_usage',
  URL_FILTERS: 'ryujin_url_filters',
  SETTINGS: 'ryujin_settings'
};

// Default user settings
const DEFAULT_SETTINGS = {
  routeAllTabs: true,
  showNotifications: true,
  dataTrackingEnabled: true,
  pingMethod: 'tcp', // 'tcp' | 'http'
  pingUrl: 'http://httpbin.org/get'
};

// Runtime state
let activeProxyId = null;
let tabRouting = new Map();
let dataUsage = new Map();
let urlFilters = { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] };
let proxies = [];
let settings = { ...DEFAULT_SETTINGS };

// Boot: load data and register listeners
function init() {
  loadAllData();
  setupProxyListener();
  setupTabListeners();
  setupWebRequestListener();
  setupMessageListener();
}

// Load all persisted data from storage
async function loadAllData() {
  const data = await browser.storage.local.get([
    STORAGE_KEYS.PROXIES,
    STORAGE_KEYS.ACTIVE_PROXY,
    STORAGE_KEYS.TAB_ROUTING,
    STORAGE_KEYS.DATA_USAGE,
    STORAGE_KEYS.URL_FILTERS,
    STORAGE_KEYS.SETTINGS
  ]);

  proxies = data[STORAGE_KEYS.PROXIES] || [];
  activeProxyId = data[STORAGE_KEYS.ACTIVE_PROXY] || null;
  tabRouting = new Map(Object.entries(data[STORAGE_KEYS.TAB_ROUTING] || {}));
  dataUsage = new Map(Object.entries(data[STORAGE_KEYS.DATA_USAGE] || {}));
  urlFilters = data[STORAGE_KEYS.URL_FILTERS] || { whitelist: [], blacklist: [], regexWhitelist: [], regexBlacklist: [] };
  settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };

  if (activeProxyId) {
    applyProxy(activeProxyId);
  }
}

// Handle messages from popup/options UI
function setupMessageListener() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATE':
        sendResponse(getState());
        break;
      case 'ADD_PROXY':
        addProxy(message.proxy).then(sendResponse);
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
        updateSettings(message.settings).then(sendResponse);
        return true;
      case 'UPDATE_URL_FILTERS':
        updateUrlFilters(message.urlFilters).then(sendResponse);
        return true;
      case 'RESET_DATA_USAGE':
        resetDataUsage(message.proxyId).then(sendResponse);
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

// Return current state for UI sync
function getState() {
  return {
    proxies: proxies.map(p => ({ ...p, dataUsage: dataUsage.get(p.id) || { sent: 0, received: 0 } })),
    activeProxyId,
    tabRouting: Object.fromEntries(tabRouting),
    urlFilters,
    settings
  };
}

// Add new proxy to list
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
  return { success: true, proxy: newProxy };
}

// Remove proxy from list
async function removeProxy(id) {
  proxies = proxies.filter(p => p.id !== id);
  dataUsage.delete(id);
  if (activeProxyId === id) {
    activeProxyId = null;
    await clearProxy();
  }
  await saveProxies();
  await saveDataUsage();
  return { success: true };
}

// Set active proxy (or disconnect if null)
async function setActiveProxy(id) {
  if (id === null) {
    activeProxyId = null;
    await clearProxy();
  } else {
    const proxy = proxies.find(p => p.id === id);
    if (!proxy) return { success: false, error: 'Proxy not found' };
    activeProxyId = id;
    await applyProxy(id);
  }
  await browser.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROXY]: activeProxyId });
  broadcastStateChange();
  return { success: true };
}

async function applyProxy(proxyId) {
  const proxy = proxies.find(p => p.id === proxyId);
  if (!proxy) return;

  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: 'socks5',
        host: proxy.host,
        port: proxy.port
      },
      bypassList: ['<local>']
    }
  };

  if (proxy.username && proxy.password) {
    config.rules.singleProxy.username = proxy.username;
    config.rules.singleProxy.password = proxy.password;
  }

  await browser.proxy.settings.set({ value: config, scope: 'regular' });
}

async function clearProxy() {
  await browser.proxy.settings.clear({ scope: 'regular' });
}

function setupProxyListener() {
  browser.proxy.onError.addListener((error) => {
    console.error('Proxy error:', error.message);
  });
}

function setupTabListeners() {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && shouldRouteTab(tabId)) {
      applyProxyToTab(tabId);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabRouting.delete(tabId);
    saveTabRouting();
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    if (shouldRouteTab(tabId)) {
      applyProxyToTab(tabId);
    }
  });
}

function shouldRouteTab(tabId) {
  if (!activeProxyId) return false;
  if (settings.routeAllTabs) return true;
  return tabRouting.get(tabId) === true;
}

async function applyProxyToTab(tabId) {
  if (!activeProxyId) return;
  const proxy = proxies.find(p => p.id === activeProxyId);
  if (!proxy) return;

  try {
    await browser.tabs.update(tabId, { proxy: { host: proxy.host, port: proxy.port, scheme: 'socks5' } });
  } catch (e) {
    console.error('Failed to apply proxy to tab:', e);
  }
}

async function toggleTabRouting(tabId) {
  const current = tabRouting.get(tabId) || false;
  tabRouting.set(tabId, !current);
  await saveTabRouting();
  
  if (!current && activeProxyId) {
    applyProxyToTab(tabId);
  }
  broadcastStateChange();
  return { success: true, routing: tabRouting.get(tabId) };
}

async function setRouteAllTabs(enabled) {
  settings.routeAllTabs = enabled;
  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  
  if (enabled && activeProxyId) {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      applyProxyToTab(tab.id);
    }
  }
  broadcastStateChange();
  return { success: true };
}

async function addUrlFilter(filter) {
  const { type, value, isRegex } = filter;
  const key = isRegex ? (type === 'whitelist' ? 'regexWhitelist' : 'regexBlacklist') : (type === 'whitelist' ? 'whitelist' : 'blacklist');
  
  if (!urlFilters[key].includes(value)) {
    urlFilters[key].push(value);
    await saveUrlFilters();
  }
  broadcastStateChange();
  return { success: true };
}

async function removeUrlFilter(filterType, index) {
  const key = filterType === 'whitelist' ? 'whitelist' : filterType === 'blacklist' ? 'blacklist' : filterType === 'regexWhitelist' ? 'regexWhitelist' : 'regexBlacklist';
  urlFilters[key].splice(index, 1);
  await saveUrlFilters();
  broadcastStateChange();
  return { success: true };
}

async function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
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
  if (!proxy) return { success: false, error: 'Proxy not found' };

  const pingMethod = method || settings.pingMethod || 'tcp';
  const pingUrl = url || settings.pingUrl || 'http://httpbin.org/get';

  const startTime = Date.now();
  
  try {
    if (pingMethod === 'tcp') {
      // TCP connection test - try to connect to the proxy port
      await testTcpConnection(proxy.host, proxy.port);
    } else {
      // HTTP request test through the proxy
      await testHttpConnection(proxy, pingUrl);
    }
    
    const latency = Date.now() - startTime;
    return { success: true, latency, method: pingMethod };
  } catch (error) {
    const latency = Date.now() - startTime;
    return { success: false, error: error.message, latency, method: pingMethod };
  }
}

async function testTcpConnection(host, port) {
  // Use a simple fetch to a test endpoint through the proxy
  // Since we can't do raw TCP in WebExtensions, we test via a quick HTTP request
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  
  try {
    // Try to connect via the proxy by making a request to a simple endpoint
    // We'll use the browser's proxy API temporarily
    const config = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'socks5',
          host: host,
          port: port
        },
        bypassList: []
      }
    };
    
    await browser.proxy.settings.set({ value: config, scope: 'regular' });
    
    // Quick test request
    const response = await fetch('http://httpbin.org/get', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    return true;
  } finally {
    clearTimeout(timeout);
    await browser.proxy.settings.clear({ scope: 'regular' });
  }
}

async function testHttpConnection(proxy, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  
  try {
    // Set up proxy temporarily
    const config = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'socks5',
          host: proxy.host,
          port: proxy.port
        },
        bypassList: []
      }
    };
    
    if (proxy.username && proxy.password) {
      config.rules.singleProxy.username = proxy.username;
      config.rules.singleProxy.password = proxy.password;
    }
    
    await browser.proxy.settings.set({ value: config, scope: 'regular' });
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    return true;
  } finally {
    clearTimeout(timeout);
    await browser.proxy.settings.clear({ scope: 'regular' });
  }
}

function setupWebRequestListener() {
  if (!settings.dataTrackingEnabled) return;

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (activeProxyId && shouldTrackRequest(details)) {
        trackDataUsage(details.tabId, details.requestBody ? JSON.stringify(details.requestBody).length : 0, 'sent');
      }
      return checkUrlFilters(details.url);
    },
    { urls: ['<all_urls>'] },
    ['blocking', 'requestBody']
  );

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (activeProxyId && shouldTrackRequest(details)) {
        const contentLength = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value;
        if (contentLength) {
          trackDataUsage(details.tabId, parseInt(contentLength), 'received');
        }
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}

function shouldTrackRequest(details) {
  return details.tabId > 0 && (settings.routeAllTabs || tabRouting.get(details.tabId));
}

function checkUrlFilters(url) {
  for (const pattern of urlFilters.regexBlacklist) {
    try {
      if (new RegExp(pattern).test(url)) return { cancel: true };
    } catch (e) {}
  }
  for (const pattern of urlFilters.regexWhitelist) {
    try {
      if (new RegExp(pattern).test(url)) return { cancel: false };
    } catch (e) {}
  }
  if (urlFilters.blacklist.some(b => url.includes(b))) return { cancel: true };
  if (urlFilters.whitelist.length > 0 && !urlFilters.whitelist.some(w => url.includes(w))) return { cancel: true };
  return { cancel: false };
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
  await browser.storage.local.set({ [STORAGE_KEYS.DATA_USAGE]: Object.fromEntries(dataUsage) });
}

async function saveUrlFilters() {
  await browser.storage.local.set({ [STORAGE_KEYS.URL_FILTERS]: urlFilters });
}

function broadcastStateChange() {
  browser.runtime.sendMessage({ type: 'STATE_CHANGED', state: getState() }).catch(() => {});
}

function generateId() {
  return 'proxy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

init();