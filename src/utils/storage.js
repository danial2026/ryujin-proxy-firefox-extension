const STORAGE_KEYS = {
  PROXIES: 'ryujin_proxies',
  ACTIVE_PROXY: 'ryujin_active_proxy',
  TAB_ROUTING: 'ryujin_tab_routing',
  DATA_USAGE: 'ryujin_data_usage',
  URL_FILTERS: 'ryujin_url_filters',
  SETTINGS: 'ryujin_settings'
};

const DEFAULT_SETTINGS = {
  routeAllTabs: true,
  showNotifications: true,
  dataTrackingEnabled: true
};

const DEFAULT_URL_FILTERS = {
  whitelist: [],
  blacklist: [],
  regexWhitelist: [],
  regexBlacklist: []
};

async function getStorage(keys) {
  return browser.storage.local.get(keys);
}

async function setStorage(data) {
  return browser.storage.local.set(data);
}

async function getProxies() {
  const data = await getStorage([STORAGE_KEYS.PROXIES]);
  return data[STORAGE_KEYS.PROXIES] || [];
}

async function setProxies(proxies) {
  await setStorage({ [STORAGE_KEYS.PROXIES]: proxies });
}

async function getActiveProxyId() {
  const data = await getStorage([STORAGE_KEYS.ACTIVE_PROXY]);
  return data[STORAGE_KEYS.ACTIVE_PROXY] || null;
}

async function setActiveProxyId(id) {
  await setStorage({ [STORAGE_KEYS.ACTIVE_PROXY]: id });
}

async function getTabRouting() {
  const data = await getStorage([STORAGE_KEYS.TAB_ROUTING]);
  return data[STORAGE_KEYS.TAB_ROUTING] || {};
}

async function setTabRouting(routing) {
  await setStorage({ [STORAGE_KEYS.TAB_ROUTING]: routing });
}

async function getDataUsage() {
  const data = await getStorage([STORAGE_KEYS.DATA_USAGE]);
  return data[STORAGE_KEYS.DATA_USAGE] || {};
}

async function setDataUsage(usage) {
  await setStorage({ [STORAGE_KEYS.DATA_USAGE]: usage });
}

async function getUrlFilters() {
  const data = await getStorage([STORAGE_KEYS.URL_FILTERS]);
  return data[STORAGE_KEYS.URL_FILTERS] || DEFAULT_URL_FILTERS;
}

async function setUrlFilters(filters) {
  await setStorage({ [STORAGE_KEYS.URL_FILTERS]: filters });
}

async function getSettings() {
  const data = await getStorage([STORAGE_KEYS.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
}

async function setSettings(settings) {
  await setStorage({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function clearAll() {
  await browser.storage.local.clear();
}

function generateId(prefix = 'item') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function validateProxyConfig(proxy) {
  if (!proxy.name || !proxy.name.trim()) {
    return { valid: false, error: 'Name is required' };
  }
  if (!proxy.host || !proxy.host.trim()) {
    return { valid: false, error: 'Host is required' };
  }
  const port = parseInt(proxy.port);
  if (isNaN(port) || port < 1 || port > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }
  return { valid: true };
}

function validateRegex(pattern) {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function testUrlAgainstFilters(url, filters) {
  if (!url) return { allowed: true };

  for (const pattern of filters.regexBlacklist || []) {
    try {
      if (new RegExp(pattern).test(url)) return { allowed: false, reason: 'regexBlacklist', pattern };
    } catch (e) {}
  }

  for (const pattern of filters.regexWhitelist || []) {
    try {
      if (new RegExp(pattern).test(url)) return { allowed: true, reason: 'regexWhitelist', pattern };
    } catch (e) {}
  }

  for (const domain of filters.blacklist || []) {
    if (url.includes(domain)) return { allowed: false, reason: 'blacklist', pattern: domain };
  }

  if (filters.whitelist && filters.whitelist.length > 0) {
    const allowed = filters.whitelist.some(domain => url.includes(domain));
    if (!allowed) return { allowed: false, reason: 'whitelist' };
  }

  return { allowed: true };
}

export {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  DEFAULT_URL_FILTERS,
  getStorage,
  setStorage,
  getProxies,
  setProxies,
  getActiveProxyId,
  setActiveProxyId,
  getTabRouting,
  setTabRouting,
  getDataUsage,
  setDataUsage,
  getUrlFilters,
  setUrlFilters,
  getSettings,
  setSettings,
  clearAll,
  generateId,
  formatBytes,
  validateProxyConfig,
  validateRegex,
  testUrlAgainstFilters
};