(function() {
  'use strict';

  let proxyConfig = null;
  let urlFilters = {
    whitelist: [],
    blacklist: [],
    regexWhitelist: [],
    regexBlacklist: []
  };
  let dataTrackingEnabled = true;

  function testUrlAgainstFilters(url) {
    if (!url) return { allowed: true };

    for (const pattern of urlFilters.regexBlacklist || []) {
      try {
        if (new RegExp(pattern).test(url)) return { allowed: false, reason: 'regexBlacklist' };
      } catch (e) {}
    }

    for (const pattern of urlFilters.regexWhitelist || []) {
      try {
        if (new RegExp(pattern).test(url)) return { allowed: true, reason: 'regexWhitelist' };
      } catch (e) {}
    }

    for (const domain of urlFilters.blacklist || []) {
      if (url.includes(domain)) return { allowed: false, reason: 'blacklist' };
    }

    if (urlFilters.whitelist && urlFilters.whitelist.length > 0) {
      const allowed = urlFilters.whitelist.some(domain => url.includes(domain));
      if (!allowed) return { allowed: false, reason: 'whitelist' };
    }

    return { allowed: true };
  }

  async function fetchConfig() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_STATE' });
      if (response) {
        proxyConfig = response.activeProxyId ? response.proxies.find(p => p.id === response.activeProxyId) : null;
        urlFilters = response.urlFilters || urlFilters;
        dataTrackingEnabled = response.settings?.dataTrackingEnabled ?? true;
      }
    } catch (e) {
      console.debug('[Ryujin Proxy] Config fetch failed:', e);
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_CHANGED') {
      proxyConfig = message.state.activeProxyId
        ? message.state.proxies.find(p => p.id === message.state.activeProxyId)
        : null;
      urlFilters = message.state.urlFilters || urlFilters;
      dataTrackingEnabled = message.state.settings?.dataTrackingEnabled ?? true;
    }
  });

  fetchConfig();

  if (typeof browser !== 'undefined' && browser.webRequest) {
    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        const result = testUrlAgainstFilters(details.url);
        if (!result.allowed) {
          return { cancel: true };
        }
        return { cancel: false };
      },
      { urls: ['<all_urls>'] },
      ['blocking']
    );
  }
})();